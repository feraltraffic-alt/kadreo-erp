package com.kadreo.operations;

import com.kadreo.operations.StaffRequestService.Detail;
import com.kadreo.operations.StaffRequestService.StaffRequest;
import java.util.List;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Client staff requests in the back office (12.1 statuses; processing screens from the audit). */
@RestController
@RequestMapping("/api/v1/staff-requests")
class StaffRequestController {

    private final StaffRequestService requests;

    StaffRequestController(StaffRequestService requests) {
        this.requests = requests;
    }

    @GetMapping
    List<StaffRequest> list() {
        return requests.list();
    }

    @GetMapping("/{id}")
    Detail get(@PathVariable UUID id) {
        return requests.detail(id);
    }

    @PostMapping("/{id}/accept")
    Detail accept(@PathVariable UUID id) {
        return requests.accept(id);
    }

    record CancelInput(String reason) {}

    @PostMapping("/{id}/cancel")
    Detail cancel(@PathVariable UUID id, @RequestBody CancelInput in) {
        return requests.cancel(id, in.reason());
    }
}
