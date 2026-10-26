import { ApiError } from "../api";
import { addDays, fromMinutes, shiftInterval, toMinutes } from "../dates";
import {
  distanceM,
  type BrigadeMember,
  type BrigadeShift,
  type BrigadeView,
  type ClockEventView,
  type ClockIssue,
  type ClockState,
  type ClockType,
  type Decision,
  type KioskIdentity,
  type KioskRecent,
  type ManagerSummary,
  type MobileApi,
  type MobileDemoUserKey,
  type MobileShift,
  type MobileSiteRules,
  type ProblemSite,
  type WorkerProfile,
  type WorkerToday,
} from "../mobile";
import { permissionsFor } from "../permissions";
import type { Assignment, ClockEvent, CurrentUser, Locale, NotificationItem, RoleCode, ShiftTemplate, Site, Worker } from "../types";
import { DEMO_NOW_ISO, DEMO_TODAY, assignments, clockEvents, contracts, documents, plans, positions, projects, replacementAssignmentIds, sites, templates, workers } from "./generate";
import { createMockApi, setDemoLocale } from "./mockApi";
import {
  NO_SHOW_AFTER_MIN,
  biometricConsent,
  demoCardUid,
  demoPin,
  kioskDevice,
  kioskWorkerIds,
  seedIssues,
  seedOutput,
  seedUrgent,
  siteOutput,
  workerUsers,
} from "./mobileData";
import { alerts, computeSiteLive } from "./ops";

/**
 * The mobile/kiosk contract in memory, for the in-browser demo. Same rules as the backend
 * (mobile module): geofence, clock window, idempotency, four-eyes approval of manual clock-ins,
 * first-to-accept urgent offers, kiosk PIN lockout. The clock runs from the demo's fixed
 * morning (26.10, 08:14) at real speed so breaks and the kiosk clock look alive.
 */

const wait = (min = 80, max = 240) => new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
const clone = <T,>(x: T): T => structuredClone(x);

const startedAt = Date.now();
const demoEpoch = new Date(DEMO_NOW_ISO).getTime();
/** Demo "now": 26.10 08:14:52 Warsaw plus the time since the page opened. */
export function mobileNow(): Date {
  return new Date(demoEpoch + (Date.now() - startedAt));
}
const WARSAW = "Europe/Warsaw";
function siteClock(d: Date): { date: string; time: string; min: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: WARSAW, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const time = `${parts.hour}:${parts.minute}`;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time, min: toMinutes(time) };
}
const nowIso = () => mobileNow().toISOString();
/** Absolute minutes since the start of DEMO_TODAY (site time). */
function nowAbs(): number {
  const c = siteClock(mobileNow());
  return (c.date > DEMO_TODAY ? 1440 : 0) + c.min;
}

/* ------------------------------------------------------------------------ state */

interface EventMeta {
  assignmentId: string;
  status: "accepted" | "flagged" | "pending" | "rejected";
  at: string;
  approvedByName?: string;
  manualByName?: string;
  reason?: string;
  comment?: string;
  /** Site of an event without an assignment (kiosk clock-in with no shift today). */
  siteId?: string;
}
const meta = new Map<string, EventMeta>();
const idempotent = new Map<string, unknown>();
const issues: (ClockIssue & { workerId: string; assignmentId: string; createdByName: string })[] = seedIssues.map((s) => ({
  id: s.id,
  workerId: s.workerId,
  assignmentId: s.assignmentId,
  kind: s.kind,
  type: s.type,
  time: s.time,
  comment: s.comment,
  status: "open",
  createdAt: `${DEMO_TODAY}T${s.createdAt}:00+01:00`,
  createdByName: nameOf(s.workerId),
}));

interface UrgentOffer {
  id: string;
  requestId: string;
  workerId: string;
  templateId: string;
  date: string;
  bonusPoints: number;
  status: "sent" | "accepted" | "declined" | "closed";
  replacesId?: string;
}
interface UrgentReq {
  id: string;
  templateId: string;
  date: string;
  needed: number;
  accepted: number;
  replacesId?: string;
}
const urgentRequests: UrgentReq[] = [{ id: seedUrgent.requestId, templateId: seedUrgent.templateId, date: seedUrgent.date, needed: seedUrgent.headcount, accepted: 0 }];
const offers: UrgentOffer[] = [
  { id: seedUrgent.offerId, requestId: seedUrgent.requestId, workerId: seedUrgent.workerId, templateId: seedUrgent.templateId, date: seedUrgent.date, bonusPoints: seedUrgent.bonusPoints, status: "sent" },
];
const outputs = new Map<string, { value: number; updatedAt: string }>([[`${seedOutput.siteId}|${seedOutput.date}|${seedOutput.start}`, { value: seedOutput.value, updatedAt: `${DEMO_TODAY}T${seedOutput.updatedAt}:00+01:00` }]]);
const pins = new Map<string, string>();
const consent = new Set(biometricConsent);
const kioskFails = new Map<string, { count: number; lockedUntil?: number }>();
const tickets = new Map<string, { workerId: string; until: number }>();
const kioskRecent: KioskRecent[] = [];
const userNotes = new Map<string, NotificationItem[]>();
let assignmentSeq = 1;

function nameOf(workerId: string) {
  const w = workers.find((x) => x.id === workerId)!;
  return `${w.firstName} ${w.lastName}`;
}
const shortName = (w: Worker) => `${w.firstName} ${w.lastName.slice(0, 1)}.`;
const tplOf = (id: string) => templates.find((t) => t.id === id)!;
const siteOfTpl = (t: ShiftTemplate): Site => sites.find((s) => s.id === projects.find((p) => p.id === t.projectId)!.siteId)!;
const posName = (id: string) => positions.find((p) => p.id === id)!.name;
const active = (a: Assignment) => a.status === "confirmed" || a.status === "proposed";

