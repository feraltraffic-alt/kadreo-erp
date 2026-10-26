package com.kadreo.platform.security;

import com.kadreo.platform.tenant.TenantContext;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Takes tenant and user ids from the validated access token — never from parameters or headers
 * (spec 5.1 p. 3) — and puts them into {@link TenantContext} for the duration of the request.
 * Token claims: {@code tenant_id}, and {@code user_id} (falls back to {@code sub}).
 */
@Component
public class TenantContextFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
        try {
            if (SecurityContextHolder.getContext().getAuthentication() instanceof JwtAuthenticationToken token) {
                Jwt jwt = token.getToken();
                String tenant = jwt.getClaimAsString("tenant_id");
                String user = jwt.hasClaim("user_id") ? jwt.getClaimAsString("user_id") : jwt.getSubject();
                if (tenant != null && user != null) TenantContext.set(UUID.fromString(tenant), UUID.fromString(user));
            }
            chain.doFilter(request, response);
        } finally {
            TenantContext.clear();
        }
    }
}
