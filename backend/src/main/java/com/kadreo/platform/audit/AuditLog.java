package com.kadreo.platform.audit;

import com.kadreo.platform.tenant.TenantContext;
import com.kadreo.platform.util.Ids;
import com.kadreo.platform.util.Json;
import java.time.Clock;
import java.time.OffsetDateTime;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/**
 * Append-only audit trail (spec 4.1, 7.3 p. 5): changes of timesheets, rates, contracts, payroll
 * lines and permissions are written with the values before and after. The database role cannot
 * update or delete these rows.
 */
@Component
public class AuditLog {

    private final JdbcClient jdbc;
    private final Clock clock;

    public AuditLog(JdbcClient jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    public void record(String entity, Object entityId, String action, Object before, Object after) {
        record(entity, entityId, action, before, after, null);
    }

    /** With the client's IP address, where the spec asks for it (12.2-15 confirmation). */
    public void record(String entity, Object entityId, String action, Object before, Object after, String ip) {
        jdbc.sql("insert into audit_log (id, tenant_id, at, actor_id, entity, entity_id, action, before, after, ip) values (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?)")
                .param(Ids.newId())
                .param(TenantContext.requireTenantId())
                .param(OffsetDateTime.now(clock))
                .param(TenantContext.userId())
                .param(entity)
                .param(String.valueOf(entityId))
                .param(action)
                .param(before == null ? null : Json.write(before))
                .param(after == null ? null : Json.write(after))
                .param(ip)
                .update();
    }
}
