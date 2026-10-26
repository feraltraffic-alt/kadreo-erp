package com.kadreo.timetracking;

import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Disputes across timesheets, for the back-office list (open by default). */
@RestController
class DisputeController {

    private final DisputeService disputes;

    DisputeController(DisputeService disputes) {
        this.disputes = disputes;
    }

    @GetMapping("/api/v1/timesheet-disputes")
    List<DisputeService.ListItem> list(@RequestParam(defaultValue = "open") String status) {
        return disputes.list(!"all".equals(status));
    }
}
