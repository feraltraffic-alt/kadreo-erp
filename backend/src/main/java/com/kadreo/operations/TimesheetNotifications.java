package com.kadreo.operations;

import com.kadreo.organization.OrganizationService;
import com.kadreo.platform.tenant.TenantContext;
import com.kadreo.platform.util.Ids;
import com.kadreo.platform.util.Json;
import com.kadreo.timetracking.TimesheetAutoAccept.TimesheetAutoAccepted;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.modulith.events.ApplicationModuleListener;
import org.springframework.stereotype.Component;

/** In-app notifications about timesheets (8.4 bell). */
@Component
class TimesheetNotifications {

    private static final DateTimeFormatter DM = DateTimeFormatter.ofPattern("dd.MM");

    private final JdbcClient jdbc;
    private final OrganizationService org;
    private final Clock clock;

    TimesheetNotifications(JdbcClient jdbc, OrganizationService org, Clock clock) {
        this.jdbc = jdbc;
        this.org = org;
        this.clock = clock;
    }

    /** Tells the manager who sent the timesheet that the client's deadline passed and it was accepted. */
    @ApplicationModuleListener
    void on(TimesheetAutoAccepted e) {
        if (e.sentBy() == null) return;
        TenantContext.runAs(e.tenantId(), null, () -> {
            String site = org.site(org.project(e.projectId()).siteId()).name();
            String period = e.from().format(DM) + "–" + e.to().format(DM);
            Map<String, String> title = Map.of(
                    "pl", "Tabela " + site + " " + period + " przyjęta automatycznie",
                    "uk", "Табель " + site + " " + period + " прийнято автоматично",
                    "ru", "Табель " + site + " " + period + " принят автоматически",
                    "en", "Timesheet " + site + " " + period + " accepted automatically");
            String href = "/timesheets/projects/" + e.projectId() + "?from=" + e.from() + "&to=" + e.to();
            jdbc.sql("insert into notification (id, tenant_id, user_id, kind, title, href, at, read) values (?, ?, ?, 'alert', ?::jsonb, ?, ?, false)")
                    .param(Ids.newId()).param(e.tenantId()).param(e.sentBy()).param(Json.write(title)).param(href).param(OffsetDateTime.now(clock))
                    .update();
        });
    }
}
