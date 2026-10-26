package com.kadreo.portal;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;
import com.kadreo.operations.DashboardService;
import com.kadreo.operations.StaffRequestService;
import com.kadreo.operations.StaffRequestService.NewRequest;
import com.kadreo.operations.StaffRequestService.StaffRequest;
import com.kadreo.organization.OrganizationModels.Client;
import com.kadreo.organization.OrganizationModels.Contract;
import com.kadreo.organization.OrganizationModels.Dictionaries;
import com.kadreo.organization.OrganizationModels.Project;
import com.kadreo.organization.OrganizationModels.RateCard;
import com.kadreo.organization.OrganizationModels.ShiftTemplate;
import com.kadreo.organization.OrganizationModels.Site;
import com.kadreo.organization.OrganizationService;
import com.kadreo.platform.security.CurrentUser;
import com.kadreo.platform.security.CurrentUserService;
import com.kadreo.platform.web.ApiException;
import com.kadreo.timetracking.ClientTimesheets;
import com.kadreo.timetracking.ClientTimesheets.Header;
import com.kadreo.timetracking.ClientTimesheets.Totals;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Overview, sites and staff requests of the client portal (12, 12.1). */
@Service
public class PortalService {

    static final ZoneId TENANT_ZONE = ZoneId.of("Europe/Warsaw");

    private final OrganizationService org;
    private final StaffRequestService requests;
    private final DashboardService dashboard;
    private final ClientTimesheets timesheets;
    private final CurrentUserService users;
    private final JdbcClient jdbc;
    private final Clock clock;

    public PortalService(OrganizationService org, StaffRequestService requests, DashboardService dashboard, ClientTimesheets timesheets, CurrentUserService users,
            JdbcClient jdbc, Clock clock) {
        this.org = org;
        this.requests = requests;
        this.dashboard = dashboard;
        this.timesheets = timesheets;
        this.users = users;
        this.jdbc = jdbc;
        this.clock = clock;
    }

    /* ---------------------------------------------------------------------- client scope */

    /** The signed-in client user with the permission; anyone else gets 403. */
    CurrentUser require(String permission) {
        CurrentUser u = users.require(permission);
        if (!u.isClientUser()) throw ApiException.forbidden("portal.read");
        return u;
    }

    /** Sites of the user's client; a CLIENT_MANAGER may be limited to some of them (12.1 «своей области»). */
    List<Site> sites(CurrentUser u) {
        return org.sites().stream()
                .filter(s -> s.clientId().equals(u.clientId()))
                .filter(s -> u.scope().siteIds().isEmpty() || u.scope().siteIds().contains(s.id()))
                .toList();
    }

    Site site(CurrentUser u, UUID siteId) {
        return sites(u).stream().filter(s -> s.id().equals(siteId)).findFirst().orElseThrow(ApiException::notFound);
    }

    LocalDate today() {
        return LocalDate.now(clock.withZone(TENANT_ZONE));
    }

    /* ----------------------------------------------------------------------------- me */

    public record PortalClient(UUID id, String name, String shortName) {}

    public record PortalUser(UUID id, String fullName, String initials, String email, String locale, String role, Set<String> permissions, PortalClient client) {}

    @Transactional(readOnly = true)
    public PortalUser me() {
        CurrentUser u = require("portal.read");
        Client c = org.client(u.clientId());
        return new PortalUser(u.id(), u.fullName(), u.initials(), u.email(), u.locale(), u.activeRole(), u.permissions(), new PortalClient(c.id(), c.name(), c.shortName()));
    }

    @Transactional(readOnly = true)
    public Dictionaries dictionaries() {
        require("portal.read");
        return org.dictionaries();
    }

    /* -------------------------------------------------------------------------- sites */

    public record PortalSite(UUID id, String name, String city, String address, String contractNumber, LocalDate contractTo, String currency) {}

    private PortalSite portalSite(Site s, Contract k) {
        return new PortalSite(s.id(), s.name(), s.city(), s.address(), k.number(), k.validTo(), k.currency());
    }

    private Contract contractOf(Site s) {
        return org.contract(org.projectOfSite(s.id()).contractId());
    }

