package com.kadreo.support;

import java.util.Map;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

/** Small HTTP helper: signs in as a demo user and calls the API with the bearer token. */
public final class Api {

    private final TestRestTemplate http;
    private final String token;
    private String role;

    private Api(TestRestTemplate http, String token) {
        this.http = http;
        this.token = token;
    }

    @SuppressWarnings("unchecked")
    public static Api signIn(TestRestTemplate http, String email) {
        var res = http.postForEntity("/api/v1/dev/token", Map.of("email", email), Map.class);
        if (!res.getStatusCode().is2xxSuccessful()) throw new IllegalStateException("token: " + res.getStatusCode());
        return new Api(http, (String) ((Map<String, Object>) res.getBody()).get("accessToken"));
    }

    public Api as(String activeRole) {
        this.role = activeRole;
        return this;
    }

    private HttpHeaders headers() {
        HttpHeaders h = new HttpHeaders();
        h.setBearerAuth(token);
        h.setContentType(MediaType.APPLICATION_JSON);
        if (role != null) h.set("X-Active-Role", role);
        return h;
    }

    public <T> ResponseEntity<T> get(String path, Class<T> type) {
        return http.exchange(path, HttpMethod.GET, new HttpEntity<>(headers()), type);
    }

    public <T> ResponseEntity<T> post(String path, Object body, Class<T> type) {
        return http.exchange(path, HttpMethod.POST, new HttpEntity<>(body, headers()), type);
    }

    public <T> ResponseEntity<T> put(String path, Object body, Class<T> type) {
        return http.exchange(path, HttpMethod.PUT, new HttpEntity<>(body, headers()), type);
    }

    public <T> ResponseEntity<T> patch(String path, Object body, Class<T> type) {
        return http.exchange(path, HttpMethod.PATCH, new HttpEntity<>(body, headers()), type);
    }

    public <T> ResponseEntity<T> delete(String path, Class<T> type) {
        return http.exchange(path, HttpMethod.DELETE, new HttpEntity<>(headers()), type);
    }
}
