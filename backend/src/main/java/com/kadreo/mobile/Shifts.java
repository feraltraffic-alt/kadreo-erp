package com.kadreo.mobile;

import com.kadreo.mobile.MobileModels.ClockEventView;
import com.kadreo.mobile.MobileModels.MobileShift;
import com.kadreo.mobile.MobileModels.SiteRules;
import com.kadreo.organization.OrganizationModels.Position;
import com.kadreo.organization.OrganizationModels.ShiftTemplate;
import com.kadreo.organization.OrganizationModels.Site;
import com.kadreo.organization.OrganizationService;
import com.kadreo.platform.security.CurrentUser;
import com.kadreo.platform.security.CurrentUserService;
import com.kadreo.platform.web.ApiException;
import com.kadreo.timetracking.ClockEvents;
import com.kadreo.timetracking.ClockEvents.Event;
import com.kadreo.workforce.WorkforceModels.Assignment;
import com.kadreo.workforce.WorkforceService;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/** Shared rules of the app and the kiosk: whose shift it is, where in the shift a worker is, site clock-in settings. */
@Component
class Shifts {

    static final Map<String, List<String>> NEXT = Map.of(
            "before", List.of("in"), "on_shift", List.of("break_start", "out"), "on_break", List.of("break_end"), "finished", List.of(), "no_shift", List.of());

    private final JdbcClient jdbc;
    private final OrganizationService org;
    private final WorkforceService workforce;
    private final ClockEvents clockEvents;
    private final CurrentUserService users;
    private final Credentials credentials;
    private final Clock clock;
    private final boolean demoQr;

    Shifts(JdbcClient jdbc, OrganizationService org, WorkforceService workforce, ClockEvents clockEvents, CurrentUserService users, Credentials credentials, Clock clock,
            @Value("${kadreo.mobile.demo-qr:false}") boolean demoQr) {
        this.jdbc = jdbc;
        this.org = org;
        this.workforce = workforce;
        this.clockEvents = clockEvents;
        this.users = users;
        this.credentials = credentials;
        this.clock = clock;
        this.demoQr = demoQr;
    }

    OffsetDateTime now() {
        return OffsetDateTime.now(clock);
    }

    /** The signed-in worker (app account linked to a worker record) with the permission. */
    UUID requireWorker(String permission) {
        CurrentUser u = users.require(permission);
        return jdbc.sql("select worker_id from app_user where id = ?").param(u.id()).query(UUID.class).optional()
                .orElseThrow(() -> ApiException.forbidden(permission));
    }

    /** Site settings of section 14 not in the organization read model. */
    record SiteExtra(int noShowAfterMin, int radiusM, int requiredAccuracyM, Integer outputNorm, String outputUnit, String outputSource) {}

    SiteExtra extra(UUID siteId) {
        return jdbc.sql("select no_show_after_min, geofence_radius_m, required_accuracy_m, output_norm, output_unit, output_source from site where id = ?")
                .param(siteId).query(SiteExtra.class).single();
    }

    record Geo(boolean inside, int distanceM) {}

    /** Inside the site's geofence polygon, or within the radius when the site has none (14.1 step 4). */
    Geo geofence(UUID siteId, double lat, double lng) {
        return jdbc.sql("""
                select coalesce(ST_Covers(geofence, ST_SetSRID(ST_MakePoint(?, ?), 4326)), ST_DWithin(location, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, geofence_radius_m)) as inside,
                       round(ST_Distance(location, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography))::int as distance_m
                from site where id = ?""")
                .param(lng).param(lat).param(lng).param(lat).param(lng).param(lat).param(siteId)
                .query(Geo.class).single();
    }

    SiteRules rules(Site s) {
        SiteExtra x = extra(s.id());
        return new SiteRules(s.id(), s.name(), s.lat(), s.lng(), x.radiusM(), x.requiredAccuracyM(), s.outsideGeofence(), s.clockMethods(), s.clockWindowMin(), s.lateThresholdMin(),
                demoQr ? sitePointQr(s.id(), 1) : null);
    }

    /** Signed payload of a site's QR point (printed in the site card, 10.2). */
    String sitePointQr(UUID siteId, int point) {
        return credentials.sign("sq1|" + siteId + "|" + point);
    }

