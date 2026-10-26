package com.kadreo.timetracking;

import com.kadreo.organization.OrganizationModels.Client;
import com.kadreo.organization.OrganizationModels.Contract;
import com.kadreo.organization.OrganizationModels.Project;
import com.kadreo.organization.OrganizationModels.Site;
import com.kadreo.organization.OrganizationService;
import com.kadreo.platform.audit.AuditLog;
import com.kadreo.platform.security.CurrentUser;
import com.kadreo.platform.security.CurrentUserService;
import com.kadreo.platform.tenant.TenantContext;
import com.kadreo.platform.util.Ids;
import com.kadreo.platform.web.ApiException;
import com.kadreo.timetracking.TimesheetModels.ClientStage;
import com.kadreo.timetracking.TimesheetModels.Correction;
import com.kadreo.timetracking.TimesheetModels.Day;
import com.kadreo.timetracking.TimesheetModels.Dispute;
import com.kadreo.timetracking.TimesheetModels.Resolution;
import com.kadreo.timetracking.TimesheetModels.Evidence;
import com.kadreo.timetracking.TimesheetModels.Issue;
import com.kadreo.timetracking.TimesheetModels.Row;
import com.kadreo.timetracking.TimesheetModels.Timesheet;
import com.kadreo.workforce.WorkforceModels.WorkerBrief;
import com.kadreo.workforce.WorkforceService;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Timesheets (spec 9.2): list, grid, day detail with clock evidence, corrections, send to client. */
@Service
public class TimesheetService {

    private static final ZoneId TENANT_ZONE = ZoneId.of("Europe/Warsaw");
    private static final DateTimeFormatter HHMM = DateTimeFormatter.ofPattern("HH:mm");

    private final JdbcClient jdbc;
    private final OrganizationService org;
    private final WorkforceService workforce;
    private final CurrentUserService users;
    private final AuditLog audit;
    private final Clock clock;

    public TimesheetService(JdbcClient jdbc, OrganizationService org, WorkforceService workforce, CurrentUserService users, AuditLog audit, Clock clock) {
        this.jdbc = jdbc;
        this.org = org;
        this.workforce = workforce;
        this.users = users;
        this.audit = audit;
        this.clock = clock;
    }

    /* -------------------------------------------------------------------- header rows */

    record Header(UUID id, UUID projectId, LocalDate periodFrom, LocalDate periodTo, int teamLeaderDaysConfirmed, boolean managerConfirmed, String clientStage, OffsetDateTime clientDueAt) {}

    private static final String HEADER_SQL = "select id, project_id, period_from, period_to, team_leader_days_confirmed, manager_confirmed, client_stage, client_due_at from timesheet";

    private Header header(UUID id) {
        return jdbc.sql(HEADER_SQL + " where id = ?").param(id).query(Header.class).optional().orElseThrow(ApiException::notFound);
    }

    /* ---------------------------------------------------------------------- entries */

    record Entry(UUID id, UUID timesheetId, UUID workerId, UUID positionId, UUID assignmentId, LocalDate date, String shiftLabel, double plannedHours, double payableHours, double billableHours, String issueKind, Integer issueMinutes, boolean disputed) {}

    private static Entry entry(ResultSet rs, int i) throws SQLException {
        return new Entry(
                rs.getObject("id", UUID.class),
                rs.getObject("timesheet_id", UUID.class),
                rs.getObject("worker_id", UUID.class),
                rs.getObject("position_id", UUID.class),
                rs.getObject("assignment_id", UUID.class),
                rs.getObject("date", LocalDate.class),
                rs.getString("shift_label"),
                rs.getBigDecimal("planned_hours").doubleValue(),
                rs.getBigDecimal("payable_hours").doubleValue(),
                rs.getBigDecimal("billable_hours").doubleValue(),
                rs.getString("issue_kind"),
                (Integer) rs.getObject("issue_minutes"),
                rs.getBoolean("disputed"));
    }

    private static final String ENTRY_SQL = "select id, timesheet_id, worker_id, position_id, assignment_id, date, shift_label, planned_hours, payable_hours, billable_hours, issue_kind, issue_minutes, disputed from timesheet_entry";

