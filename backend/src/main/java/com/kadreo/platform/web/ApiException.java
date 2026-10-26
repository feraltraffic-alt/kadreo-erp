package com.kadreo.platform.web;

import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * Errors with the body shape the clients expect ({@code ApiErrorBody} in the web contract):
 * {@code {"code":"constraint","violations":[…]}}, {@code {"code":"forbidden","permission":"…"}}, …
 */
public class ApiException extends RuntimeException {

    private final HttpStatus status;
    private final Map<String, Object> body;

    public ApiException(HttpStatus status, Map<String, Object> body) {
        super(String.valueOf(body.get("code")));
        this.status = status;
        this.body = body;
    }

    public HttpStatus status() {
        return status;
    }

    public Map<String, Object> body() {
        return body;
    }

    public static ApiException notFound() {
        return new ApiException(HttpStatus.NOT_FOUND, Map.of("code", "not_found"));
    }

    public static ApiException forbidden(String permission) {
        return new ApiException(HttpStatus.FORBIDDEN, Map.of("code", "forbidden", "permission", permission));
    }

    public static ApiException constraint(Object violations) {
        return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, Map.of("code", "constraint", "violations", violations));
    }

    public static ApiException conflict(String byName, String at) {
        return new ApiException(HttpStatus.CONFLICT, Map.of("code", "conflict", "byName", byName, "at", at));
    }

    public static ApiException badRequest(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, Map.of("code", "bad_request", "message", message));
    }
}
