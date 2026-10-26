package com.kadreo.operations;

import com.kadreo.organization.OrganizationModels.Client;
import com.kadreo.organization.OrganizationModels.Project;
import com.kadreo.organization.OrganizationModels.ShiftTemplate;
import com.kadreo.organization.OrganizationModels.Site;
import com.kadreo.organization.OrganizationService;
import com.kadreo.platform.security.CurrentUser;
import com.kadreo.platform.security.CurrentUserService;
import com.kadreo.timetracking.ClockQueries;
import com.kadreo.workforce.WorkforceModels.Assignment;
import com.kadreo.workforce.WorkforceModels.ShiftPlan;
import com.kadreo.workforce.WorkforceService;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Live numbers of the current shift per site and the dashboard summary (spec 11.1). */
@Service
@Transactional(readOnly = true)
public class DashboardService {

    private final OrganizationService org;
    private final WorkforceService workforce;
    private final ClockQueries clocks;
    private final CurrentUserService users;
    private final JdbcClient jdbc;
    private final Clock clock;

    public DashboardService(OrganizationService org, WorkforceService workforce, ClockQueries clocks, CurrentUserService users, JdbcClient jdbc, Clock clock) {
        this.org = org;
        this.workforce = workforce;
        this.clocks = clocks;
        this.users = users;
        this.jdbc = jdbc;
        this.clock = clock;
    }

    public record Filter(List<String> regions, List<UUID> clientIds) {
        boolean matches(Site s) {
            return (regions == null || regions.isEmpty() || regions.contains(s.region())) && (clientIds == null || clientIds.isEmpty() || clientIds.contains(s.clientId()));
        }
    }

    public record SiteLive(UUID siteId, UUID projectId, String siteName, String clientName, String shiftLabel, int actual, int planned, int late, int noShows, int noShowsReplaced,
            String teamLeaderName, String status, double lat, double lng, String region, String country) {}

    public record Summary(int onShiftNow, int plannedNow, int lateToday, int lateSameDayLastWeek, int noShows, int noShowsReplaced, int openAlerts, int criticalAlerts,
            int staffRequestsOpen, OffsetDateTime nearestSlaDueAt, OffsetDateTime updatedAt) {}

    record OpenAlert(UUID siteId, String severity) {}

    private List<OpenAlert> openAlerts() {
        return jdbc.sql("select site_id, severity from alert where status <> 'closed'").query(OpenAlert.class).list();
    }

    /** Sites the user may see (scope, 3.2) that match the filter. */
    List<Site> visibleSites(Filter f) {
        CurrentUser u = users.current();
        return org.sites().stream()
                .filter(s -> u.scope().wholeTenant() || u.scope().siteIds().contains(s.id()) || u.scope().regions().contains(s.region()))
                .filter(f::matches)
                .toList();
    }

    public List<SiteLive> sites(Filter f) {
        users.require("dashboard.read");
        return live(visibleSites(f));
    }

