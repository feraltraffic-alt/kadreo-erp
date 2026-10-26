package com.kadreo.mobile;

import com.kadreo.mobile.MobileModels.ClockInput;
import com.kadreo.mobile.MobileModels.ClockIssue;
import com.kadreo.mobile.MobileModels.ClockIssueInput;
import com.kadreo.mobile.MobileModels.ClockResult;
import com.kadreo.mobile.MobileModels.KioskQr;
import com.kadreo.mobile.MobileModels.MobileShift;
import com.kadreo.mobile.MobileModels.WorkerBriefView;
import com.kadreo.mobile.MobileModels.WorkerProfile;
import com.kadreo.mobile.MobileModels.WorkerToday;
import com.kadreo.operations.Notifier;
import com.kadreo.operations.UrgentOffers;
import com.kadreo.organization.OrganizationModels.Position;
import com.kadreo.organization.OrganizationModels.ShiftTemplate;
import com.kadreo.organization.OrganizationModels.Site;
import com.kadreo.organization.OrganizationService;
import com.kadreo.platform.audit.AuditLog;
import com.kadreo.platform.security.CurrentUser;
import com.kadreo.platform.security.CurrentUserService;
import com.kadreo.platform.tenant.TenantContext;
import com.kadreo.platform.util.Ids;
import com.kadreo.platform.web.ApiException;
import com.kadreo.timetracking.ClockEvents;
import com.kadreo.timetracking.ClockEvents.Event;
import com.kadreo.timetracking.ClockEvents.NewEvent;
import com.kadreo.workforce.ScheduleService;
import com.kadreo.workforce.WorkforceModels.Assignment;
import com.kadreo.workforce.WorkforceModels.Document;
import com.kadreo.workforce.WorkforceModels.Worker;
import com.kadreo.workforce.WorkforceService;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** The worker's side of the app (14.1, 14.5): today's shift, clock-ins, problem reports, offers, profile. */
@Service
class WorkerAppService {

    private static final String PERM = "clockevent.self";
    private static final Duration MAX_SKEW = Duration.ofMinutes(5);
    private static final Duration MAX_OFFLINE = Duration.ofHours(72);

    private final JdbcClient jdbc;
    private final Shifts shifts;
    private final OrganizationService org;
    private final WorkforceService workforce;
    private final ScheduleService schedule;
    private final ClockEvents clockEvents;
    private final UrgentOffers offers;
    private final Notifier notifier;
    private final CurrentUserService users;
    private final Credentials credentials;
    private final AuditLog audit;

    WorkerAppService(JdbcClient jdbc, Shifts shifts, OrganizationService org, WorkforceService workforce, ScheduleService schedule, ClockEvents clockEvents, UrgentOffers offers,
            Notifier notifier, CurrentUserService users, Credentials credentials, AuditLog audit) {
        this.jdbc = jdbc;
        this.shifts = shifts;
        this.org = org;
        this.workforce = workforce;
        this.schedule = schedule;
        this.clockEvents = clockEvents;
        this.offers = offers;
        this.notifier = notifier;
        this.users = users;
        this.credentials = credentials;
        this.audit = audit;
    }

