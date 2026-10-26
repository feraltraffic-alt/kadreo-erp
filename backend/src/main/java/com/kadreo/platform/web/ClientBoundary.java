package com.kadreo.platform.web;

import com.kadreo.platform.security.CurrentUser;
import com.kadreo.platform.security.CurrentUserService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Set;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Keeps the two audiences apart (spec 12): client users reach only the portal API, the
 * contractor's staff only the back-office API. Checked for every request in one place, so a
 * back-office endpoint that forgets a permission check still never answers a client user.
 */
@Configuration(proxyBeanMethods = false)
class ClientBoundary implements WebMvcConfigurer {

    /** Endpoints both audiences use: profile, language, tenant branding, sign-in. */
    private static final Set<String> SHARED = Set.of("/api/v1/me", "/api/v1/tenant", "/api/v1/dev/token");

    private final CurrentUserService users;

    ClientBoundary(CurrentUserService users) {
        this.users = users;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new HandlerInterceptor() {
            @Override
            public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
                String path = request.getRequestURI();
                if (!path.startsWith("/api/v1/") || SHARED.contains(path) || request.getUserPrincipal() == null) return true;
                CurrentUser u = users.current();
                boolean portal = path.startsWith("/api/v1/portal/");
                if (portal && !u.isClientUser()) throw ApiException.forbidden("portal.read");
                if (!portal && u.isClientUser()) throw ApiException.forbidden("backoffice");
                return true;
            }
        }).addPathPatterns("/api/v1/**");
    }
}
