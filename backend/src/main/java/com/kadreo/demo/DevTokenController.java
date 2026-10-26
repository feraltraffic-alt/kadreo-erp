package com.kadreo.demo;

import com.kadreo.platform.tenant.TenantContext;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * Demo sign-in: issues a token for a seeded demo user. Stands in for Keycloak until it is wired
 * (R0/R1); the token has the same claims Keycloak will issue (tenant_id, user_id).
 */
@RestController
@Profile("demo")
class DevTokenController {

    private final JwtEncoder encoder;
    private final JdbcClient jdbc;

    DevTokenController(JwtEncoder encoder, JdbcClient jdbc) {
        this.encoder = encoder;
        this.jdbc = jdbc;
    }

    record TokenRequest(String email) {}

    @PostMapping("/api/v1/dev/token")
    Map<String, Object> token(@RequestBody(required = false) TokenRequest req) {
        String email = req == null || req.email() == null ? DemoIds.DEMO_USER_EMAIL : req.email();
        UUID userId = TenantContext.callAs(DemoIds.TENANT, null, () ->
                jdbc.sql("select id from app_user where email = ?").param(email).query(UUID.class).optional().orElseThrow());
        Instant now = Instant.now();
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer("kadreo-demo")
                .subject(userId.toString())
                .issuedAt(now)
                .expiresAt(now.plus(8, ChronoUnit.HOURS))
                .claim("tenant_id", DemoIds.TENANT.toString())
                .claim("user_id", userId.toString())
                .build();
        String token = encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims)).getTokenValue();
        return Map.of("accessToken", token, "expiresIn", 8 * 3600);
    }
}
