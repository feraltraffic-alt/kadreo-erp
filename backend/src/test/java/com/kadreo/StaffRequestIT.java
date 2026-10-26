package com.kadreo;

import static com.kadreo.demo.DemoIds.fromKey;
import static org.assertj.core.api.Assertions.assertThat;

import com.kadreo.demo.DemoIds;
import com.kadreo.platform.tenant.TenantContext;
import com.kadreo.support.Api;
import com.kadreo.support.IntegrationTest;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;

/** Client staff requests in the back office, checked against the front-end demo. */
@SuppressWarnings({"unchecked", "rawtypes"})
class StaffRequestIT extends IntegrationTest {

    @Autowired TestRestTemplate http;
    @Autowired JdbcClient jdbc;

    Api marta() {
        return Api.signIn(http, DemoIds.DEMO_USER_EMAIL);
    }

    @Test
    void progressAndStatusesMatchTheDemo() {
        List<Map> list = marta().get("/api/v1/staff-requests", List.class).getBody();
        Map<Object, String> byNumber = list.stream().collect(Collectors.toMap(r -> r.get("number"), r -> r.get("status") + " " + r.get("assigned") + "/" + r.get("headcount")));
        assertThat(byNumber).containsEntry(1200, "in_progress 2/6").containsEntry(1196, "in_progress 1/2").containsEntry(1190, "staffed 10/10")
                .containsEntry(1182, "done 6/6").containsEntry(1199, "new 0/4");

        Map detail = marta().get("/api/v1/staff-requests/" + fromKey("sr-1196"), Map.class).getBody();
        assertThat((List) detail.get("cells")).hasSize(5);
        assertThat(detail).containsEntry("projectId", fromKey("pr-strykow").toString());
        assertThat((Map) detail.get("request")).containsEntry("experiencedOnly", true).containsEntry("acceptedByName", "Marta Kowalska");
    }

    @Test
    void acceptingAddsPlacesAndNewAssignmentsCountTowardsTheRequest() {
        Api api = marta();
        // Same shape as demo request 1197 (8 pickers, Poznań, 28–30.10) but our own, cancelled at the end.
        String id = insertRequest(9002, "s-poznan", "tpl-poznan-1", 8, "2026-10-28", "2026-10-30").toString();
        String tpl = fromKey("tpl-poznan-1").toString();
        String project = fromKey("pr-poznan").toString();
        int plannedBefore = planned(api, project, "2026-10-28");

        var accepted = api.post("/api/v1/staff-requests/" + id + "/accept", null, Map.class);
        assertThat(accepted.getStatusCode()).isEqualTo(HttpStatus.OK);
        Map body = accepted.getBody();
        assertThat((Map) body.get("request")).containsEntry("status", "in_progress").containsEntry("assigned", 0);
        assertThat((List<Map>) body.get("cells")).extracting(c -> c.get("date")).containsExactly("2026-10-28", "2026-10-29", "2026-10-30");
        assertThat(planned(api, project, "2026-10-28")).isEqualTo(plannedBefore + 8);

        // A second acceptance is a conflict.
        assertThat(api.post("/api/v1/staff-requests/" + id + "/accept", null, Map.class).getStatusCode()).isEqualTo(HttpStatus.CONFLICT);

        Map best = (Map) api.get("/api/v1/shifts/" + tpl + "/candidates?date=2026-10-28", List.class).getBody().get(0);
        var a = api.post("/api/v1/assignments", Map.of("workerId", best.get("workerId"), "templateId", tpl, "date", "2026-10-28"), Map.class);
        assertThat(a.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        Map after = api.get("/api/v1/staff-requests/" + id, Map.class).getBody();
        Map first = ((List<Map>) after.get("cells")).get(0);
        assertThat(first).containsEntry("assigned", 1).containsEntry("needed", 8);
        assertThat((Map) after.get("request")).containsEntry("assigned", 0); // the least staffed day still has nobody

        // Unassigning takes the person out of the request's count again.
        api.delete("/api/v1/assignments/" + a.getBody().get("id"), Void.class);
        assertThat(((List<Map>) api.get("/api/v1/staff-requests/" + id, Map.class).getBody().get("cells")).get(0)).containsEntry("assigned", 0);

        api.post("/api/v1/staff-requests/" + id + "/cancel", Map.of("reason", "test"), Map.class);
        assertThat(planned(api, project, "2026-10-28")).isEqualTo(plannedBefore);
    }

    UUID insertRequest(int number, String site, String template, int headcount, String from, String to) {
        UUID id = UUID.randomUUID();
        TenantContext.runAs(DemoIds.TENANT, null, () -> jdbc.sql("""
                insert into staff_request (id, tenant_id, number, site_id, position_id, headcount, date_from, date_to, status, sla_due_at, template_ids, contact_name, created_by_name)
                values (?, ?, ?, ?, ?, ?, ?::date, ?::date, 'new', now(), ?, 'Test', 'Test')""")
                .param(id).param(DemoIds.TENANT).param(number).param(fromKey(site)).param(fromKey("p-picker")).param(headcount).param(from).param(to)
                .param(new UUID[] {fromKey(template)})
                .update());
        return id;
    }

    @Test
    void cancelNeedsAReasonAndReturnsThePlaces() {
        Api api = marta();
        UUID id = insertRequest(9001, "s-gadki", "tpl-gadki-1", 3, "2026-11-10", "2026-11-11");
        String project = fromKey("pr-gadki").toString();
        int before = planned(api, project, "2026-11-10");
        api.post("/api/v1/staff-requests/" + id + "/accept", null, Map.class);
        assertThat(planned(api, project, "2026-11-10")).isEqualTo(before + 3);

        assertThat(api.post("/api/v1/staff-requests/" + id + "/cancel", Map.of("reason", " "), Map.class).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        var cancelled = api.post("/api/v1/staff-requests/" + id + "/cancel", Map.of("reason", "Klient przesunął dostawę"), Map.class);
        assertThat(cancelled.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat((Map) cancelled.getBody().get("request")).containsEntry("status", "cancelled").containsEntry("cancelReason", "Klient przesunął dostawę");
        assertThat(planned(api, project, "2026-11-10")).isEqualTo(before);
    }

    @Test
    void hrCannotAcceptRequests() {
        var res = Api.signIn(http, "ewa.zielinska@demo-outsourcing.pl").post("/api/v1/staff-requests/" + fromKey("sr-1199") + "/accept", null, Map.class);
        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    /** Planned headcount of the project's first shift line on a date. */
    int planned(Api api, String project, String date) {
        Map s = api.get("/api/v1/projects/" + project + "/schedule?from=" + date + "&to=" + date, Map.class).getBody();
        Map cell = (Map) ((List) ((Map) ((List) s.get("rows")).get(0)).get("cells")).get(0);
        return cell.get("planned") == null ? 0 : (Integer) cell.get("planned");
    }
}
