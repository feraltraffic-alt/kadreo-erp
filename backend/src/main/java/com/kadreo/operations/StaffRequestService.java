package com.kadreo.operations;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.kadreo.organization.OrganizationModels.Client;
import com.kadreo.organization.OrganizationModels.Contract;
import com.kadreo.organization.OrganizationModels.Project;
import com.kadreo.organization.OrganizationModels.ShiftTemplate;
import com.kadreo.organization.OrganizationModels.Site;
import com.kadreo.organization.OrganizationService;
import com.kadreo.platform.audit.AuditLog;
import com.kadreo.platform.security.CurrentUser;
import com.kadreo.platform.security.CurrentUserService;
import com.kadreo.platform.tenant.TenantContext;
import com.kadreo.platform.web.ApiException;
import com.kadreo.workforce.ScheduleService;
import com.kadreo.workforce.ScheduleService.AssignmentCreated;
import com.kadreo.workforce.WorkforceModels.Assignment;
import com.kadreo.workforce.WorkforceService;
import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Client staff requests (12.1) on the back-office side: list, card, accept, cancel. Accepting adds
 * {@code headcount} places to each shift day of the request; assignments made afterwards in those
 * days count towards it until it has {@code headcount} people there. «X of N» is the least
 * staffed day; «Укомплектована» and «Выполнена» follow from it and from the end date.
 */
@Service
public class StaffRequestService {

    private static final ZoneId TENANT_ZONE = ZoneId.of("Europe/Warsaw");

    private final JdbcClient jdbc;
    private final OrganizationService org;
    private final WorkforceService workforce;
    private final ScheduleService schedule;
    private final DashboardService dashboard;
    private final CurrentUserService users;
    private final AuditLog audit;
    private final Clock clock;

    public StaffRequestService(JdbcClient jdbc, OrganizationService org, WorkforceService workforce, ScheduleService schedule, DashboardService dashboard, CurrentUserService users,
            AuditLog audit, Clock clock) {
        this.jdbc = jdbc;
        this.org = org;
        this.workforce = workforce;
        this.schedule = schedule;
        this.dashboard = dashboard;
        this.users = users;
        this.audit = audit;
        this.clock = clock;
    }

    /* ----------------------------------------------------------------------- models */

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record StaffRequest(UUID id, int number, UUID siteId, UUID positionId, int headcount, int assigned, LocalDate from, LocalDate to, String status,
            OffsetDateTime slaDueAt, List<UUID> templateIds, List<UUID> competenceIds, boolean experiencedOnly, String clientRef, String comment, String contactName,
            OffsetDateTime createdAt, String createdByName, OffsetDateTime acceptedAt, String acceptedByName, OffsetDateTime cancelledAt, String cancelledByName,
            String cancelReason) {

        StaffRequest with(int assigned, String status) {
            return new StaffRequest(id, number, siteId, positionId, headcount, assigned, from, to, status, slaDueAt, templateIds, competenceIds, experiencedOnly, clientRef,
                    comment, contactName, createdAt, createdByName, acceptedAt, acceptedByName, cancelledAt, cancelledByName, cancelReason);
        }
    }

    public record Cell(UUID templateId, LocalDate date, int needed, int assigned) {}

    public record TemplateBrief(UUID id, UUID positionId, String start, String end) {}

    public record Detail(StaffRequest request, Site site, Client client, UUID projectId, List<TemplateBrief> templates, List<Cell> cells, int slaResponseHours) {}

    private static final String SQL = """
            select id, number, site_id, position_id, headcount, assigned, date_from, date_to, status, sla_due_at, template_ids, competence_ids, experienced_only,
                   client_ref, comment, contact_name, created_at, created_by_name, accepted_at, accepted_by_name, cancelled_at, cancelled_by_name, cancel_reason
            from staff_request""";

    private static List<UUID> uuids(Array a) throws SQLException {
        return a == null ? List.of() : Arrays.asList((UUID[]) a.getArray());
    }

