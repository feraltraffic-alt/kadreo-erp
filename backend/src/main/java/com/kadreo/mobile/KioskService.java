package com.kadreo.mobile;

import com.kadreo.mobile.MobileModels.KioskClockInput;
import com.kadreo.mobile.MobileModels.KioskClockResult;
import com.kadreo.mobile.MobileModels.KioskDevice;
import com.kadreo.mobile.MobileModels.KioskIdentifyInput;
import com.kadreo.mobile.MobileModels.KioskIdentity;
import com.kadreo.mobile.MobileModels.KioskRecent;
import com.kadreo.mobile.MobileModels.KioskState;
import com.kadreo.mobile.MobileModels.ShiftTimes;
import com.kadreo.operations.Notifier;
import com.kadreo.organization.OrganizationModels.ShiftTemplate;
import com.kadreo.organization.OrganizationModels.Site;
import com.kadreo.organization.OrganizationService;
import com.kadreo.platform.audit.AuditLog;
import com.kadreo.platform.security.CurrentUser;
import com.kadreo.platform.security.CurrentUserService;
import com.kadreo.platform.web.ApiException;
import com.kadreo.timetracking.ClockEvents;
import com.kadreo.timetracking.ClockEvents.Event;
import com.kadreo.timetracking.ClockEvents.NewEvent;
import com.kadreo.workforce.WorkforceModels.Assignment;
import com.kadreo.workforce.WorkforceModels.Worker;
import com.kadreo.workforce.WorkforceService;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The site kiosk (14.4): identifies a worker by PIN, card or the rotating QR of the app, then
 * records the chosen clock event. No shift here today: the clock-in is stored as pending for the
 * team leader and manager. Five wrong PINs lock the number for 15 minutes.
 */
@Service
class KioskService {

    private static final Duration TICKET_TTL = Duration.ofMinutes(2);
    private static final Duration OFFLINE_TTL = Duration.ofHours(72);
    private static final int MAX_PIN_ATTEMPTS = 5;

    private final JdbcClient jdbc;
    private final Shifts shifts;
    private final OrganizationService org;
    private final WorkforceService workforce;
    private final ClockEvents clockEvents;
    private final Notifier notifier;
    private final CurrentUserService users;
    private final Credentials credentials;
    private final AuditLog audit;

    KioskService(JdbcClient jdbc, Shifts shifts, OrganizationService org, WorkforceService workforce, ClockEvents clockEvents, Notifier notifier, CurrentUserService users,
            Credentials credentials, AuditLog audit) {
        this.jdbc = jdbc;
        this.shifts = shifts;
        this.org = org;
        this.workforce = workforce;
        this.clockEvents = clockEvents;
        this.notifier = notifier;
        this.users = users;
        this.credentials = credentials;
        this.audit = audit;
    }

    record Device(UUID id, String code, UUID siteId, String entry, boolean faceEnabled) {}

    private Device device() {
        CurrentUser u = users.require("kiosk.clock");
        return jdbc.sql("select id, code, site_id, entry, face_enabled from kiosk_device where user_id = ?").param(u.id()).query(Device.class).optional()
                .orElseThrow(() -> ApiException.forbidden("kiosk.clock"));
    }

    private static ApiException authFailed(int attemptsLeft, OffsetDateTime lockedUntil) {
        Map<String, Object> body = new LinkedHashMap<>(Map.of("code", "kiosk_auth", "attemptsLeft", attemptsLeft));
        if (lockedUntil != null) body.put("lockedUntil", lockedUntil.toString());
        return new ApiException(HttpStatus.UNAUTHORIZED, body);
    }

    @Transactional
    public KioskState state() {
        Device d = device();
        Site site = org.site(d.siteId());
        jdbc.sql("update kiosk_device set last_seen_at = ? where id = ?").param(shifts.now()).param(d.id()).update();
        OffsetDateTime dayStart = shifts.now().atZoneSameInstant(ZoneId.of(site.timeZone())).toLocalDate().atStartOfDay(ZoneId.of(site.timeZone())).toOffsetDateTime();
        List<Event> recent = clockEvents.recentAt(site.id(), List.of("kiosk", "access_card"), dayStart, 5);
        var names = workforce.briefs(recent.stream().map(Event::workerId).toList());
        List<KioskRecent> list = recent.stream().map(e -> {
            var w = names.get(e.workerId());
            String outcome = "pending".equals(e.status()) ? "pending" : "accepted";
            return new KioskRecent(Shifts.shortName(w.firstName(), w.lastName()), e.type(), e.time(), outcome);
        }).toList();
        return new KioskState(shifts.now(), new KioskDevice(d.id(), d.code(), site.id(), site.name(), d.entry(), d.faceEnabled()), list);
    }

