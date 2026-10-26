package com.kadreo.demo;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

/** Ids of the demo tenant; the seed export derives every id the same way from readable keys. */
public final class DemoIds {

    public static final UUID TENANT = fromKey("t-demo");
    public static final String DEMO_USER_EMAIL = "marta.kowalska@demo-outsourcing.pl";

    private DemoIds() {}

    /** Name-based UUID (v3) of {@code "kadreo-demo:" + key}, identical to the TypeScript exporter. */
    public static UUID fromKey(String key) {
        return UUID.nameUUIDFromBytes(("kadreo-demo:" + key).getBytes(StandardCharsets.UTF_8));
    }
}
