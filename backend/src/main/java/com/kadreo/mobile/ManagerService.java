package com.kadreo.mobile;

import com.fasterxml.jackson.databind.JsonNode;
import com.kadreo.mobile.MobileModels.BrigadeView;
import com.kadreo.mobile.MobileModels.Decision;
import com.kadreo.mobile.MobileModels.ManagerSummary;
import com.kadreo.mobile.MobileModels.OfferInput;
import com.kadreo.mobile.MobileModels.ProblemSite;
import com.kadreo.mobile.MobileModels.Staffing;
import com.kadreo.operations.DashboardService;
import com.kadreo.operations.DashboardService.SiteLive;
import com.kadreo.operations.Notifier;
import com.kadreo.operations.UrgentOffers;
import com.kadreo.organization.OrganizationModels.ShiftTemplate;
import com.kadreo.organization.OrganizationModels.Site;
import com.kadreo.organization.OrganizationService;
import com.kadreo.platform.audit.AuditLog;
import com.kadreo.platform.security.CurrentUser;
import com.kadreo.platform.security.CurrentUserService;
import com.kadreo.platform.web.ApiException;
import com.kadreo.timetracking.ClockEvents;
import com.kadreo.timetracking.ClockEvents.Event;
import com.kadreo.timetracking.ClockEvents.NewEvent;
import com.kadreo.timetracking.ClockQueries;
import com.kadreo.workforce.WorkforceModels.Assignment;
import com.kadreo.workforce.WorkforceModels.Worker;
import com.kadreo.workforce.WorkforceService;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** The manager's side of the app (14.3): summary, problem sites, decisions, offers, broadcasts. */
@Service
class ManagerService {

    private final JdbcClient jdbc;
    private final DashboardService dashboard;
    private final OrganizationService org;
    private final WorkforceService workforce;
    private final ClockEvents clockEvents;
    private final ClockQueries clockQueries;
    private final UrgentOffers offers;
    private final Notifier notifier;
    private final TeamService team;
    private final Shifts shifts;
    private final CurrentUserService users;
    private final AuditLog audit;

    ManagerService(JdbcClient jdbc, DashboardService dashboard, OrganizationService org, WorkforceService workforce, ClockEvents clockEvents, ClockQueries clockQueries,
            UrgentOffers offers, Notifier notifier, TeamService team, Shifts shifts, CurrentUserService users, AuditLog audit) {
        this.jdbc = jdbc;
        this.dashboard = dashboard;
        this.org = org;
        this.workforce = workforce;
        this.clockEvents = clockEvents;
        this.clockQueries = clockQueries;
        this.offers = offers;
        this.notifier = notifier;
        this.team = team;
        this.shifts = shifts;
        this.users = users;
        this.audit = audit;
    }

    private Set<UUID> visible() {
        return dashboard.visibleSites(new DashboardService.Filter(null, null)).stream().map(Site::id).collect(Collectors.toSet());
    }

    /* ------------------------------------------------------------------ summary */

    @Transactional(readOnly = true)
    public ManagerSummary summary() {
        users.require("dashboard.read");
        List<SiteLive> live = dashboard.sites(new DashboardService.Filter(null, null)).stream().filter(s -> s.planned() > 0).toList();
        int onShift = live.stream().mapToInt(SiteLive::actual).sum();
        int planned = live.stream().mapToInt(SiteLive::planned).sum();
        List<ProblemSite> problems = live.stream().filter(s -> !"ok".equals(s.status()))
                .map(this::problem)
                .sorted(Comparator.comparingInt((ProblemSite p) -> "critical".equals(p.severity()) ? 0 : 1)
                        .thenComparing(Comparator.comparingInt(ProblemSite::unreplaced).reversed())
                        .thenComparing(Comparator.comparingInt((ProblemSite p) -> p.planned() - p.onSite()).reversed()))
                .toList();
        List<Decision> decisions = decisionsList();
        int openAlerts = jdbc.sql("select count(*) from alert where status <> 'closed' and site_id = any(?)").param(visible().toArray(UUID[]::new)).query(Integer.class).single();
        return new ManagerSummary(shifts.now(), live.size(), new Staffing(onShift, planned, planned == 0 ? 100 : Math.round(onShift * 1000.0 / planned) / 10.0, targetPct()),
                problems.stream().limit(3).toList(), problems.size(), decisions.stream().limit(3).toList(), decisions.size(), openAlerts);
    }

