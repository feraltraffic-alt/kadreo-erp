package com.kadreo.mobile;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Shapes of the mobile/kiosk contract (packages/domain/src/mobile.ts). */
final class MobileModels {

    private MobileModels() {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record MobileShift(UUID id, String kind, LocalDate date, String start, String end, UUID siteId, String siteName, UUID positionId, Map<String, String> positionName, String status,
            Integer bonusPoints) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record ClockEventView(UUID id, String type, String time, OffsetDateTime at, String source, String status, boolean offline, String approvedByName) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record SiteRules(UUID id, String name, double lat, double lng, int radiusM, int requiredAccuracyM, String outsideGeofence, List<String> methods, int clockWindowMin,
            int lateThresholdMin, String demoQrPayload) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record ClockIssue(UUID id, String kind, String type, String time, String comment, String status, OffsetDateTime createdAt, String decidedByName, String decisionReason) {}

    record WorkerBriefView(UUID id, String firstName, String lastName, String number) {}

    record WorkerToday(OffsetDateTime now, WorkerBriefView worker, MobileShift shift, SiteRules site, String state, List<ClockEventView> events, String opensAt,
            List<MobileShift> upcoming, MobileShift nextShift, int unread, List<ClockIssue> issues) {}

    record ClockInput(String idempotencyKey, UUID assignmentId, String type, OffsetDateTime deviceTime, String method, Double lat, Double lng, Integer accuracyM, boolean photo,
            String comment, String qrPayload, Boolean offline) {}

    record ClockResult(ClockEventView event, String outcome, int lateMin, Integer distanceM) {}

    record ClockIssueInput(UUID assignmentId, String kind, String type, String time, String comment) {}

    record WorkerProfile(Map<String, Object> worker, String locale, boolean biometricConsent, boolean kioskPinSet, String bankAccountLast4, String notificationChannel) {}

    record KioskQr(String payload, OffsetDateTime expiresAt) {}

    /* team leader */

    record BrigadeShift(String key, UUID siteId, String siteName, LocalDate date, String start, String end) {}

    record MemberIssue(String kind, String time, String comment) {}

    @JsonInclude(JsonInclude.Include.ALWAYS)
    record Replacement(String status, String name, String clockIn) {}

    record BrigadeMember(UUID assignmentId, UUID templateId, UUID workerId, String firstName, String lastName, String number, String phone, UUID positionId,
            Map<String, String> positionName, String status, String clockIn, int lateMin, MemberIssue issue, boolean outsideGeofence, Replacement replacement, boolean isReplacement,
            boolean needsAttention) {}

    record Counters(int planned, int onSite, int late, int noShow) {}

    record ShiftOutput(int norm, String unit, String source, int value, OffsetDateTime updatedAt, int planNow) {}

    record BrigadeView(OffsetDateTime now, BrigadeShift shift, List<BrigadeShift> shifts, int noShowAfterMin, Counters counters, List<BrigadeMember> members, ShiftOutput output) {}

    record ManualClockInput(UUID assignmentId, String type, String time, String reason, String comment) {}

    /* manager */

    record ProblemSite(UUID siteId, String siteName, int onSite, int planned, String severity, int noShows, int unreplaced, int late, UUID templateId, UUID replacesId) {}

    record Decision(UUID id, String kind, String workerName, String siteName, String requestedByName, OffsetDateTime at, String time, String type, String reason, String comment) {}

    record Staffing(int onShift, int planned, double pct, double targetPct) {}

    record ManagerSummary(OffsetDateTime now, int sitesInScope, Staffing staffing, List<ProblemSite> problemSites, int problemSitesTotal, List<Decision> decisions, int decisionsTotal,
            int openAlerts) {}

    record OfferInput(UUID templateId, LocalDate date, List<UUID> workerIds, UUID replacesId, Integer bonusPoints) {}

    /* kiosk */

    record KioskDevice(UUID id, String code, UUID siteId, String siteName, String entry, boolean faceEnabled) {}

    record KioskRecent(String name, String type, String time, String outcome) {}

    record KioskState(OffsetDateTime now, KioskDevice device, List<KioskRecent> recent) {}

    record KioskIdentifyInput(String method, String number, String pin, String uid, String payload) {}

    record ShiftTimes(String start, String end) {}

    record KioskIdentity(String ticket, String name, List<String> actions, ShiftTimes shift, String state) {}

    record KioskClockInput(String ticket, String type, String idempotencyKey, OffsetDateTime deviceTime, Boolean offline) {}

    @JsonInclude(JsonInclude.Include.ALWAYS)
    record KioskClockResult(String outcome, String name, String type, String time, int lateMin, ShiftTimes shift) {}
}
