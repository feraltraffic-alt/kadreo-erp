package com.kadreo.operations;

import com.kadreo.organization.OrganizationService;
import com.kadreo.platform.tenant.TenantContext;
import com.kadreo.platform.util.Ids;
import com.kadreo.platform.util.Json;
import com.kadreo.timetracking.ClientTimesheets.TimesheetDisputed;
import com.kadreo.timetracking.TimesheetAutoAccept.TimesheetAutoAccepted;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Async;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.stereotype.Component;

/** In-app notifications about timesheets (8.4 bell). */
@Component
class TimesheetNotifications {

    private static final DateTimeFormatter DM = DateTimeFormatter.ofPattern("dd.MM");

    private final JdbcClient jdbc;
    private final OrganizationService org;
    private final Clock clock;
    private final TransactionTemplate tx;

    TimesheetNotifications(JdbcClient jdbc, OrganizationService org, Clock clock, TransactionTemplate tx) {
        this.jdbc = jdbc;
        this.org = org;
        this.clock = clock;
        this.tx = tx;
    }

    /** Tells the manager who sent the timesheet that the client's deadline passed and it was accepted. */
    // Not @ApplicationModuleListener: its transaction would open before the tenant is set, and the
    // connection would carry no tenant. The transaction starts inside the tenant context instead.
    @Async
    @TransactionalEventListener
    void on(TimesheetAutoAccepted e) {
        if (e.sentBy() == null) return;
        TenantContext.runAs(e.tenantId(), null, () -> tx.executeWithoutResult(status -> {
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
        }));
    }

    /** The client disputed days (12.2-14): the manager who sent the timesheet gets a notification. */
    @Async
    @TransactionalEventListener
    void on(TimesheetDisputed e) {
        if (e.sentBy() == null) return;
        TenantContext.runAs(e.tenantId(), null, () -> tx.executeWithoutResult(status -> {
            String site = org.site(org.project(e.projectId()).siteId()).name();
            String period = e.from().format(DM) + "–" + e.to().format(DM);
            Map<String, String> title = Map.of(
                    "pl", "Klient zakwestionował ewidencję " + site + " " + period + ": " + e.rows() + " wiersz(e)",
                    "uk", "Клієнт оскаржив табель " + site + " " + period + ": рядків " + e.rows(),
                    "ru", "Клиент оспорил табель " + site + " " + period + ": строк " + e.rows(),
                    "en", "Client disputed timesheet " + site + " " + period + ": " + e.rows() + " row(s)");
            jdbc.sql("insert into notification (id, tenant_id, user_id, kind, title, href, at, read) values (?, ?, ?, 'alert', ?::jsonb, ?, ?, false)")
                    .param(Ids.newId()).param(e.tenantId()).param(e.sentBy()).param(Json.write(title)).param("/timesheets/disputes").param(OffsetDateTime.now(clock))
                    .update();
        }));
    }
}