    @Transactional(readOnly = true)
    public List<PortalSite> sites() {
        CurrentUser u = require("portal.read");
        return sites(u).stream().map(s -> portalSite(s, contractOf(s))).toList();
    }

    public record PositionOption(UUID id, String rate) {}

    public record TemplateOption(UUID id, UUID positionId, String start, String end, double hours) {}

    public record Contact(UUID id, String name) {}

    public record SiteOptions(PortalSite site, List<PositionOption> positions, List<TemplateOption> templates, List<UUID> competenceIds, List<Contact> contacts,
            LocalDate earliestStart, int slaResponseHours, boolean showRates) {}

    private static int intOf(JsonNode n, String field, int fallback) {
        return n != null && n.has(field) ? n.get(field).asInt() : fallback;
    }

    private LocalDate earliestStart(Contract k) {
        return OffsetDateTime.now(clock).plusHours(intOf(k.sla(), "minLeadHours", 24)).atZoneSameInstant(TENANT_ZONE).toLocalDate();
    }

    /** Positions with a rate in the site's contract, shifts, requirements, contacts (12.1-02…08). */
    @Transactional(readOnly = true)
    public SiteOptions siteOptions(UUID siteId) {
        CurrentUser u = require("portal.read");
        Site s = site(u, siteId);
        Contract k = contractOf(s);
        Project p = org.projectOfSite(s.id());
        List<ShiftTemplate> tpls = org.templates(p.id());
        // In the order of the site's shift lines, so the main position comes first.
        List<PositionOption> positions = k.rates().stream()
                .filter(r -> tpls.stream().anyMatch(t -> t.positionId().equals(r.positionId())))
                .sorted(Comparator.comparingInt((RateCard r) -> tpls.stream().filter(t -> t.positionId().equals(r.positionId())).mapToInt(ShiftTemplate::sortOrder).min().orElse(99)))
                .map(r -> new PositionOption(r.positionId(), k.showRatesInPortal() ? money(r.current()) : null))
                .toList();
        List<Contact> contacts = jdbc.sql("select id, full_name as name from app_user where client_id = ? and status = 'active' order by full_name")
                .param(s.clientId()).query(Contact.class).list();
        return new SiteOptions(portalSite(s, k), positions,
                tpls.stream().map(t -> new TemplateOption(t.id(), t.positionId(), t.start().toString(), t.end().toString(), t.hours())).toList(),
                org.competences().stream().map(c -> c.id()).toList(), contacts, earliestStart(k), intOf(k.sla(), "responseHours", 24), k.showRatesInPortal());
    }

    private static String money(BigDecimal v) {
        return v == null ? null : v.setScale(2, RoundingMode.HALF_UP).toPlainString();
    }

    /* ----------------------------------------------------------------------- requests */

    public record RequestInput(UUID siteId, UUID positionId, Integer headcount, LocalDate from, LocalDate to, List<UUID> templateIds, List<UUID> competenceIds,
            Boolean experiencedOnly, String contactName, String clientRef, String comment, Boolean draft) {

        boolean isDraft() {
            return Boolean.TRUE.equals(draft);
        }

        List<UUID> templates() {
            return templateIds == null ? List.of() : templateIds;
        }
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Estimate(int days, int personShifts, double plannedHours, String rate, String amount, String currency, int slaResponseHours) {}

    static int workingDays(LocalDate from, LocalDate to) {
        int n = 0;
        if (from == null || to == null || to.isBefore(from)) return 0;
        for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) if (d.getDayOfWeek() != DayOfWeek.SUNDAY) n++;
        return n;
    }

