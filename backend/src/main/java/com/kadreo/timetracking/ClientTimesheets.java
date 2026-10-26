package com.kadreo.timetracking;

import com.kadreo.platform.audit.AuditLog;
import com.kadreo.platform.security.CurrentUser;
import com.kadreo.platform.tenant.TenantContext;
import com.kadreo.platform.util.Ids;
import com.kadreo.platform.web.ApiException;
import com.kadreo.timetracking.TimesheetModels.Timesheet;
import com.kadreo.workforce.WorkforceModels.WorkerBrief;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Timesheets as the client handles them (12.2): the sent ones, dispute days, confirm the rest.
 * No permission checks here — the portal module checks the client user and that the timesheet
 * belongs to their client before calling.
 */
@Service
public class ClientTimesheets {

    private final JdbcClient jdbc;
    private final TimesheetService timesheets;
    private final AuditLog audit;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    public ClientTimesheets(JdbcClient jdbc, TimesheetService timesheets, AuditLog audit, ApplicationEventPublisher events, Clock clock) {
        this.jdbc = jdbc;
        this.timesheets = timesheets;
        this.audit = audit;
        this.events = events;
        this.clock = clock;
    }

    public record Header(UUID id, UUID projectId, LocalDate periodFrom, LocalDate periodTo, String clientStage, OffsetDateTime clientDueAt, OffsetDateTime sentAt,
            String sentByName, UUID sentBy) {}

    private static final String HEADER_SQL = """
            select t.id, t.project_id, t.period_from, t.period_to, t.client_stage, t.client_due_at, t.sent_at, u.full_name as sent_by_name, t.sent_by
            from timesheet t left join app_user u on u.id = t.sent_by""";

    /** Timesheets of these projects whose period contains {@code ref}. */
    @Transactional(readOnly = true)
    public List<Header> containing(Collection<UUID> projectIds, LocalDate ref) {
        if (projectIds.isEmpty()) return List.of();
        return jdbc.sql(HEADER_SQL + " where t.project_id = any(?) and t.period_from <= ? and t.period_to >= ? order by t.period_from")
                .param(projectIds.toArray(UUID[]::new)).param(ref).param(ref)
                .query(Header.class).list();
    }

    @Transactional(readOnly = true)
    public Header header(UUID id) {
        return jdbc.sql(HEADER_SQL + " where t.id = ?").param(id).query(Header.class).optional().orElseThrow(ApiException::notFound);
    }

    /** Full timesheet with all days; the portal shows billable hours only. */
    @Transactional(readOnly = true)
    public Timesheet timesheet(UUID id, Map<UUID, WorkerBrief> workersOut) {
        return timesheets.assembleById(id, workersOut);
    }

    public record Totals(double plannedHours, double billableHours, int rows, int disputedRows) {}

    /** Hours and disputed share of a timesheet (portal KPI). */
    @Transactional(readOnly = true)
    public Totals totals(UUID id) {
        return jdbc.sql("""
                select coalesce(sum(e.planned_hours), 0) as planned_hours, coalesce(sum(e.billable_hours), 0) as billable_hours,
                       count(distinct e.worker_id) as row_count,
                       count(distinct e.worker_id) filter (where exists (select 1 from timesheet_dispute d where d.entry_id = e.id)) as disputed_rows
                from timesheet_entry e where e.timesheet_id = ?""")
                .param(id)
                .query((rs, i) -> new Totals(rs.getDouble(1), rs.getDouble(2), rs.getInt(3), rs.getInt(4)))
                .single();
    }

    public record Item(UUID rowId, LocalDate date) {}

    /** Published after a client disputes days; the operations module notifies the sender. */
    public record TimesheetDisputed(UUID tenantId, UUID timesheetId, UUID projectId, LocalDate from, LocalDate to, UUID sentBy, int rows) {}

