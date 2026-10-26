package com.kadreo.mobile;

import com.kadreo.mobile.MobileModels.BrigadeMember;
import com.kadreo.mobile.MobileModels.BrigadeShift;
import com.kadreo.mobile.MobileModels.BrigadeView;
import com.kadreo.mobile.MobileModels.Counters;
import com.kadreo.mobile.MobileModels.ManualClockInput;
import com.kadreo.mobile.MobileModels.MemberIssue;
import com.kadreo.mobile.MobileModels.Replacement;
import com.kadreo.mobile.MobileModels.ShiftOutput;
import com.kadreo.operations.Notifier;
import com.kadreo.operations.UrgentOffers;
import com.kadreo.organization.OrganizationModels.Position;
import com.kadreo.organization.OrganizationModels.ShiftTemplate;
import com.kadreo.organization.OrganizationModels.Site;
import com.kadreo.organization.OrganizationService;
import com.kadreo.platform.audit.AuditLog;
import com.kadreo.platform.security.CurrentUser;
import com.kadreo.platform.security.CurrentUserService;
import com.kadreo.platform.tenant.TenantContext;
import com.kadreo.platform.web.ApiException;
import com.kadreo.timetracking.ClockEvents;
import com.kadreo.timetracking.ClockEvents.Event;
import com.kadreo.timetracking.ClockEvents.NewEvent;
import com.kadreo.workforce.ScheduleService;
import com.kadreo.workforce.WorkforceModels.Assignment;
import com.kadreo.workforce.WorkforceModels.Worker;
import com.kadreo.workforce.WorkforceService;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
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

/**
 * The team leader's brigade (14.2): attendance of one shift of a site in real time, manual
 * clock-ins (four eyes), replacement requests and shift output. Managers open the same view of
 * any site in their scope (14.3-06).
 */
@Service
class TeamService {

    private final JdbcClient jdbc;
    private final Shifts shifts;
    private final OrganizationService org;
    private final WorkforceService workforce;
    private final ScheduleService schedule;
    private final ClockEvents clockEvents;
    private final UrgentOffers offers;
    private final Notifier notifier;
    private final CurrentUserService users;
    private final AuditLog audit;

    TeamService(JdbcClient jdbc, Shifts shifts, OrganizationService org, WorkforceService workforce, ScheduleService schedule, ClockEvents clockEvents, UrgentOffers offers,
            Notifier notifier, CurrentUserService users, AuditLog audit) {
        this.jdbc = jdbc;
        this.shifts = shifts;
        this.org = org;
        this.workforce = workforce;
        this.schedule = schedule;
        this.clockEvents = clockEvents;
        this.offers = offers;
        this.notifier = notifier;
        this.users = users;
        this.audit = audit;
    }

    /* ------------------------------------------------------------------ shifts */

    record Key(UUID siteId, LocalDate date, LocalTime start) {
        static Key parse(String s) {
            try {
                String[] p = s.split("\\|");
                return new Key(UUID.fromString(p[0]), LocalDate.parse(p[1]), LocalTime.parse(p[2]));
            } catch (Exception e) {
                throw ApiException.badRequest("shift");
            }
        }

        String text() {
            return siteId + "|" + date + "|" + start;
        }
    }

    /** The team leader's site: the one in their data scope. */
    private UUID leaderSite(CurrentUser u) {
        if (u.scope().siteIds().isEmpty()) throw ApiException.forbidden("team.read");
        return u.scope().siteIds().get(0);
    }

