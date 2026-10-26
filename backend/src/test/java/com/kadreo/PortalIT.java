package com.kadreo;

import static com.kadreo.demo.DemoIds.fromKey;
import static org.assertj.core.api.Assertions.assertThat;

import com.kadreo.demo.DemoIds;
import com.kadreo.platform.tenant.TenantContext;
import com.kadreo.support.Api;
import com.kadreo.support.IntegrationTest;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;

/**
 * Client portal (spec 12) with Jan Nowak of Nordlog, checked against the portal demo. Tests that
 * change shared demo data put it back (cancel the request, decide the dispute).
 */
@SuppressWarnings({"unchecked", "rawtypes"})
class PortalIT extends IntegrationTest {

    static final String JAN = "jan.nowak@nordlog.pl";

    @Autowired TestRestTemplate http;
    @Autowired JdbcClient jdbc;

    Api jan() {
        return Api.signIn(http, JAN);
    }

    Api marta() {
        return Api.signIn(http, DemoIds.DEMO_USER_EMAIL);
    }

    @Test
    void clientUsersStayInThePortalAndStaffStayOut() {
        Map me = jan().get("/api/v1/portal/me", Map.class).getBody();
        assertThat(me).containsEntry("fullName", "Jan Nowak").containsEntry("role", "CLIENT_MANAGER");
        assertThat((Map) me.get("client")).containsEntry("shortName", "Nordlog");

        for (String path : List.of("/api/v1/dashboard/summary", "/api/v1/search?q=Str", "/api/v1/staff-requests", "/api/v1/timesheets", "/api/v1/dictionaries")) {
            var res = jan().get(path, Map.class);
            assertThat(res.getStatusCode()).as(path).isEqualTo(HttpStatus.FORBIDDEN);
            assertThat(res.getBody()).containsEntry("permission", "backoffice");
        }
        assertThat(jan().get("/api/v1/tenant", Map.class).getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(marta().get("/api/v1/portal/me", Map.class).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    void sitesOptionsAndEstimateMatchTheMockUp() {
        Api api = jan();
        List<Map> sites = api.get("/api/v1/portal/sites", List.class).getBody();
        assertThat(sites).extracting(s -> s.get("name")).containsExactlyInAnyOrder("Stryków · Magazyn B", "Łódź · Centrum sortowania", "Piotrków Tryb. · Hub");

        Map options = api.get("/api/v1/portal/sites/" + fromKey("s-strykow") + "/positions", Map.class).getBody();
        assertThat(options).containsEntry("earliestStart", "2026-10-28").containsEntry("slaResponseHours", 24).containsEntry("showRates", true);
        assertThat((List<Map>) options.get("positions")).contains(Map.of("id", fromKey("p-picker").toString(), "rate", "48.00"));
        assertThat((List<Map>) options.get("contacts")).extracting(c -> c.get("name")).contains("Jan Nowak");

        Map est = api.post("/api/v1/portal/staff-requests/estimate", request("2026-10-28", false), Map.class).getBody();
        assertThat(est).containsEntry("days", 3).containsEntry("personShifts", 24).containsEntry("plannedHours", 192.0).containsEntry("amount", "9216.00");

        // Another client's site does not exist for Jan.
        assertThat(api.get("/api/v1/portal/sites/" + fromKey("s-poznan") + "/positions", Map.class).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    void sentRequestReachesTheBackOfficeAndDraftsDoNot() {
        Api api = jan();
        assertThat(api.post("/api/v1/portal/staff-requests", request("2026-10-27", false), Map.class).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);

        var sent = api.post("/api/v1/portal/staff-requests", request("2026-10-28", false), Map.class);
        assertThat(sent.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        Map r = sent.getBody();
        assertThat(r).containsEntry("status", "new").containsEntry("createdByName", "Jan Nowak").containsEntry("clientRef", "PO-2026-118");
        assertThat((Integer) r.get("number")).isGreaterThan(1200);
        assertThat((String) r.get("slaDueAt")).startsWith("2026-10-27T07:14:52");

        Api marta = marta();
        assertThat(marta.get("/api/v1/staff-requests/" + r.get("id"), Map.class).getStatusCode()).isEqualTo(HttpStatus.OK);
        long notes = TenantContext.callAs(DemoIds.TENANT, null, () -> jdbc.sql("select count(*) from notification where user_id = ? and href = ?")
                .param(fromKey("u-marta")).param("/requests/" + r.get("id")).query(Long.class).single());
        assertThat(notes).isEqualTo(1);

        // A draft stays with the client until sent.
        Map draft = api.post("/api/v1/portal/staff-requests", request("2026-10-28", true), Map.class).getBody();
        assertThat(draft).containsEntry("status", "draft");
        assertThat(marta.get("/api/v1/staff-requests/" + draft.get("id"), Map.class).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        Map submitted = api.put("/api/v1/portal/staff-requests/" + draft.get("id"), request("2026-10-29", false), Map.class).getBody();
        assertThat(submitted).containsEntry("status", "new").containsEntry("from", "2026-10-29");
        assertThat(api.put("/api/v1/portal/staff-requests/" + draft.get("id"), request("2026-10-29", false), Map.class).getStatusCode()).isEqualTo(HttpStatus.CONFLICT);

        // Clean up for the other tests: the back office cancels both.
        marta.post("/api/v1/staff-requests/" + r.get("id") + "/cancel", Map.of("reason", "test"), Map.class);
        marta.post("/api/v1/staff-requests/" + draft.get("id") + "/cancel", Map.of("reason", "test"), Map.class);
        assertThat(((List<Map>) api.get("/api/v1/portal/staff-requests", List.class).getBody()).stream().filter(x -> x.get("id").equals(r.get("id"))).findFirst().orElseThrow())
                .containsEntry("status", "cancelled");
    }

    @Test
    void disputeConfirmAndTheManagersAnswer() {
        Api api = jan();
        List<Map> list = api.get("/api/v1/portal/timesheets", List.class).getBody();
        Map piotrkow = list.get(0);
        assertThat(piotrkow).containsEntry("siteName", "Piotrków Tryb. · Hub").containsEntry("billableHours", 768.0).containsEntry("workers", 26);
        assertThat((Map) piotrkow.get("stage")).containsEntry("kind", "waiting");
        assertThat(list).noneMatch(x -> "Stryków · Magazyn B".equals(x.get("siteName"))); // not sent yet

        String id = (String) piotrkow.get("id");
        Map ts = api.get("/api/v1/portal/timesheets/" + id, Map.class).getBody();
        assertThat(ts).containsEntry("sentByName", "Marta Kowalska");
        Map row = ((List<Map>) ts.get("rows")).get(0);
        Map day = ((List<Map>) row.get("days")).stream().filter(d -> Boolean.TRUE.equals(d.get("hasShift"))).findFirst().orElseThrow();
        assertThat(day).doesNotContainKeys("payableHours", "billableHours").containsKey("hours");

        // Another client cannot see it.
        assertThat(Api.signIn(http, "katarzyna.wojcik@polmarket.pl").get("/api/v1/portal/timesheets/" + id, Map.class).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);

        Map input = new HashMap();
        input.put("items", List.of(Map.of("rowId", row.get("id"), "date", day.get("date"))));
        input.put("reasonId", fromKey("d-was-onsite").toString());
        input.put("clientHours", 8.0);
        input.put("comment", "Есть проходы по пропуску через наш турникет");
        Map disputed = api.post("/api/v1/portal/timesheets/" + id + "/disputes", input, Map.class).getBody();
        assertThat((Map) disputed.get("stage")).containsEntry("kind", "disputed").containsEntry("rows", 1);

        Map afterConfirm = api.post("/api/v1/portal/timesheets/" + id + "/confirm", null, Map.class).getBody();
        assertThat((Map) afterConfirm.get("stage")).containsEntry("kind", "disputed"); // the disputed day still waits
        long ips = TenantContext.callAs(DemoIds.TENANT, null, () -> jdbc.sql("select count(*) from audit_log where entity = 'timesheet' and entity_id = ? and action = 'client_confirm' and ip is not null")
                .param(id).query(Long.class).single());
        assertThat(ips).isEqualTo(1);

        // The back office answers; the timesheet comes back and the client confirms it.
        Map dispute = ((List<Map>) marta().get("/api/v1/timesheet-disputes", List.class).getBody()).stream()
                .filter(d -> id.equals(d.get("timesheetId"))).findFirst().orElseThrow();
        marta().post("/api/v1/timesheets/" + id + "/disputes/" + ((Map) dispute.get("dispute")).get("id") + "/resolve",
                Map.of("decision", "reject", "comment", "Pracownik był na zmianie"), Map.class);
        Map back = api.get("/api/v1/portal/timesheets/" + id, Map.class).getBody();
        assertThat((Map) back.get("stage")).containsEntry("kind", "waiting");
        Map answered = ((List<Map>) ((List<Map>) back.get("rows")).get(0).get("days")).stream().filter(d -> d.get("dispute") != null).findFirst().orElseThrow();
        assertThat((Map) answered.get("dispute")).containsEntry("status", "rejected").containsEntry("answer", "Pracownik był na zmianie");

        Map confirmed = api.post("/api/v1/portal/timesheets/" + id + "/confirm", null, Map.class).getBody();
        assertThat((Map) confirmed.get("stage")).containsEntry("kind", "confirmed");
        assertThat(api.post("/api/v1/portal/timesheets/" + id + "/confirm", null, Map.class).getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    }

    Map<String, Object> request(String from, boolean draft) {
        Map<String, Object> m = new HashMap<>();
        m.put("siteId", fromKey("s-strykow").toString());
        m.put("positionId", fromKey("p-picker").toString());
        m.put("headcount", 8);
        m.put("from", from);
        m.put("to", "2026-10-30");
        m.put("templateIds", List.of(fromKey("tpl-strykow-1").toString()));
        m.put("competenceIds", List.of(fromKey("c-wms").toString()));
        m.put("experiencedOnly", true);
        m.put("contactName", "Jan Nowak");
        m.put("clientRef", "PO-2026-118");
        m.put("draft", draft);
        return m;
    }
}
