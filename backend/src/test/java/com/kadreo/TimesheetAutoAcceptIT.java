package com.kadreo;

import static com.kadreo.demo.DemoIds.fromKey;
import static org.assertj.core.api.Assertions.assertThat;

import com.kadreo.demo.DemoIds;
import com.kadreo.platform.tenant.TenantContext;
import com.kadreo.platform.tenant.TenantScan;
import com.kadreo.support.IntegrationTest;
import com.kadreo.timetracking.TimesheetAutoAccept;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.UUID;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

/** Auto-acceptance of timesheets after the client's deadline (spec 9.2-08). */
class TimesheetAutoAcceptIT extends IntegrationTest {

    @Autowired TimesheetAutoAccept job;
    @Autowired TenantScan tenants;
    @Autowired JdbcClient jdbc;
    @Autowired Clock clock;

    <T> T asDemo(Supplier<T> work) {
        return TenantContext.callAs(DemoIds.TENANT, null, work::get);
    }

    String stage(UUID project) {
        return asDemo(() -> jdbc.sql("select client_stage from timesheet where project_id = ? and period_from <= '2026-10-19' and period_to >= '2026-10-19'")
                .param(project).query(String.class).single());
    }

    @Test
    void overdueTimesheetIsAcceptedOnceAndTheSenderIsNotified() throws Exception {
        UUID gliwice = fromKey("pr-gliwice");
        UUID halle = fromKey("pr-halle");
        UUID marta = fromKey("u-marta");
        OffsetDateTime now = OffsetDateTime.now(clock);
        UUID tsId = asDemo(() -> jdbc.sql("""
                update timesheet set client_due_at = ?, sent_by = ?
                where project_id = ? and client_stage = 'waiting' returning id""")
                .param(now.minusHours(1)).param(marta).param(gliwice).query(UUID.class).single());
        assertThat(stage(halle)).isEqualTo("waiting");

        job.run();
        job.run(); // a second run finds nothing more to do

        assertThat(stage(gliwice)).isEqualTo("auto_accepted");
        assertThat(stage(halle)).isEqualTo("waiting"); // deadline 29.10 not reached
        long audits = asDemo(() -> jdbc.sql("select count(*) from audit_log where entity = 'timesheet' and entity_id = ? and action = 'auto_accept'")
                .param(tsId.toString()).query(Long.class).single());
        assertThat(audits).isEqualTo(1);

        // The notification is written after commit by the operations module.
        long notes = 0;
        for (int i = 0; i < 50 && notes == 0; i++) {
            notes = asDemo(() -> jdbc.sql("select count(*) from notification where user_id = ? and title->>'ru' like ? and href like ?")
                    .param(marta).param("%принят автоматически%").param("%" + gliwice + "%").query(Long.class).single());
            if (notes == 0) Thread.sleep(100);
        }
        assertThat(notes).isEqualTo(1);
    }

    @Test
    void tenantScanListsTenantsButOrdinaryContextStillSeesNone() {
        assertThat(tenants.tenantIds()).contains(DemoIds.TENANT);
        assertThat(jdbc.sql("select count(*) from tenant").query(Long.class).single()).isZero();
    }
}
