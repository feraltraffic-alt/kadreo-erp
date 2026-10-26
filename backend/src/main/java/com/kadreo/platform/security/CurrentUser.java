package com.kadreo.platform.security;

import java.util.List;
import java.util.Set;
import java.util.UUID;

/** The signed-in user with the permissions of the active role (spec 3.1–3.3). */
public record CurrentUser(
        UUID id,
        UUID tenantId,
        String fullName,
        String initials,
        String email,
        String locale,
        List<String> roles,
        String activeRole,
        Set<String> permissions,
        Scope scope) {

    public record Scope(List<String> regions, List<UUID> siteIds) {
        public boolean wholeTenant() {
            return regions.isEmpty() && siteIds.isEmpty();
        }
    }

    public boolean can(String permission) {
        return permissions.contains("*") || permissions.contains(permission);
    }
}
