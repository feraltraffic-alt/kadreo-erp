package com.kadreo.platform.util;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;

/** jsonb helpers: LocalizedText is stored as {"pl": …, "uk": …, "ru": …, "en": …}. */
public final class Json {

    private static final ObjectMapper MAPPER = new ObjectMapper().findAndRegisterModules()
            .disable(com.fasterxml.jackson.databind.SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
            .disable(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
    private static final TypeReference<Map<String, String>> TEXT = new TypeReference<>() {};

    private Json() {}

    public static Map<String, String> text(String jsonb) {
        if (jsonb == null) return null;
        try {
            return MAPPER.readValue(jsonb, TEXT);
        } catch (Exception e) {
            throw new IllegalStateException("Bad localized text: " + jsonb, e);
        }
    }

    public static JsonNode node(String jsonb) {
        if (jsonb == null) return null;
        try {
            return MAPPER.readTree(jsonb);
        } catch (Exception e) {
            throw new IllegalStateException("Bad json: " + jsonb, e);
        }
    }

    public static <T> T read(String json, Class<T> type) {
        try {
            return MAPPER.readValue(json, type);
        } catch (Exception e) {
            throw new IllegalStateException("Bad json for " + type.getSimpleName(), e);
        }
    }

    public static String write(Object value) {
        try {
            return MAPPER.writeValueAsString(value);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
