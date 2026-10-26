package com.kadreo.timetracking;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/** Timesheet read models, shaped like the web contract ({@code Timesheet}, {@code TimesheetDay}, …). */
public final class TimesheetModels {

    private TimesheetModels() {}

    public record Correction(UUID id, OffsetDateTime at, String byName, double payableBefore, double payableAfter, double billableBefore, double billableAfter, UUID reasonId, String comment) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Issue(String kind, Integer minutes) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Day(LocalDate date, boolean hasShift, double plannedHours, double payableHours, double billableHours, String shiftLabel, Issue issue, List<Correction> corrections, Boolean disputed) {}

    /** One row per worker; the row id is the worker id. */
    public record Row(UUID id, UUID workerId, UUID positionId, List<Day> days) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ClientStage(String kind, OffsetDateTime until, Integer rows) {}

    public record Timesheet(UUID id, UUID projectId, LocalDate from, LocalDate to, int teamLeaderDaysConfirmed, boolean managerConfirmed, ClientStage clientStage, List<Row> rows) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Evidence(String type, String time, String endTime, String source, Integer gpsAccuracyM, Boolean photo, Boolean faceMatch, Integer gate, Integer kiosk, Integer qrPoint) {}
}