    private List<BrigadeShift> shiftsOf(Site site) {
        LocalDate today = schedule.today();
        List<ShiftTemplate> tpls = org.templates(org.projectOfSite(site.id()).id());
        Set<String> withPlan = workforce.plans(tpls.stream().map(ShiftTemplate::id).toList(), today, today.plusDays(1)).stream()
                .filter(p -> p.planned() > 0 && !p.cancelled()).map(p -> p.templateId() + "|" + p.date()).collect(Collectors.toSet());
        Map<String, BrigadeShift> out = new java.util.LinkedHashMap<>();
        for (LocalDate d : List.of(today, today.plusDays(1))) {
            for (ShiftTemplate t : tpls) {
                if (!withPlan.contains(t.id() + "|" + d)) continue;
                Key k = new Key(site.id(), d, t.start());
                out.putIfAbsent(k.text(), new BrigadeShift(k.text(), site.id(), site.name(), d, t.start().toString(), t.end().toString()));
            }
        }
        return out.values().stream().sorted(Comparator.comparing(BrigadeShift::date).thenComparing(BrigadeShift::start)).toList();
    }

    private Key currentKey(Site site) {
        List<BrigadeShift> list = shiftsOf(site);
        if (list.isEmpty()) throw ApiException.notFound();
        OffsetDateTime now = shifts.now();
        ZoneId zone = ZoneId.of(site.timeZone());
        BrigadeShift pick = null;
        for (BrigadeShift s : list) {
            ZonedDateTime start = LocalDateTime.of(s.date(), LocalTime.parse(s.start())).atZone(zone);
            ZonedDateTime end = LocalDateTime.of(LocalTime.parse(s.end()).isAfter(LocalTime.parse(s.start())) ? s.date() : s.date().plusDays(1), LocalTime.parse(s.end())).atZone(zone);
            if (!now.isBefore(start.toOffsetDateTime()) && now.isBefore(end.toOffsetDateTime())) return Key.parse(s.key());
            if (pick == null && now.isBefore(start.toOffsetDateTime())) pick = s;
        }
        return Key.parse((pick != null ? pick : list.get(0)).key());
    }

    /* ------------------------------------------------------------------ reads */

    @Transactional(readOnly = true)
    public BrigadeView brigade(String shiftKey) {
        CurrentUser u = users.require("team.read");
        Site site = org.site(leaderSite(u));
        Key key = shiftKey == null || shiftKey.isBlank() ? currentKey(site) : Key.parse(shiftKey);
        if (!key.siteId().equals(site.id())) throw ApiException.forbidden("team.read");
        UUID self = jdbc.sql("select worker_id from app_user where id = ?").param(u.id()).query(UUID.class).optional().orElse(null);
        return build(site, key, self);
    }

    /** The manager's view of a site's current shift (14.3-06). */
    @Transactional(readOnly = true)
    public BrigadeView siteBrigade(UUID siteId, Set<UUID> visibleSites) {
        if (!visibleSites.contains(siteId)) throw ApiException.notFound();
        Site site = org.site(siteId);
        return build(site, currentKey(site), null);
    }

