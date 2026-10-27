package com.kadreo.timetracking;

import com.kadreo.organization.OrganizationModels.Contract;
import com.kadreo.organization.OrganizationModels.Project;
import com.kadreo.organization.OrganizationModels.ShiftTemplate;
import com.kadreo.organization.OrganizationModels.Site;
import com.kadreo.organization.OrganizationService;
import com.kadreo.platform.tenant.TenantContext;
import com.kadreo.platform.util.Ids;
import com.kadreo.timetracking.ClockEvents.ClockEventChanged;
import com.kadreo.timetracking.ClockEvents.Event;
import com.kadreo.timetracking.HoursCalculator.Ev;
import com.kadreo.timetracking.HoursCalculator.Result;
import com.kadreo.timetracking.HoursCalculator.Rules;
import com.kadreo.workforce.WorkforceModels.Assignment;
import com.kadreo.workforce.WorkforceService;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The timesheet follows the clock (spec 9.2): every change of an assignment's clock events
 * recomputes its day by the contract's rules ({@link HoursCalculator}); a period's timesheet is
 * created when the first event of it arrives or someone opens it. Days a manager corrected, the
 * client confirmed or disputed, and timesheets already sent to the client are not touched.
 */
@Service
public class TimesheetLive {

    private final JdbcClient jdbc;
    private final OrganizationService org;
    private final WorkforceService workforce;
    private final ClockEvents clockEvents;
    private final Clock clock;

    public TimesheetLive(JdbcClient jdbc, OrganizationService org, WorkforceService workforce, ClockEvents clockEvents, Clock clock) {
        this.jdbc = jdbc;
        this.org = org;
        this.workforce = workforce;
        this.clockEvents = clockEvents;
        this.clock = clock;
    }

    record Period(LocalDate from, LocalDate to) {}

    record Header(UUID id, LocalDate periodFrom, LocalDate periodTo, String clientStage) {}

    /** The project's period that contains the date: continues the last existing period by the contract's length. */
    Period periodFor(Project p, LocalDate date) {
        Contract c = org.contract(p.contractId());
        Header last = jdbc.sql("select id, period_from, period_to, client_stage from timesheet where project_id = ? and period_from <= ? order by period_from desc limit 1")
                .param(p.id()).param(date).query(Header.class).optional().orElse(null);
        if (last != null && !date.isAfter(last.periodTo())) return new Period(last.periodFrom(), last.periodTo());
        LocalDate from = last != null ? last.periodTo().plusDays(1) : start(c.timesheetPeriod(), date);
        while (true) {
            LocalDate to = end(c.timesheetPeriod(), from);
            if (!date.isAfter(to)) return new Period(from, to);
            from = to.plusDays(1);
        }
    }

    private static LocalDate start(String period, LocalDate date) {
        return "month".equals(period) ? date.withDayOfMonth(1) : date.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
    }

    private static LocalDate end(String period, LocalDate from) {
        return switch (period) {
            case "month" -> from.with(TemporalAdjusters.lastDayOfMonth());
            case "two_weeks" -> from.plusDays(13);
            default -> from.plusDays(6);
        };
    }

    /** The timesheet of the period containing the date; created with its entries if missing. */
    @Transactional
    public UUID ensure(UUID projectId, LocalDate date) {
        Project p = org.project(projectId);
        Period period = periodFor(p, date);
        UUID existing = jdbc.sql("select id from timesheet where project_id = ? and period_from = ?").param(projectId).param(period.from()).query(UUID.class).optional().orElse(null);
        if (existing != null) return existing;
        UUID id = Ids.newId();
        jdbc.sql("insert into timesheet (id, tenant_id, project_id, period_from, period_to) values (?, ?, ?, ?, ?) on conflict (project_id, period_from) do nothing")
                .param(id).param(TenantContext.requireTenantId()).param(projectId).param(period.from()).param(period.to())
                .update();
        UUID tsId = jdbc.sql("select id from timesheet where project_id = ? and period_from = ?").param(projectId).param(period.from()).query(UUID.class).single();
        List<ShiftTemplate> templates = org.templates(projectId);
        List<Assignment> assignments = workforce.assignments(templates.stream().map(ShiftTemplate::id).toList(), period.from(), period.to()).stream()
                .filter(a -> "confirmed".equals(a.status()) || "proposed".equals(a.status())).toList();
        Map<UUID, List<Event>> events = clockEvents.ofAssignments(assignments.stream().map(Assignment::id).toList());
        for (Assignment a : assignments) upsert(tsId, a, events.getOrDefault(a.id(), List.of()), false);
        return tsId;
    }