function notify(userId: string, title: NotificationItem["title"], href?: string) {
  const list = userNotes.get(userId) ?? [];
  list.unshift({ id: `mn-${Date.now()}-${list.length}`, kind: "approval", title, at: nowIso(), read: false, href });
  userNotes.set(userId, list);
}
const userOfWorker = (workerId: string) => workerUsers.find((u) => u.workerId === workerId);
const t4 = (ru: string, uk: string, pl: string, en: string) => ({ ru, uk, pl, en });

/* ---------------------------------------------------------------------- helpers */

function shiftView(a: Assignment): MobileShift {
  const t = tplOf(a.templateId);
  const s = siteOfTpl(t);
  return { id: a.id, kind: "assignment", date: a.date, start: t.start, end: t.end, siteId: s.id, siteName: s.name, positionId: t.positionId, positionName: posName(t.positionId), status: a.status === "proposed" ? "proposed" : "confirmed" };
}
function offerView(o: UrgentOffer): MobileShift {
  const t = tplOf(o.templateId);
  const s = siteOfTpl(t);
  return { id: o.id, kind: "offer", date: o.date, start: t.start, end: t.end, siteId: s.id, siteName: s.name, positionId: t.positionId, positionName: posName(t.positionId), status: "offer", bonusPoints: o.bonusPoints };
}
function siteRules(s: Site): MobileSiteRules {
  return { id: s.id, name: s.name, lat: s.lat, lng: s.lng, radiusM: 160, requiredAccuracyM: 100, outsideGeofence: s.outsideGeofence, methods: s.clockMethods, clockWindowMin: s.clockWindowMin, lateThresholdMin: s.lateThresholdMin, demoQrPayload: `kadreo-qr:${s.id}:1:demo` };
}

function eventsOf(workerId: string, date: string): ClockEvent[] {
  return clockEvents.filter((c) => c.workerId === workerId && c.date === date && meta.get(c.id)?.status !== "rejected");
}
function eventView(c: ClockEvent): ClockEventView {
  const m = meta.get(c.id);
  return { id: c.id, type: c.type, time: c.time, at: m?.at ?? `${c.date}T${c.time}:00+01:00`, source: c.source, status: m?.status ?? "accepted", offline: !!c.offline, approvedByName: m?.approvedByName };
}
function stateOf(evs: ClockEvent[]): ClockState {
  const last = evs[evs.length - 1];
  if (!last) return "before";
  if (last.type === "out") return "finished";
  if (last.type === "break_start") return "on_break";
  return "on_shift";
}
const allowedNext: Record<ClockState, ClockType[]> = { before: ["in"], on_shift: ["break_start", "out"], on_break: ["break_end"], finished: [], no_shift: [] };

/** Today's shift of a worker: today's assignment, or last night's one that is still running. */
function currentAssignment(workerId: string): Assignment | null {
  const abs = nowAbs();
  const mine = assignments.filter((a) => a.workerId === workerId && a.status === "confirmed" && (a.date === DEMO_TODAY || a.date === addDays(DEMO_TODAY, -1)));
  for (const a of mine) {
    const t = tplOf(a.templateId);
    const [, e] = shiftInterval(a.date, t.start, t.end, DEMO_TODAY);
    const finished = eventsOf(workerId, a.date).some((c) => c.type === "out");
    if (a.date === DEMO_TODAY || (abs < e && !finished)) return a;
  }
  return null;
}

function workerOf(userKey: MobileDemoUserKey): Worker {
  const u = workerUsers.find((x) => x.id === (userKey === "leader" ? "u-oleh" : "u-viktor"))!;
  return workers.find((w) => w.id === u.workerId)!;
}

/* -------------------------------------------------------------------- clocking */

function recordClock(workerId: string, a: Pick<Assignment, "id" | "date">, type: ClockType, source: ClockEvent["source"], detail: string, m: Omit<EventMeta, "assignmentId" | "at">, time?: string, offline?: boolean): ClockEvent {
  const ev: ClockEvent = { id: `ce-m-${Date.now()}-${clockEvents.length}`, workerId, date: a.date, type, time: time ?? siteClock(mobileNow()).time, source, detail, offline };
  clockEvents.push(ev);
  meta.set(ev.id, { assignmentId: a.id, at: nowIso(), ...m });
  return ev;
}

function lateMinutes(a: Assignment, time: string): number {
  const t = tplOf(a.templateId);
  const s = siteOfTpl(t);
  const late = toMinutes(time) - toMinutes(t.start);
  return late > s.lateThresholdMin ? late : 0;
}

/* ---------------------------------------------------------------- team leader */