    private static StaffRequest row(ResultSet rs, int i) throws SQLException {
        return new StaffRequest(
                rs.getObject("id", UUID.class),
                rs.getInt("number"),
                rs.getObject("site_id", UUID.class),
                rs.getObject("position_id", UUID.class),
                rs.getInt("headcount"),
                rs.getInt("assigned"),
                rs.getObject("date_from", LocalDate.class),
                rs.getObject("date_to", LocalDate.class),
                rs.getString("status"),
                rs.getObject("sla_due_at", OffsetDateTime.class),
                uuids(rs.getArray("template_ids")),
                uuids(rs.getArray("competence_ids")),
                rs.getBoolean("experienced_only"),
                rs.getString("client_ref"),
                rs.getString("comment"),
                rs.getString("contact_name"),
                rs.getObject("created_at", OffsetDateTime.class),
                rs.getString("created_by_name"),
                rs.getObject("accepted_at", OffsetDateTime.class),
                rs.getString("accepted_by_name"),
                rs.getObject("cancelled_at", OffsetDateTime.class),
                rs.getString("cancelled_by_name"),
                rs.getString("cancel_reason"));
    }

    record StoredCell(UUID requestId, UUID templateId, LocalDate date, int needed) {}

    private LocalDate today() {
        return LocalDate.now(clock.withZone(TENANT_ZONE));
    }

    /* ------------------------------------------------------------- progress (views) */

    private Map<UUID, List<StoredCell>> cells(Collection<UUID> requestIds) {
        if (requestIds.isEmpty()) return Map.of();
        return jdbc.sql("select request_id, template_id, date, needed from staff_request_cell where request_id = any(?) order by date, template_id")
                .param(requestIds.toArray(UUID[]::new))
                .query(StoredCell.class).list().stream()
                .collect(Collectors.groupingBy(StoredCell::requestId));
    }

    private Map<UUID, Set<UUID>> links(Collection<UUID> requestIds) {
        Map<UUID, Set<UUID>> out = new HashMap<>();
        if (requestIds.isEmpty()) return out;
        jdbc.sql("select request_id, assignment_id from staff_request_assignment where request_id = any(?)")
                .param(requestIds.toArray(UUID[]::new))
                .query((rs, i) -> out.computeIfAbsent(rs.getObject(1, UUID.class), k -> new HashSet<>()).add(rs.getObject(2, UUID.class)))
                .list();
        return out;
    }

    /** Progress per cell from the request's linked assignments that are still active. */
    private Map<UUID, List<Cell>> progress(List<StaffRequest> requests) {
        List<UUID> ids = requests.stream().map(StaffRequest::id).toList();
        Map<UUID, List<StoredCell>> cells = cells(ids);
        if (cells.isEmpty()) return Map.of();
        Map<UUID, Set<UUID>> links = links(ids);
        Set<UUID> templateIds = cells.values().stream().flatMap(List::stream).map(StoredCell::templateId).collect(Collectors.toSet());
        LocalDate from = cells.values().stream().flatMap(List::stream).map(StoredCell::date).min(Comparator.naturalOrder()).orElseThrow();
        LocalDate to = cells.values().stream().flatMap(List::stream).map(StoredCell::date).max(Comparator.naturalOrder()).orElseThrow();
        Map<UUID, Assignment> active = workforce.assignments(templateIds, from, to).stream().filter(Assignment::active)
                .collect(Collectors.toMap(Assignment::id, a -> a));
        Map<UUID, List<Cell>> out = new HashMap<>();
        for (var e : cells.entrySet()) {
            Set<UUID> linked = links.getOrDefault(e.getKey(), Set.of());
            out.put(e.getKey(), e.getValue().stream().map(c -> new Cell(c.templateId(), c.date(), c.needed(), (int) linked.stream()
                    .map(active::get)
                    .filter(a -> a != null && a.templateId().equals(c.templateId()) && a.date().equals(c.date()))
                    .count())).toList());
        }
        return out;
    }

