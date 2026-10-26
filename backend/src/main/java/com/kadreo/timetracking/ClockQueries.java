package com.kadreo.timetracking;

import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Public read API over clock events for other modules (the live dashboard). */
@Service
@Transactional(readOnly = true)
public class ClockQueries {

    private final JdbcClient jdbc;

    public ClockQueries(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /** First clock-in per assignment, for the given assignments. Missing key = not clocked in. */
    public Map<UUID, OffsetDateTime> firstClockIns(Collection<UUID> assignmentIds) {
        Map<UUID, OffsetDateTime> out = new HashMap<>();
        if (assignmentIds.isEmpty()) return out;
        jdbc.sql("select assignment_id, min(at) from clock_event where type = 'in' and status <> 'rejected' and assignment_id = any(?) group by assignment_id")
                .param(assignmentIds.toArray(UUID[]::new))
                .query((rs, i) -> out.put(rs.getObject(1, UUID.class), rs.getObject(2, OffsetDateTime.class)))
                .list();
        return out;
    }

    /**
     * Clock-ins later than the site's threshold on {@code day}, counting only shifts that had
     * started by {@code upTo} (so "late today so far" compares with the same point last week).
     */
    public int lateClockIns(Collection<UUID> siteIds, java.time.LocalDate day, OffsetDateTime upTo) {
        if (siteIds.isEmpty()) return 0;
        return jdbc.sql("""
                select count(*) from clock_event c
                join assignment a on a.id = c.assignment_id
                join shift_template t on t.id = a.template_id
                join site s on s.id = c.site_id
                where c.type = 'in' and c.status <> 'rejected' and a.date = ? and c.site_id = any(?) and a.replaces_id is null
                  and (c.at at time zone s.time_zone)::time > t.start_time + make_interval(mins => s.late_threshold_min)
                  and t.start_time <= (?::timestamptz at time zone s.time_zone)::time""")
                .param(day).param(siteIds.toArray(UUID[]::new)).param(upTo)
                .query(Integer.class).single();
    }
}
