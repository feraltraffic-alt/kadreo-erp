import type {
  Api,
  AutoAssignJob,
  AutoAssignRequest,
  CandidateView,
  DashboardFilter,
  ProjectListItem,
  ScheduleResponse,
  TimesheetListItem,
  UrgentRequestResult,
} from "../api";
import { ApiError } from "../api";
import { addDays, mondayOf, shiftHours } from "../dates";
import { can, permissionsFor } from "../permissions";
import { checkConstraints, scoreCandidate, type ScoringContext } from "../scoring";
import type { Assignment, CurrentUser, RoleCode, SchedulePublishState, Site, Timesheet, Worker, WorkerDocument } from "../types";
import {
  DEMO_NOW_ISO,
  DEMO_TODAY,
  assignments,
  clients,
  competences,
  contracts,
  correctionReasons,
  disputeReasons,
  documents,
  plans,
  positions,
  projects,
  sites,
  templates,
  tenant,
  workers,
} from "./generate";
import { alerts, computeSiteLive, notifications, staffRequests } from "./ops";
import { buildTimesheet, evidenceFor } from "./timesheets";

const wait = (min = 120, max = 380) => new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
const clone = <T,>(x: T): T => structuredClone(x);

/* ------------------------------------------------------------------- current user */

const userRoles: RoleCode[] = ["OPS_MANAGER", "TENANT_ADMIN"];
let activeRole: RoleCode = "OPS_MANAGER";
let userLocale: CurrentUser["locale"] = "ru";

function currentUser(): CurrentUser {
  return {
    id: "u-marta",
    fullName: "Marta Kowalska",
    initials: "MK",
    email: "marta.kowalska@demo-outsourcing.pl",
    locale: userLocale,
    roles: userRoles,
    activeRole,
    permissions: permissionsFor(activeRole),
    scope: { regions: [], siteIds: [] },
  };
}

export function setDemoRole(role: RoleCode) {
  if (userRoles.includes(role)) activeRole = role;
}
export function setDemoLocale(locale: CurrentUser["locale"]) {
  userLocale = locale;
}

function requirePermission(p: string) {
  if (!can(permissionsFor(activeRole), p)) throw new ApiError(403, { code: "forbidden", permission: p });
}

/* ------------------------------------------------------------------------- helpers */

const scoringCtx: ScoringContext = {
  workers,
  documents,
  assignments,
  templates,
  positions,
  requiredDocs: (site: Site, positionId: string, worker: Worker) => {
    const req: WorkerDocument["type"][] = ["medical", "bhp"];
    if (worker.citizenship !== "PL") req.push("work_permit");
    if (positionId === "p-forklift") req.push("udt");
    if (site.country === "DE") req.push("a1");
    return req;
  },
};

const active = (a: Assignment) => a.status === "confirmed" || a.status === "proposed";
const siteOfProject = (projectId: string) => sites.find((s) => s.id === projects.find((p) => p.id === projectId)!.siteId)!;
const publishState = new Map<string, SchedulePublishState>(); // `${projectId}|${monday}`
const timesheetCache = new Map<string, Timesheet>();

function weekPublishState(projectId: string, monday: string): SchedulePublishState {
  const key = `${projectId}|${monday}`;
  if (!publishState.has(key)) {
    publishState.set(key, monday < "2026-10-26" ? "published" : monday === "2026-10-26" ? (projectId === "pr-strykow" ? "draft" : "published") : "draft");
  }
  return publishState.get(key)!;
}

function touchSchedule(projectId: string, date: string) {
  const key = `${projectId}|${mondayOf(date)}`;
  if (weekPublishState(projectId, mondayOf(date)) === "published") publishState.set(key, "changed_after_publish");
}

function scheduleFor(projectId: string, from: string, to: string): ScheduleResponse {
  const project = projects.find((p) => p.id === projectId);
  if (!project) throw new ApiError(404, { code: "not_found" });
  const site = siteOfProject(projectId);
  const client = clients.find((c) => c.id === site.clientId)!;
  const tpls = templates.filter((t) => t.projectId === projectId).sort((a, b) => a.sortOrder - b.sortOrder);
  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  let filled = 0;
  let total = 0;
  const rows = tpls.map((t) => ({
    templateId: t.id,
    positionId: t.positionId,
    start: t.start,
    end: t.end,
    cells: dates.map((date) => {
      const plan = plans.find((p) => p.templateId === t.id && p.date === date);
      const cellList = assignments.filter((a) => a.templateId === t.id && a.date === date && active(a));
      const replacedIds = new Set(cellList.map((a) => a.replacesId).filter(Boolean));
      const assigned = cellList.filter((a) => !replacedIds.has(a.id)).length;
      if (plan && !plan.cancelled) {
        total += plan.planned;
        filled += Math.min(assigned, plan.planned);
      }
      return { date, planned: plan && !plan.cancelled ? plan.planned : null, assigned, cancelled: !!plan?.cancelled };
    }),
  }));
  return { project, site, client, from, to, publishState: weekPublishState(projectId, from), filled, total, rows };
}