    BrigadeView build(Site site, Key key, UUID excludeWorker) {
        Shifts.SiteExtra extra = shifts.extra(site.id());
        List<ShiftTemplate> tpls = org.templates(org.projectOfSite(site.id()).id()).stream().filter(t -> t.start().equals(key.start())).toList();
        if (tpls.isEmpty()) throw ApiException.notFound();
        Map<UUID, ShiftTemplate> tplById = tpls.stream().collect(Collectors.toMap(ShiftTemplate::id, Function.identity()));
        Map<UUID, Position> positions = shifts.positions();
        ZoneId zone = ZoneId.of(site.timeZone());
        ZonedDateTime start = LocalDateTime.of(key.date(), key.start()).atZone(zone);
        LocalTime endTime = tpls.get(0).end();
        ZonedDateTime end = LocalDateTime.of(endTime.isAfter(key.start()) ? key.date() : key.date().plusDays(1), endTime).atZone(zone);
        OffsetDateTime now = shifts.now();
        long elapsed = Duration.between(start.toOffsetDateTime(), now).toMinutes();

        List<Assignment> all = workforce.assignments(tplById.keySet(), key.date(), key.date()).stream().filter(Assignment::active).filter(a -> !a.workerId().equals(excludeWorker)).toList();
        Set<UUID> replaced = all.stream().map(Assignment::replacesId).filter(Objects::nonNull).collect(Collectors.toSet());
        Map<UUID, List<Event>> events = clockEvents.ofAssignments(all.stream().map(Assignment::id).toList());
        Map<UUID, Worker> workers = workforce.workers(all.stream().map(Assignment::workerId).toList()).stream().collect(Collectors.toMap(Worker::id, Function.identity()));
        record Issue(UUID assignmentId, String kind, String time, String comment) {}
        Map<UUID, Issue> issues = new HashMap<>();
        if (!all.isEmpty()) {
            jdbc.sql("select assignment_id, kind, to_char(local_time, 'HH24:MI') as time, comment from clock_issue where status = 'open' and assignment_id = any(?) order by created_at")
                    .param(all.stream().map(Assignment::id).toArray(UUID[]::new)).query(Issue.class).list()
                    .forEach(i -> issues.put(i.assignmentId(), i));
        }
        Set<UUID> searching = offers.searching(all.stream().map(Assignment::id).toList());

        List<BrigadeMember> members = new ArrayList<>();
        for (Assignment a : all) {
            if (replaced.contains(a.id())) continue; // the replacement's card stands for this place
            Worker w = workers.get(a.workerId());
            List<Event> ev = events.getOrDefault(a.id(), List.of());
            Event firstIn = ev.stream().filter(e -> "in".equals(e.type())).findFirst().orElse(null);
            Issue issue = issues.get(a.id());
            boolean pendingManual = ev.stream().anyMatch(e -> "pending".equals(e.status()));
            boolean outside = ev.stream().anyMatch(e -> "flagged".equals(e.status()));
            String status;
            if (firstIn != null) {
                String st = Shifts.state(ev);
                status = pendingManual ? "manual_pending" : "on_break".equals(st) ? "on_break" : "finished".equals(st) ? "finished" : "on_site";
            } else if (elapsed < extra.noShowAfterMin() || (issue != null && "late".equals(issue.kind()))) {
                status = "late";
            } else {
                status = "no_show";
            }
            boolean notStarted = firstIn == null && elapsed < 0;
            int lateMin = firstIn != null ? shifts.lateMinutes(a, firstIn.at()) : (int) Math.max(0, elapsed);
            boolean attention = !notStarted && (List.of("no_show", "late", "manual_pending").contains(status) || outside || issue != null);
            ShiftTemplate t = tplById.get(a.templateId());
            members.add(new BrigadeMember(a.id(), a.templateId(), w.id(), w.firstName(), w.lastName(), w.number(), w.phone(), t.positionId(), positions.get(t.positionId()).name(), status,
                    firstIn == null ? null : firstIn.time(), lateMin, issue == null ? null : new MemberIssue(issue.kind(), issue.time(), issue.comment()), outside,
                    searching.contains(a.id()) ? new Replacement("searching", null, null) : null, a.replacesId() != null, attention));
        }
        Map<String, Integer> rank = Map.of("no_show", 0, "late", 1);
        members.sort(Comparator.comparingInt((BrigadeMember m) -> rank.getOrDefault(m.status(), m.needsAttention() ? 2 : 3)).thenComparing(BrigadeMember::lastName));
        Counters counters = new Counters(members.size(),
                (int) members.stream().filter(m -> List.of("on_site", "on_break", "finished", "manual_pending").contains(m.status())).count(),
                elapsed >= 0 ? (int) members.stream().filter(m -> "late".equals(m.status())).count() : 0,
                (int) members.stream().filter(m -> "no_show".equals(m.status())).count());

        ShiftOutput output = null;
        if (extra.outputNorm() != null) {
            record Out(int value, OffsetDateTime updatedAt) {}
            Out o = jdbc.sql("select value, updated_at from shift_output where site_id = ? and date = ? and start_time = ?").param(site.id()).param(key.date()).param(key.start())
                    .query(Out.class).optional().orElse(null);
            double total = Duration.between(start, end).toMinutes();
            double share = Math.min(1, Math.max(0, elapsed / total));
            output = new ShiftOutput(extra.outputNorm(), extra.outputUnit(), extra.outputSource(), o == null ? 0 : o.value(), o == null ? null : o.updatedAt(),
                    (int) Math.round(extra.outputNorm() * share));
        }
        BrigadeShift shift = new BrigadeShift(key.text(), site.id(), site.name(), key.date(), key.start().toString(), endTime.toString());
        return new BrigadeView(now, shift, shiftsOf(site), extra.noShowAfterMin(), counters, members, output);
    }

