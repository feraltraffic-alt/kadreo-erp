package com.kadreo.platform.tenant;

import java.util.UUID;
import java.util.concurrent.Callable;

/**
 * The tenant and user of the current request. Set from the access token by the security filter
 * (never from request parameters, spec 5.1 p. 3) and pushed into every database connection as
 * {@code app.tenant_id}, which the row-level security policies read.
 */
public final class TenantContext {

    private static final ThreadLocal<UUID> TENANT = new ThreadLocal<>();
    private static final ThreadLocal<UUID> USER = new ThreadLocal<>();

    private TenantContext() {}

    public static UUID tenantId() {
        return TENANT.get();
    }

    public static UUID requireTenantId() {
        UUID id = TENANT.get();
        if (id == null) throw new IllegalStateException("No tenant in context");
        return id;
    }

    public static UUID userId() {
        return USER.get();
    }

    public static void set(UUID tenantId, UUID userId) {
        TENANT.set(tenantId);
        USER.set(userId);
    }

    public static void clear() {
        TENANT.remove();
        USER.remove();
    }

    /** Runs work as the given tenant (scheduled jobs, seed loading, tests). */
    public static <T> T callAs(UUID tenantId, UUID userId, Callable<T> work) {
        UUID prevTenant = TENANT.get();
        UUID prevUser = USER.get();
        set(tenantId, userId);
        try {
            return work.call();
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException(e);
        } finally {
            if (prevTenant == null) clear();
            else set(prevTenant, prevUser);
        }
    }

    public static void runAs(UUID tenantId, UUID userId, Runnable work) {
        callAs(tenantId, userId, () -> {
            work.run();
            return null;
        });
    }
}
