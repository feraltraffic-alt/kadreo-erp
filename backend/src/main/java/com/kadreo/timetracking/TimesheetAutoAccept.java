package com.kadreo.timetracking;

import com.kadreo.platform.audit.AuditLog;
import com.kadreo.platform.tenant.TenantContext;
import com.kadreo.platform.tenant.TenantScan;
import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Auto-acceptance of timesheets (spec 9.2-08): a timesheet sent to the client and not confirmed or
 * disputed within the contract's {@code autoAcceptHours} becomes «Принято автоматически».
 * Idempotent: the update only touches rows still waiting, so overlapping runs or several
 * application instances do no harm.
 */
@Component
public class TimesheetAutoAccept {

    private static final Logger log = LoggerFactory.getLogger(TimesheetAutoAccept.class);

    /** Published after commit; the operations module notifies whoever sent the timesheet. */
    public record TimesheetAutoAccepted(UUID tenantId, UUID timesheetId, UUID projectId, LocalDate from, LocalDate to, UUID sentBy) {}

    private final JdbcClient jdbc;
    private final TenantScan tenants;
    private final TransactionTemplate tx;
    private final AuditLog audit;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    public TimesheetAutoAccept(JdbcClient jdbc, TenantScan tenants, TransactionTemplate tx, AuditLog audit, ApplicationEventPublisher events, Clock clock) {
        this.jdbc = jdbc;
        this.tenants = tenants;
        this.tx = tx;
        this.audit = audit;
        this.events = events;
        this.clock = clock;
    }

    @Scheduled(fixedDelayString = "${kadreo.timesheets.auto-accept-every:PT1M}", initialDelayString = "${kadreo.timesheets.auto-accept-initial-delay:PT30S}")
    public void run() {
        int[] total = {0};
        tenants.forEachTenant("timesheet auto-accept", tenant -> total[0] += acceptDue(tenant));
        if (total[0] > 0) log.info("Auto-accepted {} timesheet(s)", total[0]);
    }

    /** Accepts the current tenant's overdue timesheets; returns how many. */
    int acceptDue(UUID tenant) {
        record Due(UUID id, UUID projectId, LocalDate periodFrom, LocalDate periodTo, UUID sentBy, OffsetDateTime clientDueAt) {}
        OffsetDateTime now = OffsetDateTime.now(clock);
        List<Due> accepted = tx.execute(s -> {
            List<Due> rows = jdbc.sql("""
                    update timesheet set client_stage = 'auto_accepted', version = version + 1
                    where client_stage = 'waiting' and client_due_at <= ?
                    returning id, project_id, period_from, period_to, sent_by, client_due_at""")
                    .param(now)
                    .query(Due.class)
                    .list();
            for (Due d : rows) {
                audit.record("timesheet", d.id(), "auto_accept", Map.of("clientStage", "waiting", "dueAt", d.clientDueAt().toString()), Map.of("clientStage", "auto_accepted"));
                events.publishEvent(new TimesheetAutoAccepted(TenantContext.requireTenantId(), d.id(), d.projectId(), d.periodFrom(), d.periodTo(), d.sentBy()));
            }
            return rows;
        });
        return accepted == null ? 0 : accepted.size();
    }
}
