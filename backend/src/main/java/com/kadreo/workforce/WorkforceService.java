package com.kadreo.workforce;

import com.kadreo.workforce.WorkforceModels.Assignment;
import com.kadreo.workforce.WorkforceModels.Document;
import com.kadreo.workforce.WorkforceModels.ShiftPlan;
import com.kadreo.workforce.WorkforceModels.Worker;
import com.kadreo.workforce.WorkforceModels.WorkerBrief;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Public read API of the workforce module: workers, documents, plans and assignments. Other
 * modules (time tracking, operations) use these instead of reading the tables.
 */
@Service
@Transactional(readOnly = true)
public class WorkforceService {

    private final JdbcClient jdbc;

    public WorkforceService(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /* -------------------------------------------------------------------- workers */

    /** All active workers with positions, competences and per-site experience (one query each). */
    public List<Worker> workers() {
        return loadWorkers("w.deleted_at is null and w.status <> 'dismissed'", List.of());
    }

    public List<Worker> workers(Collection<UUID> ids) {
        if (ids.isEmpty()) return List.of();
        return loadWorkers("w.id = any(?)", List.of(ids.toArray(UUID[]::new)));
    }

    public Worker worker(UUID id) {
        return workers(List.of(id)).stream().findFirst().orElseThrow(com.kadreo.platform.web.ApiException::notFound);
    }

    public Map<UUID, WorkerBrief> briefs(Collection<UUID> ids) {
        Map<UUID, WorkerBrief> out = new HashMap<>();
        if (ids.isEmpty()) return out;
        jdbc.sql("select id, first_name, last_name, number from worker where id = any(?)")
                .param(ids.toArray(UUID[]::new))
                .query(WorkerBrief.class)
                .list()
                .forEach(b -> out.put(b.id(), b));
        return out;
    }

    public List<WorkerBrief> search(String q, int limit) {
        String like = "%" + q.toLowerCase().replace("%", "") + "%";
        return jdbc.sql("""
                select id, first_name, last_name, number from worker
                where deleted_at is null and (lower(first_name || ' ' || last_name) like ? or lower(number) like ? or replace(phone, ' ', '') like ?)
                order by last_name, first_name limit ?""")
                .param(like).param(like).param(like.replace(" ", "")).param(limit)
                .query(WorkerBrief.class)
                .list();
    }

    private List<Worker> loadWorkers(String where, List<Object> params) {
        Map<UUID, List<UUID>> positions = new HashMap<>();
        jdbc.sql("select worker_id, position_id from worker_position").query((rs, i) -> {
            positions.computeIfAbsent(rs.getObject(1, UUID.class), k -> new ArrayList<>()).add(rs.getObject(2, UUID.class));
            return null;
        }).list();
        Map<UUID, List<UUID>> competences = new HashMap<>();
        jdbc.sql("select worker_id, competence_id from worker_competence").query((rs, i) -> {
            competences.computeIfAbsent(rs.getObject(1, UUID.class), k -> new ArrayList<>()).add(rs.getObject(2, UUID.class));
            return null;
        }).list();
        Map<UUID, Map<UUID, Integer>> experience = new HashMap<>();
        jdbc.sql("select worker_id, site_id, shifts from worker_site_experience").query((rs, i) -> {
            experience.computeIfAbsent(rs.getObject(1, UUID.class), k -> new HashMap<>()).put(rs.getObject(2, UUID.class), rs.getInt(3));
            return null;
        }).list();
        var spec = jdbc.sql("""
                select w.id, w.number, w.first_name, w.last_name, w.phone, w.citizenship, w.language, w.contract_kind,
                       coalesce(ST_Y(w.home::geometry), 0) as lat, coalesce(ST_X(w.home::geometry), 0) as lng,
                       w.prefers_morning, w.weekly_hour_limit, w.status, w.status_until, w.badge_count, w.rating
                from worker w where """ + where + " order by w.number");
        for (Object p : params) spec = spec.param(p);
        return spec.query((ResultSet rs, int i) -> mapWorker(rs, positions, competences, experience)).list();
    }

    private static Worker mapWorker(ResultSet rs, Map<UUID, List<UUID>> positions, Map<UUID, List<UUID>> competences, Map<UUID, Map<UUID, Integer>> experience) throws SQLException {
        UUID id = rs.getObject("id", UUID.class);
        return new Worker(
                id,
                rs.getString("number"),
                rs.getString("first_name"),
                rs.getString("last_name"),
                rs.getString("phone"),
                rs.getString("citizenship"),
                rs.getString("language"),
                rs.getString("contract_kind"),
                positions.getOrDefault(id, List.of()),
                competences.getOrDefault(id, List.of()),
                rs.getDouble("lat"),
                rs.getDouble("lng"),
                rs.getBoolean("prefers_morning"),
                rs.getInt("weekly_hour_limit"),
                rs.getString("status"),
                rs.getObject("status_until", LocalDate.class),
                rs.getInt("badge_count"),
                rs.getDouble("rating"),
                experience.getOrDefault(id, Map.of()));
    }

    /* ------------------------------------------------------------------ documents */

    public List<Document> documents() {
        return jdbc.sql("select id, worker_id, type, valid_to from worker_document where status = 'accepted'").query(Document.class).list();
    }

    public List<Document> documents(UUID workerId) {
        return jdbc.sql("select id, worker_id, type, valid_to from worker_document where worker_id = ? and status = 'accepted' order by valid_to")
                .param(workerId).query(Document.class).list();
    }

    public record DocumentCounters(int attention, int expired) {}

    /** Documents expiring within 30 days or already expired (menu counter, 8.4). */
    public DocumentCounters documentCounters(LocalDate today) {
        record Row(int attention, int expired) {}
        Row r = jdbc.sql("""
                select count(*) filter (where d.valid_to <= ?) as attention, count(*) filter (where d.valid_to < ?) as expired
                from worker_document d join worker w on w.id = d.worker_id where w.status <> 'dismissed'""")
                .param(today.plusDays(30)).param(today)
                .query(Row.class).single();
        return new DocumentCounters(r.attention(), r.expired());
    }

    /* --------------------------------------------------------- plans, assignments */

    public List<ShiftPlan> plans(Collection<UUID> templateIds, LocalDate from, LocalDate to) {
        if (templateIds.isEmpty()) return List.of();
        return jdbc.sql("select template_id, date, planned, cancelled from shift_plan where template_id = any(?) and date between ? and ?")
                .param(templateIds.toArray(UUID[]::new)).param(from).param(to)
                .query(ShiftPlan.class).list();
    }

    private static final String ASSIGNMENT_SQL = "select id, worker_id, template_id, date, status, source, replaces_id from assignment";

    public List<Assignment> assignments(Collection<UUID> templateIds, LocalDate from, LocalDate to) {
        if (templateIds.isEmpty()) return List.of();
        return jdbc.sql(ASSIGNMENT_SQL + " where template_id = any(?) and date between ? and ?")
                .param(templateIds.toArray(UUID[]::new)).param(from).param(to)
                .query(Assignment.class).list();
    }

    /** Active assignments of any worker in a date window (constraint checks look one day around). */
    public List<Assignment> activeAssignments(LocalDate from, LocalDate to) {
        return jdbc.sql(ASSIGNMENT_SQL + " where date between ? and ? and status in ('proposed', 'confirmed')")
                .param(from).param(to).query(Assignment.class).list();
    }

    public Assignment assignment(UUID id) {
        return jdbc.sql(ASSIGNMENT_SQL + " where id = ?").param(id).query(Assignment.class).optional().orElseThrow(com.kadreo.platform.web.ApiException::notFound);
    }
}
