package com.kadreo.platform.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kadreo.platform.security.CurrentUser;
import com.kadreo.platform.security.CurrentUserService;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Current user and tenant branding: the first two calls of every client session. */
@RestController
@RequestMapping("/api/v1")
class MeController {

    private final CurrentUserService users;
    private final JdbcClient jdbc;
    private final ObjectMapper json;

    MeController(CurrentUserService users, JdbcClient jdbc, ObjectMapper json) {
        this.users = users;
        this.jdbc = jdbc;
        this.json = json;
    }

    @GetMapping("/me")
    CurrentUser me() {
        return users.current();
    }

    record LocaleChange(String locale) {}

    /** Interface language is stored in the profile and applied without reload (8.4). */
    @PatchMapping("/me")
    CurrentUser updateMe(@RequestBody LocaleChange change) {
        if (change.locale() == null || !change.locale().matches("pl|uk|ru|en")) throw ApiException.badRequest("locale");
        UUID id = users.current().id();
        jdbc.sql("update app_user set locale = ?, updated_at = now(), updated_by = ?, version = version + 1 where id = ?")
                .param(change.locale()).param(id).param(id).update();
        return users.load(id, users.current().activeRole());
    }

    @GetMapping("/tenant")
    Map<String, Object> tenant() throws Exception {
        record Row(UUID id, String name, String defaultLocale, String branding, String settings) {}
        Row t = jdbc.sql("select id, name, default_locale, branding::text, settings::text from tenant").query(Row.class).optional().orElseThrow(ApiException::notFound);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", t.id());
        out.put("name", t.name());
        out.put("defaultLocale", t.defaultLocale());
        out.put("branding", json.readValue(t.branding(), JsonNode.class));
        out.put("settings", json.readValue(t.settings(), JsonNode.class));
        return out;
    }
}
