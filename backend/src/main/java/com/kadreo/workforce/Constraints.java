package com.kadreo.workforce;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.LocalDate;

/** A failed hard assignment constraint (spec 9.1); serialized exactly like the web contract. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record Constraints(
        String code,
        String competenceId,
        String docType,
        LocalDate validTo,
        LocalDate date,
        String shift,
        Double hours,
        Integer limit,
        String status,
        LocalDate until) {

    public static Constraints missingCompetence(String competenceId) {
        return new Constraints("missing_competence", competenceId, null, null, null, null, null, null, null, null);
    }

    public static Constraints documentInvalid(String docType, LocalDate validTo) {
        return new Constraints("document_invalid", null, docType, validTo, null, null, null, null, null, null);
    }

    public static Constraints overlap(LocalDate date, String shift) {
        return new Constraints("overlap", null, null, null, date, shift, null, null, null, null);
    }

    public static Constraints restPeriod(double hours) {
        return new Constraints("rest_period", null, null, null, null, null, hours, null, null, null);
    }

    public static Constraints weeklyLimit(double hours, int limit) {
        return new Constraints("weekly_limit", null, null, null, null, null, hours, limit, null, null);
    }

    public static Constraints unavailable(String status, LocalDate until) {
        return new Constraints("unavailable", null, null, null, null, null, null, null, status, until);
    }
}