function workerBrief(w: Worker) {
  return { id: w.id, firstName: w.firstName, lastName: w.lastName, number: w.number };
}

function timesheetKey(projectId: string, from: string) {
  return `${projectId}|${from}`;
}

function getTimesheet(projectId: string, from: string, to: string): Timesheet {
  const key = timesheetKey(projectId, from);
  if (!timesheetCache.has(key)) timesheetCache.set(key, buildTimesheet(projectId, from, to));
  return timesheetCache.get(key)!;
}

function timesheetById(id: string): Timesheet {
  for (const t of timesheetCache.values()) if (t.id === id) return t;
  throw new ApiError(404, { code: "not_found" });
}

function periodFor(projectId: string, anyDate: string): { from: string; to: string } {
  const contract = contracts.find((c) => c.id === projects.find((p) => p.id === projectId)!.contractId)!;
  const monday = mondayOf(anyDate);
  if (contract.timesheetPeriod === "two_weeks") {
    // Two-week periods anchored on 2026-10-12.
    const weeks = Math.floor((new Date(monday).getTime() - new Date("2026-10-12").getTime()) / (7 * 86400000));
    const from = addDays("2026-10-12", Math.floor(weeks / 2) * 14);
    return { from, to: addDays(from, 13) };
  }
  if (contract.timesheetPeriod === "month") {
    const from = `${anyDate.slice(0, 7)}-01`;
    const next = new Date(Date.UTC(Number(anyDate.slice(0, 4)), Number(anyDate.slice(5, 7)), 1));
    return { from, to: addDays(next.toISOString().slice(0, 10), -1) };
  }
  return { from: monday, to: addDays(monday, 6) };
}

const jobs = new Map<string, AutoAssignJob & { startedAt: number; projectId: string }>();
const urgent = new Map<string, UrgentRequestResult & { startedAt: number }>();

function liveAll(f: DashboardFilter) {
  const open = alerts.filter((a) => a.status !== "closed");
  return sites
    .filter((s) => (!f.regions?.length || f.regions.includes(s.region)) && (!f.clientIds?.length || f.clientIds.includes(s.clientId)))
    .map((s) => computeSiteLive(s.id, open));
}

/* ------------------------------------------------------------------------------ API */

