package com.kadreo.organization;

import com.kadreo.organization.OrganizationModels.Client;
import com.kadreo.organization.OrganizationModels.Competence;
import com.kadreo.organization.OrganizationModels.Contract;
import com.kadreo.organization.OrganizationModels.Dictionaries;
import com.kadreo.organization.OrganizationModels.Position;
import com.kadreo.organization.OrganizationModels.Project;
import com.kadreo.organization.OrganizationModels.RateCard;
import com.kadreo.organization.OrganizationModels.Reason;
import com.kadreo.organization.OrganizationModels.ShiftTemplate;
import com.kadreo.organization.OrganizationModels.Site;
import com.kadreo.platform.util.Json;
import com.kadreo.platform.web.ApiException;
import java.math.BigDecimal;
import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalTime;
import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Public read API of the organization module. Other modules use it instead of querying these
 * tables directly (spec 5.1 p. 1). Every query runs under the tenant's row-level security.
 */
@Service
@Transactional(readOnly = true)
public class OrganizationService {

    private final JdbcClient jdbc;

    public OrganizationService(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /* ---------------------------------------------------------------------- sites */

    private static final String SITE_SQL = """
            select id, name, city, address, country, region, time_zone, client_id,
                   ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng,
                   manager_name, clock_methods, access_control::text as access_control,
                   late_threshold_min, clock_window_min, outside_geofence, team_leader_name
            from site where deleted_at is null""";

    private static Site site(ResultSet rs, int i) throws SQLException {
        Array methods = rs.getArray("clock_methods");
        return new Site(
                rs.getObject("id", UUID.class),
                rs.getString("name"),
                rs.getString("city"),
                rs.getString("address"),
                rs.getString("country"),
                rs.getString("region"),
                rs.getString("time_zone"),
                rs.getObject("client_id", UUID.class),
                rs.getDouble("lat"),
                rs.getDouble("lng"),
                rs.getString("manager_name"),
                Arrays.asList((String[]) methods.getArray()),
                Json.node(rs.getString("access_control")),
                rs.getInt("late_threshold_min"),
                rs.getInt("clock_window_min"),
                rs.getString("outside_geofence"),
                rs.getString("team_leader_name"));
    }

    public List<Site> sites() {
        return jdbc.sql(SITE_SQL + " order by name").query(OrganizationService::site).list();
    }

    public Site site(UUID id) {
        return jdbc.sql(SITE_SQL + " and id = ?").param(id).query(OrganizationService::site).optional().orElseThrow(ApiException::notFound);
    }

    /* -------------------------------------------------------------------- clients */

    public List<Client> clients() {
        return jdbc.sql("select id, name, short_name, nip, country, manager_user_id from client where deleted_at is null order by short_name").query(Client.class).list();
    }

    public Client client(UUID id) {
        return jdbc.sql("select id, name, short_name, nip, country, manager_user_id from client where id = ?").param(id).query(Client.class).optional().orElseThrow(ApiException::notFound);
    }

    /* ------------------------------------------------------------------ contracts */

    private static final String CONTRACT_SQL = """
            select id, number, client_id, legal_entity_id, currency, status, version_no, version_from, valid_from, valid_to,
                   timesheet_period, auto_accept_hours, payment_days, show_rates_in_portal, sla::text as sla, kpi_targets::text as kpi
            from contract""";

    private Contract contract(ResultSet rs, Map<UUID, List<RateCard>> rates) throws SQLException {
        UUID id = rs.getObject("id", UUID.class);
        return new Contract(
                id,
                rs.getString("number"),
                rs.getObject("client_id", UUID.class),
                rs.getObject("legal_entity_id", UUID.class),
                rs.getString("currency"),
                rs.getString("status"),
                rs.getInt("version_no"),
                rs.getObject("version_from", java.time.LocalDate.class),
                rs.getObject("valid_from", java.time.LocalDate.class),
                rs.getObject("valid_to", java.time.LocalDate.class),
                rs.getString("timesheet_period"),
                rs.getInt("auto_accept_hours"),
                rs.getInt("payment_days"),
                rs.getBoolean("show_rates_in_portal"),
                rates.getOrDefault(id, List.of()),
                Json.node(rs.getString("sla")),
                Json.node(rs.getString("kpi")));
    }

    private Map<UUID, List<RateCard>> rates() {
        record Row(UUID contractId, UUID positionId, BigDecimal previous, BigDecimal amount) {}
        return jdbc.sql("select contract_id, position_id, previous, amount from rate_card where valid_to is null").query(Row.class).list().stream()
                .collect(Collectors.groupingBy(Row::contractId, Collectors.mapping(r -> new RateCard(r.positionId(), r.previous(), r.amount()), Collectors.toList())));
    }

    public List<Contract> contracts() {
        var rates = rates();
        return jdbc.sql(CONTRACT_SQL + " order by number").query((rs, i) -> contract(rs, rates)).list();
    }

    public Contract contract(UUID id) {
        var rates = rates();
        return jdbc.sql(CONTRACT_SQL + " where id = ?").param(id).query((rs, i) -> contract(rs, rates)).optional().orElseThrow(ApiException::notFound);
    }

    /* ------------------------------------------------------------------- projects */

    private static final String PROJECT_SQL = """
            select p.id, p.site_id, p.contract_id, p.name, p.manager_name,
                   coalesce(array_agg(distinct t.position_id) filter (where t.position_id is not null), '{}') as positions
            from project p left join shift_template t on t.project_id = p.id
            where p.status = 'active'""";

    private static Project project(ResultSet rs, int i) throws SQLException {
        UUID[] positions = (UUID[]) rs.getArray("positions").getArray();
        return new Project(rs.getObject("id", UUID.class), rs.getObject("site_id", UUID.class), rs.getObject("contract_id", UUID.class), rs.getString("name"), rs.getString("manager_name"), List.of(positions));
    }

    public List<Project> projects() {
        return jdbc.sql(PROJECT_SQL + " group by p.id order by p.name").query(OrganizationService::project).list();
    }

    public Project project(UUID id) {
        return jdbc.sql(PROJECT_SQL + " and p.id = ? group by p.id").param(id).query(OrganizationService::project).optional().orElseThrow(ApiException::notFound);
    }

    public Project projectOfSite(UUID siteId) {
        return jdbc.sql(PROJECT_SQL + " and p.site_id = ? group by p.id order by p.name limit 1").param(siteId).query(OrganizationService::project).optional().orElseThrow(ApiException::notFound);
    }

    /* ------------------------------------------------------------ shift templates */

    private static final String TEMPLATE_SQL = "select id, project_id, position_id, start_time, end_time, unpaid_break_min, sort_order from shift_template";

    private static ShiftTemplate template(ResultSet rs, int i) throws SQLException {
        return new ShiftTemplate(rs.getObject("id", UUID.class), rs.getObject("project_id", UUID.class), rs.getObject("position_id", UUID.class),
                rs.getObject("start_time", LocalTime.class), rs.getObject("end_time", LocalTime.class), rs.getInt("unpaid_break_min"), rs.getInt("sort_order"));
    }

    public List<ShiftTemplate> templates(UUID projectId) {
        return jdbc.sql(TEMPLATE_SQL + " where project_id = ? order by sort_order").param(projectId).query(OrganizationService::template).list();
    }

    public List<ShiftTemplate> templates(Collection<UUID> projectIds) {
        if (projectIds.isEmpty()) return List.of();
        return jdbc.sql(TEMPLATE_SQL + " where project_id = any(?) order by sort_order").param(projectIds.toArray(UUID[]::new)).query(OrganizationService::template).list();
    }

    public List<ShiftTemplate> allTemplates() {
        return jdbc.sql(TEMPLATE_SQL + " order by project_id, sort_order").query(OrganizationService::template).list();
    }

    public ShiftTemplate template(UUID id) {
        return jdbc.sql(TEMPLATE_SQL + " where id = ?").param(id).query(OrganizationService::template).optional().orElseThrow(ApiException::notFound);
    }

    /* --------------------------------------------------------------- dictionaries */

    public List<Position> positions() {
        record Row(UUID id, String name, UUID[] competences) {}
        return jdbc.sql("""
                select p.id, p.name::text as name, coalesce(array_agg(pc.competence_id) filter (where pc.competence_id is not null), '{}') as competences
                from position p left join position_competence pc on pc.position_id = p.id
                group by p.id order by p.code""")
                .query((rs, i) -> new Position(rs.getObject("id", UUID.class), Json.text(rs.getString("name")), List.of((UUID[]) rs.getArray("competences").getArray())))
                .list();
    }

    public List<Competence> competences() {
        return jdbc.sql("select id, name::text as name, kind, required_document_type from competence order by code")
                .query((rs, i) -> new Competence(rs.getObject("id", UUID.class), Json.text(rs.getString("name")), rs.getString("required_document_type") != null, rs.getString("kind"), rs.getString("required_document_type")))
                .list();
    }

    public List<Reason> reasons(String kind) {
        return jdbc.sql("select id, name::text as name from reason where kind = ? order by sort").param(kind)
                .query((rs, i) -> new Reason(rs.getObject("id", UUID.class), Json.text(rs.getString("name"))))
                .list();
    }

    public Dictionaries dictionaries() {
        return new Dictionaries(positions(), competences(), reasons("correction"), reasons("dispute"));
    }
}
