package com.kadreo;

import static com.kadreo.demo.DemoIds.fromKey;
import static org.assertj.core.api.Assertions.assertThat;

import com.kadreo.demo.DemoIds;
import com.kadreo.platform.tenant.TenantContext;
import com.kadreo.support.Api;
import com.kadreo.support.IntegrationTest;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;

/**
 * Mobile app and kiosk (spec 14) against the same demo as the Expo app: Viktor (worker), Oleh
 * (team leader), Marta (manager) and the Stryków kiosk. The demo clock stands at 26.10 08:14:52.
 * Every test puts the shared demo data back, so the dashboard numbers other tests check stay.
 */
@SuppressWarnings({"unchecked", "rawtypes"})
class MobileIT extends IntegrationTest {

    static final String VIKTOR = "viktor.hnatiuk@kadreo-demo.app";
    static final String OLEH = "oleh.tkachenko@kadreo-demo.app";
    static final String KIOSK = "kiosk.strykow.1@devices.kadreo-demo.app";
    static final OffsetDateTime NOW = OffsetDateTime.parse("2026-10-26T07:14:52Z");

    @Autowired TestRestTemplate http;
    @Autowired JdbcClient jdbc;

    long maxSeq;
    OffsetDateTime started;
    List<UUID> notifications;
    List<UUID> timesheets;
    Map<String, Object> viktorCredential;

    <T> T db(Supplier<T> work) {
        return TenantContext.callAs(DemoIds.TENANT, null, work::get);
    }

    Api as(String email) {
        return Api.signIn(http, email);
    }

    @BeforeEach
    void snapshot() {
        maxSeq = db(() -> jdbc.sql("select coalesce(max(seq), 0) from clock_event").query(Long.class).single());
        started = db(() -> jdbc.sql("select now()").query(OffsetDateTime.class).single());
        notifications = db(() -> jdbc.sql("select id from notification").query(UUID.class).list());
        timesheets = db(() -> jdbc.sql("select id from timesheet").query(UUID.class).list());
        viktorCredential = db(() -> jdbc.sql("select pin_hash, biometric_consent_at from worker_credential where worker_id = ?").param(fromKey("w-1")).query().singleRow());
    }

    @AfterEach
    void restore() {
        TenantContext.runAs(DemoIds.TENANT, null, () -> {
            List<UUID> newAssignments = jdbc.sql("select id from assignment where created_at >= ?").param(started).query(UUID.class).list();
            UUID[] ids = newAssignments.toArray(UUID[]::new);
            jdbc.sql("update clock_issue set status = 'open', decided_by = null, decided_by_name = null, decided_at = null, decision_reason = null, clock_event_id = null where id = any(?)")
                    .param(new UUID[] {fromKey("ci-1"), fromKey("ci-2"), fromKey("ci-3")}).update();
            jdbc.sql("delete from clock_issue where id <> all(?)").param(new UUID[] {fromKey("ci-1"), fromKey("ci-2"), fromKey("ci-3")}).update();
            jdbc.sql("delete from clock_event where seq > ?").param(maxSeq).update();
            jdbc.sql("delete from timesheet where id <> all(?)").param(timesheets.toArray(UUID[]::new)).update();
            jdbc.sql("delete from timesheet_entry where assignment_id = any(?)").param(ids).update();
            jdbc.sql("delete from staff_request_assignment where assignment_id = any(?)").param(ids).update();
            jdbc.sql("update urgent_offer set status = 'sent', responded_at = null, assignment_id = null where id = ?").param(fromKey("uo-seed-1")).update();
            jdbc.sql("update urgent_request set accepted = 0, closed_at = null where id = ?").param(fromKey("ur-seed-1")).update();
            jdbc.sql("delete from urgent_offer where request_id in (select id from urgent_request where created_at >= ?)").param(started).update();
            jdbc.sql("delete from urgent_request where created_at >= ?").param(started).update();
            jdbc.sql("delete from assignment where id = any(?)").param(ids).update();
            jdbc.sql("delete from notification where id <> all(?)").param(notifications.toArray(UUID[]::new)).update();
            jdbc.sql("update worker_credential set pin_failed = 0, pin_locked_until = null").update();
            jdbc.sql("update worker_credential set pin_hash = ?, biometric_consent_at = ? where worker_id = ?")
                    .param(viktorCredential.get("pin_hash")).param(viktorCredential.get("biometric_consent_at")).param(fromKey("w-1")).update();
            jdbc.sql("update shift_output set value = 980 where site_id = ?").param(fromKey("s-strykow")).update();
        });
    }

