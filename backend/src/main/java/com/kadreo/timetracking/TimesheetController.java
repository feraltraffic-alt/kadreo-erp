package com.kadreo.timetracking;

import com.kadreo.timetracking.TimesheetModels.Correction;
import com.kadreo.timetracking.TimesheetModels.Timesheet;
import com.kadreo.timetracking.TimesheetService.CorrectionInput;
import com.kadreo.timetracking.TimesheetService.DayDetail;
import com.kadreo.timetracking.TimesheetService.ListItem;
import com.kadreo.timetracking.TimesheetService.TimesheetResponse;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.format.annotation.DateTimeFormat.ISO;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Timesheet endpoints (spec 9.2). */
@RestController
@RequestMapping("/api/v1/timesheets")
class TimesheetController {

    private final TimesheetService timesheets;
    private final DisputeService disputes;

    TimesheetController(TimesheetService timesheets, DisputeService disputes) {
        this.timesheets = timesheets;
        this.disputes = disputes;
    }

    @GetMapping
    List<ListItem> list() {
        return timesheets.list();
    }

    /** The project's timesheet whose period contains {@code from}. */
    @GetMapping("/by-period")
    TimesheetResponse byPeriod(@RequestParam UUID projectId, @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate from) {
        return timesheets.byPeriod(projectId, from);
    }

    @GetMapping("/{id}")
    TimesheetResponse get(@PathVariable UUID id) {
        return timesheets.byId(id);
    }

    @GetMapping("/{id}/rows/{rowId}/days/{date}")
    DayDetail day(@PathVariable UUID id, @PathVariable UUID rowId, @PathVariable @DateTimeFormat(iso = ISO.DATE) LocalDate date) {
        return timesheets.day(id, rowId, date);
    }

    @PostMapping("/{id}/corrections")
    @ResponseStatus(HttpStatus.CREATED)
    Correction correct(@PathVariable UUID id, @RequestBody CorrectionInput in) {
        return timesheets.correct(id, in);
    }

    @PostMapping("/{id}/send-to-client")
    Timesheet send(@PathVariable UUID id) {
        return timesheets.sendToClient(id);
    }

    @PostMapping("/{id}/disputes/{disputeId}/resolve")
    TimesheetModels.Dispute resolve(@PathVariable UUID id, @PathVariable UUID disputeId, @RequestBody DisputeService.Resolution in) {
        return disputes.resolve(id, disputeId, in);
    }
}