    private List<SiteLive> live(List<Site> sites) {
        Map<UUID, Client> clients = org.clients().stream().collect(Collectors.toMap(Client::id, Function.identity()));
        Map<UUID, Project> projectBySite = org.projects().stream().collect(Collectors.toMap(Project::siteId, Function.identity(), (a, b) -> a));
        Map<UUID, List<ShiftTemplate>> templates = org.allTemplates().stream().collect(Collectors.groupingBy(ShiftTemplate::projectId));
        List<OpenAlert> alerts = openAlerts();

        // Templates running now, per site, in the site's own time zone.
        Map<UUID, List<ShiftTemplate>> current = new java.util.HashMap<>();
        Map<UUID, LocalDate> today = new java.util.HashMap<>();
        Map<UUID, Integer> nowMin = new java.util.HashMap<>();
        for (Site s : sites) {
            Project p = projectBySite.get(s.id());
            ZonedDateTime local = ZonedDateTime.now(clock).withZoneSameInstant(ZoneId.of(s.timeZone()));
            int minute = local.getHour() * 60 + local.getMinute();
            today.put(s.id(), local.toLocalDate());
            nowMin.put(s.id(), minute);
            current.put(s.id(), p == null ? List.of() : templates.getOrDefault(p.id(), List.of()).stream().filter(t -> running(t, minute)).toList());
        }
        List<UUID> ids = current.values().stream().flatMap(List::stream).map(ShiftTemplate::id).toList();
        LocalDate minDay = today.values().stream().min(Comparator.naturalOrder()).orElse(LocalDate.now(clock));
        LocalDate maxDay = today.values().stream().max(Comparator.naturalOrder()).orElse(minDay);
        Map<String, ShiftPlan> plans = workforce.plans(ids, minDay, maxDay).stream().collect(Collectors.toMap(p -> p.templateId() + "|" + p.date(), Function.identity()));
        List<Assignment> assignments = workforce.assignments(ids, minDay, maxDay).stream().filter(Assignment::active).toList();
        Map<UUID, OffsetDateTime> clockIns = clocks.firstClockIns(assignments.stream().map(Assignment::id).toList());

        List<SiteLive> out = new ArrayList<>();
        for (Site s : sites) {
            List<ShiftTemplate> cur = current.get(s.id());
            LocalDate day = today.get(s.id());
            int minute = nowMin.get(s.id());
            Set<UUID> curIds = cur.stream().map(ShiftTemplate::id).collect(Collectors.toSet());
            int planned = cur.stream().map(t -> plans.get(t.id() + "|" + day)).filter(Objects::nonNull).filter(p -> !p.cancelled()).mapToInt(ShiftPlan::planned).sum();
            List<Assignment> todays = assignments.stream().filter(a -> a.date().equals(day) && curIds.contains(a.templateId())).toList();
            Set<UUID> replaced = todays.stream().map(Assignment::replacesId).filter(Objects::nonNull).collect(Collectors.toSet());
            int actual = 0, late = 0, noShows = 0, noShowsReplaced = 0;
            for (Assignment a : todays) {
                ShiftTemplate t = cur.stream().filter(x -> x.id().equals(a.templateId())).findFirst().orElseThrow();
                OffsetDateTime in = clockIns.get(a.id());
                int start = t.start().getHour() * 60 + t.start().getMinute();
                if (in != null) {
                    actual++;
                    LocalTime inLocal = in.atZoneSameInstant(ZoneId.of(s.timeZone())).toLocalTime();
                    if (a.replacesId() == null && inLocal.getHour() * 60 + inLocal.getMinute() > start + s.lateThresholdMin()) late++;
                } else if (minute > start + 30) {
                    noShows++;
                    if (replaced.contains(a.id())) noShowsReplaced++;
                }
            }
            List<String> labels = cur.stream().map(ShiftTemplate::label).distinct().toList();
            String label = labels.isEmpty() ? "—" : labels.size() > 1 ? labels.get(0) + " +" + (labels.size() - 1) : labels.get(0);
            int shortage = Math.max(0, planned - actual);
            List<OpenAlert> siteAlerts = alerts.stream().filter(a -> a.siteId().equals(s.id())).toList();
            String status = "ok";
            if ((planned > 0 && shortage / (double) planned > 0.2) || siteAlerts.stream().anyMatch(a -> "critical".equals(a.severity()))) status = "critical";
            else if (shortage >= 1 || late > 5 || siteAlerts.stream().anyMatch(a -> "warning".equals(a.severity()))) status = "deviation";
            Project p = projectBySite.get(s.id());
            out.add(new SiteLive(s.id(), p == null ? null : p.id(), s.name(), clients.get(s.clientId()).shortName(), label, actual, planned, late, noShows, noShowsReplaced,
                    Objects.requireNonNullElse(s.teamLeaderName(), "—"), status, s.lat(), s.lng(), s.region(), s.country()));
        }
        return out;
    }

    /** Running now: start ≤ now &lt; end on today's calendar (shifts crossing midnight end at 24:00). */
    private static boolean running(ShiftTemplate t, int minute) {
        int start = t.start().getHour() * 60 + t.start().getMinute();
        int end = t.end().getHour() * 60 + t.end().getMinute();
        if (end <= start) end += 1440;
        return start <= minute && minute < end;
    }

    public Summary summary(Filter f) {
        users.require("dashboard.read");
        List<Site> sites = visibleSites(f);
        List<SiteLive> live = live(sites);
        Set<UUID> siteIds = sites.stream().map(Site::id).collect(Collectors.toSet());
        List<OpenAlert> open = openAlerts().stream().filter(a -> siteIds.contains(a.siteId())).toList();
        record Req(UUID siteId, OffsetDateTime slaDueAt) {}
        List<Req> requests = jdbc.sql("select site_id, sla_due_at from staff_request where status in ('new', 'in_progress')").query(Req.class).list().stream()
                .filter(r -> siteIds.contains(r.siteId())).toList();
        int late = live.stream().mapToInt(SiteLive::late).sum();
        return new Summary(
                live.stream().mapToInt(SiteLive::actual).sum(),
                live.stream().mapToInt(SiteLive::planned).sum(),
                late,
                lateSameTimeLastWeek(siteIds),
                live.stream().mapToInt(SiteLive::noShows).sum(),
                live.stream().mapToInt(SiteLive::noShowsReplaced).sum(),
                open.size(),
                (int) open.stream().filter(a -> "critical".equals(a.severity())).count(),
                requests.size(),
                requests.stream().map(Req::slaDueAt).min(Comparator.naturalOrder()).orElse(null),
                OffsetDateTime.now(clock));
    }

    /** Late clock-ins on the same weekday a week ago, for shifts that had started by this time of day. */
    private int lateSameTimeLastWeek(Set<UUID> siteIds) {
        LocalDate day = LocalDate.now(clock.withZone(ZoneId.of("Europe/Warsaw"))).minusDays(7);
        return clocks.lateClockIns(siteIds, day, OffsetDateTime.now(clock).minusDays(7));
    }
}