    private List<Entry> entries(UUID timesheetId) {
        return jdbc.sql(ENTRY_SQL + " where timesheet_id = ?").param(timesheetId).query(TimesheetService::entry).list();
    }

    private Map<UUID, List<Correction>> corrections(UUID timesheetId) {
        record C(UUID entryId, Correction c) {}
        return jdbc.sql("""
                select c.entry_id, c.id, c.at, c.by_name, c.payable_before, c.payable_after, c.billable_before, c.billable_after, c.reason_id, c.comment
                from timesheet_correction c join timesheet_entry e on e.id = c.entry_id where e.timesheet_id = ? order by c.at""")
                .param(timesheetId)
                .query((rs, i) -> new C(rs.getObject("entry_id", UUID.class), new Correction(
                        rs.getObject("id", UUID.class),
                        rs.getObject("at", OffsetDateTime.class),
                        rs.getString("by_name"),
                        rs.getBigDecimal("payable_before").doubleValue(),
                        rs.getBigDecimal("payable_after").doubleValue(),
                        rs.getBigDecimal("billable_before").doubleValue(),
                        rs.getBigDecimal("billable_after").doubleValue(),
                        rs.getObject("reason_id", UUID.class),
                        rs.getString("comment"))))
                .list().stream()
                .collect(Collectors.groupingBy(C::entryId, Collectors.mapping(C::c, Collectors.toList())));
    }

    private static Day day(Entry e, List<Correction> corrections, List<Dispute> disputes) {
        Issue issue = e.issueKind() == null ? null : new Issue(e.issueKind(), e.issueMinutes());
        return new Day(e.date(), true, e.plannedHours(), e.payableHours(), e.billableHours(), e.shiftLabel(), issue, corrections, e.disputed() ? Boolean.TRUE : null,
                disputes.isEmpty() ? null : disputes);
    }

    private static Day empty(LocalDate d) {
        return new Day(d, false, 0, 0, 0, null, null, List.of(), null, null);
    }

    static final String DISPUTE_SQL = """
            select id, entry_id, timesheet_id, reason_id, client_hours, comment, created_at, created_by_name, status, resolution_comment, resolved_by_name, resolved_at,
                   payable_after, billable_after
            from timesheet_dispute""";

    static Dispute dispute(ResultSet rs) throws SQLException {
        java.math.BigDecimal client = rs.getBigDecimal("client_hours");
        java.math.BigDecimal pay = rs.getBigDecimal("payable_after");
        java.math.BigDecimal bill = rs.getBigDecimal("billable_after");
        String status = rs.getString("status");
        Resolution resolution = "open".equals(status) ? null : new Resolution(Objects.requireNonNullElse(rs.getString("resolution_comment"), ""), rs.getString("resolved_by_name"),
                rs.getObject("resolved_at", OffsetDateTime.class), pay == null ? null : pay.doubleValue(), bill == null ? null : bill.doubleValue());
        return new Dispute(rs.getObject("id", UUID.class), rs.getObject("reason_id", UUID.class), client == null ? null : client.doubleValue(), rs.getString("comment"),
                rs.getObject("created_at", OffsetDateTime.class), rs.getString("created_by_name"), status, resolution);
    }

    private Map<UUID, List<Dispute>> disputes(UUID timesheetId) {
        record D(UUID entryId, Dispute d) {}
        return jdbc.sql(DISPUTE_SQL + " where timesheet_id = ? order by created_at").param(timesheetId)
                .query((rs, i) -> new D(rs.getObject("entry_id", UUID.class), dispute(rs))).list().stream()
                .collect(Collectors.groupingBy(D::entryId, Collectors.mapping(D::d, Collectors.toList())));
    }

