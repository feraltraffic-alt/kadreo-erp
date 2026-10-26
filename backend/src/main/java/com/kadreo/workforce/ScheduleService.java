package com.kadreo.workforce;

import com.kadreo.organization.OrganizationModels.Client;
import com.kadreo.organization.OrganizationModels.Project;
import com.kadreo.organization.OrganizationModels.ShiftTemplate;
import com.kadreo.organization.OrganizationModels.Site;
import com.kadreo.organization.OrganizationService;
import com.kadreo.platform.audit.AuditLog;
import com.kadreo.platform.security.CurrentUser;
import com.kadreo.platform.security.CurrentUserService;
import com.kadreo.platform.tenant.TenantContext;
import com.kadreo.platform.util.Ids;
import com.kadreo.platform.util.Json;
import com.kadreo.platform.web.ApiException;
import com.kadreo.workforce.AssignmentRules.Context;
import com.kadreo.workforce.AssignmentRules.Score;
import com.kadreo.workforce.WorkforceModels.Assignment;
import com.kadreo.workforce.WorkforceModels.ShiftPlan;
import com.kadreo.workforce.WorkforceModels.Worker;
import com.kadreo.workforce.WorkforceModels.WorkerBrief;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Shift planning (spec 9.1): grid, candidates, assignments, plan changes, auto-assign, publish. */
@Service
public class ScheduleService {

    public static final ZoneId TENANT_ZONE = ZoneId.of("Europe/Warsaw");

    private final JdbcClient jdbc;
    private final OrganizationService org;
    private final WorkforceService workforce;
    private final CurrentUserService users;
    private final AuditLog audit;
    private final Clock clock;
    private final ApplicationEventPublisher events;

    public ScheduleService(JdbcClient jdbc, OrganizationService org, WorkforceService workforce, CurrentUserService users, AuditLog audit, Clock clock, ApplicationEventPublisher events) {
        this.jdbc = jdbc;
        this.org = org;
        this.workforce = workforce;
        this.users = users;
        this.audit = audit;
        this.clock = clock;
        this.events = events;
    }

    public LocalDate today() {
        return LocalDate.now(clock.withZone(TENANT_ZONE));
    }

    /* ------------------------------------------------------------------- read models */

    public record Cell(LocalDate date, Integer planned, int assigned, boolean cancelled) {}

    public record Row(UUID templateId, UUID positionId, String start, String end, List<Cell> cells) {}

    public record Schedule(Project project, Site site, Client client, LocalDate from, LocalDate to, String publishState, int filled, int total, List<Row> rows) {}

    public record ProjectListItem(Project project, Site site, Client client, int filledThisWeek, int totalThisWeek) {}

    public record CellAssignment(Assignment assignment, WorkerBrief worker) {}

    public record Candidate(UUID workerId, int score, List<AssignmentRules.Tag> tags, List<AssignmentRules.Warning> warnings, String firstName, String lastName, String number) {}

    /** Domain event: the week's schedule was published; notifications go to assigned workers. */
    public record SchedulePublished(UUID tenantId, UUID projectId, LocalDate monday, Set<UUID> workerIds) {}

    @Transactional(readOnly = true)
    public Schedule schedule(UUID projectId, LocalDate from, LocalDate to) {
        users.require("shift.schedule.read");
        Project project = org.project(projectId);
        Site site = org.site(project.siteId());
        List<ShiftTemplate> templates = org.templates(projectId);
        return build(project, site, org.client(site.clientId()), templates, from, to);
    }