    /** «Оспорить выбранные» (12.2-14): one dispute per chosen day; the timesheet becomes «Оспорено: N строк». */
    @Transactional
    public void dispute(UUID id, List<Item> items, UUID reasonId, Double clientHours, String comment, CurrentUser user) {
        Header h = lock(id);
        if (!List.of("waiting", "disputed").contains(h.clientStage())) throw ApiException.conflict("", String.valueOf(h.clientStage()));
        if (items == null || items.isEmpty() || reasonId == null || comment == null || comment.isBlank() || comment.length() > 1000) throw ApiException.badRequest("input");
        if (clientHours != null && (clientHours < 0 || clientHours > 24 || Math.round(clientHours * 4) != clientHours * 4)) throw ApiException.badRequest("clientHours");
        int reasons = jdbc.sql("select count(*) from reason where id = ? and kind = 'dispute'").param(reasonId).query(Integer.class).single();
        if (reasons == 0) throw ApiException.badRequest("reasonId");
        OffsetDateTime now = OffsetDateTime.now(clock);
        for (Item item : items) {
            record E(UUID id, boolean disputed, OffsetDateTime clientConfirmedAt) {}
            E e = jdbc.sql("select id, disputed, client_confirmed_at from timesheet_entry where timesheet_id = ? and worker_id = ? and date = ? for update")
                    .param(id).param(item.rowId()).param(item.date()).query(E.class).optional()
                    .orElseThrow(() -> ApiException.badRequest("day"));
            if (e.disputed() || e.clientConfirmedAt() != null) throw ApiException.badRequest("day");
            UUID disputeId = Ids.newId();
            jdbc.sql("""
                    insert into timesheet_dispute (id, tenant_id, timesheet_id, entry_id, reason_id, client_hours, comment, created_at, created_by, created_by_name, status)
                    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')""")
                    .param(disputeId).param(TenantContext.requireTenantId()).param(id).param(e.id()).param(reasonId).param(clientHours).param(comment.trim())
                    .param(now).param(user.id()).param(user.fullName())
                    .update();
            jdbc.sql("update timesheet_entry set disputed = true, version = version + 1 where id = ?").param(e.id()).update();
            audit.record("timesheet_dispute", disputeId, "open", null, Map.of("entry", e.id(), "reasonId", reasonId, "comment", comment.trim()));
        }
        int rows = jdbc.sql("select count(distinct worker_id) from timesheet_entry where timesheet_id = ? and disputed").param(id).query(Integer.class).single();
        jdbc.sql("update timesheet set client_stage = 'disputed', version = version + 1 where id = ?").param(id).update();
        events.publishEvent(new TimesheetDisputed(TenantContext.requireTenantId(), id, h.projectId(), h.periodFrom(), h.periodTo(), h.sentBy(), rows));
    }

    /**
     * «Подтвердить остальные» (12.2-15): every day without an open dispute is confirmed and stays
     * as it is. With no open dispute left the whole timesheet is confirmed. User, time and IP go
     * to the audit log.
     */
    @Transactional
    public void confirm(UUID id, CurrentUser user, String ip) {
        Header h = lock(id);
        if (!List.of("waiting", "disputed").contains(h.clientStage())) throw ApiException.conflict("", String.valueOf(h.clientStage()));
        OffsetDateTime now = OffsetDateTime.now(clock);
        int days = jdbc.sql("update timesheet_entry set client_confirmed_at = ? where timesheet_id = ? and not disputed and client_confirmed_at is null")
                .param(now).param(id).update();
        BigDecimal hours = jdbc.sql("select coalesce(sum(billable_hours), 0) from timesheet_entry where timesheet_id = ? and client_confirmed_at = ?")
                .param(id).param(now).query(BigDecimal.class).single();
        int open = jdbc.sql("select count(*) from timesheet_entry where timesheet_id = ? and disputed").param(id).query(Integer.class).single();
        if (open == 0) {
            jdbc.sql("update timesheet set client_stage = 'confirmed', confirmed_at = ?, confirmed_by = ?, confirmed_by_name = ?, version = version + 1 where id = ?")
                    .param(now).param(user.id()).param(user.fullName()).param(id).update();
        }
        Map<String, Object> after = new HashMap<>();
        after.put("days", days);
        after.put("billableHours", hours);
        after.put("clientStage", open == 0 ? "confirmed" : h.clientStage());
        audit.record("timesheet", id, "client_confirm", Map.of("clientStage", h.clientStage()), after, ip);
    }

    private Header lock(UUID id) {
        jdbc.sql("select id from timesheet where id = ? for update").param(id).query(UUID.class).optional().orElseThrow(ApiException::notFound);
        return header(id);
    }
}
