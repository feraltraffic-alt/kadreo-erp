package com.kadreo.timetracking;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;

/**
 * Hours of one shift day from its clock events (spec 9.2, «Как считаются часы дня»):
 * <ol>
 *   <li>start = clock-in, not earlier than the shift start (early arrival is not agreed in advance);</li>
 *   <li>end = clock-out, not later than the shift end (overtime is not agreed in advance);</li>
 *   <li>unpaid breaks are deducted — the recorded ones, at least the template's unpaid break;</li>
 *   <li>rounding to the contract's unit in the worker's favour (start down, end up, within the shift);</li>
 *   <li>payable and billable hours are equal by default.</li>
 * </ol>
 * Issues are set only once the day can be judged: after a clock-out or after the shift ended.
 * Pure function; the same rules run in the web demo.
 */
final class HoursCalculator {

    /** Grace after the shift end before a missing clock-out becomes an issue. */
    static final Duration MISSING_OUT_AFTER = Duration.ofMinutes(60);
    /** A clock-out this much after the end is unapproved overtime. */
    static final Duration OVERTIME_AFTER = Duration.ofMinutes(15);

    private HoursCalculator() {}

    record Ev(String type, OffsetDateTime at, String status) {}

    record Rules(int roundingMinutes, boolean paidBreaks, int lateThresholdMin, int unpaidBreakMin) {}

    /** issueKind null = no issue; inProgress = the day cannot be judged yet. */
    record Result(double hours, String issueKind, Integer issueMinutes, boolean inProgress) {}

    static Result compute(OffsetDateTime shiftStart, OffsetDateTime shiftEnd, List<Ev> events, Rules rules, OffsetDateTime now) {
        List<Ev> evs = events.stream().filter(e -> !"rejected".equals(e.status())).sorted((a, b) -> a.at().compareTo(b.at())).toList();
        Ev in = evs.stream().filter(e -> "in".equals(e.type())).findFirst().orElse(null);
        Ev out = evs.stream().filter(e -> "out".equals(e.type())).reduce((a, b) -> b).orElse(null);
        boolean ended = !now.isBefore(shiftEnd);

        if (in == null) {
            if (out != null) return new Result(0, "missing_clock", null, false);
            // Nothing yet: a no-show only once the shift is over.
            return ended ? new Result(0, "no_show", null, false) : new Result(0, null, null, true);
        }
        if (out == null) {
            if (now.isBefore(shiftEnd.plus(MISSING_OUT_AFTER))) return new Result(0, null, null, true);
            return new Result(0, "missing_clock", null, false);
        }

        OffsetDateTime start = in.at().isBefore(shiftStart) ? shiftStart : in.at();
        OffsetDateTime end = out.at().isAfter(shiftEnd) ? shiftEnd : out.at();
        start = floor(start, rules.roundingMinutes(), shiftStart);
        end = ceil(end, rules.roundingMinutes(), shiftStart);
        if (start.isBefore(shiftStart)) start = shiftStart;
        if (end.isAfter(shiftEnd)) end = shiftEnd;

        long breakMin = 0;
        OffsetDateTime breakStart = null;
        for (Ev e : evs) {
            if ("break_start".equals(e.type())) breakStart = e.at();
            else if ("break_end".equals(e.type()) && breakStart != null) {
                breakMin += Duration.between(breakStart, e.at()).toMinutes();
                breakStart = null;
            }
        }
        long unpaid = rules.paidBreaks() ? 0 : Math.max(breakMin, worked(start, end) >= 360 ? rules.unpaidBreakMin() : 0);
        long minutes = Math.max(0, worked(start, end) - unpaid);
        double hours = Math.round(minutes / 60.0 * 100) / 100.0;

        // One issue per day, the most important first.
        if (evs.stream().anyMatch(e -> "pending".equals(e.status()))) return new Result(hours, "manual_pending", null, false);
        if (evs.stream().anyMatch(e -> "flagged".equals(e.status()))) return new Result(hours, "outside_geofence", null, false);
        long over = Duration.between(shiftEnd, out.at()).toMinutes();
        if (over >= OVERTIME_AFTER.toMinutes()) return new Result(hours, "unapproved_overtime", (int) over, false);
        long late = Duration.between(shiftStart, in.at()).toMinutes();
        long early = Duration.between(out.at(), shiftEnd).toMinutes();
        long off = Math.max(late > rules.lateThresholdMin() ? late : 0, early > rules.lateThresholdMin() ? early : 0);
        if (off > 0) return new Result(hours, "late_or_early", (int) off, false);
        return new Result(hours, null, null, false);
    }

    private static long worked(OffsetDateTime a, OffsetDateTime b) {
        return Math.max(0, Duration.between(a, b).toMinutes());
    }

    /** Rounds down to the unit, counted from the shift start. */
    static OffsetDateTime floor(OffsetDateTime t, int unit, OffsetDateTime origin) {
        long sec = Duration.between(origin, t).getSeconds();
        long u = unit * 60L;
        return origin.plusSeconds(Math.floorDiv(sec, u) * u);
    }

    /** Rounds up to the unit, counted from the shift start. */
    static OffsetDateTime ceil(OffsetDateTime t, int unit, OffsetDateTime origin) {
        long sec = Duration.between(origin, t).getSeconds();
        long u = unit * 60L;
        return origin.plusSeconds(-Math.floorDiv(-sec, u) * u);
    }
}