    /** «Итог заявки» (12.1-11…15): person-shifts, planned hours, indicative amount without allowances and VAT. */
    @Transactional(readOnly = true)
    public Estimate estimate(RequestInput in) {
        CurrentUser u = require("portal.read");
        Site s = site(u, in.siteId());
        Contract k = contractOf(s);
        Map<UUID, ShiftTemplate> tpls = org.templates(org.projectOfSite(s.id()).id()).stream().collect(Collectors.toMap(ShiftTemplate::id, Function.identity()));
        List<ShiftTemplate> chosen = in.templates().stream().map(tpls::get).filter(t -> t != null).toList();
        int days = workingDays(in.from(), in.to());
        int hc = in.headcount() == null ? 0 : Math.max(0, in.headcount());
        double hours = chosen.stream().mapToDouble(t -> hc * days * t.hours()).sum();
        BigDecimal rate = k.rates().stream().filter(r -> r.positionId().equals(in.positionId())).map(RateCard::current).findFirst().orElse(null);
        String shown = k.showRatesInPortal() && rate != null ? money(rate) : null;
        String amount = shown == null ? null : money(rate.multiply(BigDecimal.valueOf(hours)));
        return new Estimate(days, hc * days * chosen.size(), hours, shown, amount, k.currency(), intOf(k.sla(), "responseHours", 24));
    }

    /** Checks for «Отправить заявку» (12.1-01…06); «Сохранить черновик» only needs the site. */
    private NewRequest validated(CurrentUser u, RequestInput in) {
        Site s = site(u, in.siteId());
        boolean draft = in.isDraft();
        List<UUID> templates = in.templates();
        List<UUID> competences = in.competenceIds() == null ? List.of() : in.competenceIds();
        if (!draft) {
            Contract k = contractOf(s);
            if (in.positionId() == null || k.rates().stream().noneMatch(r -> r.positionId().equals(in.positionId()))) throw ApiException.badRequest("positionId");
            if (in.headcount() == null || in.headcount() < 1 || in.headcount() > 500) throw ApiException.badRequest("headcount");
            if (in.from() == null || in.from().isBefore(earliestStart(k))) throw ApiException.badRequest("from");
            if (in.to() == null || in.to().isBefore(in.from()) || (k.validTo() != null && in.to().isAfter(k.validTo()))) throw ApiException.badRequest("to");
            Set<UUID> own = org.templates(org.projectOfSite(s.id()).id()).stream().filter(t -> t.positionId().equals(in.positionId())).map(ShiftTemplate::id)
                    .collect(Collectors.toSet());
            if (templates.isEmpty() || !own.containsAll(templates)) throw ApiException.badRequest("templateIds");
            Set<UUID> known = org.competences().stream().map(c -> c.id()).collect(Collectors.toSet());
            if (!known.containsAll(competences)) throw ApiException.badRequest("competenceIds");
            if (in.contactName() == null || in.contactName().isBlank()) throw ApiException.badRequest("contactName");
        }
        if (in.clientRef() != null && in.clientRef().length() > 50) throw ApiException.badRequest("clientRef");
        if (in.comment() != null && in.comment().length() > 1000) throw ApiException.badRequest("comment");
        LocalDate from = in.from() == null ? today() : in.from();
        return new NewRequest(s.id(), in.positionId(), in.headcount() == null ? 1 : in.headcount(), from, in.to() == null ? from : in.to(), templates, competences,
                Boolean.TRUE.equals(in.experiencedOnly()), in.contactName(), in.clientRef(), in.comment(), draft);
    }

    private OffsetDateTime slaDue(UUID siteId) {
        return OffsetDateTime.now(clock).plusHours(intOf(contractOf(org.site(siteId)).sla(), "responseHours", 24));
    }

    @Transactional
    public StaffRequest create(RequestInput in) {
        CurrentUser u = require("staffrequest.create");
        NewRequest r = validated(u, in);
        if (r.positionId() == null) throw ApiException.badRequest("positionId");
        return requests.create(r, slaDue(r.siteId()), u);
    }

    @Transactional
    public StaffRequest updateDraft(UUID id, RequestInput in) {
        CurrentUser u = require("staffrequest.create");
        ownRequest(u, id);
        NewRequest r = validated(u, in);
        if (r.positionId() == null) throw ApiException.badRequest("positionId");
        return requests.updateDraft(id, r, slaDue(r.siteId()), u);
    }

    @Transactional(readOnly = true)
    public List<StaffRequest> requests() {
        CurrentUser u = require("portal.read");
        return requests.viewsOf(sites(u).stream().map(Site::id).toList());
    }