    /** The point number if the payload is a valid QR of this site, else null. */
    Integer verifySitePointQr(String payload, UUID siteId) {
        String p = credentials.verify(payload);
        if (p == null) return null;
        String[] parts = p.split("\\|");
        if (parts.length != 3 || !"sq1".equals(parts[0]) || !parts[1].equals(siteId.toString())) return null;
        return Integer.parseInt(parts[2]);
    }

    Site siteOfTemplate(ShiftTemplate t) {
        return org.site(org.project(t.projectId()).siteId());
    }

    Map<UUID, Position> positions() {
        return org.positions().stream().collect(Collectors.toMap(Position::id, Function.identity()));
    }

    MobileShift view(Assignment a, Map<UUID, Position> positions) {
        ShiftTemplate t = org.template(a.templateId());
        Site s = siteOfTemplate(t);
        return new MobileShift(a.id(), "assignment", a.date(), t.start().toString(), t.end().toString(), s.id(), s.name(), t.positionId(), positions.get(t.positionId()).name(),
                "proposed".equals(a.status()) ? "proposed" : "confirmed", null);
    }

    MobileShift offerView(UUID offerId, UUID templateId, LocalDate date, int bonus, Map<UUID, Position> positions) {
        ShiftTemplate t = org.template(templateId);
        Site s = siteOfTemplate(t);
        return new MobileShift(offerId, "offer", date, t.start().toString(), t.end().toString(), s.id(), s.name(), t.positionId(), positions.get(t.positionId()).name(), "offer",
                bonus > 0 ? bonus : null);
    }

    static ClockEventView eventView(Event e) {
        return new ClockEventView(e.id(), e.type(), e.time(), e.at(), e.source(), e.status(), e.offline(), e.approvedByName());
    }

    /** Where in the shift the worker is, from the assignment's events. */
    static String state(List<Event> events) {
        if (events.isEmpty()) return "before";
        return switch (events.get(events.size() - 1).type()) {
            case "out" -> "finished";
            case "break_start" -> "on_break";
            default -> "on_shift";
        };
    }

    /** Start and end of the assignment's shift as instants in the site's time zone. */
    record Window(ZonedDateTime start, ZonedDateTime end) {}

    Window window(Assignment a) {
        ShiftTemplate t = org.template(a.templateId());
        ZoneId zone = ZoneId.of(siteOfTemplate(t).timeZone());
        ZonedDateTime start = LocalDateTime.of(a.date(), t.start()).atZone(zone);
        ZonedDateTime end = LocalDateTime.of(t.end().isAfter(t.start()) ? a.date() : a.date().plusDays(1), t.end()).atZone(zone);
        return new Window(start, end);
    }

    /** Today's confirmed shift of the worker, or last night's one that is still running and not finished. */
    Assignment current(UUID workerId) {
        LocalDate today = LocalDate.now(clock.withZone(ZoneId.of("Europe/Warsaw")));
        List<Assignment> mine = workforce.assignmentsOfWorker(workerId, today.minusDays(1), today).stream().filter(a -> "confirmed".equals(a.status())).toList();
        Map<UUID, List<Event>> events = clockEvents.ofAssignments(mine.stream().map(Assignment::id).toList());
        Assignment todays = null;
        for (Assignment a : mine) {
            if (a.date().equals(today)) todays = a;
            else if (now().isBefore(window(a).end().toOffsetDateTime()) && !"finished".equals(state(events.getOrDefault(a.id(), List.of())))) return a;
        }
        return todays;
    }

    /** Minutes late against the shift start beyond the site's threshold (0 when on time). */
    int lateMinutes(Assignment a, OffsetDateTime at) {
        Window w = window(a);
        Site s = siteOfTemplate(org.template(a.templateId()));
        long late = java.time.Duration.between(w.start().toOffsetDateTime(), at).toMinutes();
        return late > s.lateThresholdMin() ? (int) late : 0;
    }

    /** «Viktor H.» — first name and the initial only (kiosk screen, 7.4). */
    static String shortName(String first, String last) {
        return first + " " + (last.isEmpty() ? "" : last.charAt(0) + ".");
    }
}