    private Timesheet assemble(Header h, Map<UUID, WorkerBrief> briefsOut) {
        List<Entry> entries = entries(h.id());
        Map<UUID, List<Correction>> corrections = corrections(h.id());
        Map<UUID, List<Dispute>> disputes = disputes(h.id());
        Map<UUID, List<Entry>> byWorker = entries.stream().collect(Collectors.groupingBy(Entry::workerId, LinkedHashMap::new, Collectors.toList()));
        Map<UUID, WorkerBrief> briefs = workforce.briefs(byWorker.keySet());
        briefsOut.putAll(briefs);
        List<Row> rows = new ArrayList<>();
        for (var w : byWorker.entrySet()) {
            Map<LocalDate, Entry> byDate = w.getValue().stream().collect(Collectors.toMap(Entry::date, Function.identity(), (a, b) -> a));
            List<Day> days = new ArrayList<>();
            for (LocalDate d = h.periodFrom(); !d.isAfter(h.periodTo()); d = d.plusDays(1)) {
                Entry e = byDate.get(d);
                days.add(e == null ? empty(d) : day(e, corrections.getOrDefault(e.id(), List.of()), disputes.getOrDefault(e.id(), List.of())));
            }
            UUID position = w.getValue().stream().min(Comparator.comparing(Entry::date)).map(Entry::positionId).orElseThrow();
            rows.add(new Row(w.getKey(), w.getKey(), position, days));
        }
        rows.sort(Comparator.comparing((Row r) -> briefs.get(r.workerId()).lastName()).thenComparing(r -> briefs.get(r.workerId()).firstName()));
        int disputedRows = (int) byWorker.values().stream().filter(l -> l.stream().anyMatch(Entry::disputed)).count();
        return new Timesheet(h.id(), h.projectId(), h.periodFrom(), h.periodTo(), h.teamLeaderDaysConfirmed(), h.managerConfirmed(), stage(h, disputedRows), rows);
    }

    private static ClientStage stage(Header h, int disputedRows) {
        return switch (h.clientStage()) {
            case "waiting" -> new ClientStage("waiting", h.clientDueAt(), null);
            case "disputed" -> new ClientStage("disputed", null, disputedRows);
            default -> new ClientStage(h.clientStage(), null, null);
        };
    }

    /* ------------------------------------------------------------------------ queries */

    public record ListItem(UUID id, UUID projectId, String siteName, String clientName, LocalDate from, LocalDate to, double payableHours, double plannedHours, int issues, Map<String, Object> timesheet) {}

    /** The timesheet under review for each project: the period that contains the day a week ago. */
    @Transactional(readOnly = true)
    public List<ListItem> list() {
        users.require("timesheet.read");
        LocalDate ref = LocalDate.now(clock.withZone(TENANT_ZONE)).minusDays(7);
        record Totals(UUID timesheetId, BigDecimal payable, BigDecimal planned, long issues) {}
        Map<UUID, Totals> totals = jdbc.sql("""
                select timesheet_id, sum(payable_hours) as payable, sum(planned_hours) as planned,
                       count(distinct worker_id) filter (where issue_kind is not null) as issues
                from timesheet_entry group by timesheet_id""")
                .query(Totals.class).list().stream().collect(Collectors.toMap(Totals::timesheetId, Function.identity()));
        Map<UUID, Project> projects = org.projects().stream().collect(Collectors.toMap(Project::id, Function.identity()));
        Map<UUID, Site> sites = org.sites().stream().collect(Collectors.toMap(Site::id, Function.identity()));
        Map<UUID, Client> clients = org.clients().stream().collect(Collectors.toMap(Client::id, Function.identity()));
        CurrentUser user = users.current();
        return jdbc.sql(HEADER_SQL + " where period_from <= ? and period_to >= ?").param(ref).param(ref).query(Header.class).list().stream()
                .filter(h -> projects.containsKey(h.projectId()))
                .filter(h -> inScope(user, sites.get(projects.get(h.projectId()).siteId())))
                .map(h -> {
                    Site s = sites.get(projects.get(h.projectId()).siteId());
                    Totals t = totals.get(h.id());
                    int disputed = "disputed".equals(h.clientStage()) ? disputedRows(h.id()) : 0;
                    Map<String, Object> ts = new LinkedHashMap<>();
                    ts.put("clientStage", stage(h, disputed));
                    ts.put("managerConfirmed", h.managerConfirmed());
                    ts.put("teamLeaderDaysConfirmed", h.teamLeaderDaysConfirmed());
                    return new ListItem(h.id(), h.projectId(), s.name(), clients.get(s.clientId()).shortName(), h.periodFrom(), h.periodTo(),
                            t == null ? 0 : t.payable().doubleValue(), t == null ? 0 : t.planned().doubleValue(), t == null ? 0 : (int) t.issues(), ts);
                })
                .sorted(Comparator.comparing(ListItem::siteName))
                .toList();
    }