    /** Staffing target: the tenant default (contracts may override per client, 14.3-03). */
    private double targetPct() {
        JsonNode kpi = org.contracts().stream().map(c -> c.kpiTargets()).filter(Objects::nonNull).findFirst().orElse(null);
        return kpi != null && kpi.has("staffingPct") ? kpi.get("staffingPct").asDouble() : 98;
    }

    private ProblemSite problem(SiteLive s) {
        // The no-show to replace: a running shift's assignment without a clock-in and without a replacement.
        Site site = org.site(s.siteId());
        ZoneId zone = ZoneId.of(site.timeZone());
        OffsetDateTime now = shifts.now();
        LocalDate day = now.atZoneSameInstant(zone).toLocalDate();
        List<ShiftTemplate> tpls = org.templates(org.projectOfSite(site.id()).id());
        List<Assignment> todays = workforce.assignments(tpls.stream().map(ShiftTemplate::id).toList(), day, day).stream().filter(Assignment::active).toList();
        Set<UUID> replaced = todays.stream().map(Assignment::replacesId).filter(Objects::nonNull).collect(Collectors.toSet());
        Map<UUID, OffsetDateTime> ins = clockQueries.firstClockIns(todays.stream().map(Assignment::id).toList());
        Map<UUID, ShiftTemplate> byId = tpls.stream().collect(Collectors.toMap(ShiftTemplate::id, Function.identity()));
        Set<UUID> searching = offers.searching(todays.stream().map(Assignment::id).toList());
        Assignment noShow = todays.stream()
                .filter(a -> !ins.containsKey(a.id()) && !replaced.contains(a.id()) && !searching.contains(a.id()))
                .filter(a -> {
                    ShiftTemplate t = byId.get(a.templateId());
                    OffsetDateTime start = LocalDateTime.of(day, t.start()).atZone(zone).toOffsetDateTime();
                    OffsetDateTime end = LocalDateTime.of(t.end().isAfter(t.start()) ? day : day.plusDays(1), t.end()).atZone(zone).toOffsetDateTime();
                    return now.isAfter(start.plusMinutes(30)) && now.isBefore(end);
                })
                .min(Comparator.comparing(Assignment::id)).orElse(null);
        return new ProblemSite(s.siteId(), s.siteName(), s.actual(), s.planned(), "critical".equals(s.status()) ? "critical" : "warn", s.noShows(), s.noShows() - s.noShowsReplaced(),
                s.late(), noShow == null ? null : noShow.templateId(), noShow == null ? null : noShow.id());
    }

    /* ---------------------------------------------------------------- decisions */

    @Transactional(readOnly = true)
    public List<Decision> decisions() {
        users.require("clockevent.manual.approve");
        return decisionsList();
    }

