import { addDays, mondayOf, shiftHours, shiftInterval } from "./dates";
import type { Assignment, IsoDate, Position, ShiftTemplate, Site, Worker, WorkerDocument } from "./types";

/**
 * Hard assignment constraints (9.1) and the rule-based candidate score that the ML model
 * must beat (16.5: "стаж на объекте + расстояние"). The server runs the same checks on every
 * manual assignment, drag-and-drop and auto-assignment; the client uses them for previews.
 */

export type ConstraintViolation =
  | { code: "missing_competence"; competenceId: string }
  | { code: "document_invalid"; docType: WorkerDocument["type"]; validTo: IsoDate | null }
  | { code: "overlap"; date: IsoDate; shift: string }
  | { code: "rest_period"; hours: number }
  | { code: "weekly_limit"; hours: number; limit: number }
  | { code: "unavailable"; status: Worker["status"]; until?: IsoDate };

export type CandidateTag =
  | { kind: "shifts_here"; count: number }
  | { kind: "distance_km"; km: number }
  | { kind: "competence"; competenceId: string }
  | { kind: "prefers_morning" }
  | { kind: "doc_until"; docType: WorkerDocument["type"]; validTo: IsoDate };

export type CandidateWarning = { kind: "near_hour_limit"; used: number; limit: number } | { kind: "first_on_site" } | { kind: "newcomer" };

export interface CandidateScore {
  workerId: string;
  score: number;
  tags: CandidateTag[];
  warnings: CandidateWarning[];
}

export interface ScoringContext {
  workers: Worker[];
  documents: WorkerDocument[];
  assignments: Assignment[];
  templates: ShiftTemplate[];
  positions: Position[];
  /** Document types the position requires on sites of this country (simplified 15.9 rule). */
  requiredDocs: (site: Site, positionId: string, worker: Worker) => WorkerDocument["type"][];
}

export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const EPOCH = "2026-01-01";

function weekHours(ctx: ScoringContext, workerId: string, date: IsoDate): number {
  const monday = mondayOf(date);
  const sunday = addDays(monday, 6);
  return ctx.assignments
    .filter((a) => a.workerId === workerId && a.date >= monday && a.date <= sunday && (a.status === "confirmed" || a.status === "proposed"))
    .reduce((sum, a) => {
      const t = ctx.templates.find((x) => x.id === a.templateId);
      return sum + (t ? shiftHours(t.start, t.end, t.unpaidBreakMin) : 0);
    }, 0);
}

export function checkConstraints(ctx: ScoringContext, worker: Worker, site: Site, template: ShiftTemplate, date: IsoDate): ConstraintViolation[] {
  const out: ConstraintViolation[] = [];
  if (worker.status === "vacation" || worker.status === "sick" || worker.status === "blocked" || worker.status === "dismissed") {
    if (!(worker.statusUntil && date > worker.statusUntil)) out.push({ code: "unavailable", status: worker.status, ...(worker.statusUntil ? { until: worker.statusUntil } : {}) });
  }
  const position = ctx.positions.find((p) => p.id === template.positionId);
  for (const c of position?.competenceIds ?? []) {
    if (!worker.competenceIds.includes(c)) out.push({ code: "missing_competence", competenceId: c });
  }
  for (const type of ctx.requiredDocs(site, template.positionId, worker)) {
    const doc = ctx.documents.find((d) => d.workerId === worker.id && d.type === type);
    if (!doc || doc.validTo < date) out.push({ code: "document_invalid", docType: type, validTo: doc?.validTo ?? null });
  }
  const [s, e] = shiftInterval(date, template.start, template.end, EPOCH);
  for (const a of ctx.assignments) {
    if (a.workerId !== worker.id || (a.status !== "confirmed" && a.status !== "proposed")) continue;
    if (a.date < addDays(date, -1) || a.date > addDays(date, 1)) continue;
    const t = ctx.templates.find((x) => x.id === a.templateId);
    if (!t) continue;
    const [s2, e2] = shiftInterval(a.date, t.start, t.end, EPOCH);
    if (s < e2 && s2 < e) {
      out.push({ code: "overlap", date: a.date, shift: `${t.start}–${t.end}` });
      continue;
    }
    const gap = s >= e2 ? (s - e2) / 60 : (s2 - e) / 60;
    if (worker.contractKind === "uop" && gap < 11) out.push({ code: "rest_period", hours: Math.round(gap * 10) / 10 });
  }
  const used = weekHours(ctx, worker.id, date);
  const add = shiftHours(template.start, template.end, template.unpaidBreakMin);
  if (used + add > worker.weeklyHourLimit) out.push({ code: "weekly_limit", hours: used + add, limit: worker.weeklyHourLimit });
  return out;
}

export function scoreCandidate(ctx: ScoringContext, worker: Worker, site: Site, template: ShiftTemplate, date: IsoDate): CandidateScore {
  const tags: CandidateTag[] = [];
  const warnings: CandidateWarning[] = [];
  const here = worker.shiftsBySite[site.id] ?? 0;
  const km = Math.round(distanceKm(worker.homeLat, worker.homeLng, site.lat, site.lng));
  // Experience on site: up to 45 points, saturating at 40 shifts.
  let score = Math.min(45, (here / 40) * 45);
  // Distance: up to 30 points, zero at 40 km.
  score += Math.max(0, 30 * (1 - km / 40));
  // Extra competences beyond the required ones: 5 points each, up to 10.
  const position = ctx.positions.find((p) => p.id === template.positionId);
  const extra = worker.competenceIds.filter((c) => !position?.competenceIds.includes(c) && c !== "c-pl-a2" && c !== "c-de-a2");
  score += Math.min(10, extra.length * 5);
  const morning = template.start < "12:00" && template.start >= "05:00";
  if (worker.prefersMorning && morning) score += 6;
  score += (worker.rating - 3.5) * 6;
  score += Math.min(4, worker.badgeCount);

  if (here > 0) tags.push({ kind: "shifts_here", count: here });
  tags.push({ kind: "distance_km", km });
  for (const c of position?.competenceIds ?? []) if (worker.competenceIds.includes(c)) tags.push({ kind: "competence", competenceId: c });
  if (worker.prefersMorning && morning) tags.push({ kind: "prefers_morning" });
  const docs = ctx.documents.filter((d) => d.workerId === worker.id && d.validTo >= date).sort((a, b) => a.validTo.localeCompare(b.validTo));
  const nearest = docs[0];
  if (nearest && (nearest.type === "bhp" || nearest.type === "medical" || nearest.type === "a1" || nearest.type === "work_permit")) {
    tags.push({ kind: "doc_until", docType: nearest.type, validTo: nearest.validTo });
  }

  const used = weekHours(ctx, worker.id, date);
  const add = shiftHours(template.start, template.end, template.unpaidBreakMin);
  if (used + add > worker.weeklyHourLimit - 4) {
    warnings.push({ kind: "near_hour_limit", used, limit: worker.weeklyHourLimit });
    score -= 8;
  }
  if (here === 0) {
    warnings.push({ kind: "first_on_site" });
    score -= 4;
  } else if (here < 10) {
    warnings.push({ kind: "newcomer" });
  }
  return { workerId: worker.id, score: Math.max(0, Math.min(100, Math.round(score))), tags, warnings };
}