    private int disputedRows(UUID timesheetId) {
        return jdbc.sql("select count(distinct worker_id) from timesheet_entry where timesheet_id = ? and disputed").param(timesheetId).query(Integer.class).single();
    }

    static boolean inScope(CurrentUser u, Site s) {
        if (u.scope().wholeTenant()) return true;
        return u.scope().siteIds().contains(s.id()) || u.scope().regions().contains(s.region());
    }

    public record TimesheetResponse(Timesheet timesheet, Project project, Site site, Client client, Contract contract, Map<UUID, WorkerBrief> workers) {}

    @Transactional(readOnly = true)
    public TimesheetResponse byPeriod(UUID projectId, LocalDate from) {
        users.require("timesheet.read");
        Header h = jdbc.sql(HEADER_SQL + " where project_id = ? and period_from <= ? and period_to >= ? order by period_from desc limit 1")
                .param(projectId).param(from).param(from).query(Header.class).optional().orElseThrow(ApiException::notFound);
        return response(h);
    }

    @Transactional(readOnly = true)
    public TimesheetResponse byId(UUID id) {
        users.require("timesheet.read");
        return response(header(id));
    }

    private TimesheetResponse response(Header h) {
        Map<UUID, WorkerBrief> briefs = new HashMap<>();
        Timesheet t = assemble(h, briefs);
        Project p = org.project(h.projectId());
        Site s = org.site(p.siteId());
        return new TimesheetResponse(t, p, s, org.client(s.clientId()), org.contract(p.contractId()), briefs);
    }

    public record DayDetail(UUID rowId, Map<String, Object> worker, UUID positionId, Day day, List<Evidence> evidence) {}

    @Transactional(readOnly = true)
    public DayDetail day(UUID timesheetId, UUID rowId, LocalDate date) {
        users.require("timesheet.read");
        Entry e = entry(timesheetId, rowId, date);
        WorkerBrief w = workforce.briefs(List.of(e.workerId())).get(e.workerId());
        Day day = day(e, corrections(timesheetId).getOrDefault(e.id(), List.of()), disputes(timesheetId).getOrDefault(e.id(), List.of()));
        Map<String, Object> worker = Map.of("id", w.id(), "firstName", w.firstName(), "lastName", w.lastName());
        return new DayDetail(rowId, worker, e.positionId(), day, evidence(e));
    }

    private Entry entry(UUID timesheetId, UUID workerId, LocalDate date) {
        return jdbc.sql(ENTRY_SQL + " where timesheet_id = ? and worker_id = ? and date = ?")
                .param(timesheetId).param(workerId).param(date)
                .query(TimesheetService::entry).optional().orElseThrow(ApiException::notFound);
    }

    /** Clock events of the entry's assignment, in site time, with breaks paired (9.2-18). */
    private List<Evidence> evidence(Entry e) {
        if (e.assignmentId() == null) return List.of();
        List<Ev> events = jdbc.sql("""
                select c.type, c.server_time as at, c.source, c.gps_accuracy_m as gps, c.photo, c.face_match as face, c.gate, c.kiosk, c.qr_point as qr, s.time_zone as tz
                from clock_event c join site s on s.id = c.site_id where c.assignment_id = ? order by c.server_time""")
                .param(e.assignmentId())
                .query(Ev.class).list();
        List<Evidence> out = new ArrayList<>();
        Ev breakStart = null;
        for (Ev ev : events) {
            String time = ev.at().atZoneSameInstant(ZoneId.of(ev.tz())).format(HHMM);
            switch (ev.type()) {
                case "break_start" -> breakStart = ev;
                case "break_end" -> {
                    Ev s = breakStart == null ? ev : breakStart;
                    String start = s.at().atZoneSameInstant(ZoneId.of(s.tz())).format(HHMM);
                    out.add(evidence("break", start, time, s));
                    breakStart = null;
                }
                default -> out.add(evidence(ev.type(), time, null, ev));
            }
        }
        return out;
    }