    @Transactional(noRollbackFor = ApiException.class)
    public KioskIdentity identify(KioskIdentifyInput in) {
        Device d = device();
        UUID workerId = switch (in.method() == null ? "" : in.method()) {
            case "pin" -> byPin(in.number(), in.pin());
            case "card" -> byCard(in.uid());
            case "qr" -> byQr(in.payload());
            default -> throw ApiException.badRequest("method");
        };
        Worker w = workforce.worker(workerId);
        Assignment a = shifts.current(workerId);
        ShiftTemplate t = a == null ? null : org.template(a.templateId());
        boolean here = t != null && shifts.siteOfTemplate(t).id().equals(d.siteId());
        String state = here ? Shifts.state(clockEvents.ofAssignments(List.of(a.id())).getOrDefault(a.id(), List.of())) : "no_shift";
        List<String> actions = "no_shift".equals(state) ? List.of("in") : Shifts.NEXT.get(state);
        String ticket = credentials.sign("kt1|" + workerId + "|" + d.id() + "|" + shifts.now().toEpochSecond());
        return new KioskIdentity(ticket, Shifts.shortName(w.firstName(), w.lastName()), actions, here ? new ShiftTimes(t.start().toString(), t.end().toString()) : null, state);
    }

    private UUID byPin(String number, String pin) {
        if (number == null || pin == null || !pin.matches("\\d{6}")) throw authFailed(MAX_PIN_ATTEMPTS, null);
        String digits = number.replaceAll("\\D", "");
        if (digits.isEmpty() || digits.length() > 8) throw authFailed(MAX_PIN_ATTEMPTS, null);
        String normalized = "W-" + String.format("%05d", Integer.parseInt(digits));
        record Cred(UUID workerId, String pinHash, int pinFailed, OffsetDateTime pinLockedUntil) {}
        Cred c = jdbc.sql("""
                select w.id as worker_id, c.pin_hash, coalesce(c.pin_failed, 0) as pin_failed, c.pin_locked_until
                from worker w left join worker_credential c on c.worker_id = w.id where w.number = ? and w.status <> 'dismissed' for update of w""")
                .param(normalized).query(Cred.class).optional().orElse(null);
        // Unknown numbers answer exactly like a wrong PIN.
        if (c == null || c.pinHash() == null) throw authFailed(MAX_PIN_ATTEMPTS - 1, null);
        OffsetDateTime now = shifts.now();
        if (c.pinLockedUntil() != null && c.pinLockedUntil().isAfter(now)) throw authFailed(0, c.pinLockedUntil());
        if (!Credentials.verifyPin(pin, c.pinHash())) {
            int failed = c.pinFailed() + 1;
            OffsetDateTime lock = failed >= MAX_PIN_ATTEMPTS ? now.plusMinutes(15) : null;
            jdbc.sql("update worker_credential set pin_failed = ?, pin_locked_until = ? where worker_id = ?").param(lock == null ? failed : 0).param(lock).param(c.workerId()).update();
            if (lock != null) audit.record("worker_credential", c.workerId(), "pin_locked", null, Map.of("until", lock.toString()));
            throw authFailed(lock == null ? MAX_PIN_ATTEMPTS - failed : 0, lock);
        }
        if (c.pinFailed() > 0) jdbc.sql("update worker_credential set pin_failed = 0 where worker_id = ?").param(c.workerId()).update();
        return c.workerId();
    }

    private UUID byCard(String uid) {
        if (uid == null || uid.isBlank()) throw authFailed(MAX_PIN_ATTEMPTS, null);
        return jdbc.sql("select worker_id from worker_credential where card_uid = ?").param(uid.trim().toUpperCase()).query(UUID.class).optional()
                .orElseThrow(() -> authFailed(MAX_PIN_ATTEMPTS, null));
    }

