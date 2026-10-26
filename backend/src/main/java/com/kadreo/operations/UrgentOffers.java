package com.kadreo.operations;

import com.kadreo.organization.OrganizationService;
import com.kadreo.platform.audit.AuditLog;
import com.kadreo.platform.tenant.TenantContext;
import com.kadreo.platform.util.Ids;
import com.kadreo.platform.web.ApiException;
import com.kadreo.workforce.ScheduleService;
import com.kadreo.workforce.WorkforceModels.Assignment;
import com.kadreo.workforce.WorkforceService;
import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Urgent shift offers to individual workers (11.1-06, 14.2 process 1, 14.3-05/08): the request
 * says how many places, the offers go to chosen or best-scored workers, and the first ones to
 * accept get the places. Acceptance locks the request row, so two workers taking the last place
 * at the same time cannot both win: the second gets 409 «taken».
 */
@Service
public class UrgentOffers {

    private final JdbcClient jdbc;
    private final OrganizationService org;
    private final ScheduleService schedule;
    private final WorkforceService workforce;
    private final Notifier notifier;
    private final AuditLog audit;
    private final Clock clock;

    public UrgentOffers(JdbcClient jdbc, OrganizationService org, ScheduleService schedule, WorkforceService workforce, Notifier notifier, AuditLog audit, Clock clock) {
        this.jdbc = jdbc;
        this.org = org;
        this.schedule = schedule;
        this.workforce = workforce;
        this.notifier = notifier;
        this.audit = audit;
        this.clock = clock;
    }

    public record Created(UUID requestId, int offered) {}

    /**
     * Creates the request and its offers. With no {@code workerIds}, offers go to the best-scored
     * eligible workers, up to four per place. The caller checks who may do this.
     */
    @Transactional
    public Created create(UUID templateId, LocalDate date, int headcount, List<UUID> workerIds, int bonusPoints, UUID replacesId, String comment) {
        if (headcount < 1 || headcount > 50) throw ApiException.badRequest("headcount");
        if (bonusPoints < 0 || bonusPoints > 1000) throw ApiException.badRequest("bonusPoints");
        var t = org.template(templateId);
        UUID siteId = org.project(t.projectId()).siteId();
        List<UUID> targets = workerIds == null || workerIds.isEmpty() ? schedule.rankedCandidates(templateId, date, headcount * 4) : List.copyOf(new java.util.LinkedHashSet<>(workerIds));
        UUID requestId = Ids.newId();
        jdbc.sql("""
                insert into urgent_request (id, tenant_id, site_id, template_id, date, headcount, comment, offered_to, created_by, replaces_id, bonus_points)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""")
                .param(requestId).param(TenantContext.requireTenantId()).param(siteId).param(templateId).param(date).param(headcount).param(comment == null ? "" : comment)
                .param(targets.size()).param(TenantContext.userId()).param(replacesId).param(bonusPoints)
                .update();
        for (UUID w : targets) {
            jdbc.sql("insert into urgent_offer (id, tenant_id, request_id, worker_id, status, sent_at) values (?, ?, ?, ?, 'sent', ?)")
                    .param(Ids.newId()).param(TenantContext.requireTenantId()).param(requestId).param(w).param(OffsetDateTime.now(clock))
                    .update();
        }
        String when = date.toString().substring(8) + "." + date.toString().substring(5, 7) + " " + t.label();
        notifier.toWorkers(targets, "approval", Notifier.text("Новое предложение смены: " + when, "Нова пропозиція зміни: " + when, "Nowa propozycja zmiany: " + when, "New shift offer: " + when), "kadreo://clock");
        audit.record("urgent_request", requestId, "create", null, Map.of("templateId", templateId, "date", date, "headcount", headcount, "offers", targets.size()));
        return new Created(requestId, targets.size());
    }

    public record OpenOffer(UUID id, UUID requestId, UUID templateId, LocalDate date, int bonusPoints) {}

    @Transactional(readOnly = true)
    public List<OpenOffer> openOffers(UUID workerId, LocalDate from, LocalDate to) {
        return jdbc.sql("""
                select o.id, o.request_id, r.template_id, r.date, r.bonus_points from urgent_offer o join urgent_request r on r.id = o.request_id
                where o.worker_id = ? and o.status = 'sent' and r.closed_at is null and r.accepted < r.headcount and r.date between ? and ?
                order by r.date""")
                .param(workerId).param(from).param(to)
                .query(OpenOffer.class).list();
    }

