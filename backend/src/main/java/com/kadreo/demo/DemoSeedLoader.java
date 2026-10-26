package com.kadreo.demo;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.InputStream;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Types;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.zip.GZIPInputStream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.flyway.FlywayProperties;
import org.springframework.context.annotation.Profile;
import org.springframework.core.annotation.Order;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.stereotype.Component;

/**
 * Loads the demo tenant on first start (demo profile): the same data as the front-end demo,
 * exported by {@code packages/domain/scripts/export-seed.ts}. Runs with the owner credentials and
 * the demo tenant set on the connection, so the row-level security checks still apply.
 */
@Component
@Profile("demo")
@Order(0)
class DemoSeedLoader implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DemoSeedLoader.class);
    private static final int BATCH = 500;

    /** Columns that need a SQL expression instead of a plain parameter. */
    private static final Map<String, Map<String, String>> SPECIAL = Map.of(
            "site", Map.of("location", "ST_SetSRID(ST_MakePoint(?::float8, ?::float8), 4326)::geography", "geofence", "ST_SetSRID(ST_GeomFromGeoJSON(?), 4326)"),
            "worker", Map.of("home", "ST_SetSRID(ST_MakePoint(?::float8, ?::float8), 4326)::geography"),
            "user_role", Map.of("role_id", "(select id from role where tenant_id is null and code = ?)"));

    private final ObjectMapper json;
    private final FlywayProperties flyway;
    private final boolean enabled;

    DemoSeedLoader(ObjectMapper json, FlywayProperties flyway, @Value("${kadreo.demo.seed:true}") boolean enabled) {
        this.json = json;
        this.flyway = flyway;
        this.enabled = enabled;
    }

    @Override
    public void run(ApplicationArguments args) throws Exception {
        if (!enabled) return;
        var ds = new DriverManagerDataSource(flyway.getUrl(), flyway.getUser(), flyway.getPassword());
        try (Connection c = ds.getConnection()) {
            c.setAutoCommit(false);
            setTenant(c);
            try (var st = c.prepareStatement("select count(*) from tenant where id = ?::uuid")) {
                st.setString(1, DemoIds.TENANT.toString());
                var rs = st.executeQuery();
                rs.next();
                if (rs.getInt(1) > 0) {
                    log.info("Demo tenant already present, skipping seed");
                    c.rollback();
                    return;
                }
            }
            long started = System.currentTimeMillis();
            JsonNode root;
            try (InputStream in = new GZIPInputStream(new ClassPathResource("demo/seed.json.gz").getInputStream())) {
                root = json.readTree(in);
            }
            int total = 0;
            for (Iterator<Map.Entry<String, JsonNode>> it = root.fields(); it.hasNext(); ) {
                var table = it.next();
                total += insert(c, table.getKey(), table.getValue());
            }
            c.commit();
            log.info("Demo seed loaded: {} rows in {} ms", total, System.currentTimeMillis() - started);
        }
    }

    private static void setTenant(Connection c) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("select set_config('app.tenant_id', ?, false)")) {
            ps.setString(1, DemoIds.TENANT.toString());
            ps.execute();
        }
    }

    private int insert(Connection c, String table, JsonNode rows) throws SQLException {
        if (!rows.isArray() || rows.isEmpty()) return 0;
        Map<String, String> special = SPECIAL.getOrDefault(table, Map.of());
        // Rows of one table may carry different optional keys (missing = column default):
        // insert each group of rows with the same keys separately.
        Map<List<String>, List<JsonNode>> groups = new java.util.LinkedHashMap<>();
        for (JsonNode row : rows) {
            List<String> k = new ArrayList<>();
            row.fieldNames().forEachRemaining(k::add);
            groups.computeIfAbsent(k, x -> new ArrayList<>()).add(row);
        }
        int n = 0;
        for (var g : groups.entrySet()) n += insertGroup(c, table, special, g.getKey(), g.getValue());
        return n;
    }

    private static boolean isScalarArray(JsonNode v) {
        for (JsonNode x : v) if (x.isContainerNode()) return false;
        return true;
    }

    private int insertGroup(Connection c, String table, Map<String, String> special, List<String> keys, List<JsonNode> rows) throws SQLException {
        // Map export keys to columns: lat/lng → location (site) or home (worker), role_code → role_id.
        List<String> columns = new ArrayList<>();
        List<String> values = new ArrayList<>();
        List<String[]> params = new ArrayList<>();
        for (String k : keys) {
            switch (k) {
                case "lat" -> {}
                case "lng" -> {
                    String col = table.equals("worker") ? "home" : "location";
                    columns.add(col);
                    values.add(special.get(col));
                    params.add(new String[] {"lng", "lat"});
                }
                case "role_code" -> {
                    columns.add("role_id");
                    values.add(special.get("role_id"));
                    params.add(new String[] {"role_code"});
                }
                default -> {
                    columns.add(k);
                    values.add(special.getOrDefault(k, "?"));
                    params.add(new String[] {k});
                }
            }
        }
        String sql = "insert into " + table + " (" + String.join(", ", columns) + ") values (" + String.join(", ", values) + ")";
        int n = 0;
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            for (JsonNode row : rows) {
                int i = 1;
                for (String[] p : params) {
                    for (String key : p) {
                        JsonNode v = row.get(key);
                        if (key.equals("geofence") && v != null && !v.isNull()) {
                            ps.setObject(i++, "{\"type\":\"Polygon\",\"coordinates\":[" + v + "]}", Types.OTHER);
                        } else if (v == null || v.isNull()) {
                            ps.setNull(i++, Types.OTHER);
                        } else if (v.isArray() && isScalarArray(v)) {
                            // Arrays of plain values are PostgreSQL arrays (text[], uuid[]); others are jsonb.
                            List<String> items = new ArrayList<>();
                            v.forEach(x -> items.add(x.asText()));
                            ps.setObject(i++, "{" + String.join(",", items) + "}", Types.OTHER);
                        } else if (v.isObject() || v.isArray()) {
                            ps.setObject(i++, v.toString(), Types.OTHER);
                        } else {
                            ps.setObject(i++, v.asText(), Types.OTHER);
                        }
                    }
                }
                ps.addBatch();
                if (++n % BATCH == 0) ps.executeBatch();
            }
            ps.executeBatch();
        }
        return n;
    }
}