    private List<Decision> decisionsList() {
        CurrentUser u = users.current();
        if (!u.can("clockevent.manual.approve")) return List.of();
        Set<UUID> sites = visible();
        Map<UUID, String> siteNames = org.sites().stream().collect(Collectors.toMap(Site::id, Site::name));
        List<Decision> out = new ArrayList<>();
        List<Event> pending = clockEvents.pending(sites);
        Map<UUID, Worker> workers = workforce.workers(pending.stream().map(Event::workerId).toList()).stream().collect(Collectors.toMap(Worker::id, Function.identity()));
        for (Event e : pending) {
            out.add(new Decision(e.id(), "manual_clock", workers.get(e.workerId()).fullName(), siteNames.get(e.siteId()), Objects.requireNonNullElse(e.createdByName(), ""),
                    jdbc.sql("select server_time from clock_event where id = ?").param(e.id()).query(OffsetDateTime.class).single(), e.time(), e.type(),
                    e.assignmentId() == null ? "no_shift" : Objects.requireNonNullElse(e.manualReason(), "other"), Objects.requireNonNullElse(e.comment(), "")));
        }
        record Issue(UUID id, UUID siteId, String createdByName, OffsetDateTime createdAt, String time, String type, String kind, String comment) {}
        if (!sites.isEmpty()) {
            jdbc.sql("""
                    select i.id, p.site_id, i.created_by_name, i.created_at, to_char(i.local_time, 'HH24:MI') as time, i.type, i.kind, i.comment
                    from clock_issue i join assignment a on a.id = i.assignment_id join shift_template t on t.id = a.template_id join project p on p.id = t.project_id
                    where i.status = 'open' and i.kind <> 'late' and p.site_id = any(?)""")
                    .param(sites.toArray(UUID[]::new)).query(Issue.class).list()
                    .forEach(i -> out.add(new Decision(i.id(), "clock_issue", i.createdByName(), siteNames.get(i.siteId()), i.createdByName(), i.createdAt(), i.time(), i.type(), i.kind(),
                            i.comment())));
        }
        out.sort(Comparator.comparing(Decision::at).reversed());
        return out;
    }

    /**
     * ✓ / ✕ on a decision (14.3-07). Four eyes: nobody approves their own request. Approving a
     * problem report creates the manual clock event with the approver's name.
     */
    @Transactional
    public void decide(String kind, UUID id, String decision, String reason) {
        CurrentUser u = users.require("clockevent.manual.approve");
        boolean approve = switch (decision == null ? "" : decision) {
            case "approve" -> true;
            case "reject" -> false;
            default -> throw ApiException.badRequest("decision");
        };
        if (!approve && (reason == null || reason.isBlank())) throw ApiException.badRequest("reason");
        if (reason != null && reason.length() > 300) throw ApiException.badRequest("reason");
        Set<UUID> sites = visible();
        if ("manual_clock".equals(kind)) {
            Event e = jdbc.sql("select id from clock_event where id = ?").param(id).query(UUID.class).optional().map(clockEvents::byId).orElseThrow(ApiException::notFound);
            if (!sites.contains(e.siteId())) throw ApiException.notFound();
            UUID createdBy = jdbc.sql("select created_by from clock_event where id = ?").param(id).query(UUID.class).optional().orElse(null);
            if (u.id().equals(createdBy)) throw ApiException.forbidden("four_eyes");
            if (!clockEvents.decide(id, approve, u.id(), u.fullName(), reason, shifts.now())) throw ApiException.conflict("", "");
            notifyWorker(e.workerId(), approve, reason);
            audit.record("clock_event", id, approve ? "approve" : "reject", null, reason == null ? Map.of() : Map.of("reason", reason));
            return;
        }
        if (!"clock_issue".equals(kind)) throw ApiException.notFound();
        record Issue(UUID id, UUID workerId, UUID assignmentId, String type, LocalTime localTime, String comment, String kind, String status, UUID createdBy, String createdByName) {}
        Issue i = jdbc.sql("select id, worker_id, assignment_id, type, local_time, comment, kind, status, created_by, created_by_name from clock_issue where id = ? for update")
                .param(id).query(Issue.class).optional().orElseThrow(ApiException::notFound);
        Assignment a = workforce.assignment(i.assignmentId());
        ShiftTemplate t = org.template(a.templateId());
        Site site = shifts.siteOfTemplate(t);
        if (!sites.contains(site.id())) throw ApiException.notFound();
        if (u.id().equals(i.createdBy())) throw ApiException.forbidden("four_eyes");
        if (!"open".equals(i.status())) throw ApiException.conflict("", "");
        UUID eventId = null;
        if (approve) {
            LocalDate day = i.localTime().isBefore(t.start()) && t.end().isBefore(t.start()) && i.localTime().isBefore(t.end()) ? a.date().plusDays(1) : a.date();
            OffsetDateTime at = LocalDateTime.of(day, i.localTime()).atZone(ZoneId.of(site.timeZone())).toOffsetDateTime();
            Event e = clockEvents.record(new NewEvent(i.workerId(), a.id(), site.id(), i.type(), at, shifts.now(), "manual", "accepted", null, false, null, null, null, i.comment(), false,
                    null, null, null, i.kind(), i.createdBy(), i.createdByName()));
            clockEvents.decide(e.id(), true, u.id(), u.fullName(), null, shifts.now());
            eventId = e.id();
        }
        jdbc.sql("update clock_issue set status = ?, decided_by = ?, decided_by_name = ?, decided_at = ?, decision_reason = ?, clock_event_id = ? where id = ?")
                .param(approve ? "approved" : "rejected").param(u.id()).param(u.fullName()).param(shifts.now()).param(reason).param(eventId).param(id)
                .update();
        notifyWorker(i.workerId(), approve, reason);
        audit.record("clock_issue", id, approve ? "approve" : "reject", null, reason == null ? Map.of() : Map.of("reason", reason));
    }

