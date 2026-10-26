package com.kadreo.workforce;

import com.kadreo.organization.OrganizationModels.Competence;
import com.kadreo.organization.OrganizationModels.Position;
import com.kadreo.organization.OrganizationModels.ShiftTemplate;
import com.kadreo.organization.OrganizationModels.Site;
import com.kadreo.workforce.WorkforceModels.Assignment;
import com.kadreo.workforce.WorkforceModels.Document;
import com.kadreo.workforce.WorkforceModels.Worker;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Hard assignment constraints (spec 9.1) and the rule-based candidate score that the ML model has
 * to beat (16.5). Pure functions over a {@link Context}: the server applies them to manual
 * assignments, drag-and-drop and auto-assignment alike. Mirrors packages/domain/src/scoring.ts.
 */
public final class AssignmentRules {

    private static final LocalDate EPOCH = LocalDate.of(2026, 1, 1);
    /** Employer country for the posting (A1) rule; all legal entities are Polish (A-01). */
    private static final String EMPLOYER_COUNTRY = "PL";

    private AssignmentRules() {}

    /** Everything the rules need, loaded once per request. */
    public record Context(
            Map<UUID, ShiftTemplate> templates,
            Map<UUID, Position> positions,
            Map<UUID, Competence> competences,
            Map<UUID, List<Document>> documentsByWorker,
            Map<UUID, List<Assignment>> assignmentsByWorker) {

        public static Context of(Collection<ShiftTemplate> templates, Collection<Position> positions, Collection<Competence> competences, Collection<Document> documents, Collection<Assignment> assignments) {
            return new Context(
                    templates.stream().collect(Collectors.toMap(ShiftTemplate::id, Function.identity())),
                    positions.stream().collect(Collectors.toMap(Position::id, Function.identity())),
                    competences.stream().collect(Collectors.toMap(Competence::id, Function.identity())),
                    documents.stream().collect(Collectors.groupingBy(Document::workerId)),
                    assignments.stream().collect(Collectors.groupingBy(Assignment::workerId, Collectors.toCollection(ArrayList::new))));
        }

        /** Adds a tentative assignment (auto-assign preview) so later checks see it. */
        public void add(Assignment a) {
            assignmentsByWorker.computeIfAbsent(a.workerId(), k -> new ArrayList<>()).add(a);
        }
    }

    public record Tag(String kind, Integer count, Long km, String competenceId, String docType, LocalDate validTo) {
        static Tag shiftsHere(int n) { return new Tag("shifts_here", n, null, null, null, null); }
        static Tag distance(long km) { return new Tag("distance_km", null, km, null, null, null); }
        static Tag competence(UUID id) { return new Tag("competence", null, null, id.toString(), null, null); }
        static Tag prefersMorning() { return new Tag("prefers_morning", null, null, null, null, null); }
        static Tag docUntil(String type, LocalDate to) { return new Tag("doc_until", null, null, null, type, to); }
    }

    public record Warning(String kind, Double used, Integer limit) {}

    public record Score(UUID workerId, int score, List<Tag> tags, List<Warning> warnings) {}

    /** Document types required for this worker on this site and position (simplified 15.9 rule). */
    public static List<String> requiredDocuments(Context ctx, Site site, UUID positionId, Worker worker) {
        List<String> req = new ArrayList<>(List.of("medical", "bhp"));
        if (!"PL".equals(worker.citizenship())) req.add("work_permit");
        Position p = ctx.positions().get(positionId);
        if (p != null) {
            for (UUID c : p.competenceIds()) {
                Competence comp = ctx.competences().get(c);
                if (comp != null && comp.requiredDocumentType() != null) req.add(comp.requiredDocumentType());
            }
        }
        if (!EMPLOYER_COUNTRY.equals(site.country())) req.add("a1");
        return req;
    }

    private static long[] interval(LocalDate date, ShiftTemplate t) {
        long base = ChronoUnit.DAYS.between(EPOCH, date) * 1440;
        long s = base + t.start().toSecondOfDay() / 60;
        long e = base + t.end().toSecondOfDay() / 60;
        if (e <= s) e += 1440;
        return new long[] {s, e};
    }

    private static double weekHours(Context ctx, UUID workerId, LocalDate date) {
        LocalDate monday = date.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        LocalDate sunday = monday.plusDays(6);
        return ctx.assignmentsByWorker().getOrDefault(workerId, List.of()).stream()
                .filter(a -> a.active() && !a.date().isBefore(monday) && !a.date().isAfter(sunday))
                .mapToDouble(a -> {
                    ShiftTemplate t = ctx.templates().get(a.templateId());
                    return t == null ? 0 : t.hours();
                })
                .sum();
    }