    public record TemplateBrief(UUID id, UUID positionId, String start, String end) {}

    public record RequestDetail(StaffRequest request, PortalSite site, List<TemplateBrief> templates, List<StaffRequestService.Cell> cells) {}

    private StaffRequestService.RequestWithCells ownRequest(CurrentUser u, UUID id) {
        var r = requests.find(id).orElseThrow(ApiException::notFound);
        site(u, r.request().siteId());
        return r;
    }

    @Transactional(readOnly = true)
    public RequestDetail request(UUID id) {
        CurrentUser u = require("portal.read");
        var r = ownRequest(u, id);
        Site s = org.site(r.request().siteId());
        List<TemplateBrief> tpls = org.templates(org.projectOfSite(s.id()).id()).stream()
                .map(t -> new TemplateBrief(t.id(), t.positionId(), t.start().toString(), t.end().toString())).toList();
        return new RequestDetail(r.request(), portalSite(s, contractOf(s)), tpls, r.cells());
    }

    /* ------------------------------------------------------------------------ overview */

    public record SiteNow(UUID siteId, String siteName, String shiftLabel, int actual, int planned, String status) {}

    public record Kpi(LocalDate from, LocalDate to, double staffingPct, double staffingTarget, double disputedPct, double disputedTarget) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Overview(int onShiftNow, int plannedNow, List<SiteNow> sites, int requestsNew, int requestsInProgress, int timesheetsToConfirm, OffsetDateTime nearestDeadline,
            Kpi kpi) {}

    @Transactional(readOnly = true)
    public Overview overview() {
        CurrentUser u = require("portal.read");
        List<Site> own = sites(u);
        List<SiteNow> live = dashboard.liveFor(own).stream()
                .map(l -> new SiteNow(l.siteId(), l.siteName(), l.shiftLabel(), l.actual(), l.planned(), l.status())).toList();
        List<StaffRequest> reqs = requests.viewsOf(own.stream().map(Site::id).toList());
        List<Header> sheets = timesheets.containing(own.stream().map(s -> org.projectOfSite(s.id()).id()).toList(), today().minusDays(7));
        List<Header> waiting = sheets.stream().filter(h -> "waiting".equals(h.clientStage())).toList();
        double planned = 0;
        double billable = 0;
        int rows = 0;
        int disputed = 0;
        for (Header h : sheets) {
            Totals t = timesheets.totals(h.id());
            planned += t.plannedHours();
            billable += t.billableHours();
            rows += t.rows();
            disputed += t.disputedRows();
        }
        JsonNode targets = own.isEmpty() ? null : contractOf(own.get(0)).kpiTargets();
        LocalDate from = sheets.stream().map(Header::periodFrom).min(Comparator.naturalOrder()).orElse(today());
        LocalDate to = sheets.stream().map(Header::periodTo).max(Comparator.naturalOrder()).orElse(today());
        Kpi kpi = new Kpi(from, to, planned > 0 ? Math.round(billable / planned * 1000) / 10.0 : 0, targets != null && targets.has("staffingPct") ? targets.get("staffingPct").asDouble() : 0,
                rows > 0 ? Math.round(disputed * 1000.0 / rows) / 10.0 : 0, targets != null && targets.has("disputedPct") ? targets.get("disputedPct").asDouble() : 0);
        return new Overview(
                live.stream().mapToInt(SiteNow::actual).sum(),
                live.stream().mapToInt(SiteNow::planned).sum(),
                new ArrayList<>(live),
                (int) reqs.stream().filter(r -> "new".equals(r.status())).count(),
                (int) reqs.stream().filter(r -> "in_progress".equals(r.status())).count(),
                waiting.size(),
                waiting.stream().map(Header::clientDueAt).filter(d -> d != null).min(Comparator.naturalOrder()).orElse(null),
                kpi);
    }

    /** Project ids of the user's sites (for the timesheet service of this module). */
    Map<UUID, Site> sitesByProject(CurrentUser u) {
        return sites(u).stream().collect(Collectors.toMap(s -> org.projectOfSite(s.id()).id(), Function.identity()));
    }
}