    private StaffRequest view(StaffRequest r, List<Cell> cells) {
        if (r.acceptedAt() == null || r.cancelledAt() != null) return r.cancelledAt() != null ? r : r.with(0, r.status());
        int assigned = cells.isEmpty() ? 0 : Math.min(r.headcount(), cells.stream().mapToInt(Cell::assigned).min().orElse(0));
        String status = r.to().isBefore(today()) ? "done" : !cells.isEmpty() && assigned >= r.headcount() ? "staffed" : "in_progress";
        return r.with(assigned, status);
    }

    /** All requests on sites the user may see, with derived progress and status. */
    @Transactional(readOnly = true)
    public List<StaffRequest> list() {
        users.require("staffrequest.read");
        return views();
    }

    /** Same as {@link #list()} without the permission check, for the dashboard summary. */
    List<StaffRequest> views() {
        Set<UUID> visible = dashboard.visibleSites(new DashboardService.Filter(null, null)).stream().map(Site::id).collect(Collectors.toSet());
        List<StaffRequest> rows = jdbc.sql(SQL + " order by number desc").query(StaffRequestService::row).list().stream()
                .filter(r -> visible.contains(r.siteId())).toList();
        Map<UUID, List<Cell>> progress = progress(rows);
        return rows.stream().map(r -> view(r, progress.getOrDefault(r.id(), List.of()))).toList();
    }

    private StaffRequest load(UUID id, boolean lock) {
        StaffRequest r = jdbc.sql(SQL + " where id = ?" + (lock ? " for update" : "")).param(id).query(StaffRequestService::row).optional().orElseThrow(ApiException::notFound);
        Site site = org.site(r.siteId());
        CurrentUser u = users.current();
        if (!u.scope().wholeTenant() && !u.scope().siteIds().contains(site.id()) && !u.scope().regions().contains(site.region())) throw ApiException.notFound();
        return r;
    }

    @Transactional(readOnly = true)
    public Detail detail(UUID id) {
        users.require("staffrequest.read");
        return detailOf(load(id, false));
    }

    private Detail detailOf(StaffRequest r) {
        Site site = org.site(r.siteId());
        Project project = org.projectOfSite(site.id());
        Contract contract = org.contract(project.contractId());
        List<Cell> cells = progress(List.of(r)).getOrDefault(r.id(), List.of());
        List<TemplateBrief> templates = org.templates(project.id()).stream()
                .map((ShiftTemplate t) -> new TemplateBrief(t.id(), t.positionId(), t.start().toString(), t.end().toString())).toList();
        int responseHours = contract.sla() != null && contract.sla().has("responseHours") ? contract.sla().get("responseHours").asInt() : 0;
        return new Detail(view(r, cells), site, org.client(site.clientId()), project.id(), templates, cells, responseHours);
    }

    /* ------------------------------------------------------------------------ writes */

    /** Shift days of a request: every day of the period except Sunday, for each chosen shift. */
    static List<StoredCell> cellsOf(StaffRequest r) {
        List<StoredCell> out = new ArrayList<>();
        for (LocalDate d = r.from(); !d.isAfter(r.to()); d = d.plusDays(1)) {
            if (d.getDayOfWeek() == DayOfWeek.SUNDAY) continue;
            for (UUID t : r.templateIds()) out.add(new StoredCell(r.id(), t, d, r.headcount()));
        }
        return out;
    }