    /* ------------------------------------------------------------------ writes */

    private Assignment memberOfMySite(UUID assignmentId, CurrentUser u) {
        Assignment a = workforce.assignment(assignmentId);
        Site site = shifts.siteOfTemplate(org.template(a.templateId()));
        if (!u.scope().wholeTenant() && !u.scope().siteIds().contains(site.id()) && !u.scope().regions().contains(site.region())) throw ApiException.notFound();
        return a;
    }

    private BrigadeView viewAfter(Assignment a, CurrentUser u) {
        ShiftTemplate t = org.template(a.templateId());
        Site site = shifts.siteOfTemplate(t);
        UUID self = jdbc.sql("select worker_id from app_user where id = ?").param(u.id()).query(UUID.class).optional().orElse(null);
        return build(site, new Key(site.id(), a.date(), t.start()), self);
    }

    /** «Запросить замену» (14.2 process 1): one place, offered to the best candidates; the manager is told. */
    @Transactional
    public BrigadeView requestReplacement(UUID assignmentId) {
        CurrentUser u = users.current();
        if (!u.can("team.read") && !u.can("shift.urgent.create")) throw ApiException.forbidden("team.read");
        Assignment a = memberOfMySite(assignmentId, u);
        if (!offers.searching(List.of(a.id())).isEmpty()) throw ApiException.conflict(u.fullName(), "");
        offers.create(a.templateId(), a.date(), 1, null, 0, a.id(), "replacement");
        Site site = shifts.siteOfTemplate(org.template(a.templateId()));
        String name = workforce.worker(a.workerId()).fullName();
        notifier.toSiteManagers(site.id(), site.region(), Notifier.text("Запрос замены: " + name + " · " + site.name(), "Запит заміни: " + name + " · " + site.name(),
                "Prośba o zastępstwo: " + name + " · " + site.name(), "Replacement request: " + name + " · " + site.name()), null);
        return viewAfter(a, u);
    }