    private Schedule build(Project project, Site site, Client client, List<ShiftTemplate> templates, LocalDate from, LocalDate to) {
        List<UUID> ids = templates.stream().map(ShiftTemplate::id).toList();
        Map<String, ShiftPlan> plans = workforce.plans(ids, from, to).stream().collect(Collectors.toMap(p -> p.templateId() + "|" + p.date(), Function.identity()));
        Map<String, List<Assignment>> byCell = workforce.assignments(ids, from, to).stream().filter(Assignment::active).collect(Collectors.groupingBy(a -> a.templateId() + "|" + a.date()));
        int filled = 0;
        int total = 0;
        List<Row> rows = new ArrayList<>();
        for (ShiftTemplate t : templates) {
            List<Cell> cells = new ArrayList<>();
            for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) {
                ShiftPlan plan = plans.get(t.id() + "|" + d);
                int assigned = countFilled(byCell.getOrDefault(t.id() + "|" + d, List.of()));
                boolean active = plan != null && !plan.cancelled();
                if (active) {
                    total += plan.planned();
                    filled += Math.min(assigned, plan.planned());
                }
                cells.add(new Cell(d, active ? plan.planned() : null, assigned, plan != null && plan.cancelled()));
            }
            rows.add(new Row(t.id(), t.positionId(), t.start().toString(), t.end().toString(), cells));
        }
        return new Schedule(project, site, client, from, to, publishState(project.id(), from), filled, total, rows);
    }

    /** An assignment replaced after a no-show no longer fills its place. */
    private static int countFilled(List<Assignment> cell) {
        Set<UUID> replaced = cell.stream().map(Assignment::replacesId).filter(java.util.Objects::nonNull).collect(Collectors.toSet());
        return (int) cell.stream().filter(a -> !replaced.contains(a.id())).count();
    }

    private String publishState(UUID projectId, LocalDate monday) {
        return jdbc.sql("select state from schedule_week where project_id = ? and monday = ?").param(projectId).param(monday).query(String.class).optional().orElse("draft");
    }

    @Transactional(readOnly = true)
    public List<ProjectListItem> projects(LocalDate weekOf) {
        users.require("shift.schedule.read");
        LocalDate monday = weekOf.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        Map<UUID, Site> sites = org.sites().stream().collect(Collectors.toMap(Site::id, Function.identity()));
        Map<UUID, Client> clients = org.clients().stream().collect(Collectors.toMap(Client::id, Function.identity()));
        Map<UUID, List<ShiftTemplate>> templates = org.allTemplates().stream().collect(Collectors.groupingBy(ShiftTemplate::projectId));
        CurrentUser user = users.current();
        return org.projects().stream()
                .filter(p -> inScope(user, sites.get(p.siteId())))
                .map(p -> {
                    Site s = sites.get(p.siteId());
                    Schedule sch = build(p, s, clients.get(s.clientId()), templates.getOrDefault(p.id(), List.of()), monday, monday.plusDays(6));
                    return new ProjectListItem(p, s, clients.get(s.clientId()), sch.filled(), sch.total());
                })
                .toList();
    }

    static boolean inScope(CurrentUser u, Site s) {
        if (u.scope().wholeTenant()) return true;
        return u.scope().siteIds().contains(s.id()) || u.scope().regions().contains(s.region());
    }

    @Transactional(readOnly = true)
    public List<CellAssignment> cellAssignments(UUID templateId, LocalDate date) {
        users.require("shift.schedule.read");
        List<Assignment> cell = workforce.assignments(List.of(templateId), date, date).stream().filter(Assignment::active).toList();
        Set<UUID> replaced = cell.stream().map(Assignment::replacesId).filter(java.util.Objects::nonNull).collect(Collectors.toSet());
        List<Assignment> shown = cell.stream().filter(a -> !replaced.contains(a.id())).toList();
        Map<UUID, WorkerBrief> briefs = workforce.briefs(shown.stream().map(Assignment::workerId).toList());
        return shown.stream()
                .map(a -> new CellAssignment(a, briefs.get(a.workerId())))
                .sorted(Comparator.comparing(c -> c.worker().lastName()))
                .toList();
    }

    /* ------------------------------------------------------------ rules context */

    private Context context(LocalDate from, LocalDate to) {
        LocalDate monday = from.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        LocalDate sunday = to.with(TemporalAdjusters.nextOrSame(DayOfWeek.SUNDAY));
        return Context.of(org.allTemplates(), org.positions(), org.competences(), workforce.documents(), workforce.activeAssignments(monday.minusDays(1), sunday.plusDays(1)));
    }

    public record CandidateFilter(Integer maxKm, boolean experiencedOnly, boolean noOvertime) {}

    @Transactional(readOnly = true)
    public List<Candidate> candidates(UUID templateId, LocalDate date, CandidateFilter filter) {
        users.require("shift.schedule.read");
        ShiftTemplate t = org.template(templateId);
        Site site = org.site(org.project(t.projectId()).siteId());
        Context ctx = context(date, date);
        var position = ctx.positions().get(t.positionId());
        List<Candidate> out = new ArrayList<>();
        for (Worker w : workforce.workers()) {
            boolean fits = w.positionIds().contains(t.positionId()) || (position != null && w.competenceIds().containsAll(position.competenceIds()) && !position.competenceIds().isEmpty());
            if (!fits) continue;
            if (!AssignmentRules.check(ctx, w, site, t, date).isEmpty()) continue;
            Score s = AssignmentRules.score(ctx, w, site, t, date);
            long km = s.tags().stream().filter(x -> "distance_km".equals(x.kind())).mapToLong(x -> x.km()).findFirst().orElse(0);
            if (filter.maxKm() != null && km > filter.maxKm()) continue;
            if (filter.experiencedOnly() && w.shiftsBySite().getOrDefault(site.id(), 0) == 0) continue;
            if (filter.noOvertime() && s.warnings().stream().anyMatch(x -> "near_hour_limit".equals(x.kind()))) continue;
            out.add(new Candidate(w.id(), s.score(), s.tags(), s.warnings(), w.firstName(), w.lastName(), w.number()));
        }
        out.sort(Comparator.comparingInt(Candidate::score).reversed());
        return out.size() > 20 ? out.subList(0, 20) : out;
    }

    /* -------------------------------------------------------------------- writes */

    @Transactional
    public Assignment assign(UUID workerId, UUID templateId, LocalDate date, String source) {
        users.require("shift.schedule.edit");
        if (date.isBefore(today())) throw ApiException.badRequest("past_date");
        ShiftTemplate t = org.template(templateId);
        Site site = org.site(org.project(t.projectId()).siteId());
        Worker w = workforce.worker(workerId);
        List<Constraints> violations = AssignmentRules.check(context(date, date), w, site, t, date);
        if (!violations.isEmpty()) throw ApiException.constraint(violations);
        Assignment a = new Assignment(Ids.newId(), workerId, templateId, date, "proposed", source == null ? "manual" : source, null);
        jdbc.sql("insert into assignment (id, tenant_id, worker_id, template_id, date, status, source, created_by) values (?, ?, ?, ?, ?, ?, ?, ?)")
                .param(a.id()).param(TenantContext.requireTenantId()).param(workerId).param(templateId).param(date).param(a.status()).param(a.source()).param(TenantContext.userId())
                .update();
        audit.record("assignment", a.id(), "create", null, a);
        touch(t.projectId(), date);
        return a;
    }

    @Transactional
    public void unassign(UUID id) {
        users.require("shift.schedule.edit");
        Assignment a = workforce.assignment(id);
        jdbc.sql("update assignment set status = 'cancelled', updated_at = now(), updated_by = ?, version = version + 1 where id = ?").param(TenantContext.userId()).param(id).update();
        audit.record("assignment", id, "cancel", a, null);
        touch(org.template(a.templateId()).projectId(), a.date());
    }

    @Transactional
    public void changePlan(UUID templateId, LocalDate date, int planned) {
        users.require("shift.schedule.edit");
        if (planned < 1 || planned > 500) throw ApiException.badRequest("planned");
        jdbc.sql("""
                insert into shift_plan (tenant_id, template_id, date, planned, cancelled) values (?, ?, ?, ?, false)
                on conflict (template_id, date) do update set planned = excluded.planned, cancelled = false""")
                .param(TenantContext.requireTenantId()).param(templateId).param(date).param(planned).update();
        audit.record("shift_plan", templateId + "|" + date, "update", null, Map.of("planned", planned));
        touch(org.template(templateId).projectId(), date);
    }

    @Transactional
    public void cancelShift(UUID templateId, LocalDate date) {
        users.require("shift.schedule.edit");
        jdbc.sql("update shift_plan set cancelled = true where template_id = ? and date = ?").param(templateId).param(date).update();
        jdbc.sql("update assignment set status = 'cancelled', updated_at = now(), updated_by = ? where template_id = ? and date = ? and status in ('proposed', 'confirmed')")
                .param(TenantContext.userId()).param(templateId).param(date).update();
        audit.record("shift_plan", templateId + "|" + date, "cancel", null, null);
        touch(org.template(templateId).projectId(), date);
    }

    @Transactional
    public int copyToNextWeek(UUID templateId, LocalDate date) {
        users.require("shift.schedule.edit");
        LocalDate target = date.plusDays(7);
        jdbc.sql("""
                insert into shift_plan (tenant_id, template_id, date, planned, cancelled)
                select tenant_id, template_id, ?, planned, false from shift_plan where template_id = ? and date = ? and not cancelled
                on conflict (template_id, date) do update set planned = excluded.planned, cancelled = false""")
                .param(target).param(templateId).param(date).update();
        ShiftTemplate t = org.template(templateId);
        Site site = org.site(org.project(t.projectId()).siteId());
        Context ctx = context(target, target);
        int copied = 0;
        for (Assignment a : workforce.assignments(List.of(templateId), date, date).stream().filter(Assignment::active).toList()) {
            Worker w = workforce.worker(a.workerId());
            if (!AssignmentRules.check(ctx, w, site, t, target).isEmpty()) continue;
            Assignment copy = new Assignment(Ids.newId(), a.workerId(), templateId, target, "proposed", a.source(), null);
            jdbc.sql("insert into assignment (id, tenant_id, worker_id, template_id, date, status, source, created_by) values (?, ?, ?, ?, ?, 'proposed', ?, ?)")
                    .param(copy.id()).param(TenantContext.requireTenantId()).param(copy.workerId()).param(templateId).param(target).param(copy.source()).param(TenantContext.userId())
                    .update();
            ctx.add(copy);
            copied++;
        }
        touch(t.projectId(), target);
        return copied;
    }

    /** A change to a published week marks it «Изменён после публикации» (9.1-03). */
    private void touch(UUID projectId, LocalDate date) {
        LocalDate monday = date.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        jdbc.sql("update schedule_week set state = 'changed_after_publish' where project_id = ? and monday = ? and state = 'published'").param(projectId).param(monday).update();
    }

    @Transactional
    public int publish(UUID projectId, LocalDate monday) {
        users.require("shift.schedule.publish");
        jdbc.sql("""
                insert into schedule_week (tenant_id, project_id, monday, state, published_at, published_by) values (?, ?, ?, 'published', ?, ?)
                on conflict (project_id, monday) do update set state = 'published', published_at = excluded.published_at, published_by = excluded.published_by""")
                .param(TenantContext.requireTenantId()).param(projectId).param(monday).param(OffsetDateTime.now(clock)).param(TenantContext.userId())
                .update();
        List<UUID> templateIds = org.templates(projectId).stream().map(ShiftTemplate::id).toList();
        Set<UUID> workers = workforce.assignments(templateIds, monday, monday.plusDays(6)).stream().filter(Assignment::active).map(Assignment::workerId).collect(Collectors.toCollection(HashSet::new));
        events.publishEvent(new SchedulePublished(TenantContext.requireTenantId(), projectId, monday, workers));
        return workers.size();
    }

    /* ---------------------------------------------------------------- auto-assign */

    public record AutoAssignRequest(String scope, List<LocalDate> dates, List<CellRef> cells, String mode) {}

    public record CellRef(UUID templateId, LocalDate date) {}

    public record Proposal(UUID templateId, LocalDate date, List<UUID> workerIds) {}

    public record AutoAssignJob(UUID id, String status, double progress, List<Proposal> proposals, int unfilled) {}

    /**
     * Greedy fill by score under the hard constraints — the baseline the CP-SAT optimiser (16.5)
     * replaces. Nothing is saved: the client previews proposals and accepts them as assignments.
     */
    @Transactional
    public UUID startAutoAssign(UUID projectId, LocalDate from, AutoAssignRequest req) {
        users.require("shift.autoassign.run");
        Project project = org.project(projectId);
        Site site = org.site(project.siteId());
        List<ShiftTemplate> templates = org.templates(projectId);
        LocalDate to = from.plusDays(6);
        List<LocalDate> dates = "days".equals(req.scope()) && req.dates() != null && !req.dates().isEmpty() ? req.dates() : from.datesUntil(to.plusDays(1)).toList();
        List<CellRef> cells = "cells".equals(req.scope()) && req.cells() != null && !req.cells().isEmpty()
                ? req.cells()
                : templates.stream().flatMap(t -> dates.stream().map(d -> new CellRef(t.id(), d))).toList();
        Context ctx = context(from, to);
        List<UUID> ids = templates.stream().map(ShiftTemplate::id).toList();
        Map<String, ShiftPlan> plans = workforce.plans(ids, from, to).stream().collect(Collectors.toMap(p -> p.templateId() + "|" + p.date(), Function.identity()));
        Map<String, List<Assignment>> byCell = workforce.assignments(ids, from, to).stream().collect(Collectors.groupingBy(a -> a.templateId() + "|" + a.date()));
        List<Worker> workers = workforce.workers();
        LocalDate today = today();
        List<Proposal> proposals = new ArrayList<>();
        int unfilled = 0;
        for (CellRef cell : cells) {
            if (cell.date().isBefore(today)) continue;
            ShiftPlan plan = plans.get(cell.templateId() + "|" + cell.date());
            if (plan == null || plan.cancelled()) continue;
            ShiftTemplate t = templates.stream().filter(x -> x.id().equals(cell.templateId())).findFirst().orElse(null);
            if (t == null) continue;
            List<Assignment> current = byCell.getOrDefault(t.id() + "|" + cell.date(), List.of());
            long kept = current.stream().filter(a -> "empty_only".equals(req.mode()) ? a.active() : "confirmed".equals(a.status())).count();
            int need = (int) (plan.planned() - kept);
            if (need <= 0) continue;
            List<UUID> chosen = workers.stream()
                    .filter(w -> w.positionIds().contains(t.positionId()))
                    .filter(w -> AssignmentRules.check(ctx, w, site, t, cell.date()).isEmpty())
                    .map(w -> Map.entry(w, AssignmentRules.score(ctx, w, site, t, cell.date()).score()))
                    .sorted(Map.Entry.<Worker, Integer>comparingByValue().reversed())
                    .limit(need)
                    .map(e -> e.getKey().id())
                    .toList();
            for (UUID w : chosen) ctx.add(new Assignment(Ids.newId(), w, t.id(), cell.date(), "proposed", "ai", null));
            unfilled += need - chosen.size();
            if (!chosen.isEmpty()) proposals.add(new Proposal(t.id(), cell.date(), chosen));
        }
        UUID jobId = Ids.newId();
        jdbc.sql("insert into auto_assign_job (id, tenant_id, project_id, status, request, result, finished_at) values (?, ?, ?, 'done', ?::jsonb, ?::jsonb, ?)")
                .param(jobId).param(TenantContext.requireTenantId()).param(projectId).param(Json.write(req))
                .param(Json.write(new AutoAssignJob(jobId, "done", 1, proposals, unfilled))).param(OffsetDateTime.now(clock))
                .update();
        return jobId;
    }

    @Transactional(readOnly = true)
    public AutoAssignJob job(UUID jobId) {
        users.require("shift.autoassign.run");
        String result = jdbc.sql("select result::text from auto_assign_job where id = ?").param(jobId).query(String.class).optional().orElseThrow(ApiException::notFound);
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper().findAndRegisterModules().readValue(result, AutoAssignJob.class);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
