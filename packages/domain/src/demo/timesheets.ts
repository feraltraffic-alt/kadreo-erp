import { addDays, daysBetween, fromMinutes, shiftHours, toMinutes } from "../dates";
import type { ClockEvidence, Timesheet, TimesheetClientStage, TimesheetDay, TimesheetRow } from "../types";
import { DEMO_TODAY, assignments, namedWorkerIds, projects, sites, templates } from "./generate";
import { createRng, hashString } from "./rng";

/**
 * Timesheets are derived from assignments (and, in production, from clock events).
 * The demo builds them on first access and keeps them in memory so corrections stick.
 */

const STRYKOW_REVIEW = { projectId: "pr-strykow", from: "2026-10-19", to: "2026-10-25" };

function clientStageFor(projectId: string, from: string, to: string): TimesheetClientStage {
  if (daysBetween(to, DEMO_TODAY) > 7) return { kind: "confirmed" };
  if (projectId === STRYKOW_REVIEW.projectId && from === STRYKOW_REVIEW.from) return { kind: "not_sent" };
  const h = hashString(projectId) % 4;
  if (h === 0) return { kind: "waiting", until: "2026-10-29T23:59:00+01:00" };
  if (h === 1) return { kind: "confirmed" };
  if (h === 2) return { kind: "auto_accepted" };
  return { kind: "not_sent" };
}

export function buildTimesheet(projectId: string, from: string, to: string): Timesheet {
  const project = projects.find((p) => p.id === projectId);
  if (!project) throw new Error(`Unknown project ${projectId}`);
  const projectTemplates = templates.filter((t) => t.projectId === projectId);
  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  const inRange = assignments.filter(
    (a) => a.date >= from && a.date <= to && a.status !== "cancelled" && a.status !== "declined" && projectTemplates.some((t) => t.id === a.templateId),
  );
  const byWorker = new Map<string, typeof inRange>();
  for (const a of inRange) {
    if (!byWorker.has(a.workerId)) byWorker.set(a.workerId, []);
    byWorker.get(a.workerId)!.push(a);
  }
  const isReview = projectId === STRYKOW_REVIEW.projectId && from === STRYKOW_REVIEW.from;
  const rows: TimesheetRow[] = [];
  for (const [workerId, list] of byWorker) {
    const firstTpl = projectTemplates.find((t) => t.id === list[0]!.templateId)!;
    const days: TimesheetDay[] = dates.map((date) => {
      const a = list.find((x) => x.date === date);
      if (!a) return { date, hasShift: false, plannedHours: 0, payableHours: 0, billableHours: 0, corrections: [] };
      const tpl = projectTemplates.find((t) => t.id === a.templateId)!;
      const planned = shiftHours(tpl.start, tpl.end, tpl.unpaidBreakMin);
      const day: TimesheetDay = {
        date,
        hasShift: true,
        plannedHours: planned,
        payableHours: date < DEMO_TODAY ? planned : 0,
        billableHours: date < DEMO_TODAY ? planned : 0,
        shiftLabel: `${tpl.start}–${tpl.end}`,
        corrections: [],
      };
      if (date >= DEMO_TODAY || isReview) return day;
      const r = hashString(`${workerId}|${date}`) % 1000;
      if (r < 6) Object.assign(day, { payableHours: 0, billableHours: 0, issue: { kind: "no_show" } });
      else if (r < 22) Object.assign(day, { payableHours: planned - 0.25, billableHours: planned - 0.25, issue: { kind: "late_or_early", minutes: 12 } });
      else if (r < 30) Object.assign(day, { payableHours: planned + 0.5, billableHours: planned + 0.5, issue: { kind: "unapproved_overtime", minutes: 34 } });
      // Older periods were reviewed long ago: their issues are already resolved.
      if (daysBetween(to, DEMO_TODAY) > 7 && day.issue) {
        day.corrections.push({ id: `cor-${workerId}-${date}`, at: `${addDays(to, 1)}T09:00:00+01:00`, byName: project.managerName, payableBefore: day.payableHours, payableAfter: planned, billableBefore: day.billableHours, billableAfter: planned, reasonId: "r-clock-error", comment: "" });
        day.payableHours = planned;
        day.billableHours = planned;
        delete day.issue;
      }
      return day;
    });
    rows.push({ id: `tr-${projectId}-${from}-${workerId}`, workerId, positionId: firstTpl.positionId, days });
  }

  if (isReview) applyReviewScenario(rows, project.managerName);

  // Mock-up order first, then by surname order of creation.
  const order = ["viktor", "oksana", "tomasz", "dmytro", "agnieszka"].map((k) => namedWorkerIds[k]);
  rows.sort((a, b) => {
    const ia = order.indexOf(a.workerId);
    const ib = order.indexOf(b.workerId);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return Number(a.workerId.slice(2)) - Number(b.workerId.slice(2));
  });

  const isPast = daysBetween(to, DEMO_TODAY) > 0;
  const stage = clientStageFor(projectId, from, to);
  return {
    id: `ts-${projectId}-${from}`,
    projectId,
    from,
    to,
    teamLeaderDaysConfirmed: isPast ? dates.length : Math.max(0, daysBetween(from, DEMO_TODAY)),
    managerConfirmed: stage.kind !== "not_sent",
    clientStage: stage,
    rows,
  };
}

