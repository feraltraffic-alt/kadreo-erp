package com.kadreo.portal;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.kadreo.organization.OrganizationModels.Site;
import com.kadreo.platform.security.CurrentUser;
import com.kadreo.platform.web.ApiException;
import com.kadreo.timetracking.ClientTimesheets;
import com.kadreo.timetracking.ClientTimesheets.Header;
import com.kadreo.timetracking.ClientTimesheets.Item;
import com.kadreo.timetracking.TimesheetModels.ClientStage;
import com.kadreo.timetracking.TimesheetModels.Correction;
import com.kadreo.timetracking.TimesheetModels.Day;
import com.kadreo.timetracking.TimesheetModels.Dispute;
import com.kadreo.timetracking.TimesheetModels.Row;
import com.kadreo.timetracking.TimesheetModels.Timesheet;
import com.kadreo.workforce.WorkforceModels.WorkerBrief;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Hours to confirm (12.2) as the client sees them: billable hours per day, the contractor's
 * corrections with reasons, disputes and answers. Workers appear by name and position only.
 */
@Service
public class PortalTimesheetService {

    private final PortalService portal;
    private final ClientTimesheets timesheets;

    public PortalTimesheetService(PortalService portal, ClientTimesheets timesheets) {
        this.portal = portal;
        this.timesheets = timesheets;
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ListItem(UUID id, UUID siteId, String siteName, LocalDate from, LocalDate to, ClientStage stage, double billableHours, int workers, OffsetDateTime sentAt) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record PortalCorrection(UUID reasonId, String comment, double before, double after) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record PortalDispute(UUID id, String status, UUID reasonId, Double clientHours, String comment, String answer) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record PortalDay(LocalDate date, boolean hasShift, double hours, double nightHours, String shiftLabel, PortalCorrection correction, PortalDispute dispute,
            boolean confirmed) {}

    public record PortalWorker(String firstName, String lastName) {}

    public record PortalRow(UUID id, PortalWorker worker, UUID positionId, List<PortalDay> days, double total) {}

    public record SiteRef(UUID id, String name) {}

    public record Totals(double hours, int workers, double nightHours) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record PortalTimesheet(UUID id, SiteRef site, LocalDate from, LocalDate to, ClientStage stage, OffsetDateTime sentAt, String sentByName, Totals totals,
            List<PortalRow> rows) {}

    /** The user's own timesheet, or 404 — never a hint that another client's exists. */
    private Header own(CurrentUser u, UUID id) {
        Header h = timesheets.header(id);
        Site s = portal.sitesByProject(u).get(h.projectId());
        if (s == null || "not_sent".equals(h.clientStage())) throw ApiException.notFound();
        return h;
    }

    @Transactional(readOnly = true)
    public List<ListItem> list() {
        CurrentUser u = portal.require("portal.read");
        Map<UUID, Site> byProject = portal.sitesByProject(u);
        Map<String, Integer> order = Map.of("waiting", 0, "disputed", 1, "confirmed", 2, "auto_accepted", 3);
        List<ListItem> out = new ArrayList<>();
        for (Header h : timesheets.containing(byProject.keySet(), portal.today().minusDays(7))) {
            if ("not_sent".equals(h.clientStage())) continue;
            PortalTimesheet t = view(h, byProject.get(h.projectId()));
            out.add(new ListItem(h.id(), t.site().id(), t.site().name(), h.periodFrom(), h.periodTo(), t.stage(), t.totals().hours(), t.totals().workers(), h.sentAt()));
        }
        out.sort(Comparator.comparingInt((ListItem x) -> order.getOrDefault(x.stage().kind(), 9)).thenComparing(ListItem::siteName));
        return out;
    }

    @Transactional(readOnly = true)
    public PortalTimesheet get(UUID id) {
        CurrentUser u = portal.require("portal.read");
        Header h = own(u, id);
        return view(h, portal.sitesByProject(u).get(h.projectId()));
    }

    public record DisputeInput(List<Item> items, UUID reasonId, Double clientHours, String comment) {}

    @Transactional
    public PortalTimesheet dispute(UUID id, DisputeInput in) {
        CurrentUser u = portal.require("timesheet.client.confirm");
        own(u, id);
        if (in == null) throw ApiException.badRequest("input");
        timesheets.dispute(id, in.items(), in.reasonId(), in.clientHours(), in.comment(), u);
        return get(id);
    }

    @Transactional
    public PortalTimesheet confirm(UUID id, String ip) {
        CurrentUser u = portal.require("timesheet.client.confirm");
        own(u, id);
        timesheets.confirm(id, u, ip);
        return get(id);
    }

    /* ------------------------------------------------------------------------ mapping */

    private PortalTimesheet view(Header h, Site site) {
        Map<UUID, WorkerBrief> workers = new HashMap<>();
        Timesheet t = timesheets.timesheet(h.id(), workers);
        boolean closed = List.of("confirmed", "auto_accepted").contains(h.clientStage());
        List<PortalRow> rows = new ArrayList<>();
        for (Row r : t.rows()) {
            WorkerBrief w = workers.get(r.workerId());
            List<PortalDay> days = r.days().stream().map(d -> day(d, closed)).toList();
            rows.add(new PortalRow(r.id(), new PortalWorker(w.firstName(), w.lastName()), r.positionId(), days, days.stream().mapToDouble(PortalDay::hours).sum()));
        }
        double hours = rows.stream().mapToDouble(PortalRow::total).sum();
        double night = rows.stream().flatMap(r -> r.days().stream()).mapToDouble(PortalDay::nightHours).sum();
        return new PortalTimesheet(h.id(), new SiteRef(site.id(), site.name()), h.periodFrom(), h.periodTo(), t.clientStage(), h.sentAt(), h.sentByName(),
                new Totals(hours, rows.size(), night), rows);
    }

    private static PortalDay day(Day d, boolean closed) {
        PortalCorrection correction = null;
        if (d.corrections() != null && !d.corrections().isEmpty()) {
            Correction c = d.corrections().get(d.corrections().size() - 1);
            correction = new PortalCorrection(c.reasonId(), c.comment(), c.billableBefore(), c.billableAfter());
        }
        PortalDispute dispute = null;
        if (d.disputes() != null && !d.disputes().isEmpty()) {
            Dispute x = d.disputes().get(d.disputes().size() - 1);
            String answer = x.resolution() == null || x.resolution().comment() == null || x.resolution().comment().isBlank() ? null : x.resolution().comment();
            dispute = new PortalDispute(x.id(), x.status(), x.reasonId(), x.clientHours(), x.comment(), answer);
        }
        boolean confirmed = closed || Boolean.TRUE.equals(d.clientConfirmed());
        return new PortalDay(d.date(), d.hasShift(), d.billableHours(), nightHours(d.shiftLabel(), d.billableHours()), d.shiftLabel(), correction, dispute, confirmed);
    }

    /** Hours of a shift between 22:00 and 06:00, capped at the day's hours (12.2-04). */
    static double nightHours(String shiftLabel, double hours) {
        if (shiftLabel == null || hours <= 0) return 0;
        String[] parts = shiftLabel.split("[–-]");
        if (parts.length != 2) return 0;
        int s = LocalTime.parse(parts[0].trim()).toSecondOfDay() / 60;
        int e = LocalTime.parse(parts[1].trim()).toSecondOfDay() / 60;
        if (e <= s) e += 1440;
        int night = overlap(s, e, 0, 360) + overlap(s, e, 1320, 1800) + overlap(s, e, 2760, 2880);
        return Math.min(hours, night / 60.0);
    }

    private static int overlap(int s, int e, int x, int y) {
        return Math.max(0, Math.min(e, y) - Math.max(s, x));
    }
}
