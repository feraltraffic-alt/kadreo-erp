package com.kadreo.timetracking;

import com.kadreo.organization.OrganizationModels.Client;
import com.kadreo.organization.OrganizationModels.Contract;
import com.kadreo.organization.OrganizationModels.Project;
import com.kadreo.organization.OrganizationModels.Reason;
import com.kadreo.organization.OrganizationModels.Site;
import com.kadreo.organization.OrganizationService;
import com.kadreo.platform.audit.AuditLog;
import com.kadreo.platform.security.CurrentUser;
import com.kadreo.platform.security.CurrentUserService;
import com.kadreo.platform.tenant.TenantContext;
import com.kadreo.platform.util.Ids;
import com.kadreo.platform.web.ApiException;
import com.kadreo.timetracking.TimesheetModels.Dispute;
import com.kadreo.workforce.WorkforceModels.WorkerBrief;
import com.kadreo.workforce.WorkforceService;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Timesheet disputes (12.2, rules after a dispute): the manager agrees — the hours are corrected
 * with the reason «согласовано по спору» — or rejects with a comment. When no open dispute is
 * left, the timesheet goes back to the client with a new deadline for auto-acceptance.
 */
@Service
public class DisputeService {

    private final JdbcClient jdbc;
    private final OrganizationService org;
    private final WorkforceService workforce;
    private final CurrentUserService users;
    private final AuditLog audit;
    private final Clock clock;

    public DisputeService(JdbcClient jdbc, OrganizationService org, WorkforceService workforce, CurrentUserService users, AuditLog audit, Clock clock) {
        this.jdbc = jdbc;
        this.org = org;
        this.workforce = workforce;
        this.users = users;
        this.audit = audit;
        this.clock = clock;
    }

    public record ListItem(Dispute dispute, UUID timesheetId, UUID projectId, String siteName, String clientName, LocalDate from, LocalDate to, UUID rowId,
            Map<String, Object> worker, UUID positionId, LocalDate date, double payableHours, double billableHours) {}

    record Row(Dispute dispute, UUID timesheetId, UUID projectId, LocalDate periodFrom, LocalDate periodTo, UUID workerId, UUID positionId, LocalDate date, double payable,
            double billable) {}

    @Transactional(readOnly = true)
    public List<ListItem> list(boolean openOnly) {
        CurrentUser u = users.require("timesheet.read");
        List<Row> rows = jdbc.sql("""
                select d.id, d.entry_id, d.timesheet_id, d.reason_id, d.client_hours, d.comment, d.created_at, d.created_by_name, d.status, d.resolution_comment,
                       d.resolved_by_name, d.resolved_at, d.payable_after, d.billable_after,
                       t.project_id, t.period_from, t.period_to, e.worker_id, e.position_id, e.date, e.payable_hours, e.billable_hours
                from timesheet_dispute d
                join timesheet_entry e on e.id = d.entry_id
                join timesheet t on t.id = d.timesheet_id
                """ + (openOnly ? "where d.status = 'open' " : "") + "order by d.created_at")
                .query((rs, i) -> new Row(TimesheetService.dispute(rs), rs.getObject("timesheet_id", UUID.class), rs.getObject("project_id", UUID.class),
                        rs.getObject("period_from", LocalDate.class), rs.getObject("period_to", LocalDate.class), rs.getObject("worker_id", UUID.class),
                        rs.getObject("position_id", UUID.class), rs.getObject("date", LocalDate.class), rs.getBigDecimal("payable_hours").doubleValue(),
                        rs.getBigDecimal("billable_hours").doubleValue()))
                .list();
        Map<UUID, Project> projects = org.projects().stream().collect(Collectors.toMap(Project::id, Function.identity()));
        Map<UUID, Site> sites = org.sites().stream().collect(Collectors.toMap(Site::id, Function.identity()));
        Map<UUID, Client> clients = org.clients().stream().collect(Collectors.toMap(Client::id, Function.identity()));
        Map<UUID, WorkerBrief> briefs = workforce.briefs(rows.stream().map(Row::workerId).distinct().toList());
        return rows.stream()
                .filter(r -> projects.containsKey(r.projectId()))
                .filter(r -> TimesheetService.inScope(u, sites.get(projects.get(r.projectId()).siteId())))
                .map(r -> {
                    Site s = sites.get(projects.get(r.projectId()).siteId());
                    WorkerBrief w = briefs.get(r.workerId());
                    Map<String, Object> worker = new LinkedHashMap<>();
                    worker.put("id", w.id());
                    worker.put("firstName", w.firstName());
                    worker.put("lastName", w.lastName());
                    return new ListItem(r.dispute(), r.timesheetId(), r.projectId(), s.name(), clients.get(s.clientId()).shortName(), r.periodFrom(), r.periodTo(),
                            r.workerId(), worker, r.positionId(), r.date(), r.payable(), r.billable());
                })
                .sorted(Comparator.comparing((ListItem x) -> x.dispute().createdAt()))
                .toList();
    }

