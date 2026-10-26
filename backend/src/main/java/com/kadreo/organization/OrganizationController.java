package com.kadreo.organization;

import com.kadreo.organization.OrganizationModels.Dictionaries;
import com.kadreo.organization.OrganizationModels.ShiftTemplate;
import com.kadreo.organization.OrganizationModels.Site;
import com.kadreo.platform.security.CurrentUserService;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
class OrganizationController {

    private final OrganizationService org;
    private final CurrentUserService users;

    OrganizationController(OrganizationService org, CurrentUserService users) {
        this.org = org;
        this.users = users;
    }

    /** Positions, competences and reason dictionaries in all four languages. */
    @GetMapping("/dictionaries")
    Dictionaries dictionaries() {
        users.current();
        return org.dictionaries();
    }

    record TemplateBrief(UUID id, UUID positionId, String start, String end) {}

    record SiteWithTemplates(Site site, List<TemplateBrief> templates) {}

    /** Sites with their shift lines, for pickers such as «Срочная замена» (11.1-06). */
    @GetMapping("/sites-with-templates")
    List<SiteWithTemplates> sitesWithTemplates() {
        users.require("site.read");
        var projects = org.projects();
        Map<UUID, UUID> projectBySite = projects.stream().collect(Collectors.toMap(p -> p.siteId(), p -> p.id(), (a, b) -> a));
        Map<UUID, List<ShiftTemplate>> templates = org.allTemplates().stream().collect(Collectors.groupingBy(ShiftTemplate::projectId));
        return org.sites().stream()
                .map(s -> new SiteWithTemplates(s, templates.getOrDefault(projectBySite.get(s.id()), List.of()).stream()
                        .map(t -> new TemplateBrief(t.id(), t.positionId(), t.start().toString(), t.end().toString()))
                        .toList()))
                .toList();
    }
}
