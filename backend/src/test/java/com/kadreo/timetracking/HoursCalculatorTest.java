package com.kadreo.timetracking;

import static org.assertj.core.api.Assertions.assertThat;

import com.kadreo.timetracking.HoursCalculator.Ev;
import com.kadreo.timetracking.HoursCalculator.Result;
import com.kadreo.timetracking.HoursCalculator.Rules;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The day's hours by the rules of spec 9.2 for a 06:00–14:00 shift. */
class HoursCalculatorTest {

    static final OffsetDateTime START = OffsetDateTime.parse("2026-10-26T06:00:00+01:00");
    static final OffsetDateTime END = OffsetDateTime.parse("2026-10-26T14:00:00+01:00");
    static final OffsetDateTime EVENING = OffsetDateTime.parse("2026-10-26T18:00:00+01:00");
    static final Rules RULES = new Rules(15, false, 5, 0);

    static OffsetDateTime at(String hhmm) {
        return OffsetDateTime.parse("2026-10-26T" + hhmm + ":00+01:00");
    }

    static List<Ev> evs(String... spec) {
        List<Ev> out = new ArrayList<>();
        for (String s : spec) {
            String[] p = s.split(" ");
            out.add(new Ev(p[0], at(p[1]), p.length > 2 ? p[2] : "accepted"));
        }
        return out;
    }

    static Result calc(Rules rules, OffsetDateTime now, String... spec) {
        return HoursCalculator.compute(START, END, evs(spec), rules, now);
    }

    @Test
    void earlyArrivalAndShortOvertimeAreNotPaid() {
        assertThat(calc(RULES, EVENING, "in 05:52", "out 14:03")).isEqualTo(new Result(8.0, null, null, false));
    }

    @Test
    void lateArrivalRoundsInTheWorkersFavour() {
        assertThat(calc(RULES, EVENING, "in 06:20", "out 14:00")).isEqualTo(new Result(7.75, "late_or_early", 20, false));
        // Within the site's threshold: no issue.
        assertThat(calc(RULES, EVENING, "in 06:04", "out 14:00")).isEqualTo(new Result(8.0, null, null, false));
    }

    @Test
    void unpaidBreaksAreDeductedPaidOnesAreNot() {
        assertThat(calc(RULES, EVENING, "in 06:00", "break_start 10:00", "break_end 10:30", "out 14:00").hours()).isEqualTo(7.5);
        assertThat(calc(new Rules(15, true, 5, 30), EVENING, "in 06:00", "break_start 10:00", "break_end 10:30", "out 14:00").hours()).isEqualTo(8.0);
        // No break recorded on a long day: at least the template's unpaid break.
        assertThat(calc(new Rules(15, false, 5, 30), EVENING, "in 06:00", "out 14:00").hours()).isEqualTo(7.5);
    }

    @Test
    void overtimeIsCappedAndFlagged() {
        assertThat(calc(RULES, EVENING, "in 06:00", "out 14:40")).isEqualTo(new Result(8.0, "unapproved_overtime", 40, false));
    }

    @Test
    void leavingEarly() {
        assertThat(calc(RULES, at("08:20"), "in 05:50", "out 08:14")).isEqualTo(new Result(2.25, "late_or_early", 346, false));
    }

    @Test
    void openDaysAreNotJudgedUntilTheShiftIsOver() {
        assertThat(calc(RULES, at("08:14"), "in 05:50")).isEqualTo(new Result(0, null, null, true));
        assertThat(calc(RULES, at("08:14"))).isEqualTo(new Result(0, null, null, true));
        assertThat(calc(RULES, at("14:30"), "in 05:50").inProgress()).isTrue();
        assertThat(calc(RULES, at("15:30"), "in 05:50")).isEqualTo(new Result(0, "missing_clock", null, false));
        assertThat(calc(RULES, at("14:00"))).isEqualTo(new Result(0, "no_show", null, false));
    }

    @Test
    void pendingManualAndFlaggedRecordsAreIssues() {
        assertThat(calc(RULES, EVENING, "in 05:58 pending", "out 14:00")).isEqualTo(new Result(8.0, "manual_pending", null, false));
        assertThat(calc(RULES, EVENING, "in 05:58 flagged", "out 14:00")).isEqualTo(new Result(8.0, "outside_geofence", null, false));
        // A rejected clock-in does not count.
        assertThat(calc(RULES, EVENING, "in 05:58 rejected", "out 14:00").issueKind()).isEqualTo("missing_clock");
    }
}
