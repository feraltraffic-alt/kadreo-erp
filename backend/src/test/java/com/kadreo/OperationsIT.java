package com.kadreo;

import static com.kadreo.demo.DemoIds.fromKey;
import static org.assertj.core.api.Assertions.assertThat;

import com.kadreo.demo.DemoIds;
import com.kadreo.support.Api;
import com.kadreo.support.IntegrationTest;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpStatus;

/** Dashboard and operations API (spec 11.1), checked against the front-end demo numbers. */
@SuppressWarnings({"unchecked", "rawtypes"})
class OperationsIT extends IntegrationTest {

    @Autowired TestRestTemplate http;

    Api marta() {
        return Api.signIn(http, DemoIds.DEMO_USER_EMAIL);
    }

    @Test
    void summaryMatchesTheDemo() {
        Map s = marta().get("/api/v1/dashboard/summary", Map.class).getBody();
        assertThat(s).containsEntry("onShiftNow", 464).containsEntry("plannedNow", 478).containsEntry("lateToday", 48)
                .containsEntry("noShows", 20).containsEntry("noShowsReplaced", 6)
                .containsEntry("openAlerts", 6).containsEntry("criticalAlerts", 2).containsEntry("staffRequestsOpen", 4);
        assertThat((String) s.get("nearestSlaDueAt")).startsWith("2026-10-26T09:19:52");
    }

    @Test
    void siteLiveMatchesTheDemo() {
        List<Map> sites = marta().get("/api/v1/dashboard/sites", List.class).getBody();
        assertThat(sites).hasSize(23);
        Map strykow = sites.stream().filter(x -> x.get("siteId").equals(fromKey("s-strykow").toString())).findFirst().orElseThrow();
        assertThat(strykow).containsEntry("shiftLabel", "06:00–14:00").containsEntry("actual", 18).containsEntry("planned", 23)
                .containsEntry("late", 4).containsEntry("noShows", 7).containsEntry("noShowsReplaced", 2)
                .containsEntry("teamLeaderName", "Oleh Tkachenko").containsEntry("status", "critical")
                .containsEntry("projectId", fromKey("pr-strykow").toString());
        Map<Object, Long> statuses = sites.stream().collect(Collectors.groupingBy(x -> x.get("status"), Collectors.counting()));
        assertThat(statuses).containsEntry("critical", 2L).containsEntry("ok", 18L).containsEntry("deviation", 3L);
    }

    @Test
    void filtersAndScopeNarrowTheMap() {
        assertThat(marta().get("/api/v1/dashboard/sites?regions=Łódzkie", List.class).getBody()).isNotEmpty()
                .allSatisfy(x -> assertThat(((Map) x).get("region")).isEqualTo("Łódzkie"));
        assertThat(Api.signIn(http, "pawel.nowak@demo-outsourcing.pl").get("/api/v1/dashboard/sites", List.class).getBody()).hasSize(4);
        Map options = marta().get("/api/v1/dashboard/filter-options", Map.class).getBody();
        assertThat((List) options.get("clients")).hasSize(9);
    }

    @Test
    void alertsAreTakenOnceAndASecondTakerGetsAConflict() {
        List<Map> open = marta().get("/api/v1/alerts?status=open", List.class).getBody();
        assertThat(open).hasSize(6);
        assertThat(open.get(0)).containsEntry("kind", "understaffed").containsEntry("severity", "critical");
        assertThat(marta().get("/api/v1/alerts?limit=3", List.class).getBody()).hasSize(3);

        String leipzigDocs = fromKey("al-2").toString();
        var taken = marta().post("/api/v1/alerts/" + leipzigDocs + "/take", null, Map.class);
        assertThat(taken.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(taken.getBody()).containsEntry("status", "taken").containsEntry("takenByName", "Marta Kowalska");

        var second = Api.signIn(http, "iryna.szewczuk@demo-outsourcing.pl").post("/api/v1/alerts/" + leipzigDocs + "/take", null, Map.class);
        assertThat(second.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(second.getBody()).containsEntry("code", "conflict").containsEntry("byName", "Marta Kowalska");
    }

    @Test
    void urgentRequestIsOfferedToEligibleWorkers() {
        Api api = marta();
        var res = api.post("/api/v1/urgent-requests", Map.of("siteId", fromKey("s-strykow").toString(), "templateId", fromKey("tpl-strykow-1").toString(),
                "date", "2026-10-27", "headcount", 2, "comment", ""), Map.class);
        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat((Integer) res.getBody().get("offeredTo")).isBetween(1, 8);
        assertThat(api.get("/api/v1/urgent-requests/" + res.getBody().get("id"), Map.class).getBody()).containsEntry("needed", 2);
    }

    @Test
    void countersSearchAndNotifications() {
        Api api = marta();
        assertThat(api.get("/api/v1/nav-counters", Map.class).getBody()).containsEntry("requestsNew", 2).containsEntry("docsAttention", 20).containsEntry("docsExpired", 3);
        assertThat((List<Map>) api.get("/api/v1/search?q=rudenko", Map.class).getBody().get("workers")).extracting(w -> w.get("label")).contains("Dmytro Rudenko");
        assertThat(api.get("/api/v1/staff-requests", List.class).getBody()).hasSize(6);

        List<Map> notes = api.get("/api/v1/notifications", List.class).getBody();
        assertThat(notes).hasSize(5);
        assertThat(api.post("/api/v1/notifications/read-all", null, Void.class).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(api.get("/api/v1/notifications", List.class).getBody()).allSatisfy(n -> assertThat(((Map) n).get("read")).isEqualTo(true));
    }
}