    public record Resolution(String decision, Double payableHours, Double billableHours, String comment) {}

    record Open(UUID id, UUID entryId, String status, Double clientHours, String resolvedByName, OffsetDateTime resolvedAt) {}

    record EntryHours(UUID id, BigDecimal payableHours, BigDecimal billableHours) {}

    @Transactional
    public Dispute resolve(UUID timesheetId, UUID disputeId, Resolution in) {
        CurrentUser u = users.require("timesheet.dispute.resolve");
        if (in == null || !List.of("agree", "reject").contains(in.decision())) throw ApiException.badRequest("decision");
        String comment = in.comment() == null ? "" : in.comment().trim();
        if ("reject".equals(in.decision()) && comment.isEmpty()) throw ApiException.badRequest("comment");
        Open d = jdbc.sql("select id, entry_id, status, client_hours, resolved_by_name, resolved_at from timesheet_dispute where id = ? and timesheet_id = ? for update")
                .param(disputeId).param(timesheetId).query(Open.class).optional().orElseThrow(ApiException::notFound);
        if (!"open".equals(d.status())) throw ApiException.conflict(d.resolvedByName() == null ? "" : d.resolvedByName(), String.valueOf(d.resolvedAt()));
        EntryHours e = jdbc.sql("select id, payable_hours, billable_hours from timesheet_entry where id = ? for update").param(d.entryId()).query(EntryHours.class).single();
        OffsetDateTime now = OffsetDateTime.now(clock);
        Double payableAfter = null;
        Double billableAfter = null;
        if ("agree".equals(in.decision())) {
            double current = e.payableHours().doubleValue();
            payableAfter = in.payableHours() != null ? in.payableHours() : d.clientHours() != null ? d.clientHours() : current;
            billableAfter = in.billableHours() != null ? in.billableHours() : d.clientHours() != null ? d.clientHours() : e.billableHours().doubleValue();
            if (payableAfter < 0 || payableAfter > 24 || billableAfter < 0 || billableAfter > 24) throw ApiException.badRequest("hours");
            UUID reason = org.reasons("correction").stream().filter(r -> "dispute".equals(r.code())).map(Reason::id).findFirst()
                    .orElseThrow(() -> ApiException.badRequest("no_dispute_reason"));
            jdbc.sql("""
                    insert into timesheet_correction (id, tenant_id, entry_id, at, by_user_id, by_name, payable_before, payable_after, billable_before, billable_after, reason_id, comment)
                    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""")
                    .param(Ids.newId()).param(TenantContext.requireTenantId()).param(e.id()).param(now).param(u.id()).param(u.fullName())
                    .param(e.payableHours()).param(payableAfter).param(e.billableHours()).param(billableAfter).param(reason).param(comment)
                    .update();
            jdbc.sql("update timesheet_entry set payable_hours = ?, billable_hours = ?, version = version + 1 where id = ?")
                    .param(payableAfter).param(billableAfter).param(e.id()).update();
        }
        jdbc.sql("""
                update timesheet_dispute set status = ?, resolution_comment = ?, resolved_by = ?, resolved_by_name = ?, resolved_at = ?, payable_after = ?, billable_after = ?,
                       version = version + 1
                where id = ?""")
                .param("agree".equals(in.decision()) ? "agreed" : "rejected").param(comment).param(u.id()).param(u.fullName()).param(now)
                .param(payableAfter).param(billableAfter).param(disputeId)
                .update();
        jdbc.sql("update timesheet_entry set disputed = exists (select 1 from timesheet_dispute where entry_id = ? and status = 'open') where id = ?")
                .param(e.id()).param(e.id()).update();
        audit.record("timesheet_dispute", disputeId, "resolve", Map.of("status", "open"), Map.of("decision", in.decision(), "comment", comment));

        // No open dispute left: back to the client for confirmation, with a fresh deadline.
        int open = jdbc.sql("select count(*) from timesheet_dispute where timesheet_id = ? and status = 'open'").param(timesheetId).query(Integer.class).single();
        String stage = jdbc.sql("select client_stage from timesheet where id = ?").param(timesheetId).query(String.class).single();
        if (open == 0 && "disputed".equals(stage)) {
            UUID project = jdbc.sql("select project_id from timesheet where id = ?").param(timesheetId).query(UUID.class).single();
            Contract contract = org.contract(org.project(project).contractId());
            jdbc.sql("update timesheet set client_stage = 'waiting', client_due_at = ?, version = version + 1 where id = ?")
                    .param(now.plusHours(contract.autoAcceptHours())).param(timesheetId).update();
            audit.record("timesheet", timesheetId, "disputes_resolved", Map.of("clientStage", "disputed"), Map.of("clientStage", "waiting"));
        }
        return jdbc.sql(TimesheetService.DISPUTE_SQL + " where id = ?").param(disputeId).query((rs, i) -> TimesheetService.dispute(rs)).single();
    }
}