    record Ev(String type, OffsetDateTime at, String source, Integer gps, boolean photo, Boolean face, Integer gate, Integer kiosk, Integer qr, String tz) {}

    private static Evidence evidence(String type, String time, String endTime, Ev ev) {
        return new Evidence(type, time, endTime, ev.source(), ev.gps(), ev.photo() ? Boolean.TRUE : null, ev.face(), ev.gate(), ev.kiosk(), ev.qr());
    }

    /* ------------------------------------------------------------------------ writes */

    public record CorrectionInput(UUID rowId, LocalDate date, double payableHours, double billableHours, UUID reasonId, String comment) {}

    @Transactional
    public Correction correct(UUID timesheetId, CorrectionInput in) {
        CurrentUser user = users.require("timesheet.entry.correct");
        Header h = header(timesheetId);
        if (List.of("confirmed", "auto_accepted").contains(h.clientStage())) throw ApiException.badRequest("timesheet_locked");
        if (in.reasonId() == null) throw ApiException.badRequest("reasonId");
        if (in.payableHours() < 0 || in.payableHours() > 24 || in.billableHours() < 0 || in.billableHours() > 24) throw ApiException.badRequest("hours");
        Entry e = entry(timesheetId, in.rowId(), in.date());
        Correction c = new Correction(Ids.newId(), OffsetDateTime.now(clock), user.fullName(), e.payableHours(), in.payableHours(), e.billableHours(), in.billableHours(), in.reasonId(), Objects.requireNonNullElse(in.comment(), ""));
        jdbc.sql("""
                insert into timesheet_correction (id, tenant_id, entry_id, at, by_user_id, by_name, payable_before, payable_after, billable_before, billable_after, reason_id, comment)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""")
                .param(c.id()).param(TenantContext.requireTenantId()).param(e.id()).param(c.at()).param(user.id()).param(c.byName())
                .param(c.payableBefore()).param(c.payableAfter()).param(c.billableBefore()).param(c.billableAfter()).param(c.reasonId()).param(c.comment())
                .update();
        jdbc.sql("update timesheet_entry set payable_hours = ?, billable_hours = ?, issue_kind = null, issue_minutes = null, version = version + 1 where id = ?")
                .param(in.payableHours()).param(in.billableHours()).param(e.id())
                .update();
        audit.record("timesheet_entry", e.id(), "correct", Map.of("payable", e.payableHours(), "billable", e.billableHours()), Map.of("payable", in.payableHours(), "billable", in.billableHours(), "reasonId", in.reasonId()));
        return c;
    }

    /** Manager confirms and sends; the client has {@code autoAcceptHours} before auto-acceptance (9.2-08). */
    @Transactional
    public Timesheet sendToClient(UUID timesheetId) {
        CurrentUser user = users.require("timesheet.send_to_client");
        Header h = header(timesheetId);
        if (!"not_sent".equals(h.clientStage()) && !"disputed".equals(h.clientStage())) throw ApiException.badRequest("already_sent");
        Contract contract = org.contract(org.project(h.projectId()).contractId());
        OffsetDateTime now = OffsetDateTime.now(clock);
        jdbc.sql("""
                update timesheet set manager_confirmed = true, client_stage = 'waiting', client_due_at = ?, sent_at = ?, sent_by = ?, version = version + 1
                where id = ?""")
                .param(now.plusHours(contract.autoAcceptHours())).param(now).param(user.id()).param(timesheetId)
                .update();
        audit.record("timesheet", timesheetId, "send_to_client", Map.of("clientStage", h.clientStage()), Map.of("clientStage", "waiting"));
        return assemble(header(timesheetId), new HashMap<>());
    }
}
