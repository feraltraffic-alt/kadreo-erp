package com.kadreo.operations;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;
import com.kadreo.organization.OrganizationModels.Client;
import com.kadreo.organization.OrganizationModels.Contract;
import com.kadreo.organization.OrganizationModels.Site;
import com.kadreo.organization.OrganizationService;
import com.kadreo.platform.audit.AuditLog;
import com.kadreo.platform.security.CurrentUser;
import com.kadreo.platform.security.CurrentUserService;
import com.kadreo.platform.tenant.TenantContext;
import com.kadreo.platform.util.Ids;
import com.kadreo.platform.util.Json;
import com.kadreo.platform.web.ApiException;
import com.kadreo.workforce.ScheduleService;
import com.kadreo.workforce.WorkforceService;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Alerts, staff and urgent requests, notifications, search and menu counters (spec 11.1, 8.4). */
@Service
public class OperationsService {

    private final JdbcClient jdbc;
    private final OrganizationService org;
    private final WorkforceService workforce;
    private final ScheduleService schedule;
    private final DashboardService dashboard;
    private final CurrentUserService users;
    private final AuditLog audit;
    private final Clock clock;
    private final boolean simulateAcceptance;
    private final UrgentOffers offers;

    public OperationsService(JdbcClient jdbc, OrganizationService org, WorkforceService workforce, ScheduleService schedule, DashboardService dashboard, CurrentUserService users,
            AuditLog audit, Clock clock, @Value("${kadreo.demo.simulate-urgent-acceptance:false}") boolean simulateAcceptance, UrgentOffers offers) {
        this.offers = offers;
        this.jdbc = jdbc;
        this.org = org;
        this.workforce = workforce;
        this.schedule = schedule;
        this.dashboard = dashboard;
        this.users = users;
        this.audit = audit;
        this.clock = clock;
        this.simulateAcceptance = simulateAcceptance;
    }

    /* ------------------------------------------------------------------------ alerts */

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Alert(UUID id, String kind, String severity, UUID siteId, Map<String, String> title, Map<String, String> context, OffsetDateTime createdAt, int escalationLevel,
            OffsetDateTime nextEscalationAt, OffsetDateTime slaDueAt, String takenByName, OffsetDateTime takenAt, int count, String status, JsonNode shiftRef) {}

    private static final String ALERT_SQL = """
            select id, kind, severity, site_id, title::text as title, context::text as context, created_at, escalation_level, next_escalation_at, sla_due_at,
                   taken_by, taken_by_name, taken_at, count, status, shift_ref::text as shift_ref
            from alert""";

    private static Alert alert(ResultSet rs, int i) throws SQLException {
        return new Alert(
                rs.getObject("id", UUID.class),
                rs.getString("kind"),
                rs.getString("severity"),
                rs.getObject("site_id", UUID.class),
                Json.text(rs.getString("title")),
                Json.text(rs.getString("context")),
                rs.getObject("created_at", OffsetDateTime.class),
                rs.getInt("escalation_level"),
                rs.getObject("next_escalation_at", OffsetDateTime.class),
                rs.getObject("sla_due_at", OffsetDateTime.class),
                rs.getString("taken_by_name"),
                rs.getObject("taken_at", OffsetDateTime.class),
                rs.getInt("count"),
                rs.getString("status"),
                Json.node(rs.getString("shift_ref")));
    }

    @Transactional(readOnly = true)
    public List<Alert> alerts(boolean openOnly, Integer limit) {
        users.require("alert.read");
        var visible = dashboard.visibleSites(new DashboardService.Filter(null, null)).stream().map(Site::id).collect(Collectors.toSet());
        return jdbc.sql(ALERT_SQL + (openOnly ? " where status <> 'closed'" : "") + " order by case severity when 'critical' then 0 when 'warning' then 1 else 2 end, created_at desc")
                .query(OperationsService::alert).list().stream()
                .filter(a -> visible.contains(a.siteId()))
                .limit(limit == null ? Long.MAX_VALUE : limit)
                .toList();
    }

    /** «Взять в работу»: stops the escalation; a second person gets 409 with who took it. */
    @Transactional
    public Alert take(UUID id) {
        CurrentUser u = users.require("alert.take");
        Alert a = jdbc.sql(ALERT_SQL + " where id = ? for update").param(id).query(OperationsService::alert).optional().orElseThrow(ApiException::notFound);
        if ("taken".equals(a.status()) && a.takenByName() != null && !a.takenByName().equals(u.fullName())) {
            throw ApiException.conflict(a.takenByName(), String.valueOf(a.takenAt()));
        }
        if ("closed".equals(a.status())) throw ApiException.badRequest("closed");
        jdbc.sql("update alert set status = 'taken', taken_by = ?, taken_by_name = ?, taken_at = ?, next_escalation_at = null, version = version + 1 where id = ?")
                .param(u.id()).param(u.fullName()).param(OffsetDateTime.now(clock)).param(id)
                .update();
        audit.record("alert", id, "take", Map.of("status", a.status()), Map.of("status", "taken"));
        return jdbc.sql(ALERT_SQL + " where id = ?").param(id).query(OperationsService::alert).single();
    }

    /* --------------------------------------------------------------- urgent requests */

    public record UrgentInput(UUID siteId, UUID templateId, LocalDate date, int headcount, String comment, Integer bonusPoints) {}

    public record UrgentResult(UUID id, int offeredTo, int accepted, int needed) {}

