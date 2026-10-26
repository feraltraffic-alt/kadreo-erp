package com.kadreo.platform.tenant;

import java.util.List;
import java.util.UUID;
import java.util.function.Consumer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Runs background work once per tenant. Tenant ids are read under the {@code tenant_system_scan}
 * policy (V4); the work itself runs with that tenant in context, so row-level security applies to
 * it exactly as to a user request. A failure in one tenant does not stop the others.
 */
@Component
public class TenantScan {

    private static final Logger log = LoggerFactory.getLogger(TenantScan.class);

    private final JdbcClient jdbc;
    private final TransactionTemplate tx;

    public TenantScan(JdbcClient jdbc, TransactionTemplate tx) {
        this.jdbc = jdbc;
        this.tx = tx;
    }

    public List<UUID> tenantIds() {
        return tx.execute(s -> {
            jdbc.sql("select set_config('app.system_job', 'tenant-scan', true)").query(String.class).single();
            return jdbc.sql("select id from tenant order by id").query(UUID.class).list();
        });
    }

    public void forEachTenant(String job, Consumer<UUID> work) {
        for (UUID tenant : tenantIds()) {
            try {
                TenantContext.runAs(tenant, null, () -> work.accept(tenant));
            } catch (RuntimeException e) {
                log.error("{} failed for tenant {}", job, tenant, e);
            }
        }
    }
}
