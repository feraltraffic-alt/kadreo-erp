package com.kadreo;

import static org.assertj.core.api.Assertions.assertThat;

import com.kadreo.demo.DemoIds;
import com.kadreo.platform.tenant.TenantContext;
import com.kadreo.support.Api;
import com.kadreo.support.IntegrationTest;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;

class PlatformIT extends IntegrationTest {

    @Autowired TestRestTemplate http;
    @Autowired JdbcClient jdbc;

    @Test
    @SuppressWarnings("unchecked")
    void signedInUserGetsProfileAndTenantBranding() {
        Api api = Api.signIn(http, DemoIds.DEMO_USER_EMAIL);
        var me = api.get("/api/v1/me", Map.class);
        assertThat(me.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(me.getBody()).containsEntry("fullName", "Marta Kowalska").containsEntry("activeRole", "OPS_MANAGER");
        assertThat((List<String>) me.getBody().get("roles")).containsExactly("OPS_MANAGER", "TENANT_ADMIN");

        var tenant = api.get("/api/v1/tenant", Map.class);
        assertThat(((Map<String, Object>) tenant.getBody().get("branding"))).containsEntry("productName", "Kadreo ERP");
    }

    @Test
    void requestsWithoutTokenAreRejected() {
        assertThat(http.getForEntity("/api/v1/me", String.class).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    void rowLevelSecurityHidesOtherTenantsAndEmptyContext() {
        // Without a tenant in context the application role sees nothing at all.
        assertThat(jdbc.sql("select count(*) from worker").query(Long.class).single()).isZero();
        long demoWorkers = TenantContext.callAs(DemoIds.TENANT, null, () -> jdbc.sql("select count(*) from worker").query(Long.class).single());
        assertThat(demoWorkers).isGreaterThan(500);
        // A different tenant id sees none of the demo rows.
        long other = TenantContext.callAs(UUID.randomUUID(), null, () -> jdbc.sql("select count(*) from worker").query(Long.class).single());
        assertThat(other).isZero();
    }
}
