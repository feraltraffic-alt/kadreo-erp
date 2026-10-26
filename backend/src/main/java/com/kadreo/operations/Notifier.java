package com.kadreo.operations;

import com.kadreo.platform.tenant.TenantContext;
import com.kadreo.platform.util.Ids;
import com.kadreo.platform.util.Json;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/**
 * In-app notifications (the bell, 8.4; the worker app, 14.1-03). Push and SMS delivery come with
 * the notification service (section 6); until then the app shows what is stored here.
 */
@Component
public class Notifier {

    private final JdbcClient jdbc;
    private final Clock clock;

    public Notifier(JdbcClient jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    /** Text in all four interface languages. */
    public static Map<String, String> text(String ru, String uk, String pl, String en) {
        return Map.of("ru", ru, "uk", uk, "pl", pl, "en", en);
    }

    public void toUser(UUID userId, String kind, Map<String, String> title, String href) {
        if (userId == null) return;
        jdbc.sql("insert into notification (id, tenant_id, user_id, kind, title, href, at, read) values (?, ?, ?, ?, ?::jsonb, ?, ?, false)")
                .param(Ids.newId()).param(TenantContext.requireTenantId()).param(userId).param(kind).param(Json.write(title)).param(href).param(OffsetDateTime.now(clock))
                .update();
    }

    /** To the app accounts of these workers; returns how many accounts got it. */
    public int toWorkers(Collection<UUID> workerIds, String kind, Map<String, String> title, String href) {
        if (workerIds.isEmpty()) return 0;
        List<UUID> users = jdbc.sql("select id from app_user where worker_id = any(?) and status = 'active'").param(workerIds.toArray(UUID[]::new)).query(UUID.class).list();
        users.forEach(u -> toUser(u, kind, title, href));
        return users.size();
    }

    /** To the managers of a site: site-scoped managers of that site and tenant-wide or regional operations managers. */
    public void toSiteManagers(UUID siteId, String region, Map<String, String> title, String href) {
        List<UUID> users = jdbc.sql("""
                select distinct u.id from app_user u
                join user_role ur on ur.user_id = u.id join role r on r.id = ur.role_id
                where u.status = 'active' and u.client_id is null and r.code in ('OPS_MANAGER', 'SITE_MANAGER')
                  and (not exists (select 1 from user_scope s where s.user_id = u.id)
                       or exists (select 1 from user_scope s where s.user_id = u.id and ((s.kind = 'site' and s.value = ?) or (s.kind = 'region' and s.value = ?))))""")
                .param(siteId.toString()).param(region)
                .query(UUID.class).list();
        users.forEach(u -> toUser(u, "approval", title, href));
    }
}