    static ApiException rejected(String reason, Map<String, Object> extra) {
        Map<String, Object> body = new LinkedHashMap<>(Map.of("code", "clock_rejected", "reason", reason));
        body.putAll(extra);
        return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, body);
    }

    private LocalDate localToday() {
        return schedule.today();
    }

    /* ------------------------------------------------------------------ reads */

    @Transactional(readOnly = true)
    public WorkerToday today() {
        UUID workerId = shifts.requireWorker(PERM);
        Worker w = workforce.worker(workerId);
        Map<UUID, Position> positions = shifts.positions();
        Assignment a = shifts.current(workerId);
        List<Event> events = a == null ? List.of() : clockEvents.ofAssignments(List.of(a.id())).getOrDefault(a.id(), List.of());
        Site site = a == null ? null : shifts.siteOfTemplate(org.template(a.templateId()));
        String opensAt = null;
        if (a != null) {
            ShiftTemplate t = org.template(a.templateId());
            opensAt = t.start().minusMinutes(site.clockWindowMin()).toString();
        }
        List<MobileShift> upcoming = upcoming(workerId, a, positions);
        int unread = jdbc.sql("select count(*) from notification where user_id = ? and not read").param(users.current().id()).query(Integer.class).single();
        return new WorkerToday(shifts.now(), new WorkerBriefView(w.id(), w.firstName(), w.lastName(), w.number()), a == null ? null : shifts.view(a, positions),
                site == null ? null : shifts.rules(site), a == null ? "no_shift" : Shifts.state(events), events.stream().map(Shifts::eventView).toList(), opensAt,
                upcoming.stream().limit(2).toList(), a == null && !upcoming.isEmpty() ? upcoming.get(0) : null, unread, issues(workerId));
    }

    private List<MobileShift> upcoming(UUID workerId, Assignment current, Map<UUID, Position> positions) {
        LocalDate from = localToday().plusDays(1);
        List<MobileShift> list = new ArrayList<>();
        workforce.assignmentsOfWorker(workerId, from, from.plusDays(28)).stream().filter(Assignment::active).filter(x -> current == null || !x.id().equals(current.id()))
                .forEach(x -> list.add(shifts.view(x, positions)));
        offers.openOffers(workerId, from, from.plusDays(28)).forEach(o -> list.add(shifts.offerView(o.id(), o.templateId(), o.date(), o.bonusPoints(), positions)));
        list.sort(Comparator.comparing((MobileShift s) -> s.date()).thenComparing(MobileShift::start));
        return list;
    }

    @Transactional(readOnly = true)
    public List<MobileShift> shiftsBetween(LocalDate from, LocalDate to) {
        UUID workerId = shifts.requireWorker(PERM);
        if (to.isBefore(from) || from.plusDays(62).isBefore(to)) throw ApiException.badRequest("range");
        Map<UUID, Position> positions = shifts.positions();
        List<MobileShift> list = new ArrayList<>();
        workforce.assignmentsOfWorker(workerId, from, to).stream().filter(Assignment::active).forEach(x -> list.add(shifts.view(x, positions)));
        offers.openOffers(workerId, from, to).forEach(o -> list.add(shifts.offerView(o.id(), o.templateId(), o.date(), o.bonusPoints(), positions)));
        list.sort(Comparator.comparing((MobileShift s) -> s.date()).thenComparing(MobileShift::start));
        return list;
    }

    private List<ClockIssue> issues(UUID workerId) {
        return jdbc.sql("""
                select id, kind, type, to_char(local_time, 'HH24:MI') as time, comment, status, created_at, decided_by_name, decision_reason
                from clock_issue where worker_id = ? and created_at > now() - interval '14 days' order by created_at desc""")
                .param(workerId).query(ClockIssue.class).list();
    }

    @Transactional(readOnly = true)
    public List<Document> documents() {
        return workforce.documents(shifts.requireWorker(PERM));
    }

    /* ------------------------------------------------------------------ clock */

    /**
     * One clock event from the phone (14.1): the shift must be the worker's and confirmed, the
     * device clock within 5 minutes (unless recorded offline, then up to 72 hours old), the
     * order in → break → out kept, «in» not earlier than the site's window, the position inside
     * the geofence (or flagged with a comment where the site allows it), or a valid site QR.
     */
    @Transactional
    public ClockResult clock(ClockInput in) {
        UUID workerId = shifts.requireWorker(PERM);
        CurrentUser u = users.current();
        if (in.idempotencyKey() == null || in.idempotencyKey().isBlank() || in.idempotencyKey().length() > 80) throw ApiException.badRequest("idempotencyKey");
        String key = u.id() + ":" + in.idempotencyKey();
        UUID existing = clockEvents.byIdempotencyKey(key);
        if (existing != null) return result(clockEvents.byId(existing));
        if (!List.of("in", "break_start", "break_end", "out").contains(in.type())) throw ApiException.badRequest("type");
        Assignment a = in.assignmentId() == null ? null : workforce.assignment(in.assignmentId());
        if (a == null || !a.workerId().equals(workerId) || !"confirmed".equals(a.status())) throw rejected("no_shift", Map.of());
        ShiftTemplate t = org.template(a.templateId());
        Site site = shifts.siteOfTemplate(t);
        OffsetDateTime now = shifts.now();
        boolean offline = Boolean.TRUE.equals(in.offline());
        if (in.deviceTime() == null) throw ApiException.badRequest("deviceTime");
        Duration skew = Duration.between(in.deviceTime(), now).abs();
        if (!offline && skew.compareTo(MAX_SKEW) > 0) throw rejected("clock_skew", Map.of());
        if (offline && (in.deviceTime().isAfter(now.plus(MAX_SKEW)) || Duration.between(in.deviceTime(), now).compareTo(MAX_OFFLINE) > 0)) throw rejected("clock_skew", Map.of());
        OffsetDateTime at = offline ? in.deviceTime() : now;

        List<Event> events = clockEvents.ofAssignments(List.of(a.id())).getOrDefault(a.id(), List.of());
        if (!Shifts.NEXT.get(Shifts.state(events)).contains(in.type())) throw rejected("wrong_state", Map.of());
        if ("in".equals(in.type())) {
            OffsetDateTime opens = shifts.window(a).start().minusMinutes(site.clockWindowMin()).toOffsetDateTime();
            if (at.isBefore(opens)) throw rejected("too_early", Map.of("opensAt", opens.atZoneSameInstant(ZoneId.of(site.timeZone())).toLocalTime().toString()));
        }

        String status = "accepted";
        Integer distance = null;
        Integer qrPoint = null;
        String source;
        if ("qr".equals(in.method())) {
            if (!site.clockMethods().contains("qr") && shifts.rules(site).demoQrPayload() == null) throw rejected("bad_qr", Map.of());
            qrPoint = shifts.verifySitePointQr(in.qrPayload(), site.id());
            if (qrPoint == null) throw rejected("bad_qr", Map.of());
            source = "qr";
        } else if ("gps_photo".equals(in.method())) {
            Shifts.SiteExtra extra = shifts.extra(site.id());
            if (in.lat() == null || in.lng() == null || in.accuracyM() == null || in.accuracyM() > extra.requiredAccuracyM()) throw rejected("low_accuracy", Map.of());
            Shifts.Geo geo = shifts.geofence(site.id(), in.lat(), in.lng());
            distance = geo.distanceM();
            if (!geo.inside()) {
                if ("deny".equals(site.outsideGeofence())) throw rejected("outside_geofence", Map.of("distanceM", geo.distanceM()));
                if (in.comment() == null || in.comment().isBlank()) throw rejected("comment_required", Map.of("distanceM", geo.distanceM()));
                status = "flagged";
            }
            source = "gps_photo";
        } else {
            throw ApiException.badRequest("method");
        }
        if (in.comment() != null && in.comment().length() > 500) throw ApiException.badRequest("comment");
        Event e = clockEvents.record(new NewEvent(workerId, a.id(), site.id(), in.type(), in.deviceTime(), now, source, status, in.accuracyM(), in.photo(), in.lat(), in.lng(),
                distance, in.comment(), offline, key, qrPoint, null, null, u.id(), u.fullName()));
        audit.record("clock_event", e.id(), "create", null, Map.of("type", in.type(), "status", status, "source", source, "offline", offline));
        return result(clockEvents.byId(e.id()));
    }

    private ClockResult result(Event e) {
        Assignment a = workforce.assignment(e.assignmentId());
        Integer distance = jdbc.sql("select distance_m from clock_event where id = ?").param(e.id()).query(Integer.class).optional().orElse(null);
        return new ClockResult(Shifts.eventView(e), "flagged".equals(e.status()) ? "flagged" : "accepted", "in".equals(e.type()) ? shifts.lateMinutes(a, e.at()) : 0, distance);
    }

    /* ------------------------------------------------------------- problem reports */

    /** «Проблема с отметкой» / «Опаздываю» (14.1-11): goes to the team leader and the manager. */
    @Transactional
    public ClockIssue reportIssue(ClockIssueInput in) {
        UUID workerId = shifts.requireWorker(PERM);
        if (!List.of("no_gps", "no_camera", "forgot", "other", "late").contains(in.kind())) throw ApiException.badRequest("kind");
        if (!List.of("in", "break_start", "break_end", "out").contains(in.type())) throw ApiException.badRequest("type");
        if (in.comment() != null && in.comment().length() > 500) throw ApiException.badRequest("comment");
        if ("other".equals(in.kind()) && (in.comment() == null || in.comment().isBlank())) throw ApiException.badRequest("comment");
        LocalTime time;
        try {
            time = LocalTime.parse(in.time());
        } catch (Exception ex) {
            throw ApiException.badRequest("time");
        }
        Assignment a = workforce.assignment(in.assignmentId());
        if (!a.workerId().equals(workerId)) throw ApiException.notFound();
        Worker w = workforce.worker(workerId);
        UUID id = Ids.newId();
        jdbc.sql("""
                insert into clock_issue (id, tenant_id, worker_id, assignment_id, kind, type, local_time, comment, status, created_at, created_by, created_by_name)
                values (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)""")
                .param(id).param(TenantContext.requireTenantId()).param(workerId).param(a.id()).param(in.kind()).param(in.type()).param(time)
                .param(in.comment() == null ? "" : in.comment()).param(shifts.now()).param(users.current().id()).param(w.fullName())
                .update();
        if (!"late".equals(in.kind())) {
            Site site = shifts.siteOfTemplate(org.template(a.templateId()));
            notifier.toSiteManagers(site.id(), site.region(), Notifier.text("Проблема с отметкой: " + w.fullName(), "Проблема з відміткою: " + w.fullName(),
                    "Problem z odbiciem: " + w.fullName(), "Clock-in problem: " + w.fullName()), null);
        }
        audit.record("clock_issue", id, "create", null, in);
        return jdbc.sql("""
                select id, kind, type, to_char(local_time, 'HH24:MI') as time, comment, status, created_at, decided_by_name, decision_reason from clock_issue where id = ?""")
                .param(id).query(ClockIssue.class).single();
    }

    /* ------------------------------------------------------------------ offers */

    @Transactional
    public void respondToAssignment(UUID assignmentId, boolean accept, String reason) {
        UUID workerId = shifts.requireWorker(PERM);
        if (!schedule.respond(assignmentId, workerId, accept, reason)) throw ApiException.notFound();
    }

    @Transactional
    public void respondToOffer(UUID offerId, boolean accept) {
        UUID workerId = shifts.requireWorker(PERM);
        if (accept) offers.accept(offerId, workerId);
        else offers.decline(offerId, workerId);
    }

    /* ----------------------------------------------------------------- profile */

    @Transactional(readOnly = true)
    public WorkerProfile profile() {
        UUID workerId = shifts.requireWorker(PERM);
        Worker w = workforce.worker(workerId);
        record Cred(String pinHash, OffsetDateTime biometricConsentAt) {}
        Cred c = jdbc.sql("select pin_hash, biometric_consent_at from worker_credential where worker_id = ?").param(workerId).query(Cred.class).optional().orElse(new Cred(null, null));
        Map<String, Object> worker = new HashMap<>(Map.of("id", w.id(), "firstName", w.firstName(), "lastName", w.lastName(), "number", w.number(), "phone", w.phone()));
        String digits = w.number().replaceAll("\\D", "");
        String last4 = String.valueOf(1000 + Integer.parseInt(digits.isEmpty() ? "0" : digits) % 9000);
        return new WorkerProfile(worker, users.current().locale(), c.biometricConsentAt() != null, c.pinHash() != null, last4, "push");
    }

    /** Consent to face recognition (7.4); withdrawing deletes the face template at once. */
    @Transactional
    public WorkerProfile setBiometricConsent(boolean consent) {
        UUID workerId = shifts.requireWorker(PERM);
        jdbc.sql("""
                insert into worker_credential (tenant_id, worker_id, biometric_consent_at) values (?, ?, ?)
                on conflict (worker_id) do update set biometric_consent_at = excluded.biometric_consent_at""")
                .param(TenantContext.requireTenantId()).param(workerId).param(consent ? shifts.now() : null)
                .update();
        audit.record("worker_credential", workerId, consent ? "biometric_consent" : "biometric_withdraw", null, null);
        return profile();
    }

    @Transactional
    public WorkerProfile setKioskPin(String pin) {
        UUID workerId = shifts.requireWorker(PERM);
        if (pin == null || !pin.matches("\\d{6}")) throw ApiException.badRequest("pin");
        jdbc.sql("""
                insert into worker_credential (tenant_id, worker_id, pin_hash) values (?, ?, ?)
                on conflict (worker_id) do update set pin_hash = excluded.pin_hash, pin_failed = 0, pin_locked_until = null""")
                .param(TenantContext.requireTenantId()).param(workerId).param(Credentials.hashPin(pin))
                .update();
        audit.record("worker_credential", workerId, "set_pin", null, null);
        return profile();
    }

    /** Rotating kiosk QR (14.4): signed, valid for the current 30-second slot. */
    @Transactional(readOnly = true)
    public KioskQr kioskQr() {
        UUID workerId = shifts.requireWorker(PERM);
        long slot = shifts.now().toEpochSecond() / 30;
        return new KioskQr(credentials.sign("kq1|" + workerId + "|" + slot), OffsetDateTime.ofInstant(java.time.Instant.ofEpochSecond((slot + 1) * 30), java.time.ZoneOffset.UTC));
    }
}