    @EventListener
    void on(ClockEventChanged e) {
        recalculate(e.assignmentId());
    }

    /** Recomputes the assignment's day from its clock events. */
    @Transactional
    public void recalculate(UUID assignmentId) {
        Assignment a = workforce.assignment(assignmentId);
        ShiftTemplate t = org.template(a.templateId());
        UUID tsId = ensure(t.projectId(), a.date());
        upsert(tsId, a, clockEvents.ofAssignments(List.of(a.id())).getOrDefault(a.id(), List.of()), true);
    }

    record Guard(UUID id, boolean locked) {}

    private void upsert(UUID timesheetId, Assignment a, List<Event> events, boolean onlyIfOpen) {
        ShiftTemplate t = org.template(a.templateId());
        Project p = org.project(t.projectId());
        Site site = org.site(p.siteId());
        record ContractRules(int roundingMinutes, boolean paidBreaks) {}
        ContractRules cr = jdbc.sql("select rounding_minutes, paid_breaks from contract where id = ?").param(p.contractId()).query(ContractRules.class).single();
        ZoneId zone = ZoneId.of(site.timeZone());
        OffsetDateTime start = LocalDateTime.of(a.date(), t.start()).atZone(zone).toOffsetDateTime();
        OffsetDateTime end = LocalDateTime.of(t.end().isAfter(t.start()) ? a.date() : a.date().plusDays(1), t.end()).atZone(zone).toOffsetDateTime();
        Result r = HoursCalculator.compute(start, end, events.stream().map(e -> new Ev(e.type(), e.at(), e.status())).toList(),
                new Rules(cr.roundingMinutes(), cr.paidBreaks(), site.lateThresholdMin(), t.unpaidBreakMin()), OffsetDateTime.now(clock));
        OffsetDateTime now = OffsetDateTime.now(clock);

        Guard g = jdbc.sql("""
                select e.id, (ts.client_stage <> 'not_sent' or e.client_confirmed_at is not null or e.disputed
                              or exists (select 1 from timesheet_correction c where c.entry_id = e.id)) as locked
                from timesheet_entry e join timesheet ts on ts.id = e.timesheet_id where e.timesheet_id = ? and e.worker_id = ? and e.date = ?""")
                .param(timesheetId).param(a.workerId()).param(a.date()).query(Guard.class).optional().orElse(null);
        if (g == null) {
            String stage = jdbc.sql("select client_stage from timesheet where id = ?").param(timesheetId).query(String.class).single();
            if (onlyIfOpen && !"not_sent".equals(stage)) return;
            jdbc.sql("""
                    insert into timesheet_entry (id, tenant_id, timesheet_id, worker_id, position_id, assignment_id, date, shift_label, planned_hours, payable_hours, billable_hours,
                        issue_kind, issue_minutes, computed_at)
                    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""")
                    .param(Ids.newId()).param(TenantContext.requireTenantId()).param(timesheetId).param(a.workerId()).param(t.positionId()).param(a.id()).param(a.date())
                    .param(t.label()).param(t.hours()).param(r.hours()).param(r.hours()).param(r.issueKind()).param(r.issueMinutes()).param(now)
                    .update();
            return;
        }
        if (g.locked()) return;
        jdbc.sql("""
                update timesheet_entry set assignment_id = ?, payable_hours = ?, billable_hours = ?, issue_kind = ?, issue_minutes = ?, computed_at = ?, version = version + 1
                where id = ?""")
                .param(a.id()).param(r.hours()).param(r.hours()).param(r.issueKind()).param(r.issueMinutes()).param(now).param(g.id())
                .update();
    }
}
