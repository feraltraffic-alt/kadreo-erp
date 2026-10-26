package com.kadreo.organization;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Read models of the organization module, shaped like the web contract types. */
public final class OrganizationModels {

    private OrganizationModels() {}

    public record Client(UUID id, String name, String shortName, String nip, String country, UUID managerUserId) {}

    public record Site(
            UUID id,
            String name,
            String city,
            String address,
            String country,
            String region,
            String timeZone,
            UUID clientId,
            double lat,
            double lng,
            String managerName,
            List<String> clockMethods,
            JsonNode accessControl,
            int lateThresholdMin,
            int clockWindowMin,
            String outsideGeofence,
            String teamLeaderName) {}

    public record RateCard(UUID positionId, BigDecimal previous, BigDecimal current) {}

    public record Contract(
            UUID id,
            String number,
            UUID clientId,
            UUID legalEntityId,
            String currency,
            String status,
            int version,
            LocalDate versionFrom,
            LocalDate validFrom,
            LocalDate validTo,
            String timesheetPeriod,
            int autoAcceptHours,
            int paymentDays,
            boolean showRatesInPortal,
            List<RateCard> rates,
            JsonNode sla,
            JsonNode kpiTargets) {}

    public record Project(UUID id, UUID siteId, UUID contractId, String name, String managerName, List<UUID> positionIds) {}

    public record ShiftTemplate(UUID id, UUID projectId, UUID positionId, LocalTime start, LocalTime end, int unpaidBreakMin, int sortOrder) {
        /** Paid hours of one shift; an end before the start crosses midnight. */
        public double hours() {
            int len = (end.toSecondOfDay() - start.toSecondOfDay()) / 60;
            if (len <= 0) len += 1440;
            return (len - unpaidBreakMin) / 60.0;
        }

        public String label() {
            return start + "–" + end;
        }
    }

    public record Position(UUID id, Map<String, String> name, List<UUID> competenceIds) {}

    public record Competence(UUID id, Map<String, String> name, boolean requiresDocument, String kind, String requiredDocumentType) {}

    public record Reason(UUID id, Map<String, String> name) {}

    public record Dictionaries(List<Position> positions, List<Competence> competences, List<Reason> correctionReasons, List<Reason> disputeReasons) {}
}
