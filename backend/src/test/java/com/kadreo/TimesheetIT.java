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

/** Timesheet API (spec 9.2), checked against the front-end demo numbers. */
@SuppressWarnings({"unchecked", "rawtypes"})
class TimesheetIT extends IntegrationTest {

    @Autowired TestRestTemplate http;

    Api marta() {
        return Api.signIn(http, DemoIds.DEMO_USER_EMAIL);
    }

    @Test
    void listShowsTheReviewPeriodOfEveryProject() {
        List<Map> list = marta().get("/api/v1/timesheets", List.class).getBody();
        assertThat(list).hasSize(23);
        assertThat(list.stream().filter(x -> (Integer) x.get("issues") > 0)).hasSize(21);
    }

    @Test
    void strykowWeekHasEveryWorkerAsARow() {
        Map body = marta().get("/api/v1/timesheets/by-period?projectId=" + fromKey("pr-strykow") + "&from=2026-10-19", Map.class).getBody();
        Map ts = (Map) body.get("timesheet");
        assertThat((List) ts.get("rows")).hasSize(70);
        assertThat((Map) ts.get("clientStage")).containsEntry("kind", "not_sent");
        assertThat((Map) body.get("workers")).hasSize(70);
        assertThat((Map) body.get("contract")).containsKey("autoAcceptHours");
        List<Map> days = (List<Map>) ((List<Map>) ts.get("rows")).get(0).get("days");
        assertThat(days).hasSize(7);
    }

    @Test
    void dayDetailCarriesTheClockEvidence() {
        Api api = marta();
        String viktor = (String) ((List<Map>) api.get("/api/v1/search?q=Hnatiuk", Map.class).getBody().get("workers")).get(0).get("id");
        Map ts = (Map) api.get("/api/v1/timesheets/by-period?projectId=" + fromKey("pr-strykow") + "&from=2026-10-19", Map.class).getBody().get("timesheet");
        Map day = api.get("/api/v1/timesheets/" + ts.get("id") + "/rows/" + viktor + "/days/2026-10-23", Map.class).getBody();
        List<Map> ev = (List<Map>) day.get("evidence");
        assertThat(ev).extracting(e -> e.get("type")).containsExactly("in", "break", "out");
        assertThat(ev.get(0)).containsEntry("time", "05:56").containsEntry("source", "gps_photo").containsEntry("gpsAccuracyM", 18);
        assertThat(ev.get(1)).containsEntry("time", "10:00").containsEntry("endTime", "10:30");
        assertThat(ev.get(2)).containsEntry("time", "14:31").containsEntry("gate", 2);
    }

    @Test
    void correctionChangesHoursAndKeepsHistory() {
        Api api = marta();
        String viktor = (String) ((List<Map>) api.get("/api/v1/search?q=Hnatiuk", Map.class).getBody().get("workers")).get(0).get("id");
        Map ts = (Map) api.get("/api/v1/timesheets/by-period?projectId=" + fromKey("pr-strykow") + "&from=2026-10-19", Map.class).getBody().get("timesheet");
        String path = "/api/v1/timesheets/" + ts.get("id");
        Map before = (Map) api.get(path + "/rows/" + viktor + "/days/2026-10-22", Map.class).getBody().get("day");
        int corrections = ((List) before.get("corrections")).size();

        var res = api.post(path + "/corrections", Map.of("rowId", viktor, "date", "2026-10-22", "payableHours", 7.5, "billableHours", 7.5,
                "reasonId", fromKey("r-clock-error").toString(), "comment", "test"), Map.class);
        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(res.getBody()).containsEntry("byName", "Marta Kowalska").containsEntry("payableAfter", 7.5);

        Map after = (Map) api.get(path + "/rows/" + viktor + "/days/2026-10-22", Map.class).getBody().get("day");
        assertThat(after).containsEntry("payableHours", 7.5).doesNotContainKey("issue");
        assertThat((List) after.get("corrections")).hasSize(corrections + 1);
    }

    @Test
    void sendToClientStartsTheAutoAcceptClock() {
        Api api = marta();
        Map ts = (Map) api.get("/api/v1/timesheets/by-period?projectId=" + fromKey("pr-poznan") + "&from=2026-10-19", Map.class).getBody().get("timesheet");
        var sent = api.post("/api/v1/timesheets/" + ts.get("id") + "/send-to-client", null, Map.class);
        assertThat(sent.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(sent.getBody()).containsEntry("managerConfirmed", true);
        assertThat((Map) sent.getBody().get("clientStage")).containsEntry("kind", "waiting").containsKey("until");
        assertThat(api.post("/api/v1/timesheets/" + ts.get("id") + "/send-to-client", null, Map.class).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }
}
