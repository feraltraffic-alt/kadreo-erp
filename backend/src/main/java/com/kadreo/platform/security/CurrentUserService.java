package com.kadreo.platform.security;

import com.kadreo.platform.tenant.TenantContext;
import com.kadreo.platform.web.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * Loads the current user, roles, permissions and data scope once per request. A user with several
 * roles picks the active one with the {@code X-Active-Role} header (the "switch role" menu, 8.4).
 */
@Service
public class CurrentUserService {

    /** Order in which a default active role is chosen. */
    private static final List<String> ROLE_ORDER = List.of("OPS_MANAGER", "SITE_MANAGER", "EXECUTIVE", "HR", "PAYROLL", "FINANCE", "ANALYST", "TENANT_ADMIN", "AUDITOR", "TEAM_LEADER", "WORKER");
    private static final String ATTR = CurrentUserService.class.getName();

    private final JdbcClient jdbc;

    public CurrentUserService(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public CurrentUser current() {
        RequestAttributes attrs = RequestContextHolder.getRequestAttributes();
        if (attrs != null && attrs.getAttribute(ATTR, RequestAttributes.SCOPE_REQUEST) instanceof CurrentUser cached) return cached;
        CurrentUser user = load(TenantContext.userId(), activeRoleHeader(attrs));
        if (attrs != null) attrs.setAttribute(ATTR, user, RequestAttributes.SCOPE_REQUEST);
        return user;
    }

    /** Throws 403 with the missing permission's code (8.5) unless the active role has it. */
    public CurrentUser require(String permission) {
        CurrentUser u = current();
        if (!u.can(permission)) throw ApiException.forbidden(permission);
        return u;
    }

    public CurrentUser load(UUID userId, String requestedRole) {
        if (userId == null) throw new ApiException(HttpStatus.UNAUTHORIZED, Map.of("code", "unauthorized"));
        record Row(UUID id, UUID tenantId, String fullName, String email, String locale, String status) {}
        Row u = jdbc.sql("select id, tenant_id, full_name, email, locale, status from app_user where id = ?")
                .param(userId)
                .query(Row.class)
                .optional()
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, Map.of("code", "unauthorized")));
        if (!"active".equals(u.status())) throw new ApiException(HttpStatus.UNAUTHORIZED, Map.of("code", "unauthorized"));
        List<String> roles = new ArrayList<>(jdbc.sql("select r.code from user_role ur join role r on r.id = ur.role_id where ur.user_id = ?")
                .param(userId)
                .query(String.class)
                .list());
        roles.sort(Comparator.comparingInt(r -> ROLE_ORDER.indexOf(r) < 0 ? 99 : ROLE_ORDER.indexOf(r)));
        String active = requestedRole != null && roles.contains(requestedRole) ? requestedRole : roles.isEmpty() ? "WORKER" : roles.get(0);
        var permissions = new HashSet<>(jdbc.sql("""
                select rp.permission from user_role ur
                join role r on r.id = ur.role_id
                join role_permission rp on rp.role_id = r.id
                where ur.user_id = ? and r.code = ?""")
                .param(userId)
                .param(active)
                .query(String.class)
                .list());
        List<String> regions = jdbc.sql("select value from user_scope where user_id = ? and kind = 'region'").param(userId).query(String.class).list();
        List<UUID> sites = jdbc.sql("select value::uuid from user_scope where user_id = ? and kind = 'site'").param(userId).query(UUID.class).list();
        String[] parts = u.fullName().trim().split("\\s+");
        String initials = (parts[0].substring(0, 1) + (parts.length > 1 ? parts[parts.length - 1].substring(0, 1) : "")).toUpperCase();
        return new CurrentUser(u.id(), u.tenantId(), u.fullName(), initials, u.email(), u.locale(), roles, active, permissions, new CurrentUser.Scope(regions, sites));
    }

    private static String activeRoleHeader(RequestAttributes attrs) {
        if (attrs instanceof ServletRequestAttributes sra) {
            HttpServletRequest req = sra.getRequest();
            return req.getHeader("X-Active-Role");
        }
        return null;
    }
}
