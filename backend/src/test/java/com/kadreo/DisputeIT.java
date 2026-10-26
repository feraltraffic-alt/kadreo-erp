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

/** Timesheet disputes (12.2): the Poznań demo has two; the manager decides on each. */
@SuppressWarnings({"unchecked", "rawtypes"})
class DisputeIT extends IntegrationTest {

    @Autowired TestRestTemplate http;

    @Test
    void agreeAndRejectSendTheTimesheetBackToTheClient() {
        Api api = Api.signIn(http, DemoIds.DEMO_USER_EMAIL);
        List<Map> open = api.get("/api/v1/timesheet-disputes", List.class).getBody();
        assertThat(open).hasSize(2);
        assertThat(open).allSatisfy(d -> assertThat(d).containsEntry("projectId", fromKey("pr-poznan").toString()).containsEntry("date", "2026-10-23"));
        Map tooMany = open.stream().filter(d -> ((Map) d.get("dispute")).get("reasonId").equals(fromKey("d-too-many").toString())).findFirst().orElseThrow();
        Map notOurs = open.stream().filter(d -> d != tooMany).findFirst().orElseThrow();
        String ts = (String) tooMany.get("timesheetId");
        assertThat(((Map) api.get("/api/v1/timesheets/" + ts, Map.class).getBody().get("timesheet")).get("clientStage")).isEqualTo(Map.of("kind", "disputed", "rows", 2));

        // Agree: hours become the client's (8 → 6), with a correction in the history.
        String path = "/api/v1/timesheets/" + ts + "/disputes/";
        var agreed = api.post(path + ((Map) tooMany.get("dispute")).get("id") + "/resolve", Map.of("decision", "agree", "comment", "Zgodnie z rejestrem bramek"), Map.class);
        assertThat(agreed.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(agreed.getBody()).containsEntry("status", "agreed");
        assertThat((Map) agreed.getBody().get("resolution")).containsEntry("billableHours", 6.0).containsEntry("byName", "Marta Kowalska");
        Map day = (Map) api.get("/api/v1/timesheets/" + ts + "/rows/" + tooMany.get("rowId") + "/days/2026-10-23", Map.class).getBody().get("day");
        assertThat(day).containsEntry("billableHours", 6.0).doesNotContainKey("disputed");
        assertThat((List) day.get("corrections")).hasSize(1);
        assertThat(((Map) api.get("/api/v1/timesheets/" + ts, Map.class).getBody().get("timesheet")).get("clientStage")).isEqualTo(Map.of("kind", "disputed", "rows", 1));

        // Reject needs a comment; then no dispute is open and the client gets the timesheet again.
        String notOursPath = path + ((Map) notOurs.get("dispute")).get("id") + "/resolve";
        assertThat(api.post(notOursPath, Map.of("decision", "reject", "comment", ""), Map.class).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        var rejected = api.post(notOursPath, Map.of("decision", "reject", "comment", "Pracownik był na zmianie, potwierdza lider"), Map.class);
        assertThat(rejected.getBody()).containsEntry("status", "rejected");
        assertThat(api.post(notOursPath, Map.of("decision", "reject", "comment", "again"), Map.class).getStatusCode()).isEqualTo(HttpStatus.CONFLICT);

        Map stage = (Map) ((Map) api.get("/api/v1/timesheets/" + ts, Map.class).getBody().get("timesheet")).get("clientStage");
        assertThat(stage).containsEntry("kind", "waiting").containsKey("until");
        assertThat(api.get("/api/v1/timesheet-disputes", List.class).getBody()).isEmpty();
        assertThat(api.get("/api/v1/timesheet-disputes?status=all", List.class).getBody()).hasSize(2);
    }

    @Test
    void financeCannotResolve() {
        Api finance = Api.signIn(http, "robert.mazur@demo-outsourcing.pl");
        var res = finance.post("/api/v1/timesheets/" + fromKey("ts-pr-poznan-2026-10-12") + "/disputes/" + fromKey("x") + "/resolve", Map.of("decision", "agree", "comment", ""), Map.class);
        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(res.getBody()).containsEntry("permission", "timesheet.dispute.resolve");
    }
}