function brigadeShiftsFor(siteId: string): BrigadeShift[] {
  const site = sites.find((s) => s.id === siteId)!;
  const tpls = templates.filter((t) => siteOfTpl(t).id === siteId);
  const out: BrigadeShift[] = [];
  for (const date of [DEMO_TODAY, addDays(DEMO_TODAY, 1)]) {
    for (const t of tpls) {
      if (!plans.some((p) => p.templateId === t.id && p.date === date && p.planned > 0)) continue;
      const key = `${siteId}|${date}|${t.start}`;
      if (!out.some((x) => x.key === key)) out.push({ key, siteId, siteName: site.name, date, start: t.start, end: t.end });
    }
  }
  return out.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

function currentShiftKey(siteId: string): string {
  const abs = nowAbs();
  const list = brigadeShiftsFor(siteId);
  const running = list.find((s) => {
    const [a, b] = shiftInterval(s.date, s.start, s.end, DEMO_TODAY);
    return a <= abs && abs < b;
  });
  return (running ?? list.find((s) => shiftInterval(s.date, s.start, s.end, DEMO_TODAY)[0] > abs) ?? list[0]!).key;
}

function buildBrigade(shiftKey: string, excludeWorkerId?: string): BrigadeView {
  const [siteId, date, start] = shiftKey.split("|") as [string, string, string];
  const site = sites.find((s) => s.id === siteId)!;
  const tpls = templates.filter((t) => siteOfTpl(t).id === siteId && t.start === start);
  const shift = brigadeShiftsFor(siteId).find((s) => s.key === shiftKey) ?? { key: shiftKey, siteId, siteName: site.name, date, start, end: tpls[0]?.end ?? start };
  const abs = nowAbs();
  const [shiftStart, shiftEnd] = shiftInterval(date, start, shift.end, DEMO_TODAY);
  const todays = assignments.filter((a) => a.date === date && active(a) && tpls.some((t) => t.id === a.templateId) && a.workerId !== excludeWorkerId);
  const replacedIds = new Set(todays.map((a) => a.replacesId).filter(Boolean) as string[]);
  const members: BrigadeMember[] = [];
  for (const a of todays) {
    if (replacedIds.has(a.id)) continue; // the replacement's card stands for this slot
    const w = workers.find((x) => x.id === a.workerId)!;
    const evs = eventsOf(a.workerId, a.date);
    const firstIn = evs.find((c) => c.type === "in");
    const issue = issues.filter((i) => i.assignmentId === a.id && i.status === "open").pop() ?? null;
    const elapsed = abs - shiftStart;
    const pendingManual = evs.some((c) => meta.get(c.id)?.status === "pending");
    let status: BrigadeMember["status"];
    if (firstIn) {
      const st = stateOf(evs);
      status = pendingManual ? "manual_pending" : st === "on_break" ? "on_break" : st === "finished" ? "finished" : "on_site";
    } else if (elapsed < 0) status = "late"; // not started yet: shown in the plan, not as a problem
    else if (elapsed < NO_SHOW_AFTER_MIN || issue?.kind === "late") status = "late";
    else status = "no_show";
    const searching = urgentRequests.some((r) => r.replacesId === a.id && r.accepted < r.needed);
    const lateMin = firstIn ? lateMinutes(a, firstIn.time) : Math.max(0, elapsed);
    const outside = evs.some((c) => meta.get(c.id)?.status === "flagged");
    const notStarted = !firstIn && elapsed < 0;
    members.push({
      assignmentId: a.id,
      templateId: a.templateId,
      workerId: w.id,
      firstName: w.firstName,
      lastName: w.lastName,
      number: w.number,
      phone: w.phone,
      positionId: tplOf(a.templateId).positionId,
      positionName: posName(tplOf(a.templateId).positionId),
      status,
      clockIn: firstIn?.time ?? null,
      lateMin,
      issue: issue ? { kind: issue.kind, time: issue.time, comment: issue.comment } : null,
      outsideGeofence: outside,
      replacement: searching ? { status: "searching" } : null,
      isReplacement: !!a.replacesId || replacementAssignmentIds.has(a.id),
      needsAttention: !notStarted && (status === "no_show" || status === "late" || status === "manual_pending" || outside || !!issue),
    });
  }
  const rank = (m: BrigadeMember) => (m.status === "no_show" ? 0 : m.status === "late" ? 1 : m.needsAttention ? 2 : 3);
  members.sort((a, b) => rank(a) - rank(b) || a.lastName.localeCompare(b.lastName));
  const counters = {
    planned: members.length,
    onSite: members.filter((m) => ["on_site", "on_break", "finished", "manual_pending"].includes(m.status)).length,
    late: members.filter((m) => m.status === "late" && abs >= shiftStart).length,
    noShow: members.filter((m) => m.status === "no_show").length,
  };
  const out = siteOutput[siteId];
  const stored = outputs.get(shiftKey);
  const share = Math.min(1, Math.max(0, (abs - shiftStart) / (shiftEnd - shiftStart)));
  return {
    now: nowIso(),
    shift,
    shifts: brigadeShiftsFor(siteId),
    noShowAfterMin: NO_SHOW_AFTER_MIN,
    counters,
    members,
    output: out ? { ...out, value: stored?.value ?? 0, updatedAt: stored?.updatedAt ?? null, planNow: Math.round(out.norm * share) } : null,
  };
}

/* -------------------------------------------------------------------- manager */

function decisionsList(): Decision[] {
  const out: Decision[] = [];
  for (const c of clockEvents) {
    const m = meta.get(c.id);
    if (m?.status !== "pending") continue;
    const a = assignments.find((x) => x.id === m.assignmentId);
    const siteName = a ? siteOfTpl(tplOf(a.templateId)).name : sites.find((s) => s.id === m.siteId)?.name ?? "";
    out.push({ id: c.id, kind: "manual_clock", workerName: nameOf(c.workerId), siteName, requestedByName: m.manualByName ?? "", at: m.at, time: c.time, type: c.type, reason: m.reason ?? "other", comment: m.comment ?? "" });
  }
  for (const i of issues) {
    if (i.status !== "open" || i.kind === "late") continue;
    const a = assignments.find((x) => x.id === i.assignmentId)!;
    out.push({ id: i.id, kind: "clock_issue", workerName: nameOf(i.workerId), siteName: siteOfTpl(tplOf(a.templateId)).name, requestedByName: i.createdByName, at: i.createdAt, time: i.time, type: i.type, reason: i.kind, comment: i.comment });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/* ------------------------------------------------------------------------ API */

export function createMobileMockApi(userKey: MobileDemoUserKey): MobileApi {
  const office = createMockApi();
  let locale: Locale = "ru";

  function me(): CurrentUser {
    if (userKey === "manager") {
      return { id: "u-marta", fullName: "Marta Kowalska", initials: "MK", email: "marta.kowalska@demo-outsourcing.pl", locale, roles: ["OPS_MANAGER", "TENANT_ADMIN"], activeRole: "OPS_MANAGER", permissions: permissionsFor("OPS_MANAGER"), scope: { regions: [], siteIds: [] } };
    }
    if (userKey === "kiosk") {
      return { id: kioskDevice.userId, fullName: kioskDevice.code, initials: "K", email: kioskDevice.email, locale, roles: ["KIOSK"], activeRole: "KIOSK", permissions: [], scope: { regions: [], siteIds: [kioskDevice.siteId] } };
    }
    const u = workerUsers.find((x) => x.id === (userKey === "leader" ? "u-oleh" : "u-viktor"))!;
    const roles = u.roles as RoleCode[];
    const [first, last] = u.fullName.split(" ");
    return { id: u.id, fullName: u.fullName, initials: `${first![0]}${last![0]}`, email: u.email, locale, roles, activeRole: roles[0]!, permissions: permissionsFor(roles[0]!), scope: { regions: [], siteIds: u.leadsSiteId ? [u.leadsSiteId] : [] } };
  }
  const myUserId = () => me().id;

  function requireRole(...roles: RoleCode[]) {
    if (!me().roles.some((r) => roles.includes(r))) throw new ApiError(403, { code: "forbidden", permission: roles.join("|") });
  }

  function today(): WorkerToday {
    const w = workerOf(userKey);
    const a = currentAssignment(w.id);
    const evs = a ? eventsOf(w.id, a.date) : [];
    const t = a ? tplOf(a.templateId) : null;
    const site = t ? siteOfTpl(t) : null;
    const after = assignments
      .filter((x) => x.workerId === w.id && active(x) && x.date > DEMO_TODAY)
      .map(shiftView);
    const myOffers = offers.filter((o) => o.workerId === w.id && o.status === "sent").map(offerView);
    const upcoming = [...after, ...myOffers].sort((x, y) => (x.date + x.start).localeCompare(y.date + y.start));
    const st: ClockState = a ? stateOf(evs) : "no_shift";
    return {
      now: nowIso(),
      worker: { id: w.id, firstName: w.firstName, lastName: w.lastName, number: w.number },
      shift: a ? shiftView(a) : null,
      site: site ? siteRules(site) : null,
      state: st,
      events: evs.map(eventView),
      opensAt: t && site ? fromMinutes(toMinutes(t.start) - site.clockWindowMin) : null,
      upcoming: upcoming.slice(0, 2),
      nextShift: a ? null : upcoming[0] ?? null,
      unread: (userNotes.get(myUserId()) ?? []).filter((n) => !n.read).length,
      issues: issues.filter((i) => i.workerId === w.id).map(({ workerId: _w, assignmentId: _a, createdByName: _c, ...rest }) => rest),
    };
  }

  function acceptOffer(o: UrgentOffer) {
    const r = urgentRequests.find((x) => x.id === o.requestId)!;
    if (o.status !== "sent" || r.accepted >= r.needed) {
      o.status = "closed";
      throw new ApiError(409, { code: "taken" });
    }
    o.status = "accepted";
    r.accepted++;
    const a: Assignment = { id: `as-m-${assignmentSeq++}`, workerId: o.workerId, templateId: o.templateId, date: o.date, source: "manual", status: "confirmed", replacesId: o.replacesId };
    assignments.push(a);
    if (o.replacesId) replacementAssignmentIds.add(a.id);
    if (r.accepted >= r.needed) for (const x of offers) if (x.requestId === r.id && x.status === "sent") x.status = "closed";
    notify("u-marta", t4(`Срочная смена: ${nameOf(o.workerId)} принял(а)`, `Термінова зміна: ${nameOf(o.workerId)} прийняв(ла)`, `Pilna zmiana: ${nameOf(o.workerId)} przyjął(ęła)`, `Urgent shift: ${nameOf(o.workerId)} accepted`));
  }

  function makeOffers(templateId: string, date: string, workerIds: string[], needed: number, bonusPoints: number, replacesId?: string) {
    const r: UrgentReq = { id: `ur-m-${Date.now()}`, templateId, date, needed, accepted: 0, replacesId };
    urgentRequests.push(r);
    for (const wid of workerIds) {
      offers.push({ id: `uo-m-${Date.now()}-${wid}`, requestId: r.id, workerId: wid, templateId, date, bonusPoints, status: "sent", replacesId });
      const u = userOfWorker(wid);
      if (u) notify(u.id, t4("Новое предложение смены", "Нова пропозиція зміни", "Nowa propozycja zmiany", "New shift offer"));
    }
    return r;
  }

  function eligibleFor(templateId: string, date: string, limit: number): string[] {
    const t = tplOf(templateId);
    const busy = new Set(assignments.filter((a) => a.date === date && active(a)).map((a) => a.workerId));
    return workers
      .filter((w) => (w.status === "active" || w.status === "free") && w.positionIds.includes(t.positionId) && !busy.has(w.id))
      .slice(0, limit)
      .map((w) => w.id);
  }

  function leaderSite() {
    return workerUsers.find((u) => u.id === "u-oleh")!.leadsSiteId!;
  }

  return {
    async me() {
      await wait(40, 90);
      return me();
    },
    async updateLocale(l) {
      locale = l;
      setDemoLocale(l);
    },
    async notifications() {
      await wait();
      if (userKey === "manager") return office.notifications();
      return clone(userNotes.get(myUserId()) ?? []);
    },
    async markAllNotificationsRead() {
      if (userKey === "manager") return office.markAllNotificationsRead();
      for (const n of userNotes.get(myUserId()) ?? []) n.read = true;
    },

    /* ------------------------------------------------------------- worker */
    async today() {
      requireRole("WORKER");
      await wait();
      return clone(today());
    },
    async myShifts(from, to) {
      requireRole("WORKER");
      await wait();
      const w = workerOf(userKey);
      const list = assignments.filter((a) => a.workerId === w.id && active(a) && a.date >= from && a.date <= to).map(shiftView);
      const o = offers.filter((x) => x.workerId === w.id && x.status === "sent" && x.date >= from && x.date <= to).map(offerView);
      return clone([...list, ...o].sort((x, y) => (x.date + x.start).localeCompare(y.date + y.start)));
    },
    async clock(input) {
      requireRole("WORKER");
      await wait(200, 450);
      const key = `${myUserId()}|${input.idempotencyKey}`;
      if (idempotent.has(key)) return clone(idempotent.get(key)) as never;
      const w = workerOf(userKey);
      const a = assignments.find((x) => x.id === input.assignmentId && x.workerId === w.id);
      if (!a || a.status !== "confirmed") throw new ApiError(422, { code: "clock_rejected", reason: "no_shift" });
      const t = tplOf(a.templateId);
      const site = siteOfTpl(t);
      const skew = Math.abs(new Date(input.deviceTime).getTime() - mobileNow().getTime());
      if (!input.offline && skew > 5 * 60000) throw new ApiError(422, { code: "clock_rejected", reason: "clock_skew" });
      const evs = eventsOf(w.id, a.date);
      if (!allowedNext[stateOf(evs)].includes(input.type)) throw new ApiError(422, { code: "clock_rejected", reason: "wrong_state" });
      const time = input.offline ? siteClock(new Date(input.deviceTime)).time : siteClock(mobileNow()).time;
      if (input.type === "in") {
        const opens = toMinutes(t.start) - site.clockWindowMin;
        const [s] = shiftInterval(a.date, t.start, t.end, DEMO_TODAY);
        if (nowAbs() < s - site.clockWindowMin) throw new ApiError(422, { code: "clock_rejected", reason: "too_early", opensAt: fromMinutes(opens) });
      }
      let outcome: "accepted" | "flagged" = "accepted";
      let dist: number | null = null;
      if (input.method === "qr") {
        if (!input.qrPayload?.startsWith(`kadreo-qr:${site.id}:`)) throw new ApiError(422, { code: "clock_rejected", reason: "bad_qr" });
      } else {
        if (input.lat === undefined || input.lng === undefined) throw new ApiError(422, { code: "clock_rejected", reason: "low_accuracy" });
        if ((input.accuracyM ?? 999) > 100) throw new ApiError(422, { code: "clock_rejected", reason: "low_accuracy" });
        dist = distanceM(input.lat, input.lng, site.lat, site.lng);
        if (dist > 160) {
          if (site.outsideGeofence === "deny") throw new ApiError(422, { code: "clock_rejected", reason: "outside_geofence", distanceM: dist });
          if (!input.comment?.trim()) throw new ApiError(422, { code: "clock_rejected", reason: "comment_required", distanceM: dist });
          outcome = "flagged";
        }
      }
      const detail = input.method === "qr" ? "QR" : `GPS ${Math.round(input.accuracyM ?? 0)} m${input.photo ? " · foto" : ""}`;
      const ev = recordClock(w.id, a, input.type, input.method === "qr" ? "qr" : "gps_photo", detail, { status: outcome, comment: input.comment }, time, input.offline);
      const result = { event: eventView(ev), outcome, lateMin: input.type === "in" ? lateMinutes(a, ev.time) : 0, distanceM: dist };
      idempotent.set(key, result);
      return clone(result);
    },
    async reportIssue(input) {
      requireRole("WORKER");
      await wait();
      const w = workerOf(userKey);
      if (!assignments.some((a) => a.id === input.assignmentId && a.workerId === w.id)) throw new ApiError(404, { code: "not_found" });
      if (input.comment.length > 500) throw new ApiError(400, { code: "bad_request", message: "comment" });
      const issue = { id: `ci-m-${Date.now()}`, workerId: w.id, assignmentId: input.assignmentId, createdByName: nameOf(w.id), kind: input.kind, type: input.type, time: input.time, comment: input.comment, status: "open" as const, createdAt: nowIso() };
      issues.push(issue);
      const { workerId: _w, assignmentId: _a, createdByName: _c, ...view } = issue;
      return clone(view);
    },
    async respondToShift(shift, decision) {
      requireRole("WORKER");
      await wait(200, 400);
      const w = workerOf(userKey);
      if (shift.kind === "offer") {
        const o = offers.find((x) => x.id === shift.id && x.workerId === w.id);
        if (!o) throw new ApiError(404, { code: "not_found" });
        if (decision === "accept") acceptOffer(o);
        else o.status = "declined";
        return;
      }
      const a = assignments.find((x) => x.id === shift.id && x.workerId === w.id);
      if (!a) throw new ApiError(404, { code: "not_found" });
      a.status = decision === "accept" ? "confirmed" : "declined";
    },
    async myDocuments() {
      requireRole("WORKER");
      await wait();
      const w = workerOf(userKey);
      return clone(documents.filter((d) => d.workerId === w.id));
    },
    async profile() {
      requireRole("WORKER");
      await wait();
      return clone(profileOf());
    },
    async setBiometricConsent(c) {
      const w = workerOf(userKey);
      if (c) consent.add(w.id);
      else consent.delete(w.id);
      return clone(profileOf());
    },
    async setKioskPin(pin) {
      if (!/^\d{6}$/.test(pin)) throw new ApiError(400, { code: "bad_request", message: "pin" });
      pins.set(workerOf(userKey).id, pin);
      return clone(profileOf());
    },
    async kioskQr() {
      requireRole("WORKER");
      const w = workerOf(userKey);
      const slot = Math.floor(mobileNow().getTime() / 30000);
      return { payload: `kadreo-kiosk:${w.id}:${slot}`, expiresAt: new Date((slot + 1) * 30000).toISOString() };
    },

    /* -------------------------------------------------------- team leader */
    async brigade(shiftKey) {
      requireRole("TEAM_LEADER");
      await wait();
      const site = leaderSite();
      return clone(buildBrigade(shiftKey ?? currentShiftKey(site), workerOf(userKey).id));
    },
    async requestReplacement(assignmentId) {
      requireRole("TEAM_LEADER", "OPS_MANAGER", "SITE_MANAGER");
      await wait(200, 400);
      const a = assignments.find((x) => x.id === assignmentId)!;
      if (urgentRequests.some((r) => r.replacesId === a.id && r.accepted < r.needed)) throw new ApiError(409, { code: "conflict", byName: "", at: "" });
      makeOffers(a.templateId, a.date, eligibleFor(a.templateId, a.date, 4), 1, 0, a.id);
      notify("u-marta", t4(`Запрос замены: ${nameOf(a.workerId)}`, `Запит заміни: ${nameOf(a.workerId)}`, `Prośba o zastępstwo: ${nameOf(a.workerId)}`, `Replacement request: ${nameOf(a.workerId)}`));
      const t = tplOf(a.templateId);
      return clone(buildBrigade(`${siteOfTpl(t).id}|${a.date}|${t.start}`, userKey === "leader" ? workerOf(userKey).id : undefined));
    },
    async manualClock(input) {
      requireRole("TEAM_LEADER");
      await wait(200, 400);
      const self = workerOf(userKey);
      const a = assignments.find((x) => x.id === input.assignmentId)!;
      if (a.workerId === self.id) throw new ApiError(403, { code: "forbidden", permission: "clockevent.manual.self" });
      if (!input.comment.trim() && input.reason === "other") throw new ApiError(400, { code: "bad_request", message: "comment" });
      const evs = eventsOf(a.workerId, a.date);
      if (!allowedNext[stateOf(evs)].includes(input.type)) throw new ApiError(422, { code: "clock_rejected", reason: "wrong_state" });
      recordClock(a.workerId, a, input.type, "manual", `ręcznie · ${nameOf(self.id)}`, { status: "pending", manualByName: nameOf(self.id), reason: input.reason, comment: input.comment }, input.time);
      for (const i of issues) if (i.assignmentId === a.id && i.status === "open" && i.kind !== "late") i.status = "approved";
      const t = tplOf(a.templateId);
      return clone(buildBrigade(`${siteOfTpl(t).id}|${a.date}|${t.start}`, self.id));
    },
    async recordOutput(shiftKey, value) {
      requireRole("TEAM_LEADER");
      await wait();
      const siteId = shiftKey.split("|")[0]!;
      if (siteOutput[siteId]?.source !== "team_leader") throw new ApiError(403, { code: "forbidden", permission: "output.client_source" });
      if (!Number.isFinite(value) || value < 0) throw new ApiError(400, { code: "bad_request", message: "value" });
      outputs.set(shiftKey, { value: Math.round(value), updatedAt: nowIso() });
      return clone(buildBrigade(shiftKey, workerOf(userKey).id));
    },
    async replyToWorker(workerId, text) {
      requireRole("TEAM_LEADER");
      await wait();
      const u = userOfWorker(workerId);
      if (u) notify(u.id, { ru: text, uk: text, pl: text, en: text });
    },

    /* -------------------------------------------------------------- manager */
    async managerSummary() {
      requireRole("OPS_MANAGER", "SITE_MANAGER");
      await wait(150, 300);
      const open = alerts.filter((a) => a.status !== "closed");
      const lives = sites.map((s) => computeSiteLive(s.id, open)).filter((l) => l.planned > 0);
      const onShift = lives.reduce((n, l) => n + l.actual, 0);
      const planned = lives.reduce((n, l) => n + l.planned, 0);
      const problems: ProblemSite[] = lives
        .filter((l) => l.status !== "ok")
        .map((l) => {
          const unreplacedNoShow = assignments.find((a) => {
            if (a.date !== DEMO_TODAY || !active(a) || siteOfTpl(tplOf(a.templateId)).id !== l.siteId) return false;
            const t = tplOf(a.templateId);
            const [s, e] = shiftInterval(a.date, t.start, t.end, DEMO_TODAY);
            const abs = nowAbs();
            return s <= abs && abs < e && s + 30 < abs && !eventsOf(a.workerId, a.date).length && !assignments.some((r) => r.replacesId === a.id);
          });
          return {
            siteId: l.siteId,
            siteName: l.siteName,
            onSite: l.actual,
            planned: l.planned,
            severity: l.status === "critical" ? ("critical" as const) : ("warn" as const),
            noShows: l.noShows,
            unreplaced: l.noShows - l.noShowsReplaced,
            late: l.late,
            templateId: unreplacedNoShow?.templateId ?? null,
            replacesId: unreplacedNoShow?.id ?? null,
          };
        })
        .sort((a, b) => (a.severity === b.severity ? b.unreplaced - a.unreplaced || b.planned - b.onSite - (a.planned - a.onSite) : a.severity === "critical" ? -1 : 1));
      const ds = decisionsList();
      const target = contracts[0]?.kpiTargets.staffingPct ?? 98;
      const summary: ManagerSummary = {
        now: nowIso(),
        sitesInScope: lives.length,
        staffing: { onShift, planned, pct: planned ? Math.round((onShift / planned) * 1000) / 10 : 100, targetPct: target },
        problemSites: problems.slice(0, 3),
        problemSitesTotal: problems.length,
        decisions: ds.slice(0, 3),
        decisionsTotal: ds.length,
        openAlerts: open.length,
      };
      return clone(summary);
    },
    async alerts() {
      return office.alerts({ status: "open", limit: 50 });
    },
    async sites() {
      return office.dashboardSites({});
    },
    async siteBrigade(siteId) {
      requireRole("OPS_MANAGER", "SITE_MANAGER");
      await wait();
      return clone(buildBrigade(currentShiftKey(siteId)));
    },
    async decisions() {
      requireRole("OPS_MANAGER", "SITE_MANAGER");
      await wait();
      return clone(decisionsList());
    },
    async decide(id, kind, decision, reason) {
      requireRole("OPS_MANAGER", "SITE_MANAGER");
      await wait(150, 300);
      if (decision === "reject" && !reason?.trim()) throw new ApiError(400, { code: "bad_request", message: "reason" });
      const by = me().fullName;
      if (kind === "manual_clock") {
        const m = meta.get(id);
        if (!m || m.status !== "pending") throw new ApiError(409, { code: "conflict", byName: m?.approvedByName ?? "", at: "" });
        m.status = decision === "approve" ? "accepted" : "rejected";
        m.approvedByName = by;
        return;
      }
      const i = issues.find((x) => x.id === id);
      if (!i || i.status !== "open") throw new ApiError(409, { code: "conflict", byName: "", at: "" });
      i.status = decision === "approve" ? "approved" : "rejected";
      i.decidedByName = by;
      i.decisionReason = reason;
      if (decision === "approve") {
        const a = assignments.find((x) => x.id === i.assignmentId)!;
        recordClock(i.workerId, a, i.type, "manual", `ręcznie · ${by}`, { status: "accepted", approvedByName: by, manualByName: i.createdByName, reason: i.kind, comment: i.comment }, i.time);
      }
      const u = userOfWorker(i.workerId);
      if (u) notify(u.id, decision === "approve" ? t4("Отметка одобрена", "Відмітку схвалено", "Odbicie zatwierdzone", "Clock-in approved") : t4(`Отметка отклонена: ${reason}`, `Відмітку відхилено: ${reason}`, `Odbicie odrzucone: ${reason}`, `Clock-in rejected: ${reason}`));
    },
    async candidates(templateId, date) {
      return office.candidates(templateId, date);
    },
    async offerShift(input) {
      requireRole("OPS_MANAGER", "SITE_MANAGER");
      await wait(200, 400);
      if (!input.workerIds.length) throw new ApiError(400, { code: "bad_request", message: "workerIds" });
      makeOffers(input.templateId, input.date, input.workerIds, 1, input.bonusPoints ?? 0, input.replacesId);
      return { offered: input.workerIds.length };
    },
    async urgentShift(input) {
      requireRole("OPS_MANAGER", "SITE_MANAGER");
      await wait(250, 450);
      const ids = eligibleFor(input.templateId, input.date, input.headcount * 4);
      makeOffers(input.templateId, input.date, ids, input.headcount, input.bonusPoints);
      return { offered: ids.length };
    },
    async broadcast(input) {
      requireRole("OPS_MANAGER", "SITE_MANAGER");
      await wait(200, 400);
      if (!input.text.trim()) throw new ApiError(400, { code: "bad_request", message: "text" });
      const today = new Set(assignments.filter((a) => a.date === DEMO_TODAY && active(a) && siteOfTpl(tplOf(a.templateId)).id === input.siteId).map((a) => a.workerId));
      for (const u of workerUsers) if (today.has(u.workerId)) notify(u.id, { ru: input.text, uk: input.text, pl: input.text, en: input.text });
      return { recipients: today.size };
    },
    async siteTemplates() {
      const list = await office.sitesWithTemplates();
      return list.map((x) => ({ siteId: x.site.id, siteName: x.site.name, templates: x.templates }));
    },

    /* ---------------------------------------------------------------- kiosk */
    async kioskState() {
      requireRole("KIOSK");
      await wait(60, 120);
      const site = sites.find((s) => s.id === kioskDevice.siteId)!;
      if (!kioskRecent.length) {
        // This morning at the kiosk: the latest clock-ins from the kiosk and card reader.
        const todays = clockEvents
          .filter((c) => c.date === DEMO_TODAY && (c.source === "kiosk" || c.source === "access_card") && kioskWorkerIds.includes(c.workerId))
          .sort((a, b) => b.time.localeCompare(a.time))
          .slice(0, 5);
        for (const c of todays) kioskRecent.push({ name: shortName(workers.find((w) => w.id === c.workerId)!), type: c.type, time: c.time, outcome: "accepted" });
      }
      return clone({ now: nowIso(), device: { id: kioskDevice.id, code: kioskDevice.code, siteId: site.id, siteName: site.name, entry: kioskDevice.entry, faceEnabled: kioskDevice.faceEnabled }, recent: kioskRecent.slice(0, 5) });
    },
    async kioskIdentify(input) {
      requireRole("KIOSK");
      await wait(150, 300);
      let workerId: string | undefined;
      const lockKey = input.method === "pin" ? input.number.toUpperCase() : "";
      if (input.method === "pin") {
        const f = kioskFails.get(lockKey);
        if (f?.lockedUntil && f.lockedUntil > Date.now()) throw new ApiError(401, { code: "kiosk_auth", attemptsLeft: 0, lockedUntil: new Date(f.lockedUntil).toISOString() });
        const w = workers.find((x) => x.number.toUpperCase() === lockKey || x.number.replace(/\D/g, "") === input.number.replace(/\D/g, "").padStart(5, "0"));
        const expected = w ? pins.get(w.id) ?? (kioskWorkerIds.includes(w.id) ? demoPin(w.number) : null) : null;
        if (!w || !expected || expected !== input.pin) {
          const count = (f?.count ?? 0) + 1;
          const lockedUntil = count >= 5 ? Date.now() + 15 * 60000 : undefined;
          kioskFails.set(lockKey, { count: lockedUntil ? 0 : count, lockedUntil });
          kioskRecent.unshift({ name: "—", type: "unrecognized", time: siteClock(mobileNow()).time, outcome: "unrecognized" });
          throw new ApiError(401, { code: "kiosk_auth", attemptsLeft: lockedUntil ? 0 : 5 - count, lockedUntil: lockedUntil ? new Date(lockedUntil).toISOString() : undefined });
        }
        kioskFails.delete(lockKey);
        workerId = w.id;
      } else if (input.method === "card") {
        workerId = kioskWorkerIds.find((id) => demoCardUid(id) === input.uid.trim().toUpperCase());
      } else {
        const m = /^kadreo-kiosk:([^:]+):(\d+)$/.exec(input.payload);
        const slot = Math.floor(mobileNow().getTime() / 30000);
        if (m && Math.abs(Number(m[2]) - slot) <= 1) workerId = m[1];
      }
      if (!workerId) {
        kioskRecent.unshift({ name: "—", type: "unrecognized", time: siteClock(mobileNow()).time, outcome: "unrecognized" });
        throw new ApiError(401, { code: "kiosk_auth", attemptsLeft: 5 });
      }
      const w = workers.find((x) => x.id === workerId)!;
      const a = currentAssignment(w.id);
      const t = a ? tplOf(a.templateId) : null;
      const onThisSite = a && t && siteOfTpl(t).id === kioskDevice.siteId;
      const st: ClockState = onThisSite ? stateOf(eventsOf(w.id, a!.date)) : "no_shift";
      const ticket = `kt-${Date.now()}-${w.id}`;
      tickets.set(ticket, { workerId: w.id, until: Date.now() + 60000 });
      const identity: KioskIdentity = { ticket, name: shortName(w), actions: st === "no_shift" ? ["in"] : allowedNext[st], shift: onThisSite ? { start: t!.start, end: t!.end } : null, state: st };
      return clone(identity);
    },
    async kioskClock(input) {
      requireRole("KIOSK");
      await wait(150, 300);
      const key = `kiosk|${input.idempotencyKey}`;
      if (idempotent.has(key)) return clone(idempotent.get(key)) as never;
      const tk = tickets.get(input.ticket);
      if (!tk || tk.until < Date.now()) throw new ApiError(401, { code: "kiosk_auth", attemptsLeft: 5 });
      tickets.delete(input.ticket);
      const w = workers.find((x) => x.id === tk.workerId)!;
      const a = currentAssignment(w.id);
      const t = a ? tplOf(a.templateId) : null;
      const time = siteClock(mobileNow()).time;
      let result;
      if (!a || !t || siteOfTpl(t).id !== kioskDevice.siteId) {
        // No shift here today: the clock-in waits for the manager (14.4, red panel).
        recordClock(w.id, { id: "", date: DEMO_TODAY }, input.type, "kiosk", `kiosk ${kioskDevice.code}`, { status: "pending", manualByName: kioskDevice.code, reason: "no_shift", comment: "", siteId: kioskDevice.siteId }, time);
        result = { outcome: "pending" as const, name: shortName(w), type: input.type, time, lateMin: 0, shift: null };
      } else {
        if (!allowedNext[stateOf(eventsOf(w.id, a.date))].includes(input.type)) throw new ApiError(422, { code: "clock_rejected", reason: "wrong_state" });
        recordClock(w.id, a, input.type, "kiosk", `kiosk ${kioskDevice.code}`, { status: "accepted" }, time, input.offline);
        const late = input.type === "in" ? lateMinutes(a, time) : 0;
        result = { outcome: late > 0 ? ("late" as const) : ("accepted" as const), name: shortName(w), type: input.type, time, lateMin: late, shift: { start: t.start, end: t.end } };
      }
      kioskRecent.unshift({ name: result.name, type: input.type, time, outcome: result.outcome });
      idempotent.set(key, result);
      return clone(result);
    },
  };

  function profileOf(): WorkerProfile {
    const w = workerOf(userKey);
    return {
      worker: { id: w.id, firstName: w.firstName, lastName: w.lastName, number: w.number, phone: w.phone },
      locale,
      biometricConsent: consent.has(w.id),
      kioskPinSet: pins.has(w.id) || kioskWorkerIds.includes(w.id),
      bankAccountLast4: String(1000 + (Number(w.number.replace(/\D/g, "")) % 9000)),
      notificationChannel: "push",
    };
  }
}
