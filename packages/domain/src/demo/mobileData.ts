import { addDays, toMinutes } from "../dates";
import type { ClockIssueKind, ClockType } from "../mobile";
import { DEMO_TODAY, assignments, clockEvents, namedWorkerIds, replacementAssignmentIds, templates, workers } from "./generate";
import { hashString } from "./rng";

/**
 * Demo data of the mobile app and kiosk (spec 14): app accounts of a worker and a team leader,
 * the Stryków kiosk, worker PINs and cards, this morning's problem reports and an urgent offer.
 * Added after the generator ran and without its random stream, so no other screen changes.
 */

const STRYKOW_MORNING = ["tpl-strykow-1", "tpl-strykow-3", "tpl-strykow-5"];
const clockedToday = (workerId: string) => clockEvents.some((c) => c.workerId === workerId && c.date === DEMO_TODAY && c.type === "in");
const named = new Set(Object.values(namedWorkerIds));

/* --------------------------------------------------------------- the team leader */

/**
 * Oleh Tkachenko leads the Stryków morning shift (team leader on the dashboard). He is a worker
 * too: one of the pickers on today's shift, renamed so the generated roster stays the same.
 */
const leaderAssignment = assignments
  .filter((a) => a.date === DEMO_TODAY && a.templateId === "tpl-strykow-1" && !named.has(a.workerId) && !replacementAssignmentIds.has(a.id) && clockedToday(a.workerId))
  .sort((a, b) => a.id.localeCompare(b.id))[0]!;
export const leaderWorkerId = leaderAssignment.workerId;
{
  const w = workers.find((x) => x.id === leaderWorkerId)!;
  w.firstName = "Oleh";
  w.lastName = "Tkachenko";
  w.language = "uk";
  w.citizenship = "UA";
}

/* --------------------------------------------------------------------- accounts */

export interface WorkerUser {
  id: string;
  email: string;
  fullName: string;
  locale: "ru" | "uk" | "pl" | "en";
  workerId: string;
  roles: ("WORKER" | "TEAM_LEADER")[];
  /** Team leader: the site whose shifts they lead. */
  leadsSiteId?: string;
}

export const workerUsers: WorkerUser[] = [
  { id: "u-viktor", email: "viktor.hnatiuk@kadreo-demo.app", fullName: "Viktor Hnatiuk", locale: "ru", workerId: namedWorkerIds.viktor!, roles: ["WORKER"] },
  { id: "u-oleh", email: "oleh.tkachenko@kadreo-demo.app", fullName: "Oleh Tkachenko", locale: "ru", workerId: leaderWorkerId, roles: ["TEAM_LEADER", "WORKER"], leadsSiteId: "s-strykow" },
];

export const kioskDevice = {
  id: "kd-strykow-1",
  userId: "u-kiosk-strykow-1",
  email: "kiosk.strykow.1@devices.kadreo-demo.app",
  code: "KSK-STR-01",
  siteId: "s-strykow",
  entry: "вход 1",
  faceEnabled: false,
};

/* ------------------------------------------------------------ kiosk credentials */

/** Demo PIN = the six digits of the personnel number (W-00012 → 000012). Never in production. */
export const demoPin = (number: string) => number.replace(/\D/g, "").padStart(6, "0").slice(-6);
/** Card UID as a reader would type it (keyboard wedge). */
export const demoCardUid = (workerId: string) => `04${(hashString(`card:${workerId}`) >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;

const strykowTemplates = new Set(templates.filter((t) => t.projectId === "pr-strykow").map((t) => t.id));
/** Workers who can clock in at the Stryków kiosk: everyone on a Stryków line and the reserve. */
export const kioskWorkerIds = workers
  .filter((w) => w.status !== "dismissed" && (assignments.some((a) => a.workerId === w.id && strykowTemplates.has(a.templateId)) || w.shiftsBySite["s-strykow"] !== undefined))
  .map((w) => w.id);

/** Workers who gave biometric consent (7.4); only they may use face recognition at the kiosk. */
export const biometricConsent = new Set<string>([namedWorkerIds.viktor!]);

/* ----------------------------------------------------- this morning's reports */

export interface SeedIssue {
  id: string;
  workerId: string;
  assignmentId: string;
  kind: ClockIssueKind;
  type: ClockType;
  time: string;
  comment: string;
  createdAt: string; // HH:mm today
  createdByWorker: boolean;
}

const strykowNoShows = assignments
  .filter((a) => a.date === DEMO_TODAY && STRYKOW_MORNING.includes(a.templateId) && !clockedToday(a.workerId) && !assignments.some((r) => r.replacesId === a.id))
  .sort((a, b) => a.id.localeCompare(b.id));

const poznanNoShow = assignments
  .filter((a) => a.date === DEMO_TODAY && a.templateId.startsWith("tpl-poznan") && !clockedToday(a.workerId))
  .sort((a, b) => a.id.localeCompare(b.id))[0];

export const seedIssues: SeedIssue[] = [
  // «Написал: буду в 08:40, автобус» on the team leader's screen (14.2-08).
  strykowNoShows[0] && { id: "ci-1", workerId: strykowNoShows[0].workerId, assignmentId: strykowNoShows[0].id, kind: "late" as const, type: "in" as const, time: "08:40", comment: "Автобус сломался, буду в 08:40", createdAt: "07:52", createdByWorker: true },
  // «На месте, но GPS вне зоны» — the worker asks for a manual clock-in.
  strykowNoShows[1] && { id: "ci-2", workerId: strykowNoShows[1].workerId, assignmentId: strykowNoShows[1].id, kind: "no_gps" as const, type: "in" as const, time: "05:58", comment: "Телефон показывает, что я вне зоны, хотя я на складе", createdAt: "06:03", createdByWorker: true },
  // Waits for the manager's decision (14.3-07).
  poznanNoShow && { id: "ci-3", workerId: poznanNoShow.workerId, assignmentId: poznanNoShow.id, kind: "forgot" as const, type: "in" as const, time: "06:02", comment: "Zapomniałem odbić się przy wejściu", createdAt: "07:40", createdByWorker: true },
].filter(Boolean) as SeedIssue[];

/* ---------------------------------------------------------------- urgent offer */

/** Wednesday 28.10 is short on pickers in Stryków; Viktor got an urgent offer (14.1-12). */
export const seedUrgent = {
  requestId: "ur-seed-1",
  offerId: "uo-seed-1",
  siteId: "s-strykow",
  templateId: "tpl-strykow-1",
  date: addDays(DEMO_TODAY, 2),
  headcount: 5,
  bonusPoints: 50,
  workerId: namedWorkerIds.viktor!,
  createdAt: "07:30",
};

/* --------------------------------------------------------------- shift output */

/** Output norm of the site (15): the team leader enters lines picked on the morning shift. */
export const siteOutput: Record<string, { norm: number; unit: string; source: "team_leader" | "client" }> = {
  "s-strykow": { norm: 3600, unit: "lines", source: "team_leader" },
  "s-lodz": { norm: 2400, unit: "parcels", source: "client" },
};
export const seedOutput = { siteId: "s-strykow", date: DEMO_TODAY, start: "06:00", value: 980, updatedAt: "08:00" };

/** Minutes after the start when a missing clock-in becomes a no-show for the team leader (14.2). */
export const NO_SHOW_AFTER_MIN = 10;

export function minutesOf(hhmm: string) {
  return toMinutes(hhmm);
}