    /** «Принять в работу»: adds the places to the schedule; only a new request can be accepted. */
    @Transactional
    public Detail accept(UUID id) {
        CurrentUser u = users.require("staffrequest.manage");
        StaffRequest r = load(id, true);
        if (!"new".equals(r.status())) throw ApiException.conflict(r.acceptedByName() == null ? "" : r.acceptedByName(), String.valueOf(r.acceptedAt()));
        if (r.templateIds().isEmpty()) throw ApiException.badRequest("no_shifts");
        List<StoredCell> cells = cellsOf(r);
        for (StoredCell c : cells) {
            schedule.addPlaces(c.templateId(), c.date(), c.needed());
            jdbc.sql("insert into staff_request_cell (tenant_id, request_id, template_id, date, needed) values (?, ?, ?, ?, ?)")
                    .param(TenantContext.requireTenantId()).param(r.id()).param(c.templateId()).param(c.date()).param(c.needed())
                    .update();
        }
        jdbc.sql("update staff_request set status = 'in_progress', accepted_at = ?, accepted_by = ?, accepted_by_name = ?, version = version + 1 where id = ?")
                .param(OffsetDateTime.now(clock)).param(u.id()).param(u.fullName()).param(id)
                .update();
        audit.record("staff_request", id, "accept", Map.of("status", "new"), Map.of("status", "in_progress", "cells", cells.size()));
        return detailOf(load(id, false));
    }

    /**
     * Cancels with a reason. Places the request added to future days are taken out of the plan;
     * people already assigned stay in the schedule for the manager to review.
     */
    @Transactional
    public Detail cancel(UUID id, String reason) {
        CurrentUser u = users.require("staffrequest.manage");
        if (reason == null || reason.isBlank()) throw ApiException.badRequest("reason");
        StaffRequest stored = load(id, true);
        StaffRequest r = view(stored, progress(List.of(stored)).getOrDefault(id, List.of()));
        if (!List.of("draft", "new", "in_progress", "staffed").contains(r.status())) throw ApiException.badRequest("not_cancellable");
        LocalDate today = today();
        for (StoredCell c : cells(List.of(id)).getOrDefault(id, List.of())) {
            if (!c.date().isBefore(today)) schedule.addPlaces(c.templateId(), c.date(), -c.needed());
        }
        jdbc.sql("""
                update staff_request set status = 'cancelled', assigned = ?, cancelled_at = ?, cancelled_by = ?, cancelled_by_name = ?, cancel_reason = ?, version = version + 1
                where id = ?""")
                .param(r.assigned()).param(OffsetDateTime.now(clock)).param(u.id()).param(u.fullName()).param(reason.trim()).param(id)
                .update();
        audit.record("staff_request", id, "cancel", Map.of("status", r.status()), Map.of("status", "cancelled", "reason", reason.trim()));
        return detailOf(load(id, false));
    }

    /** A new assignment counts towards the earliest accepted request in its shift day that still needs people. */
    @EventListener
    void on(AssignmentCreated e) {
        List<UUID> candidates = jdbc.sql("""
                select c.request_id from staff_request_cell c join staff_request r on r.id = c.request_id
                where c.template_id = ? and c.date = ? and r.accepted_at is not null and r.cancelled_at is null
                order by r.accepted_at""")
                .param(e.templateId()).param(e.date()).query(UUID.class).list();
        if (candidates.isEmpty()) return;
        List<StaffRequest> requests = jdbc.sql(SQL + " where id = any(?)").param(candidates.toArray(UUID[]::new)).query(StaffRequestService::row).list();
        Map<UUID, List<Cell>> progress = progress(requests);
        for (UUID requestId : candidates) {
            Cell cell = progress.getOrDefault(requestId, List.of()).stream()
                    .filter(c -> c.templateId().equals(e.templateId()) && c.date().equals(e.date())).findFirst().orElse(null);
            if (cell != null && cell.assigned() < cell.needed()) {
                jdbc.sql("insert into staff_request_assignment (tenant_id, request_id, assignment_id) values (?, ?, ?) on conflict do nothing")
                        .param(TenantContext.requireTenantId()).param(requestId).param(e.assignmentId())
                        .update();
                return;
            }
        }
    }
}