    /**
     * Manual clock-in by the team leader (14.2 process 2): source «manual», status «pending» until
     * a site manager approves it; never for themselves.
     */
    @Transactional
    public BrigadeView manualClock(ManualClockInput in) {
        CurrentUser u = users.require("clockevent.manual.create");
        Assignment a = memberOfMySite(in.assignmentId(), u);
        UUID self = jdbc.sql("select worker_id from app_user where id = ?").param(u.id()).query(UUID.class).optional().orElse(null);
        if (a.workerId().equals(self)) throw ApiException.forbidden("clockevent.manual.self");
        if (!List.of("no_gps", "no_phone", "camera", "other").contains(in.reason())) throw ApiException.badRequest("reason");
        if ("other".equals(in.reason()) && (in.comment() == null || in.comment().isBlank())) throw ApiException.badRequest("comment");
        if (!List.of("in", "break_start", "break_end", "out").contains(in.type())) throw ApiException.badRequest("type");
        LocalTime time;
        try {
            time = LocalTime.parse(in.time());
        } catch (Exception e) {
            throw ApiException.badRequest("time");
        }
        List<Event> ev = clockEvents.ofAssignments(List.of(a.id())).getOrDefault(a.id(), List.of());
        if (!Shifts.NEXT.get(Shifts.state(ev)).contains(in.type())) throw WorkerAppService.rejected("wrong_state", Map.of());
        ShiftTemplate t = org.template(a.templateId());
        Site site = shifts.siteOfTemplate(t);
        LocalDate day = time.isBefore(t.start()) && t.end().isBefore(t.start()) && time.isBefore(t.end()) ? a.date().plusDays(1) : a.date();
        OffsetDateTime at = LocalDateTime.of(day, time).atZone(ZoneId.of(site.timeZone())).toOffsetDateTime();
        if (at.isAfter(shifts.now().plusMinutes(5))) throw ApiException.badRequest("time_in_future");
        Event e = clockEvents.record(new NewEvent(a.workerId(), a.id(), site.id(), in.type(), at, shifts.now(), "manual", "pending", null, false, null, null, null,
                in.comment(), false, null, null, null, in.reason(), u.id(), u.fullName()));
        // The worker's open problem report about the same clock-in is answered by this record.
        jdbc.sql("update clock_issue set status = 'approved', decided_by = ?, decided_by_name = ?, decided_at = ?, clock_event_id = ? where assignment_id = ? and status = 'open' and kind <> 'late'")
                .param(u.id()).param(u.fullName()).param(shifts.now()).param(e.id()).param(a.id()).update();
        String name = workforce.worker(a.workerId()).fullName();
        notifier.toSiteManagers(site.id(), site.region(), Notifier.text("Ручная отметка на согласование: " + name, "Ручна відмітка на погодження: " + name,
                "Odbicie ręczne do zatwierdzenia: " + name, "Manual clock-in to approve: " + name), null);
        audit.record("clock_event", e.id(), "manual_create", null, in);
        return viewAfter(a, u);
    }

    @Transactional
    public BrigadeView recordOutput(String shiftKey, Integer value) {
        CurrentUser u = users.require("output.record");
        Key key = Key.parse(shiftKey);
        Site site = org.site(leaderSite(u));
        if (!key.siteId().equals(site.id())) throw ApiException.forbidden("output.record");
        Shifts.SiteExtra extra = shifts.extra(site.id());
        if (!"team_leader".equals(extra.outputSource())) throw ApiException.forbidden("output.client_source");
        if (value == null || value < 0 || value > 1_000_000) throw ApiException.badRequest("value");
        jdbc.sql("""
                insert into shift_output (tenant_id, site_id, date, start_time, value, updated_at, updated_by) values (?, ?, ?, ?, ?, ?, ?)
                on conflict (site_id, date, start_time) do update set value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by""")
                .param(TenantContext.requireTenantId()).param(site.id()).param(key.date()).param(key.start()).param(value).param(shifts.now()).param(u.id())
                .update();
        audit.record("shift_output", key.text(), "set", null, Map.of("value", value));
        UUID self = jdbc.sql("select worker_id from app_user where id = ?").param(u.id()).query(UUID.class).optional().orElse(null);
        return build(site, key, self);
    }

    /** A short answer to a worker's message (14.2-08), delivered as a notification until chat exists. */
    @Transactional
    public void reply(UUID workerId, String text) {
        CurrentUser u = users.require("team.read");
        if (text == null || text.isBlank() || text.length() > 500) throw ApiException.badRequest("text");
        Site site = org.site(leaderSite(u));
        boolean onMySite = jdbc.sql("""
                select exists (select 1 from assignment a join shift_template t on t.id = a.template_id join project p on p.id = t.project_id
                               where a.worker_id = ? and p.site_id = ? and a.date between ? and ?)""")
                .param(workerId).param(site.id()).param(schedule.today().minusDays(1)).param(schedule.today().plusDays(1))
                .query(Boolean.class).single();
        if (!onMySite) throw ApiException.notFound();
        String t = u.fullName() + ": " + text.trim();
        notifier.toWorkers(List.of(workerId), "mention", Notifier.text(t, t, t, t), null);
    }
}