export function createMockApi(): Api {
  return {
    async me() {
      await wait(40, 90);
      return currentUser();
    },
    async updateLocale(locale) {
      await wait(40, 90);
      setDemoLocale(locale);
    },
    setActiveRole(role) {
      setDemoRole(role);
    },
    async tenant() {
      await wait(30, 60);
      return clone(tenant);
    },
    async dictionaries() {
      await wait(30, 60);
      return clone({ positions, competences, correctionReasons, disputeReasons });
    },
    async search(q) {
      await wait(80, 200);
      const s = q.trim().toLowerCase();
      const hit = (x: string) => x.toLowerCase().includes(s);
      return {
        workers: workers
          .filter((w) => hit(`${w.firstName} ${w.lastName}`) || hit(w.number) || hit(w.phone.replace(/\s/g, "")) || hit(w.phone))
          .slice(0, 5)
          .map((w) => ({ id: w.id, label: `${w.firstName} ${w.lastName}`, sub: w.number })),
        sites: sites.filter((x) => hit(x.name) || hit(x.city)).slice(0, 5).map((x) => ({ id: x.id, label: x.name, sub: clients.find((c) => c.id === x.clientId)!.shortName })),
        clients: clients.filter((c) => hit(c.name) || hit(c.nip)).slice(0, 5).map((c) => ({ id: c.id, label: c.name, sub: `NIP ${c.nip}` })),
        contracts: contracts
          .filter((k) => hit(k.number) || hit(clients.find((c) => c.id === k.clientId)!.shortName))
          .slice(0, 5)
          .map((k) => ({ id: k.id, label: k.number, sub: clients.find((c) => c.id === k.clientId)!.shortName })),
      };
    },
    async notifications() {
      await wait(60, 140);
      return clone(notifications);
    },
    async navCounters() {
      await wait(40, 90);
      const in30 = addDays(DEMO_TODAY, 30);
      const relevant = documents.filter((d) => workers.find((w) => w.id === d.workerId)?.status !== "dismissed");
      return {
        requestsNew: staffRequests.filter((r) => r.status === "new").length,
        docsAttention: relevant.filter((d) => d.validTo <= in30).length,
        docsExpired: relevant.filter((d) => d.validTo < DEMO_TODAY).length,
      };
    },
    async markAllNotificationsRead() {
      await wait(60, 120);
      notifications.forEach((n) => (n.read = true));
    },

    async dashboardSummary(f) {
      requirePermission("dashboard.read");
      await wait();
      const live = liveAll(f);
      const siteIds = new Set(live.map((l) => l.siteId));
      const open = alerts.filter((a) => a.status !== "closed" && siteIds.has(a.siteId));
      const req = staffRequests.filter((r) => (r.status === "new" || r.status === "in_progress") && siteIds.has(r.siteId));
      return {
        onShiftNow: live.reduce((s, l) => s + l.actual, 0),
        plannedNow: live.reduce((s, l) => s + l.planned, 0),
        lateToday: live.reduce((s, l) => s + l.late, 0),
        lateSameDayLastWeek: Math.max(0, live.reduce((s, l) => s + l.late, 0) - 5),
        noShows: live.reduce((s, l) => s + l.noShows, 0),
        noShowsReplaced: live.reduce((s, l) => s + l.noShowsReplaced, 0),
        openAlerts: open.length,
        criticalAlerts: open.filter((a) => a.severity === "critical").length,
        staffRequestsOpen: req.length,
        ...(req.length ? { nearestSlaDueAt: req.map((r) => r.slaDueAt).sort()[0]! } : {}),
        updatedAt: DEMO_NOW_ISO,
      };
    },
    async dashboardSites(f) {
      requirePermission("dashboard.read");
      await wait();
      return liveAll(f);
    },
    async dashboardFilterOptions() {
      await wait(40, 90);
      return {
        regions: [...new Set(sites.map((s) => s.region))].sort((a, b) => a.localeCompare(b, "pl")),
        clients: clients.map((c) => ({ id: c.id, shortName: c.shortName })),
      };
    },
    async alerts(q) {
      requirePermission("alert.read");
      await wait();
      const rank = { critical: 0, warning: 1, info: 2 } as const;
      const list = alerts
        .filter((a) => (q.status === "open" ? a.status !== "closed" : true))
        .sort((a, b) => rank[a.severity] - rank[b.severity] || b.createdAt.localeCompare(a.createdAt));
      return clone(q.limit ? list.slice(0, q.limit) : list);
    },
    async takeAlert(id) {
      requirePermission("alert.take");
      await wait();
      const a = alerts.find((x) => x.id === id);
      if (!a) throw new ApiError(404, { code: "not_found" });
      a.status = "taken";
      a.takenByName = currentUser().fullName;
      a.takenAt = new Date().toISOString();
      return clone(a);
    },
    async createUrgentRequest(input) {
      requirePermission("shift.urgent.create");
      await wait(300, 500);
      const tpl = templates.find((t) => t.id === input.templateId)!;
      const site = sites.find((s) => s.id === input.siteId)!;
      const eligible = workers.filter((w) => w.positionIds.includes(tpl.positionId) && checkConstraints(scoringCtx, w, site, tpl, input.date).length === 0);
      const id = `ur-${Date.now()}`;
      urgent.set(id, { id, offeredTo: Math.min(eligible.length, input.headcount * 4), accepted: 0, needed: input.headcount, startedAt: Date.now() });
      return clone(urgent.get(id)!);
    },
    async urgentRequestStatus(id) {
      await wait(80, 160);
      const u = urgent.get(id);
      if (!u) throw new ApiError(404, { code: "not_found" });
      // Demo: one more person accepts every ~3 seconds.
      u.accepted = Math.min(u.needed, Math.floor((Date.now() - u.startedAt) / 3000));
      return clone(u);
    },
    async staffRequests() {
      requirePermission("staffrequest.read");
      await wait();
      return clone(staffRequests);
    },
    async sitesWithTemplates() {
      await wait(60, 120);
      return sites.map((site) => ({
        site: clone(site),
        templates: templates.filter((t) => t.projectId === projects.find((p) => p.siteId === site.id)!.id).map((t) => ({ id: t.id, positionId: t.positionId, start: t.start, end: t.end })),
      }));
    },

    async projects(weekOf) {
      requirePermission("shift.schedule.read");
      await wait();
      const monday = mondayOf(weekOf);
      return projects.map<ProjectListItem>((p) => {
        const s = scheduleFor(p.id, monday, addDays(monday, 6));
        return { project: clone(p), site: clone(s.site), client: clone(s.client), filledThisWeek: s.filled, totalThisWeek: s.total };
      });
    },
    async schedule(projectId, from, to) {
      requirePermission("shift.schedule.read");
      await wait();
      return clone(scheduleFor(projectId, from, to));
    },
    async cellAssignments(templateId, date) {
      await wait(80, 160);
      const cellList = assignments.filter((a) => a.templateId === templateId && a.date === date && active(a));
      const replacedIds = new Set(cellList.map((a) => a.replacesId).filter(Boolean));
      return cellList
        .filter((a) => !replacedIds.has(a.id))
        .map((a) => ({ assignment: clone(a), worker: workerBrief(workers.find((w) => w.id === a.workerId)!) }));
    },
    async candidates(templateId, date, filters) {
      requirePermission("shift.schedule.read");
      await wait(200, 420);
      const tpl = templates.find((t) => t.id === templateId)!;
      const site = siteOfProject(tpl.projectId);
      const list: CandidateView[] = [];
      for (const w of workers) {
        if (!w.positionIds.includes(tpl.positionId) && !positions.find((p) => p.id === tpl.positionId)!.competenceIds.every((c) => w.competenceIds.includes(c))) continue;
        if (assignments.some((a) => a.workerId === w.id && a.date === date && a.templateId === templateId && active(a))) continue;
        if (checkConstraints(scoringCtx, w, site, tpl, date).length) continue;
        const sc = scoreCandidate(scoringCtx, w, site, tpl, date);
        const km = sc.tags.find((t) => t.kind === "distance_km");
        if (filters?.maxKm && km && km.kind === "distance_km" && km.km > filters.maxKm) continue;
        if (filters?.experiencedOnly && !(w.shiftsBySite[site.id] ?? 0)) continue;
        if (filters?.noOvertime && sc.warnings.some((x) => x.kind === "near_hour_limit")) continue;
        list.push({ ...sc, firstName: w.firstName, lastName: w.lastName, number: w.number });
      }
      return list.sort((a, b) => b.score - a.score).slice(0, 20);
    },
    async assign({ workerId, templateId, date, source }) {
      requirePermission("shift.schedule.edit");
      await wait(150, 300);
      const w = workers.find((x) => x.id === workerId)!;
      const tpl = templates.find((t) => t.id === templateId)!;
      const violations = checkConstraints(scoringCtx, w, siteOfProject(tpl.projectId), tpl, date);
      if (violations.length) throw new ApiError(422, { code: "constraint", violations });
      const a: Assignment = { id: `as-new-${Date.now()}-${Math.round(Math.random() * 1e6)}`, workerId, templateId, date, status: "proposed", source: source ?? "manual" };
      assignments.push(a);
      touchSchedule(tpl.projectId, date);
      return clone(a);
    },
    async unassign(id) {
      requirePermission("shift.schedule.edit");
      await wait(120, 240);
      const a = assignments.find((x) => x.id === id);
      if (!a) throw new ApiError(404, { code: "not_found" });
      a.status = "cancelled";
      touchSchedule(templates.find((t) => t.id === a.templateId)!.projectId, a.date);
    },
    async changePlan(templateId, date, planned) {
      requirePermission("shift.schedule.edit");
      await wait();
      const p = plans.find((x) => x.templateId === templateId && x.date === date);
      if (p) {
        p.planned = planned;
        p.cancelled = false;
      } else plans.push({ templateId, date, planned });
      touchSchedule(templates.find((t) => t.id === templateId)!.projectId, date);
    },
    async cancelShift(templateId, date) {
      requirePermission("shift.schedule.edit");
      await wait();
      const p = plans.find((x) => x.templateId === templateId && x.date === date);
      if (p) p.cancelled = true;
      assignments.filter((a) => a.templateId === templateId && a.date === date && active(a)).forEach((a) => (a.status = "cancelled"));
      touchSchedule(templates.find((t) => t.id === templateId)!.projectId, date);
    },
    async copyToNextWeek(templateId, date) {
      requirePermission("shift.schedule.edit");
      await wait();
      const target = addDays(date, 7);
      const src = plans.find((x) => x.templateId === templateId && x.date === date);
      if (src) {
        const dst = plans.find((x) => x.templateId === templateId && x.date === target);
        if (dst) dst.planned = src.planned;
        else plans.push({ templateId, date: target, planned: src.planned });
      }
      const tpl = templates.find((t) => t.id === templateId)!;
      const site = siteOfProject(tpl.projectId);
      let copied = 0;
      for (const a of assignments.filter((x) => x.templateId === templateId && x.date === date && active(x))) {
        if (assignments.some((x) => x.workerId === a.workerId && x.date === target && active(x))) continue;
        const w = workers.find((x) => x.id === a.workerId)!;
        if (checkConstraints(scoringCtx, w, site, tpl, target).length) continue;
        assignments.push({ ...a, id: `as-copy-${Date.now()}-${copied}`, date: target, status: "proposed" });
        copied++;
      }
      touchSchedule(tpl.projectId, target);
      return copied;
    },
    async startAutoAssign(projectId, from, req: AutoAssignRequest) {
      requirePermission("shift.autoassign.run");
      await wait(150, 250);
      const id = `job-${Date.now()}`;
      const site = siteOfProject(projectId);
      const tpls = templates.filter((t) => t.projectId === projectId);
      const dates = req.scope === "days" && req.dates?.length ? req.dates : Array.from({ length: 7 }, (_, i) => addDays(from, i));
      const cells = req.scope === "cells" && req.cells?.length ? req.cells : tpls.flatMap((t) => dates.map((date) => ({ templateId: t.id, date })));
      // Greedy fill by score with hard constraints; a stand-in for the CP-SAT optimiser (16.5).
      const tentative: Assignment[] = [];
      const ctx: ScoringContext = { ...scoringCtx, assignments: [...assignments, ...tentative] };
      const proposals = [];
      let unfilled = 0;
      for (const cell of cells.filter((c) => c.date >= DEMO_TODAY)) {
        const plan = plans.find((p) => p.templateId === cell.templateId && p.date === cell.date && !p.cancelled);
        if (!plan) continue;
        const tpl = tpls.find((t) => t.id === cell.templateId)!;
        const current = assignments.filter((a) => a.templateId === tpl.id && a.date === cell.date && (req.mode === "empty_only" ? active(a) : a.status === "confirmed")).length;
        let need = plan.planned - current;
        if (need <= 0) continue;
        const ranked = workers
          .filter((w) => w.positionIds.includes(tpl.positionId) && !ctx.assignments.some((a) => a.workerId === w.id && a.date === cell.date && active(a)))
          .filter((w) => checkConstraints(ctx, w, site, tpl, cell.date).length === 0)
          .map((w) => ({ w, s: scoreCandidate(ctx, w, site, tpl, cell.date).score }))
          .sort((a, b) => b.s - a.s);
        const chosen = ranked.slice(0, need).map((x) => x.w.id);
        for (const workerId of chosen) {
          const t: Assignment = { id: `tmp-${workerId}-${cell.date}`, workerId, templateId: tpl.id, date: cell.date, status: "proposed", source: "ai" };
          tentative.push(t);
          ctx.assignments.push(t);
        }
        need -= chosen.length;
        unfilled += need;
        if (chosen.length) proposals.push({ templateId: tpl.id, date: cell.date, workerIds: chosen });
      }
      jobs.set(id, { id, status: "running", progress: 0, proposals, unfilled, startedAt: Date.now(), projectId });
      return { jobId: id };
    },
    async job(jobId) {
      await wait(150, 250);
      const j = jobs.get(jobId);
      if (!j) throw new ApiError(404, { code: "not_found" });
      const elapsed = Date.now() - j.startedAt;
      const progress = Math.min(1, elapsed / 2600);
      const { startedAt: _s, projectId: _p, ...rest } = j;
      return clone({ ...rest, progress, status: progress >= 1 ? "done" : "running", proposals: progress >= 1 ? j.proposals : [] });
    },
    async publishSchedule(projectId, from) {
      requirePermission("shift.schedule.publish");
      await wait(300, 600);
      publishState.set(`${projectId}|${from}`, "published");
      const tplIds = new Set(templates.filter((t) => t.projectId === projectId).map((t) => t.id));
      const notified = new Set(assignments.filter((a) => tplIds.has(a.templateId) && a.date >= from && a.date <= addDays(from, 6) && active(a)).map((a) => a.workerId));
      return { notified: notified.size };
    },

    async timesheets() {
      requirePermission("timesheet.read");
      await wait();
      const out: TimesheetListItem[] = [];
      for (const p of projects) {
        const { from, to } = periodFor(p.id, addDays(DEMO_TODAY, -7));
        const t = getTimesheet(p.id, from, to);
        const site = siteOfProject(p.id);
        let payable = 0;
        let planned = 0;
        let issues = 0;
        for (const r of t.rows) {
          for (const d of r.days) {
            payable += d.payableHours;
            planned += d.plannedHours;
          }
          if (r.days.some((d) => d.issue)) issues++;
        }
        out.push({ id: t.id, projectId: p.id, siteName: site.name, clientName: clients.find((c) => c.id === site.clientId)!.shortName, from, to, payableHours: payable, plannedHours: planned, issues, timesheet: { clientStage: t.clientStage, managerConfirmed: t.managerConfirmed, teamLeaderDaysConfirmed: t.teamLeaderDaysConfirmed } });
      }
      return out;
    },
    async timesheet(projectId, from, to) {
      requirePermission("timesheet.read");
      await wait();
      const t = getTimesheet(projectId, from, to);
      const project = projects.find((p) => p.id === projectId)!;
      const site = siteOfProject(projectId);
      const ws: Record<string, ReturnType<typeof workerBrief>> = {};
      for (const r of t.rows) ws[r.workerId] = workerBrief(workers.find((w) => w.id === r.workerId)!);
      return clone({ timesheet: t, project, site, client: clients.find((c) => c.id === site.clientId)!, contract: contracts.find((c) => c.id === project.contractId)!, workers: ws });
    },
    async timesheetDay(timesheetId, rowId, date) {
      requirePermission("timesheet.read");
      await wait(100, 220);
      const t = timesheetById(timesheetId);
      const row = t.rows.find((r) => r.id === rowId);
      const day = row?.days.find((d) => d.date === date);
      if (!row || !day) throw new ApiError(404, { code: "not_found" });
      const w = workers.find((x) => x.id === row.workerId)!;
      return clone({ rowId, worker: { id: w.id, firstName: w.firstName, lastName: w.lastName }, positionId: row.positionId, day, evidence: evidenceFor(t.projectId, w.id, day) });
    },
    async correct(timesheetId, input) {
      requirePermission("timesheet.entry.correct");
      await wait(200, 400);
      const t = timesheetById(timesheetId);
      const day = t.rows.find((r) => r.id === input.rowId)?.days.find((d) => d.date === input.date);
      if (!day) throw new ApiError(404, { code: "not_found" });
      const correction = {
        id: `cor-${Date.now()}`,
        at: new Date().toISOString(),
        byName: currentUser().fullName,
        payableBefore: day.payableHours,
        payableAfter: input.payableHours,
        billableBefore: day.billableHours,
        billableAfter: input.billableHours,
        reasonId: input.reasonId,
        comment: input.comment,
      };
      day.corrections.push(correction);
      day.payableHours = input.payableHours;
      day.billableHours = input.billableHours;
      delete day.issue;
      return clone(correction);
    },
    async sendToClient(timesheetId) {
      requirePermission("timesheet.send_to_client");
      await wait(300, 500);
      const t = timesheetById(timesheetId);
      t.managerConfirmed = true;
      const contract = contracts.find((c) => c.id === projects.find((p) => p.id === t.projectId)!.contractId)!;
      const until = new Date(new Date(DEMO_NOW_ISO).getTime() + contract.autoAcceptHours * 3600000).toISOString();
      t.clientStage = { kind: "waiting", until };
      return clone(t);
    },
    async workerDocuments(workerId) {
      await wait(60, 120);
      return clone(documents.filter((d) => d.workerId === workerId));
    },
  };
}

/** Planned hours of a timesheet row; used by list views. */
export function rowPlannedHours(days: { plannedHours: number }[]) {
  return days.reduce((s, d) => s + d.plannedHours, 0);
}

export { shiftHours };
