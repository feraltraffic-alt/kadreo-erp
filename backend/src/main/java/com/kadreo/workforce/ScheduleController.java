package com.kadreo.workforce;

import com.kadreo.workforce.ScheduleService.AutoAssignJob;
import com.kadreo.workforce.ScheduleService.AutoAssignRequest;
import com.kadreo.workforce.ScheduleService.Candidate;
import com.kadreo.workforce.ScheduleService.CandidateFilter;
import com.kadreo.workforce.ScheduleService.CellAssignment;
import com.kadreo.workforce.ScheduleService.ProjectListItem;
import com.kadreo.workforce.ScheduleService.Schedule;
import com.kadreo.workforce.WorkforceModels.Assignment;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.format.annotation.DateTimeFormat.ISO;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Shift planning endpoints (spec 9.1). Permission checks live in {@link ScheduleService}. */
@RestController
@RequestMapping("/api/v1")
class ScheduleController {

    private final ScheduleService schedule;
    private final WorkforceService workforce;
    private final com.kadreo.platform.security.CurrentUserService users;

    ScheduleController(ScheduleService schedule, WorkforceService workforce, com.kadreo.platform.security.CurrentUserService users) {
        this.schedule = schedule;
        this.workforce = workforce;
        this.users = users;
    }

    @GetMapping("/projects")
    List<ProjectListItem> projects(@RequestParam(required = false) @DateTimeFormat(iso = ISO.DATE) LocalDate weekOf) {
        return schedule.projects(weekOf == null ? schedule.today() : weekOf);
    }

    @GetMapping("/projects/{id}/schedule")
    Schedule schedule(@PathVariable UUID id, @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate from, @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate to) {
        if (to.isBefore(from) || from.plusDays(62).isBefore(to)) throw com.kadreo.platform.web.ApiException.badRequest("range");
        return schedule.schedule(id, from, to);
    }

    @GetMapping("/shifts/{templateId}/assignments")
    List<CellAssignment> cell(@PathVariable UUID templateId, @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate date) {
        return schedule.cellAssignments(templateId, date);
    }

    @GetMapping("/shifts/{templateId}/candidates")
    List<Candidate> candidates(
            @PathVariable UUID templateId,
            @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate date,
            @RequestParam(required = false) Integer maxKm,
            @RequestParam(defaultValue = "false") boolean experiencedOnly,
            @RequestParam(defaultValue = "false") boolean noOvertime) {
        return schedule.candidates(templateId, date, new CandidateFilter(maxKm, experiencedOnly, noOvertime));
    }

    record AssignInput(UUID workerId, UUID templateId, LocalDate date, String source) {}

    @PostMapping("/assignments")
    @ResponseStatus(HttpStatus.CREATED)
    Assignment assign(@RequestBody AssignInput in) {
        if (in.workerId() == null || in.templateId() == null || in.date() == null) throw com.kadreo.platform.web.ApiException.badRequest("workerId, templateId and date are required");
        return schedule.assign(in.workerId(), in.templateId(), in.date(), in.source());
    }

    @DeleteMapping("/assignments/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void unassign(@PathVariable UUID id) {
        schedule.unassign(id);
    }

    record PlanInput(int planned) {}

    @PutMapping("/shifts/{templateId}/plans/{date}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void changePlan(@PathVariable UUID templateId, @PathVariable @DateTimeFormat(iso = ISO.DATE) LocalDate date, @RequestBody PlanInput in) {
        schedule.changePlan(templateId, date, in.planned());
    }

    @PostMapping("/shifts/{templateId}/plans/{date}/cancel")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void cancel(@PathVariable UUID templateId, @PathVariable @DateTimeFormat(iso = ISO.DATE) LocalDate date) {
        schedule.cancelShift(templateId, date);
    }

    @PostMapping("/shifts/{templateId}/plans/{date}/copy-to-next-week")
    Map<String, Integer> copy(@PathVariable UUID templateId, @PathVariable @DateTimeFormat(iso = ISO.DATE) LocalDate date) {
        return Map.of("copied", schedule.copyToNextWeek(templateId, date));
    }

    @PostMapping("/projects/{id}/schedule/auto-assign")
    @ResponseStatus(HttpStatus.ACCEPTED)
    Map<String, UUID> autoAssign(@PathVariable UUID id, @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate from, @RequestBody AutoAssignRequest req) {
        return Map.of("jobId", schedule.startAutoAssign(id, from, req));
    }

    @GetMapping("/jobs/{id}")
    AutoAssignJob job(@PathVariable UUID id) {
        return schedule.job(id);
    }

    @PostMapping("/projects/{id}/schedule/publish")
    Map<String, Integer> publish(@PathVariable UUID id, @RequestParam @DateTimeFormat(iso = ISO.DATE) LocalDate from) {
        return Map.of("notified", schedule.publish(id, from));
    }

    @GetMapping("/workers/{id}/documents")
    List<WorkforceModels.Document> documents(@PathVariable UUID id) {
        users.require("worker.document.read");
        return workforce.documents(id);
    }
}