    /* ------------------------------------------------------------------ worker */

    @Test
    void workerSeesTodaysShiftAndTheUrgentOfferAsOnTheMockUp() {
        Map d = as(VIKTOR).get("/api/v1/me/today", Map.class).getBody();
        assertThat((Map) d.get("worker")).containsEntry("firstName", "Viktor").containsEntry("number", "W-00012");
        assertThat((Map) d.get("shift")).containsEntry("start", "06:00").containsEntry("end", "14:00").containsEntry("siteName", "Stryków · Magazyn B").containsEntry("status", "confirmed");
        assertThat(d).containsEntry("state", "on_shift").containsEntry("opensAt", "05:30");
        assertThat((List<Map>) d.get("events")).singleElement().satisfies(e -> assertThat(e).containsEntry("time", "05:50").containsEntry("source", "access_card"));
        List<Map> upcoming = (List<Map>) d.get("upcoming");
        assertThat(upcoming).extracting(s -> s.get("date") + " " + s.get("status")).containsExactly("2026-10-27 confirmed", "2026-10-28 offer");
        assertThat(upcoming.get(1)).containsEntry("bonusPoints", 50);
        Map site = (Map) d.get("site");
        assertThat(site).containsEntry("outsideGeofence", "allow_flagged").containsEntry("clockWindowMin", 30);
        assertThat((String) site.get("demoQrPayload")).startsWith("sq1|");

        assertThat(as(VIKTOR).get("/api/v1/me/shifts?from=2026-10-26&to=2026-11-08", List.class).getBody()).extracting(s -> ((Map) s).get("date"))
                .contains("2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29");
        // A worker account cannot read the back office, and the manager has no worker screen.
        assertThat(as(VIKTOR).get("/api/v1/dashboard/summary", Map.class).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(as(DemoIds.DEMO_USER_EMAIL).get("/api/v1/me/today", Map.class).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    Map<String, Object> clock(String type, double lat, double lng, String comment, String key) {
        Map<String, Object> m = new HashMap<>();
        m.put("idempotencyKey", key);
        m.put("assignmentId", currentAssignment());
        m.put("type", type);
        m.put("deviceTime", NOW.toString());
        m.put("method", "gps_photo");
        m.put("lat", lat);
        m.put("lng", lng);
        m.put("accuracyM", 18);
        m.put("photo", false);
        if (comment != null) m.put("comment", comment);
        return m;
    }

    String currentAssignment() {
        return (String) ((Map) as(VIKTOR).get("/api/v1/me/today", Map.class).getBody().get("shift")).get("id");
    }

    @Test
    void clockRulesGeofenceSkewOrderQrAndIdempotency() {
        Api v = as(VIKTOR);
        double lat = 51.902, lng = 19.601;

        Map skewed = clock("break_start", lat, lng, null, "k-skew");
        skewed.put("deviceTime", NOW.plusMinutes(9).toString());
        assertThat(v.post("/api/v1/clock-events", skewed, Map.class).getBody()).containsEntry("code", "clock_rejected").containsEntry("reason", "clock_skew");
        assertThat(v.post("/api/v1/clock-events", clock("in", lat, lng, null, "k-in"), Map.class).getBody()).containsEntry("reason", "wrong_state");

        // 1.2 km away: the site allows it only with a comment, and flags it for the timesheet.
        var noComment = v.post("/api/v1/clock-events", clock("break_start", lat + 0.008, lng + 0.009, null, "k-out"), Map.class);
        assertThat(noComment.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
        assertThat(noComment.getBody()).containsEntry("reason", "comment_required");
        assertThat((Integer) noComment.getBody().get("distanceM")).isBetween(1000, 1400);
        Map flagged = v.post("/api/v1/clock-events", clock("break_start", lat + 0.008, lng + 0.009, "У второго въезда", "k-break"), Map.class).getBody();
        assertThat(flagged).containsEntry("outcome", "flagged");
        assertThat((Map) flagged.get("event")).containsEntry("type", "break_start").containsEntry("time", "08:14").containsEntry("status", "flagged");
        // The same key again (a retry after a lost answer) returns the same event.
        Map again = v.post("/api/v1/clock-events", clock("break_start", lat + 0.008, lng + 0.009, "У второго въезда", "k-break"), Map.class).getBody();
        assertThat(((Map) again.get("event")).get("id")).isEqualTo(((Map) flagged.get("event")).get("id"));

        // Back from the break with the QR of the entrance: a foreign code is refused.
        String qr = (String) ((Map) v.get("/api/v1/me/today", Map.class).getBody().get("site")).get("demoQrPayload");
        Map qrBody = new HashMap<>(Map.of("idempotencyKey", "k-qr-bad", "assignmentId", currentAssignment(), "type", "break_end", "deviceTime", NOW.toString(), "method", "qr", "photo", false,
                "qrPayload", qr.replace("|1.", "|2.")));
        assertThat(v.post("/api/v1/clock-events", qrBody, Map.class).getBody()).containsEntry("reason", "bad_qr");
        qrBody.put("qrPayload", qr);
        qrBody.put("idempotencyKey", "k-qr");
        assertThat(v.post("/api/v1/clock-events", qrBody, Map.class).getBody()).containsEntry("outcome", "accepted");
        Map today = v.get("/api/v1/me/today", Map.class).getBody();
        assertThat(today).containsEntry("state", "on_shift");
        assertThat((List<Map>) today.get("events")).extracting(e -> e.get("type") + " " + e.get("source")).containsExactly("in access_card", "break_start gps_photo", "break_end qr");
    }

    @Test
    void firstToAcceptGetsTheUrgentShift() {
        Api v = as(VIKTOR);
        String offer = fromKey("uo-seed-1").toString();
        assertThat(v.post("/api/v1/urgent-offers/" + offer + "/accept", null, Void.class).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        List<Map> upcoming = (List<Map>) v.get("/api/v1/me/today", Map.class).getBody().get("upcoming");
        assertThat(upcoming.get(1)).containsEntry("date", "2026-10-28").containsEntry("kind", "assignment").containsEntry("status", "confirmed");
        var second = v.post("/api/v1/urgent-offers/" + offer + "/accept", null, Map.class);
        assertThat(second.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(second.getBody()).containsEntry("code", "taken");
        // Marta, who published the urgent shift, is told.
        assertThat(as(DemoIds.DEMO_USER_EMAIL).get("/api/v1/notifications", List.class).getBody())
                .anySatisfy(n -> assertThat((Map) ((Map) n).get("title")).containsEntry("ru", "Срочная смена: Viktor Hnatiuk принял(а)"));
    }

    @Test
    void problemReportGoesToTheManagerAndPinIsStoredHashed() {
        Api v = as(VIKTOR);
        Map issue = v.post("/api/v1/clock-issues", Map.of("assignmentId", currentAssignment(), "kind", "forgot", "type", "out", "time", "07:59", "comment", "Тест"), Map.class).getBody();
        assertThat(issue).containsEntry("status", "open").containsEntry("time", "07:59");
        assertThat(v.put("/api/v1/me/kiosk-pin", Map.of("pin", "12ab"), Map.class).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(v.put("/api/v1/me/kiosk-pin", Map.of("pin", "135790"), Map.class).getBody()).containsEntry("kioskPinSet", true);
        String hash = db(() -> jdbc.sql("select pin_hash from worker_credential where worker_id = ?").param(fromKey("w-1")).query(String.class).single());
        assertThat(hash).startsWith("pbkdf2-sha256$").doesNotContain("135790");
        assertThat(v.put("/api/v1/me/biometric-consent", Map.of("consent", false), Map.class).getBody()).containsEntry("biometricConsent", false);
    }

    /* ------------------------------------------------------------- team leader */

    @Test
    void teamLeaderSeesTheBrigadeAndClocksInManuallyForApproval() {
        Api oleh = as(OLEH);
        Map b = oleh.get("/api/v1/team/brigade", Map.class).getBody();
        assertThat((Map) b.get("shift")).containsEntry("start", "06:00").containsEntry("end", "14:00").containsEntry("siteName", "Stryków · Magazyn B");
        assertThat((Map) b.get("counters")).containsEntry("planned", 22).containsEntry("onSite", 17).containsEntry("late", 1).containsEntry("noShow", 4);
        assertThat((Map) b.get("output")).containsEntry("norm", 3600).containsEntry("value", 980).containsEntry("planNow", 1005).containsEntry("source", "team_leader");
        List<Map> members = (List<Map>) b.get("members");
        assertThat(members).noneMatch(m -> "W-00016".equals(m.get("number"))); // Oleh himself
        Map pawlak = members.stream().filter(m -> "W-00950".equals(m.get("number"))).findFirst().orElseThrow();
        assertThat(pawlak).containsEntry("status", "no_show");
        assertThat((Map) pawlak.get("issue")).containsEntry("kind", "no_gps");
        assertThat(members.stream().filter(m -> "W-00018".equals(m.get("number"))).findFirst().orElseThrow()).containsEntry("status", "late");

        Map manual = Map.of("assignmentId", pawlak.get("assignmentId"), "type", "in", "time", "05:58", "reason", "no_gps", "comment", "GPS вне зоны");
        Map after = oleh.post("/api/v1/team/manual-clock", manual, Map.class).getBody();
        Map pawlakAfter = ((List<Map>) after.get("members")).stream().filter(m -> "W-00950".equals(m.get("number"))).findFirst().orElseThrow();
        assertThat(pawlakAfter).containsEntry("status", "manual_pending").containsEntry("clockIn", "05:58");
        // The team leader cannot clock in themselves.
        String own = TenantContext.callAs(DemoIds.TENANT, null, () -> jdbc.sql("""
                select a.id::text from assignment a join app_user u on u.worker_id = a.worker_id where u.email = ? and a.date = '2026-10-26'""").param(OLEH).query(String.class).single());
        assertThat(oleh.post("/api/v1/team/manual-clock", Map.of("assignmentId", own, "type", "out", "time", "08:00", "reason", "other", "comment", "x"), Map.class).getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);

        // Four eyes: the manager approves; the record is now accepted with the approver's name.
        Api marta = as(DemoIds.DEMO_USER_EMAIL);
        List<Map> decisions = marta.get("/api/v1/manager/decisions", List.class).getBody();
        Map d = decisions.stream().filter(x -> "manual_clock".equals(x.get("kind")) && "Adam Pawlak".equals(x.get("workerName"))).findFirst().orElseThrow();
        assertThat(d).containsEntry("requestedByName", "Oleh Tkachenko").containsEntry("time", "05:58").containsEntry("reason", "no_gps");
        assertThat(marta.post("/api/v1/manager/decisions/manual_clock/" + d.get("id"), Map.of("decision", "reject"), Map.class).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(marta.post("/api/v1/manager/decisions/manual_clock/" + d.get("id"), Map.of("decision", "approve"), Void.class).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(marta.post("/api/v1/manager/decisions/manual_clock/" + d.get("id"), Map.of("decision", "approve"), Map.class).getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        Map approved = ((List<Map>) oleh.get("/api/v1/team/brigade", Map.class).getBody().get("members")).stream().filter(m -> "W-00950".equals(m.get("number"))).findFirst().orElseThrow();
        assertThat(approved).containsEntry("status", "on_site");
    }

    @Test
    void replacementRequestAndOutput() {
        Api oleh = as(OLEH);
        Map b = oleh.get("/api/v1/team/brigade", Map.class).getBody();
        Map noShow = ((List<Map>) b.get("members")).stream().filter(m -> "no_show".equals(m.get("status")) && m.get("issue") == null).findFirst().orElseThrow();
        Map after = oleh.post("/api/v1/team/assignments/" + noShow.get("assignmentId") + "/replacement", null, Map.class).getBody();
        Map same = ((List<Map>) after.get("members")).stream().filter(m -> m.get("assignmentId").equals(noShow.get("assignmentId"))).findFirst().orElseThrow();
        assertThat((Map) same.get("replacement")).containsEntry("status", "searching");
        assertThat(oleh.post("/api/v1/team/assignments/" + noShow.get("assignmentId") + "/replacement", null, Map.class).getStatusCode()).isEqualTo(HttpStatus.CONFLICT);

        String key = (String) ((Map) b.get("shift")).get("key");
        Map out = oleh.put("/api/v1/team/output?shift=" + key, Map.of("value", 1200), Map.class).getBody();
        assertThat((Map) out.get("output")).containsEntry("value", 1200);
        assertThat(as(VIKTOR).put("/api/v1/team/output?shift=" + key, Map.of("value", 1), Map.class).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    /* ----------------------------------------------------------------- manager */

    @Test
    void managerSummaryDecisionsAndOffers() {
        Api marta = as(DemoIds.DEMO_USER_EMAIL);
        Map s = marta.get("/api/v1/manager/summary", Map.class).getBody();
        assertThat((Map) s.get("staffing")).containsEntry("onShift", 464).containsEntry("planned", 478);
        assertThat(s).containsEntry("sitesInScope", 23).containsEntry("problemSitesTotal", 5).containsEntry("openAlerts", 6);
        List<Map> problems = (List<Map>) s.get("problemSites");
        assertThat(problems).hasSize(3).allSatisfy(x -> assertThat(((Map) x).get("severity")).isIn("critical", "warn"));
        Map p = problems.stream().filter(x -> "Stryków · Magazyn B".equals(x.get("siteName"))).findFirst().orElseThrow();
        assertThat(p).containsEntry("severity", "critical").containsEntry("unreplaced", 5).containsEntry("onSite", 18).containsEntry("planned", 23);
        assertThat(p.get("replacesId")).isNotNull();

        // The forgotten clock-in from Poznań: approving it creates the record for the worker.
        List<Map> decisions = marta.get("/api/v1/manager/decisions", List.class).getBody();
        Map forgot = decisions.stream().filter(d -> "forgot".equals(d.get("reason"))).findFirst().orElseThrow();
        assertThat(forgot).containsEntry("kind", "clock_issue").containsEntry("time", "06:02").containsEntry("siteName", "Poznań · Magazyn A");
        assertThat(marta.post("/api/v1/manager/decisions/clock_issue/" + forgot.get("id"), Map.of("decision", "approve"), Void.class).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat((Map) marta.get("/api/v1/manager/summary", Map.class).getBody().get("staffing")).containsEntry("onShift", 465);

        // «Найти замену»: an offer to two chosen candidates for one place.
        List<Map> candidates = marta.get("/api/v1/shifts/" + p.get("templateId") + "/candidates?date=2026-10-26", List.class).getBody();
        Map offered = marta.post("/api/v1/urgent-offers", Map.of("templateId", p.get("templateId"), "date", "2026-10-26",
                "workerIds", List.of(candidates.get(0).get("workerId"), candidates.get(1).get("workerId")), "replacesId", p.get("replacesId")), Map.class).getBody();
        assertThat(offered).containsEntry("offered", 2);
        Map site = marta.get("/api/v1/manager/sites/" + fromKey("s-strykow") + "/brigade", Map.class).getBody();
        assertThat((List<Map>) site.get("members")).anySatisfy(m -> {
            assertThat(m.get("assignmentId")).isEqualTo(p.get("replacesId"));
            assertThat((Map) m.get("replacement")).containsEntry("status", "searching");
        });
        assertThat(marta.post("/api/v1/manager/broadcasts", Map.of("siteId", fromKey("s-strykow").toString(), "text", "Вход 2 закрыт"), Map.class).getBody())
                .containsEntry("recipients", 49);
    }

    /* --------------------------------------------------------------- timesheet */

    @Test
    void clockEventsFillTheTimesheetDay() {
        Api v = as(VIKTOR);
        double lat = 51.902, lng = 19.601;
        assertThat(v.post("/api/v1/clock-events", clock("out", lat, lng, null, "k-ts-out"), Map.class).getStatusCode()).isEqualTo(HttpStatus.OK);

        // The week of 26.10 had no timesheet yet: the clock-out created it, the day is computed.
        Map body = as(DemoIds.DEMO_USER_EMAIL).get("/api/v1/timesheets/by-period?projectId=" + fromKey("pr-strykow") + "&from=2026-10-26", Map.class).getBody();
        Map ts = (Map) body.get("timesheet");
        assertThat(ts).containsEntry("from", "2026-10-26").containsEntry("to", "2026-11-01");
        Map viktorRow = ((List<Map>) ts.get("rows")).stream().filter(r -> r.get("workerId").equals(fromKey("w-1").toString())).findFirst().orElseThrow();
        Map monday = ((List<Map>) viktorRow.get("days")).get(0);
        // In at 05:50 counts from 06:00; out at 08:14 rounds up to 08:15 in the worker's favour; left 346 min early.
        assertThat(monday).containsEntry("payableHours", 2.25).containsEntry("billableHours", 2.25).containsEntry("plannedHours", 8.0);
        assertThat((Map) monday.get("issue")).containsEntry("kind", "late_or_early").containsEntry("minutes", 346);
        // Colleagues still on shift are not judged yet.
        Map other = ((List<Map>) ts.get("rows")).stream().filter(r -> !r.get("workerId").equals(fromKey("w-1").toString())).findFirst().orElseThrow();
        assertThat(((List<Map>) other.get("days")).get(0)).doesNotContainKey("issue");

        // A future period is not created on open.
        assertThat(as(DemoIds.DEMO_USER_EMAIL).get("/api/v1/timesheets/by-period?projectId=" + fromKey("pr-strykow") + "&from=2026-11-09", Map.class).getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);
    }

    /* ------------------------------------------------------------------- kiosk */

    Map identify(Api k, String number, String pin) {
        return k.post("/api/v1/kiosk/identify", Map.of("method", "pin", "number", number, "pin", pin), Map.class).getBody();
    }

    @Test
    void kioskPinLateArrivalChoiceAndLockout() {
        Api k = as(KIOSK);
        Map state = k.get("/api/v1/kiosk/state", Map.class).getBody();
        assertThat((Map) state.get("device")).containsEntry("code", "KSK-STR-01").containsEntry("entry", "вход 1").containsEntry("siteName", "Stryków · Magazyn B");
        assertThat((List) state.get("recent")).hasSize(5);

        // A no-show arrives: one action, accepted as late.
        Map iryna = identify(k, "49", "000049");
        assertThat(iryna).containsEntry("name", "Iryna N.").containsEntry("state", "before").containsEntry("actions", List.of("in"));
        Map in = k.post("/api/v1/kiosk/clock-events", Map.of("ticket", iryna.get("ticket"), "type", "in", "idempotencyKey", "kiosk-1", "deviceTime", NOW.toString()), Map.class).getBody();
        assertThat(in).containsEntry("outcome", "late").containsEntry("time", "08:14").containsEntry("lateMin", 134);
        assertThat((Map) in.get("shift")).containsEntry("start", "06:00");

        // Viktor is on shift: the kiosk offers a break or the end of the shift.
        Map viktor = identify(k, "W-00012", "000012");
        assertThat(viktor).containsEntry("state", "on_shift").containsEntry("actions", List.of("break_start", "out"));
        var forged = k.post("/api/v1/kiosk/clock-events", Map.of("ticket", ((String) viktor.get("ticket")).replace("|", ":"), "type", "break_start", "idempotencyKey", "kiosk-2"), Map.class);
        assertThat(forged.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);

        // Five wrong PINs lock the number for 15 minutes.
        for (int left = 4; left >= 1; left--) assertThat(identify(k, "12", "111111")).containsEntry("code", "kiosk_auth").containsEntry("attemptsLeft", left);
        Map locked = identify(k, "12", "111111");
        assertThat(locked).containsEntry("attemptsLeft", 0);
        assertThat((String) locked.get("lockedUntil")).startsWith("2026-10-26T07:29:52");
        assertThat(identify(k, "12", "000012")).containsEntry("code", "kiosk_auth").containsEntry("attemptsLeft", 0);

        // The kiosk account reaches nothing else.
        assertThat(k.get("/api/v1/me/today", Map.class).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(k.get("/api/v1/timesheets", Map.class).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    void kioskQrFromTheAppAndNoShiftGoesToTheManager() {
        Map qr = as(VIKTOR).get("/api/v1/me/kiosk-qr", Map.class).getBody();
        Api k = as(KIOSK);
        Map id = k.post("/api/v1/kiosk/identify", Map.of("method", "qr", "payload", qr.get("payload")), Map.class).getBody();
        assertThat(id).containsEntry("name", "Viktor H.");
        assertThat(k.post("/api/v1/kiosk/identify", Map.of("method", "qr", "payload", "kq1|" + UUID.randomUUID() + "|1.abc"), Map.class).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);

        // Dmytro Rudenko is blocked and has no shift today: recorded as pending for the manager.
        Map dmytro = identify(k, "318", "000318");
        assertThat(dmytro).containsEntry("state", "no_shift");
        Map res = k.post("/api/v1/kiosk/clock-events", Map.of("ticket", dmytro.get("ticket"), "type", "in", "idempotencyKey", "kiosk-3", "deviceTime", NOW.toString()), Map.class).getBody();
        assertThat(res).containsEntry("outcome", "pending");
        assertThat(as(DemoIds.DEMO_USER_EMAIL).get("/api/v1/manager/decisions", List.class).getBody())
                .anySatisfy(d -> assertThat((Map) d).containsEntry("workerName", "Dmytro Rudenko").containsEntry("reason", "no_shift"));
    }
}
