package com.kadreo.demo;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.context.annotation.Profile;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;

@Configuration(proxyBeanMethods = false)
@Profile("demo")
class DemoConfig {

    @Bean
    @Primary
    Clock demoClock(@Value("${kadreo.demo.now}") String now) {
        return Clock.fixed(Instant.parse(now), ZoneId.of("UTC"));
    }

    @Bean
    SecretKey demoJwtKey(@Value("${kadreo.demo.jwt-secret}") String secret) {
        return new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
    }

    @Bean
    JwtDecoder demoJwtDecoder(SecretKey demoJwtKey) {
        return NimbusJwtDecoder.withSecretKey(demoJwtKey).macAlgorithm(MacAlgorithm.HS256).build();
    }

    @Bean
    JwtEncoder demoJwtEncoder(SecretKey demoJwtKey) {
        return new NimbusJwtEncoder(new ImmutableSecret<>(demoJwtKey));
    }
}