    /** Accepts an offer; the place is the worker's only if one is still free. */
    @Transactional
    public Assignment accept(UUID offerId, UUID workerId) {
        record Row(UUID requestId, String status, UUID templateId, LocalDate date, int headcount, int accepted, UUID replacesId, UUID createdBy, OffsetDateTime closedAt) {}
        UUID requestId = jdbc.sql("select request_id from urgent_offer where id = ? and worker_id = ?").param(offerId).param(workerId).query(UUID.class).optional().orElseThrow(ApiException::notFound);
        // Lock the request first: concurrent acceptances of the same request run one after another.
        Row r = jdbc.sql("""
                select r.id as request_id, o.status, r.template_id, r.date, r.headcount, r.accepted, r.replaces_id, r.created_by, r.closed_at
                from urgent_request r join urgent_offer o on o.request_id = r.id and o.id = ?
                where r.id = ? for update of r""")
                .param(offerId).param(requestId).query(Row.class).single();
        if (!"sent".equals(r.status()) || r.closedAt() != null || r.accepted() >= r.headcount()) {
            jdbc.sql("update urgent_offer set status = 'closed', responded_at = ? where id = ? and status = 'sent'").param(OffsetDateTime.now(clock)).param(offerId).update();
            throw new ApiException(HttpStatus.CONFLICT, Map.of("code", "taken"));
        }
        Assignment a = schedule.assignAccepted(workerId, r.templateId(), r.date(), r.replacesId());
        jdbc.sql("update urgent_offer set status = 'accepted', responded_at = ?, assignment_id = ? where id = ?").param(OffsetDateTime.now(clock)).param(a.id()).param(offerId).update();
        int accepted = r.accepted() + 1;
        jdbc.sql("update urgent_request set accepted = ?, closed_at = case when ? >= headcount then ? else closed_at end where id = ?")
                .param(accepted).param(accepted).param(OffsetDateTime.now(clock)).param(requestId).update();
        if (accepted >= r.headcount()) {
            // The others get «Смена уже занята».
            List<UUID> others = jdbc.sql("update urgent_offer set status = 'closed', responded_at = ? where request_id = ? and status = 'sent' returning worker_id")
                    .param(OffsetDateTime.now(clock)).param(requestId).query(UUID.class).list();
            notifier.toWorkers(others, "approval", Notifier.text("Смена уже занята", "Зміну вже зайнято", "Zmiana jest już zajęta", "The shift is already taken"), null);
        }
        String name = workforce.worker(workerId).fullName();
        notifier.toUser(r.createdBy(), "approval", Notifier.text("Срочная смена: " + name + " принял(а)", "Термінова зміна: " + name + " прийняв(ла)", "Pilna zmiana: " + name + " przyjął(ęła)",
                "Urgent shift: " + name + " accepted"), null);
        audit.record("urgent_offer", offerId, "accept", null, Map.of("assignmentId", a.id()));
        return a;
    }

    @Transactional
    public void decline(UUID offerId, UUID workerId) {
        int n = jdbc.sql("update urgent_offer set status = 'declined', responded_at = ? where id = ? and worker_id = ? and status = 'sent'")
                .param(OffsetDateTime.now(clock)).param(offerId).param(workerId).update();
        if (n == 0) throw ApiException.notFound();
        audit.record("urgent_offer", offerId, "decline", null, null);
    }

    /** No-shows (assignment ids) with an open replacement request. */
    @Transactional(readOnly = true)
    public Set<UUID> searching(Collection<UUID> assignmentIds) {
        if (assignmentIds.isEmpty()) return Set.of();
        return new HashSet<>(jdbc.sql("select replaces_id from urgent_request where replaces_id = any(?) and closed_at is null and accepted < headcount")
                .param(assignmentIds.toArray(UUID[]::new)).query(UUID.class).list());
    }

    /** Real acceptances of a request (back-office progress screen). */
    @Transactional(readOnly = true)
    public int accepted(UUID requestId) {
        return jdbc.sql("select accepted from urgent_request where id = ?").param(requestId).query(Integer.class).optional().orElse(0);
    }
}