    public static List<Constraints> check(Context ctx, Worker w, Site site, ShiftTemplate t, LocalDate date) {
        List<Constraints> out = new ArrayList<>();
        if (Set.of("vacation", "sick", "blocked", "dismissed").contains(w.status())
                && !(w.statusUntil() != null && date.isAfter(w.statusUntil()))) {
            out.add(Constraints.unavailable(w.status(), w.statusUntil()));
        }
        Position position = ctx.positions().get(t.positionId());
        if (position != null) {
            for (UUID c : position.competenceIds()) {
                if (!w.competenceIds().contains(c)) out.add(Constraints.missingCompetence(c.toString()));
            }
        }
        List<Document> docs = ctx.documentsByWorker().getOrDefault(w.id(), List.of());
        for (String type : requiredDocuments(ctx, site, t.positionId(), w)) {
            Document d = docs.stream().filter(x -> x.type().equals(type)).findFirst().orElse(null);
            if (d == null || d.validTo() == null || d.validTo().isBefore(date)) out.add(Constraints.documentInvalid(type, d == null ? null : d.validTo()));
        }
        long[] mine = interval(date, t);
        for (Assignment a : ctx.assignmentsByWorker().getOrDefault(w.id(), List.of())) {
            if (!a.active() || a.date().isBefore(date.minusDays(1)) || a.date().isAfter(date.plusDays(1))) continue;
            ShiftTemplate other = ctx.templates().get(a.templateId());
            if (other == null) continue;
            long[] theirs = interval(a.date(), other);
            if (mine[0] < theirs[1] && theirs[0] < mine[1]) {
                out.add(Constraints.overlap(a.date(), other.label()));
                continue;
            }
            double gap = (mine[0] >= theirs[1] ? mine[0] - theirs[1] : theirs[0] - mine[1]) / 60.0;
            // 11 hours of rest for employment contracts (Kodeks pracy); zlecenie and B2B: tenant setting.
            if ("uop".equals(w.contractKind()) && gap < 11) out.add(Constraints.restPeriod(Math.round(gap * 10) / 10.0));
        }
        double used = weekHours(ctx, w.id(), date);
        if (used + t.hours() > w.weeklyHourLimit()) out.add(Constraints.weeklyLimit(used + t.hours(), w.weeklyHourLimit()));
        return out;
    }

    public static double distanceKm(double lat1, double lng1, double lat2, double lng2) {
        double r = 6371;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double a = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) * Math.pow(Math.sin(dLng / 2), 2);
        return 2 * r * Math.asin(Math.sqrt(a));
    }

    public static Score score(Context ctx, Worker w, Site site, ShiftTemplate t, LocalDate date) {
        List<Tag> tags = new ArrayList<>();
        List<Warning> warnings = new ArrayList<>();
        int here = w.shiftsBySite().getOrDefault(site.id(), 0);
        long km = Math.round(distanceKm(w.homeLat(), w.homeLng(), site.lat(), site.lng()));
        // Experience on site: up to 45 points, saturating at 40 shifts. Distance: up to 30, zero at 40 km.
        double s = Math.min(45, here / 40.0 * 45);
        s += Math.max(0, 30 * (1 - km / 40.0));
        Position position = ctx.positions().get(t.positionId());
        List<UUID> required = position == null ? List.of() : position.competenceIds();
        long extra = w.competenceIds().stream()
                .filter(c -> !required.contains(c))
                .filter(c -> {
                    Competence comp = ctx.competences().get(c);
                    return comp == null || !"language".equals(comp.kind());
                })
                .count();
        s += Math.min(10, extra * 5);
        boolean morning = t.start().getHour() >= 5 && t.start().getHour() < 12;
        if (w.prefersMorning() && morning) s += 6;
        s += (w.rating() - 3.5) * 6;
        s += Math.min(4, w.badgeCount());

        if (here > 0) tags.add(Tag.shiftsHere(here));
        tags.add(Tag.distance(km));
        for (UUID c : required) if (w.competenceIds().contains(c)) tags.add(Tag.competence(c));
        if (w.prefersMorning() && morning) tags.add(Tag.prefersMorning());
        ctx.documentsByWorker().getOrDefault(w.id(), List.of()).stream()
                .filter(d -> d.validTo() != null && !d.validTo().isBefore(date))
                .min((a, b) -> a.validTo().compareTo(b.validTo()))
                .filter(d -> Set.of("bhp", "medical", "a1", "work_permit").contains(d.type()))
                .ifPresent(d -> tags.add(Tag.docUntil(d.type(), d.validTo())));

        double used = weekHours(ctx, w.id(), date);
        if (used + t.hours() > w.weeklyHourLimit() - 4) {
            warnings.add(new Warning("near_hour_limit", used, w.weeklyHourLimit()));
            s -= 8;
        }
        if (here == 0) {
            warnings.add(new Warning("first_on_site", null, null));
            s -= 4;
        } else if (here < 10) {
            warnings.add(new Warning("newcomer", null, null));
        }
        int score = (int) Math.max(0, Math.min(100, Math.round(s)));
        return new Score(w.id(), score, tags, warnings);
    }
}