    /** «Срочная замена»: offers the shift to up to four eligible workers per place (11.1-06). */
    @Transactional
    public UrgentResult createUrgent(UrgentInput in) {
        users.require("shift.urgent.create");
        if (in.headcount() < 1 || in.headcount() > 50) throw ApiException.badRequest("headcount");
        if (in.siteId() == null || in.templateId() == null || in.date() == null) throw ApiException.badRequest("siteId, templateId and date are required");
        var tpl = org.template(in.templateId());
        if (!org.project(tpl.projectId()).siteId().equals(in.siteId())) throw ApiException.badRequest("template_site_mismatch");
        var created = offers.create(in.templateId(), in.date(), in.headcount(), null, in.bonusPoints() == null ? 0 : in.bonusPoints(), null, in.comment());
        return new UrgentResult(created.requestId(), created.offered(), 0, in.headcount());
    }

    /**
     * Acceptances arrive from the worker app. On the presentation stand (demo profile) one more
     * person also accepts every three seconds of wall-clock time, so the progress screen moves
     * without phones in the room.
     */
    @Transactional(readOnly = true)
    public UrgentResult urgentStatus(UUID id) {
        users.require("shift.urgent.create");
        record Row(UUID id, int offeredTo, int accepted, int headcount, long ageSeconds) {}
        Row r = jdbc.sql("select id, offered_to, accepted, headcount, extract(epoch from clock_timestamp() - created_at)::bigint as age_seconds from urgent_request where id = ?")
                .param(id).query(Row.class).optional().orElseThrow(ApiException::notFound);
        int accepted = simulateAcceptance ? Math.max(r.accepted(), (int) Math.min(Math.min(r.headcount(), r.offeredTo()), r.ageSeconds() / 3)) : r.accepted();
        return new UrgentResult(r.id(), r.offeredTo(), accepted, r.headcount());
    }

    /* ----------------------------------------------------------------- notifications */

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Notification(UUID id, String kind, Map<String, String> title, OffsetDateTime at, boolean read, String href) {}

    @Transactional(readOnly = true)
    public List<Notification> notifications() {
        CurrentUser u = users.current();
        return jdbc.sql("select id, kind, title::text as title, at, read, href from notification where user_id = ? order by at desc limit 50")
                .param(u.id())
                .query((rs, i) -> new Notification(rs.getObject("id", UUID.class), rs.getString("kind"), Json.text(rs.getString("title")), rs.getObject("at", OffsetDateTime.class),
                        rs.getBoolean("read"), rs.getString("href")))
                .list();
    }

    @Transactional
    public void markAllRead() {
        jdbc.sql("update notification set read = true where user_id = ? and not read").param(users.current().id()).update();
    }

    /* ----------------------------------------------------------- search and counters */

    public record Hit(UUID id, String label, String sub) {}

    public record SearchResults(List<Hit> workers, List<Hit> sites, List<Hit> clients, List<Hit> contracts) {}

    /** Global search (8.4): name, number or phone of a worker; site; client by name or NIP; contract. */
    @Transactional(readOnly = true)
    public SearchResults search(String q) {
        users.current();
        String s = q == null ? "" : q.trim().toLowerCase();
        if (s.length() < 2) return new SearchResults(List.of(), List.of(), List.of(), List.of());
        CurrentUser u = users.current();
        Map<UUID, Client> clients = org.clients().stream().collect(Collectors.toMap(Client::id, Function.identity()));
        List<Hit> workers = u.can("worker.read") || u.can("shift.schedule.read")
                ? workforce.search(s, 5).stream().map(w -> new Hit(w.id(), w.firstName() + " " + w.lastName(), w.number())).toList()
                : List.of();
        List<Hit> sites = dashboard.visibleSites(new DashboardService.Filter(null, null)).stream()
                .filter(x -> x.name().toLowerCase().contains(s) || x.city().toLowerCase().contains(s))
                .limit(5).map(x -> new Hit(x.id(), x.name(), clients.get(x.clientId()).shortName())).toList();
        List<Hit> clientHits = clients.values().stream()
                .filter(c -> c.name().toLowerCase().contains(s) || c.nip().contains(s))
                .sorted(Comparator.comparing(Client::shortName))
                .limit(5).map(c -> new Hit(c.id(), c.name(), "NIP " + c.nip())).toList();
        List<Hit> contracts = u.can("contract.read")
                ? org.contracts().stream()
                        .filter(k -> k.number().toLowerCase().contains(s) || clients.get(k.clientId()).shortName().toLowerCase().contains(s))
                        .limit(5).map((Contract k) -> new Hit(k.id(), k.number(), clients.get(k.clientId()).shortName())).toList()
                : List.of();
        return new SearchResults(workers, sites, clientHits, contracts);
    }

    public record NavCounters(int requestsNew, int docsAttention, int docsExpired) {}

    @Transactional(readOnly = true)
    public NavCounters navCounters() {
        users.current();
        int requestsNew = jdbc.sql("select count(*) from staff_request where status = 'new'").query(Integer.class).single();
        var docs = workforce.documentCounters(LocalDate.now(clock.withZone(ZoneId.of("Europe/Warsaw"))));
        return new NavCounters(requestsNew, docs.attention(), docs.expired());
    }

    public record ClientOption(UUID id, String shortName) {}

    public record FilterOptions(List<String> regions, List<ClientOption> clients) {}

    @Transactional(readOnly = true)
    public FilterOptions filterOptions() {
        var sites = dashboard.visibleSites(new DashboardService.Filter(null, null));
        var clientIds = sites.stream().map(Site::clientId).collect(Collectors.toSet());
        var collator = java.text.Collator.getInstance(java.util.Locale.forLanguageTag("pl"));
        return new FilterOptions(
                sites.stream().map(Site::region).distinct().sorted(collator).toList(),
                org.clients().stream().filter(c -> clientIds.contains(c.id())).map(c -> new ClientOption(c.id(), c.shortName())).toList());
    }
}
