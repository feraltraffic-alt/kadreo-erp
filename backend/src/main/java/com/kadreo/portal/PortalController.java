package com.kadreo.portal;

import com.kadreo.operations.StaffRequestService.StaffRequest;
import com.kadreo.organization.OrganizationModels.Dictionaries;
import com.kadreo.portal.PortalService.Estimate;
import com.kadreo.portal.PortalService.Overview;
import com.kadreo.portal.PortalService.PortalSite;
import com.kadreo.portal.PortalService.PortalUser;
import com.kadreo.portal.PortalService.RequestDetail;
import com.kadreo.portal.PortalService.RequestInput;
import com.kadreo.portal.PortalService.SiteOptions;
import com.kadreo.portal.PortalTimesheetService.DisputeInput;
import com.kadreo.portal.PortalTimesheetService.ListItem;
import com.kadreo.portal.PortalTimesheetService.PortalTimesheet;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Client portal API (spec 12). Only client users reach it (see ClientBoundary). */
@RestController
@RequestMapping("/api/v1/portal")
class PortalController {

    private final PortalService portal;
    private final PortalTimesheetService timesheets;

    PortalController(PortalService portal, PortalTimesheetService timesheets) {
        this.portal = portal;
        this.timesheets = timesheets;
    }

    @GetMapping("/me")
    PortalUser me() {
        return portal.me();
    }

    @GetMapping("/dictionaries")
    Dictionaries dictionaries() {
        return portal.dictionaries();
    }

    @GetMapping("/overview")
    Overview overview() {
        return portal.overview();
    }

    @GetMapping("/sites")
    List<PortalSite> sites() {
        return portal.sites();
    }

    @GetMapping("/sites/{id}/positions")
    SiteOptions positions(@PathVariable UUID id) {
        return portal.siteOptions(id);
    }

    @PostMapping("/staff-requests/estimate")
    Estimate estimate(@RequestBody RequestInput in) {
        return portal.estimate(in);
    }

    @PostMapping("/staff-requests")
    @ResponseStatus(HttpStatus.CREATED)
    StaffRequest create(@RequestBody RequestInput in) {
        return portal.create(in);
    }

    @PutMapping("/staff-requests/{id}")
    StaffRequest update(@PathVariable UUID id, @RequestBody RequestInput in) {
        return portal.updateDraft(id, in);
    }

    @GetMapping("/staff-requests")
    List<StaffRequest> requests() {
        return portal.requests();
    }

    @GetMapping("/staff-requests/{id}")
    RequestDetail request(@PathVariable UUID id) {
        return portal.request(id);
    }

    @GetMapping("/timesheets")
    List<ListItem> timesheets() {
        return timesheets.list();
    }

    @GetMapping("/timesheets/{id}")
    PortalTimesheet timesheet(@PathVariable UUID id) {
        return timesheets.get(id);
    }

    @PostMapping("/timesheets/{id}/disputes")
    PortalTimesheet dispute(@PathVariable UUID id, @RequestBody DisputeInput in) {
        return timesheets.dispute(id, in);
    }

    /** Fixes user, time and IP address of the confirmation (12.2-15). */
    @PostMapping("/timesheets/{id}/confirm")
    PortalTimesheet confirm(@PathVariable UUID id, HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        String ip = forwarded != null && !forwarded.isBlank() ? forwarded.split(",")[0].trim() : request.getRemoteAddr();
        return timesheets.confirm(id, ip);
    }
}