/** The Stryków week 43 timesheet as drawn on the "Табель" mock-up: three rows with issues. */
function applyReviewScenario(rows: TimesheetRow[], managerName: string) {
  const day = (workerKey: string, date: string) => {
    const row = rows.find((r) => r.workerId === namedWorkerIds[workerKey]);
    return row?.days.find((d) => d.date === date);
  };
  const viktorFri = day("viktor", "2026-10-23");
  if (viktorFri) Object.assign(viktorFri, { payableHours: 8.5, billableHours: 8.5, issue: { kind: "unapproved_overtime", minutes: 31 } });
  const tomaszWed = day("tomasz", "2026-10-21");
  if (tomaszWed) Object.assign(tomaszWed, { payableHours: 0, billableHours: 0, issue: { kind: "no_show" } });
  const agnThu = day("agnieszka", "2026-10-22");
  if (agnThu) Object.assign(agnThu, { payableHours: 7.5, billableHours: 7.5, issue: { kind: "late_or_early", minutes: 30 } });
  const dmytroTue = day("dmytro", "2026-10-20");
  if (dmytroTue) {
    dmytroTue.corrections.push({ id: "cor-dmytro-1020", at: "2026-10-21T08:40:00+02:00", byName: managerName, payableBefore: 7.5, payableAfter: 8, billableBefore: 7.5, billableAfter: 8, reasonId: "r-forgot", comment: "Wyjście potwierdzone przez lidera zmiany" });
  }
}

/** Clock evidence for one timesheet day, consistent with the day's hours and issue. */
export function evidenceFor(projectId: string, workerId: string, day: TimesheetDay): ClockEvidence[] {
  if (!day.hasShift || !day.shiftLabel) return [];
  if (day.issue?.kind === "no_show") return [];
  const site = sites.find((s) => s.id === projects.find((p) => p.id === projectId)!.siteId)!;
  const [start, end] = day.shiftLabel.split("–") as [string, string];
  const r = createRng(hashString(`${workerId}|${day.date}|ev`));
  const methods = site.clockMethods;
  const method = (i: number) => methods[i % methods.length]!;
  const ev = (type: ClockEvidence["type"], time: string, m: ClockEvidence["source"], endTime?: string): ClockEvidence => {
    const e: ClockEvidence = { type, time, source: m };
    if (endTime) e.endTime = endTime;
    if (m === "gps_photo") Object.assign(e, { gpsAccuracyM: r.int(8, 35), photo: true });
    if (m === "access_card") e.gate = r.int(1, 3);
    if (m === "kiosk") e.kiosk = r.int(1, 2);
    if (m === "face") Object.assign(e, { kiosk: 1, faceMatch: true });
    if (m === "qr") e.qrPoint = r.int(1, 4);
    return e;
  };

  // Named scenario from the mock-up.
  if (workerId === namedWorkerIds.viktor && day.date === "2026-10-23") {
    return [
      { type: "in", time: "05:56", source: "gps_photo", gpsAccuracyM: 18, photo: true, faceMatch: true },
      { type: "break", time: "10:00", endTime: "10:30", source: "kiosk", kiosk: 1 },
      { type: "out", time: "14:31", source: "access_card", gate: 2 },
    ];
  }
  let inMin = toMinutes(start) - r.int(2, 14);
  let outMin = toMinutes(end) + r.int(0, 6);
  if (day.issue?.kind === "late_or_early") inMin = toMinutes(start) + (day.issue.minutes ?? 15);
  if (day.issue?.kind === "unapproved_overtime") outMin = toMinutes(end) + (day.issue.minutes ?? 30);
  const breakStart = toMinutes(start) + 240;
  const list: ClockEvidence[] = [
    ev("in", fromMinutes(inMin), method(0)),
    ev("break", fromMinutes(breakStart), method(1), fromMinutes(breakStart + 30)),
  ];
  if (day.issue?.kind !== "missing_clock") list.push(ev("out", fromMinutes(outMin), method(2)));
  return list;
}
