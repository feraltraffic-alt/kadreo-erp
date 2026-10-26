package com.kadreo.mobile;

import com.kadreo.mobile.MobileModels.BrigadeView;
import com.kadreo.mobile.MobileModels.ClockInput;
import com.kadreo.mobile.MobileModels.ClockIssue;
import com.kadreo.mobile.MobileModels.ClockIssueInput;
import com.kadreo.mobile.MobileModels.ClockResult;
import com.kadreo.mobile.MobileModels.Decision;
import com.kadreo.mobile.MobileModels.KioskClockInput;
import com.kadreo.mobile.MobileModels.KioskClockResult;
import com.kadreo.mobile.MobileModels.KioskIdentifyInput;
import com.kadreo.mobile.MobileModels.KioskIdentity;
import com.kadreo.mobile.MobileModels.KioskQr;
import com.kadreo.mobile.MobileModels.KioskState;
import com.kadreo.mobile.MobileModels.ManagerSummary;
import com.kadreo.mobile.MobileModels.ManualClockInput;
import com.kadreo.mobile.MobileModels.MobileShift;
import com.kadreo.mobile.MobileModels.OfferInput;
import com.kadreo.mobile.MobileModels.WorkerProfile;
import com.kadreo.mobile.MobileModels.WorkerToday;
import com.kadreo.workforce.WorkforceModels.Document;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Endpoints of the mobile app and the kiosk (spec 14.1–14.5). */
@RestController
@RequestMapping("/api/v1")
class MobileController {

    private final WorkerAppService worker;
    private final TeamService team;
    private final ManagerService manager;
    private final KioskService kiosk;

    MobileController(WorkerAppService worker, TeamService team, ManagerService manager, KioskService kiosk) {
        this.worker = worker;
        this.team = team;
        this.manager = manager;
        this.kiosk = kiosk;
    }

    /* worker 14.1, 14.5 */

    @GetMapping("/me/today")
    WorkerToday today() {
        return worker.today();
    }

    @GetMapping("/me/shifts")
    List<MobileShift> shifts(@RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from, @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return worker.shiftsBetween(from, to);
    }

    @PostMapping("/clock-events")
    ClockResult clock(@RequestBody ClockInput in) {
        return worker.clock(in);
    }

    @PostMapping("/clock-issues")
    ClockIssue issue(@RequestBody ClockIssueInput in) {
        return worker.reportIssue(in);
    }

    record ReasonBody(String reason) {}

    @PostMapping("/assignments/{id}/accept")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void acceptAssignment(@PathVariable UUID id) {
        worker.respondToAssignment(id, true, null);
    }

    @PostMapping("/assignments/{id}/decline")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void declineAssignment(@PathVariable UUID id, @RequestBody(required = false) ReasonBody body) {
        worker.respondToAssignment(id, false, body == null ? null : body.reason());
    }

    @PostMapping("/urgent-offers/{id}/accept")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void acceptOffer(@PathVariable UUID id) {
        worker.respondToOffer(id, true);
    }

    @PostMapping("/urgent-offers/{id}/decline")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void declineOffer(@PathVariable UUID id, @RequestBody(required = false) ReasonBody body) {
        worker.respondToOffer(id, false);
    }

    @GetMapping("/me/documents")
    List<Document> documents() {
        return worker.documents();
    }

    @GetMapping("/me/profile")
    WorkerProfile profile() {
        return worker.profile();
    }

    record ConsentBody(boolean consent) {}

    @PutMapping("/me/biometric-consent")
    WorkerProfile consent(@RequestBody ConsentBody body) {
        return worker.setBiometricConsent(body.consent());
    }

    record PinBody(String pin) {}

    @PutMapping("/me/kiosk-pin")
    WorkerProfile pin(@RequestBody PinBody body) {
        return worker.setKioskPin(body.pin());
    }

    @GetMapping("/me/kiosk-qr")
    KioskQr kioskQr() {
        return worker.kioskQr();
    }

    /* team leader 14.2 */

    @GetMapping("/team/brigade")
    BrigadeView brigade(@RequestParam(required = false) String shift) {
        return team.brigade(shift);
    }

    @PostMapping("/team/assignments/{id}/replacement")
    BrigadeView replacement(@PathVariable UUID id) {
        return team.requestReplacement(id);
    }

    @PostMapping("/team/manual-clock")
    BrigadeView manualClock(@RequestBody ManualClockInput in) {
        return team.manualClock(in);
    }

    record OutputBody(Integer value) {}

    @PutMapping("/team/output")
    BrigadeView output(@RequestParam String shift, @RequestBody OutputBody body) {
        return team.recordOutput(shift, body.value());
    }

    record MessageBody(UUID workerId, String text) {}

    @PostMapping("/team/messages")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void message(@RequestBody MessageBody body) {
        team.reply(body.workerId(), body.text());
    }

    /* manager 14.3 */

    @GetMapping("/manager/summary")
    ManagerSummary summary() {
        return manager.summary();
    }

    @GetMapping("/manager/sites/{id}/brigade")
    BrigadeView siteBrigade(@PathVariable UUID id) {
        return manager.siteBrigade(id);
    }

    @GetMapping("/manager/decisions")
    List<Decision> decisions() {
        return manager.decisions();
    }

    record DecisionBody(String decision, String reason) {}

    @PostMapping("/manager/decisions/{kind}/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void decide(@PathVariable String kind, @PathVariable UUID id, @RequestBody DecisionBody body) {
        manager.decide(kind, id, body.decision(), body.reason());
    }

    @PostMapping("/urgent-offers")
    Map<String, Integer> offer(@RequestBody OfferInput in) {
        return manager.offer(in);
    }

    record BroadcastBody(UUID siteId, String text) {}

    @PostMapping("/manager/broadcasts")
    Map<String, Integer> broadcast(@RequestBody BroadcastBody body) {
        return manager.broadcast(body.siteId(), body.text());
    }

    /* kiosk 14.4 */

    @GetMapping("/kiosk/state")
    KioskState kioskState() {
        return kiosk.state();
    }

    @PostMapping("/kiosk/identify")
    KioskIdentity identify(@RequestBody KioskIdentifyInput in) {
        return kiosk.identify(in);
    }

    @PostMapping("/kiosk/clock-events")
    KioskClockResult kioskClock(@RequestBody KioskClockInput in) {
        return kiosk.clock(in);
    }
}
