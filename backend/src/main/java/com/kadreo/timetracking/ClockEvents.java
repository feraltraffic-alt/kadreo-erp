package com.kadreo.timetracking;

import com.kadreo.platform.tenant.TenantContext;
import com.kadreo.platform.util.Ids;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Clock events as the other modules see them (spec 14): writes one event with its proof, reads the
 * events of assignments, and the four-eyes decision on pending manual records. Who may do what is
 * checked by the caller; this class only keeps the table consistent.
 */
@Service
public class ClockEvents {

    private static final DateTimeFormatter HHMM = DateTimeFormatter.ofPattern("HH:mm");

    private final JdbcClient jdbc;

    public ClockEvents(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /** One stored event. {@code at} is when it happened (device time for offline and manual records). */
    public record Event(UUID id, UUID workerId, UUID assignmentId, UUID siteId, String type, OffsetDateTime at, String source, String status, boolean offline, String approvedByName,
            String createdByName, String manualReason, String comment, String timeZone) {

        public String time() {
            return at.atZoneSameInstant(ZoneId.of(timeZone)).format(HHMM);
        }

        public LocalDate localDate() {
            return at.atZoneSameInstant(ZoneId.of(timeZone)).toLocalDate();
        }
    }

    public record NewEvent(UUID workerId, UUID assignmentId, UUID siteId, String type, OffsetDateTime deviceTime, OffsetDateTime serverTime, String source, String status, Integer accuracyM,
            boolean photo, Double lat, Double lng, Integer distanceM, String comment, boolean offline, String idempotencyKey, Integer qrPoint, UUID kioskDeviceId,
            String manualReason, UUID createdBy, String createdByName) {}

    private static final String SELECT = """
            select c.id, c.worker_id, c.assignment_id, c.site_id, c.type, c.at, c.source, c.status, c.offline, c.decided_by_name, c.created_by_name, c.manual_reason, c.comment, s.time_zone
            from clock_event c join site s on s.id = c.site_id""";

    private static Event map(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        String status = rs.getString("status");
        return new Event(rs.getObject("id", UUID.class), rs.getObject("worker_id", UUID.class), rs.getObject("assignment_id", UUID.class), rs.getObject("site_id", UUID.class),
                rs.getString("type"), rs.getObject("at", OffsetDateTime.class), rs.getString("source"), status, rs.getBoolean("offline"),
                "accepted".equals(status) ? rs.getString("decided_by_name") : null, rs.getString("created_by_name"), rs.getString("manual_reason"), rs.getString("comment"),
                rs.getString("time_zone"));
    }

    @Transactional
    public Event record(NewEvent e) {
        UUID id = Ids.newId();
        jdbc.sql("""
                insert into clock_event (id, tenant_id, worker_id, assignment_id, site_id, type, device_time, server_time, source, status, gps_accuracy_m, photo, lat, lng, distance_m,
                    comment, offline, idempotency_key, qr_point, kiosk_device_id, manual_reason, created_by, created_by_name)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""")
                .param(id).param(TenantContext.requireTenantId()).param(e.workerId()).param(e.assignmentId()).param(e.siteId()).param(e.type()).param(e.deviceTime()).param(e.serverTime())
                .param(e.source()).param(e.status()).param(e.accuracyM()).param(e.photo()).param(e.lat()).param(e.lng()).param(e.distanceM()).param(e.comment()).param(e.offline())
                .param(e.idempotencyKey()).param(e.qrPoint()).param(e.kioskDeviceId()).param(e.manualReason()).param(e.createdBy()).param(e.createdByName())
                .update();
        return byId(id);
    }

    @Transactional(readOnly = true)
    public Event byId(UUID id) {
        return jdbc.sql(SELECT + " where c.id = ?").param(id).query(ClockEvents::map).single();
    }

    @Transactional(readOnly = true)
    public UUID byIdempotencyKey(String key) {
        if (key == null) return null;
        return jdbc.sql("select id from clock_event where idempotency_key = ?").param(key).query(UUID.class).optional().orElse(null);
    }

    /** Non-rejected events of these assignments, oldest first, grouped by assignment. */
    @Transactional(readOnly = true)
    public Map<UUID, List<Event>> ofAssignments(Collection<UUID> assignmentIds) {
        if (assignmentIds.isEmpty()) return Map.of();
        return jdbc.sql(SELECT + " where c.assignment_id = any(?) and c.status <> 'rejected' order by c.at, c.seq")
                .param(assignmentIds.toArray(UUID[]::new))
                .query(ClockEvents::map).list().stream()
                .collect(Collectors.groupingBy(Event::assignmentId));
    }

    /** Pending events (manual or kiosk without a shift) on these sites, newest first. */
    @Transactional(readOnly = true)
    public List<Event> pending(Collection<UUID> siteIds) {
        if (siteIds.isEmpty()) return List.of();
        return jdbc.sql(SELECT + " where c.status = 'pending' and c.site_id = any(?) order by c.seq desc").param(siteIds.toArray(UUID[]::new)).query(ClockEvents::map).list();
    }

    /** Four-eyes decision (section 3): returns false when the event was no longer pending. */
    @Transactional
    public boolean decide(UUID id, boolean approve, UUID by, String byName, String reason, OffsetDateTime at) {
        return jdbc.sql("""
                update clock_event set status = ?, decided_by = ?, decided_by_name = ?, decided_at = ?, decision_reason = ?
                where id = ? and status = 'pending'""")
                .param(approve ? "accepted" : "rejected").param(by).param(byName).param(at).param(reason).param(id)
                .update() == 1;
    }

    /** Recent events at a site (kiosk «Последние отметки»). */
    @Transactional(readOnly = true)
    public List<Event> recentAt(UUID siteId, List<String> sources, OffsetDateTime from, int limit) {
        return jdbc.sql(SELECT + " where c.site_id = ? and c.source = any(?) and c.at >= ? order by c.at desc, c.seq desc limit ?")
                .param(siteId).param(sources.toArray(String[]::new)).param(from).param(limit)
                .query(ClockEvents::map).list();
    }
}