    private UUID byQr(String payload) {
        String p = credentials.verify(payload);
        if (p == null) throw authFailed(MAX_PIN_ATTEMPTS, null);
        String[] parts = p.split("\\|");
        if (parts.length != 3 || !"kq1".equals(parts[0])) throw authFailed(MAX_PIN_ATTEMPTS, null);
        long slot = Long.parseLong(parts[2]);
        long nowSlot = shifts.now().toEpochSecond() / 30;
        if (Math.abs(nowSlot - slot) > 1) throw authFailed(MAX_PIN_ATTEMPTS, null);
        return UUID.fromString(parts[1]);
    }

    @Transactional
    public KioskClockResult clock(KioskClockInput in) {
        Device d = device();
        CurrentUser u = users.current();
        boolean offline = Boolean.TRUE.equals(in.offline());
        String p = credentials.verify(in.ticket());
        String[] parts = p == null ? new String[0] : p.split("\\|");
        if (parts.length != 4 || !"kt1".equals(parts[0]) || !parts[2].equals(d.id().toString())) throw authFailed(MAX_PIN_ATTEMPTS, null);
        OffsetDateTime issued = OffsetDateTime.ofInstant(java.time.Instant.ofEpochSecond(Long.parseLong(parts[3])), java.time.ZoneOffset.UTC);
        OffsetDateTime now = shifts.now();
        if (Duration.between(issued, now).compareTo(offline ? OFFLINE_TTL : TICKET_TTL) > 0) throw authFailed(MAX_PIN_ATTEMPTS, null);
        if (in.idempotencyKey() == null || in.idempotencyKey().isBlank() || in.idempotencyKey().length() > 80) throw ApiException.badRequest("idempotencyKey");
        if (!List.of("in", "break_start", "break_end", "out").contains(in.type())) throw ApiException.badRequest("type");
        String key = "kiosk:" + d.id() + ":" + in.idempotencyKey();
        UUID workerId = UUID.fromString(parts[1]);
        Worker w = workforce.worker(workerId);
        String name = Shifts.shortName(w.firstName(), w.lastName());
        UUID existing = clockEvents.byIdempotencyKey(key);
        if (existing != null) return result(clockEvents.byId(existing), name);

        OffsetDateTime deviceTime = in.deviceTime() == null ? now : in.deviceTime();
        boolean useDevice = offline && !deviceTime.isAfter(now.plusMinutes(5)) && Duration.between(deviceTime, now).compareTo(OFFLINE_TTL) <= 0;
        Assignment a = shifts.current(workerId);
        ShiftTemplate t = a == null ? null : org.template(a.templateId());
        Site site = org.site(d.siteId());
        Event e;
        if (t == null || !shifts.siteOfTemplate(t).id().equals(d.siteId())) {
            // No shift on this site: recorded, but pending until the manager decides (red panel).
            e = clockEvents.record(new NewEvent(workerId, null, site.id(), in.type(), useDevice ? deviceTime : now, now, "kiosk", "pending", null, false, null, null, null, null,
                    useDevice, key, null, d.id(), "no_shift", u.id(), d.code()));
            notifier.toSiteManagers(site.id(), site.region(), Notifier.text("Отметка без смены на киоске: " + w.fullName(), "Відмітка без зміни на кіоску: " + w.fullName(),
                    "Odbicie bez zmiany w kiosku: " + w.fullName(), "Kiosk clock-in without a shift: " + w.fullName()), null);
        } else {
            List<Event> events = clockEvents.ofAssignments(List.of(a.id())).getOrDefault(a.id(), List.of());
            if (!Shifts.NEXT.get(Shifts.state(events)).contains(in.type())) throw WorkerAppService.rejected("wrong_state", Map.of());
            e = clockEvents.record(new NewEvent(workerId, a.id(), site.id(), in.type(), useDevice ? deviceTime : now, now, "kiosk", "accepted", null, false, null, null, null, null,
                    useDevice, key, null, d.id(), null, u.id(), d.code()));
        }
        audit.record("clock_event", e.id(), "kiosk", null, Map.of("device", d.code(), "type", in.type(), "status", e.status()));
        return result(e, name);
    }

    private KioskClockResult result(Event e, String name) {
        if (e.assignmentId() == null) return new KioskClockResult("pending", name, e.type(), e.time(), 0, null);
        Assignment a = workforce.assignment(e.assignmentId());
        ShiftTemplate t = org.template(a.templateId());
        int late = "in".equals(e.type()) ? shifts.lateMinutes(a, e.at()) : 0;
        return new KioskClockResult(late > 0 ? "late" : "accepted", name, e.type(), e.time(), late, new ShiftTimes(t.start().toString(), t.end().toString()));
    }
}