    private void notifyWorker(UUID workerId, boolean approve, String reason) {
        notifier.toWorkers(List.of(workerId), "approval", approve
                ? Notifier.text("Отметка одобрена", "Відмітку схвалено", "Odbicie zatwierdzone", "Clock-in approved")
                : Notifier.text("Отметка отклонена: " + reason, "Відмітку відхилено: " + reason, "Odbicie odrzucone: " + reason, "Clock-in rejected: " + reason), "kadreo://clock");
    }

    /* ------------------------------------------------------------- site, offers */

    @Transactional(readOnly = true)
    public BrigadeView siteBrigade(UUID siteId) {
        users.require("dashboard.read");
        return team.siteBrigade(siteId, visible());
    }

    /** «Найти замену» with chosen candidates (14.3-05): one place, the first to accept gets it. */
    @Transactional
    public Map<String, Integer> offer(OfferInput in) {
        users.require("shift.urgent.create");
        if (in.workerIds() == null || in.workerIds().isEmpty() || in.workerIds().size() > 20) throw ApiException.badRequest("workerIds");
        if (in.templateId() == null || in.date() == null) throw ApiException.badRequest("templateId, date");
        Site site = shifts.siteOfTemplate(org.template(in.templateId()));
        if (!visible().contains(site.id())) throw ApiException.notFound();
        if (in.replacesId() != null && !offers.searching(List.of(in.replacesId())).isEmpty()) throw ApiException.conflict("", "");
        var created = offers.create(in.templateId(), in.date(), 1, in.workerIds(), in.bonusPoints() == null ? 0 : in.bonusPoints(), in.replacesId(), "replacement");
        return Map.of("offered", created.offered());
    }

    /** «Рассылка бригаде» (14.3-09): to the app accounts of workers on the site's shifts today. */
    @Transactional
    public Map<String, Integer> broadcast(UUID siteId, String text) {
        CurrentUser u = users.require("shift.urgent.create");
        if (text == null || text.isBlank() || text.length() > 500) throw ApiException.badRequest("text");
        if (!visible().contains(siteId)) throw ApiException.notFound();
        Site site = org.site(siteId);
        LocalDate day = shifts.now().atZoneSameInstant(ZoneId.of(site.timeZone())).toLocalDate();
        List<UUID> tpls = org.templates(org.projectOfSite(siteId).id()).stream().map(ShiftTemplate::id).toList();
        Set<UUID> workers = workforce.assignments(tpls, day, day).stream().filter(Assignment::active).map(Assignment::workerId).collect(Collectors.toSet());
        String t = site.name() + " · " + text.trim();
        notifier.toWorkers(workers, "mention", Notifier.text(t, t, t, t), null);
        audit.record("broadcast", siteId, "send", null, Map.of("by", u.fullName(), "recipients", workers.size()));
        return Map.of("recipients", workers.size());
    }
}
