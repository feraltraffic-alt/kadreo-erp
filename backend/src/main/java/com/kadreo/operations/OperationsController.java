package com.kadreo.operations;

import com.kadreo.operations.DashboardService.Filter;
import com.kadreo.operations.DashboardService.SiteLive;
import com.kadreo.operations.DashboardService.Summary;
import com.kadreo.operations.OperationsService.Alert;
import com.kadreo.operations.OperationsService.FilterOptions;
import com.kadreo.operations.OperationsService.NavCounters;
import com.kadreo.operations.OperationsService.Notification;
import com.kadreo.operations.OperationsService.SearchResults;
import com.kadreo.operations.OperationsService.UrgentInput;
import com.kadreo.operations.OperationsService.UrgentResult;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Dashboard and operations endpoints (spec 11.1, 8.4). */
@RestController
@RequestMapping("/api/v1")
class OperationsController {

    private final DashboardService dashboard;
    private final OperationsService ops;

    OperationsController(DashboardService dashboard, OperationsService ops) {
        this.dashboard = dashboard;
        this.ops = ops;
    }

    @GetMapping("/dashboard/summary")
    Summary summary(@RequestParam(required = false) List<String> regions, @RequestParam(required = false) List<UUID> clientIds) {
        return dashboard.summary(new Filter(regions, clientIds));
    }

    @GetMapping("/dashboard/sites")
    List<SiteLive> sites(@RequestParam(required = false) List<String> regions, @RequestParam(required = false) List<UUID> clientIds) {
        return dashboard.sites(new Filter(regions, clientIds));
    }

    @GetMapping("/dashboard/filter-options")
    FilterOptions filterOptions() {
        return ops.filterOptions();
    }

    @GetMapping("/alerts")
    List<Alert> alerts(@RequestParam(required = false) String status, @RequestParam(required = false) Integer limit) {
        return ops.alerts("open".equals(status), limit);
    }

    @PostMapping("/alerts/{id}/take")
    Alert take(@PathVariable UUID id) {
        return ops.take(id);
    }

    @PostMapping("/urgent-requests")
    @ResponseStatus(HttpStatus.CREATED)
    UrgentResult urgent(@RequestBody UrgentInput in) {
        return ops.createUrgent(in);
    }

    @GetMapping("/urgent-requests/{id}")
    UrgentResult urgentStatus(@PathVariable UUID id) {
        return ops.urgentStatus(id);
    }

    @GetMapping("/notifications")
    List<Notification> notifications() {
        return ops.notifications();
    }

    @PostMapping("/notifications/read-all")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void readAll() {
        ops.markAllRead();
    }

    @GetMapping("/search")
    SearchResults search(@RequestParam String q) {
        return ops.search(q);
    }

    @GetMapping("/nav-counters")
    NavCounters navCounters() {
        return ops.navCounters();
    }
}
