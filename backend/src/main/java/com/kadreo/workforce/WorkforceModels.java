package com.kadreo.workforce;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Read models of the workforce module, shaped like the web contract types. */
public final class WorkforceModels {

    private WorkforceModels() {}

    public record Worker(
            UUID id,
            String number,
            String firstName,
            String lastName,
            String phone,
            String citizenship,
            String language,
            String contractKind,
            List<UUID> positionIds,
            List<UUID> competenceIds,
            double homeLat,
            double homeLng,
            boolean prefersMorning,
            int weeklyHourLimit,
            String status,
            LocalDate statusUntil,
            int badgeCount,
            double rating,
            Map<UUID, Integer> shiftsBySite) {

        public String fullName() {
            return firstName + " " + lastName;
        }
    }

    public record WorkerBrief(UUID id, String firstName, String lastName, String number) {}

    public record Document(UUID id, UUID workerId, String type, LocalDate validTo) {}

    public record Assignment(UUID id, UUID workerId, UUID templateId, LocalDate date, String status, String source, UUID replacesId) {
        public boolean active() {
            return "confirmed".equals(status) || "proposed".equals(status);
        }
    }

    public record ShiftPlan(UUID templateId, LocalDate date, int planned, boolean cancelled) {}
}
