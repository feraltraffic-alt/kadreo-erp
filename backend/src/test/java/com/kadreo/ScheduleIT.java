package com.kadreo;

import static com.kadreo.demo.DemoIds.fromKey;
import static org.assertj.core.api.Assertions.assertThat;

import com.kadreo.demo.DemoIds;
import com.kadreo.support.Api;
import com.kadreo.support.IntegrationTest;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpStatus;

/**
 * Shift planning API (spec 9.1). The demo seed is the same data as the front-end demo, so the
 * expected numbers are the ones the in-memory demo API returns for the same requests.
 */
@SuppressWarnings({"unchecked", "rawtypes"})
class ScheduleIT extends IntegrationTest {

    static final String STRYKOW = fromKey("pr-strykow").toString();
    static final String PICKERS = fromKey("tpl-strykow-1").toString();

    @Autowired TestRestTemplate http;

    Api marta() {
        return Api.signIn(http, DemoIds.DEMO_USER_EMAIL);
    }

    @Test
    void weekGridMatchesTheDemo() {
        Map body = marta().get("/api/v1/projects/" + STRYKOW + "/schedule?from=2026-10-26&to=2026-11-01", Map.class).getBody();
        assertThat(body).containsEntry("filled", 229).containsEntry("total", 249).containsEntry("publishState", "draft");
        List<Map> rows = (List<Map>) body.get("rows");
        assertThat(rows).hasSize(6);
        List<Map> cells = (List<Map>) rows.get(0).get("cells");
        assertThat(cells).extracting(c -> c.get("planned")).containsExactly(14, 14, 14, 14, 14, 10, null);
        assertThat(cells).extracting(c -> c.get("assigned")).containsExactly(14, 14, 9, 12, 14, 8, 0);
    }

    @Test
    void candidatesAreRankedLikeTheDemo() {
        List<Map> list = marta().get("/api/v1/shifts/" + PICKERS + "/candidates?date=2026-10-28", List.class).getBody();
        assertThat(list).hasSize(20);
        assertThat(list.get(0)).containsEntry("lastName", "Hnatiuk").containsEntry("score", 84);
        assertThat((List<Map>) list.get(0).get("tags")).extracting(t -> t.get("kind")).contains("shifts_here", "distance_km");
    }

    @Test
    void hardConstraintsRejectAnAssignmentWith422() {
        Api api = marta();
        Map dmytro = ((List<Map>) api.get("/api/v1/search?q=Dmytro Rudenko", Map.class).getBody().get("workers")).get(0);
        var res = api.post("/api/v1/assignments", Map.of("workerId", dmytro.get("id"), "templateId", PICKERS, "date", "2026-10-29"), Map.class);
        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
        assertThat(res.getBody()).containsEntry("code", "constraint");
        assertThat((List<Map>) res.getBody().get("violations")).extracting(v -> v.get("code")).contains("unavailable", "document_invalid");
    }

    @Test
    void assignAndUnassignTheBestCandidate() {
        Api api = marta();
        int before = api.get("/api/v1/shifts/" + PICKERS + "/assignments?date=2026-10-28", List.class).getBody().size();
        assertThat(before).isEqualTo(9);
        Map best = (Map) api.get("/api/v1/shifts/" + PICKERS + "/candidates?date=2026-10-28", List.class).getBody().get(0);
        var created = api.post("/api/v1/assignments", Map.of("workerId", best.get("workerId"), "templateId", PICKERS, "date", "2026-10-28"), Map.class);
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(created.getBody()).containsEntry("status", "proposed").containsEntry("source", "manual");

        // The same worker twice in one cell is a conflict, not a second row.
        var again = api.post("/api/v1/assignments", Map.of("workerId", best.get("workerId"), "templateId", PICKERS, "date", "2026-10-28"), Map.class);
        assertThat(again.getStatusCode().value()).isIn(409, 422);

        List<Map> cell = api.get("/api/v1/shifts/" + PICKERS + "/assignments?date=2026-10-28", List.class).getBody();
        assertThat(cell).hasSize(before + 1);
        assertThat(api.delete("/api/v1/assignments/" + created.getBody().get("id"), Void.class).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(api.get("/api/v1/shifts/" + PICKERS + "/assignments?date=2026-10-28", List.class).getBody()).hasSize(before);
    }

    @Test
    void pastDatesCannotBeAssigned() {
        Api api = marta();
        Map best = (Map) api.get("/api/v1/shifts/" + PICKERS + "/candidates?date=2026-10-28", List.class).getBody().get(0);
        var res = api.post("/api/v1/assignments", Map.of("workerId", best.get("workerId"), "templateId", PICKERS, "date", "2026-10-20"), Map.class);
        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    void autoAssignProposesWithoutSaving() {
        Api api = marta();
        String poznan = fromKey("pr-poznan").toString();
        Object filledBefore = api.get("/api/v1/projects/" + poznan + "/schedule?from=2026-11-02&to=2026-11-08", Map.class).getBody().get("filled");
        var started = api.post("/api/v1/projects/" + poznan + "/schedule/auto-assign?from=2026-11-02", Map.of("scope", "week", "mode", "empty_only"), Map.class);
        assertThat(started.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
        Map job = api.get("/api/v1/jobs/" + started.getBody().get("jobId"), Map.class).getBody();
        assertThat(job).containsEntry("status", "done");
        assertThat((List) job.get("proposals")).isNotEmpty();
        assertThat(api.get("/api/v1/projects/" + poznan + "/schedule?from=2026-11-02&to=2026-11-08", Map.class).getBody().get("filled")).isEqualTo(filledBefore);
    }

    @Test
    void publishThenEditMarksTheWeekChanged() {
        Api api = marta();
        String gadki = fromKey("pr-gadki").toString();
        String tpl = fromKey("tpl-gadki-1").toString();
        var pub = api.post("/api/v1/projects/" + gadki + "/schedule/publish?from=2026-10-26", null, Map.class);
        assertThat(pub.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat((Integer) pub.getBody().get("notified")).isPositive();
        assertThat(api.get("/api/v1/projects/" + gadki + "/schedule?from=2026-10-26&to=2026-11-01", Map.class).getBody()).containsEntry("publishState", "published");

        Map best = (Map) api.get("/api/v1/shifts/" + tpl + "/candidates?date=2026-10-30", List.class).getBody().get(0);
        var a = api.post("/api/v1/assignments", Map.of("workerId", best.get("workerId"), "templateId", tpl, "date", "2026-10-30"), Map.class);
        assertThat(a.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(api.get("/api/v1/projects/" + gadki + "/schedule?from=2026-10-26&to=2026-11-01", Map.class).getBody()).containsEntry("publishState", "changed_after_publish");
        api.delete("/api/v1/assignments/" + a.getBody().get("id"), Void.class);
    }

    @Test
    void siteManagerSeesOnlyTheirSitesAndFinanceCannotEdit() {
        List<Map> pawel = Api.signIn(http, "pawel.nowak@demo-outsourcing.pl").get("/api/v1/projects?weekOf=2026-10-26", List.class).getBody();
        assertThat(pawel).hasSize(4);
        assertThat(marta().get("/api/v1/projects?weekOf=2026-10-26", List.class).getBody()).hasSize(23);

        var res = Api.signIn(http, "robert.mazur@demo-outsourcing.pl").post("/api/v1/assignments",
                Map.of("workerId", fromKey("w-1").toString(), "templateId", PICKERS, "date", "2026-10-28"), Map.class);
        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(res.getBody()).containsEntry("code", "forbidden").containsEntry("permission", "shift.schedule.edit");
    }
}
