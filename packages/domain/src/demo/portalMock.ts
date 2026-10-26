import { ApiError } from "../api";
import { addDays, shiftHours, toMinutes, weekdayIndex } from "../dates";
import { permissionsFor } from "../permissions";
import type {
  PortalApi,
  PortalDayDispute,
  PortalSite,
  PortalTimesheet,
  PortalTimesheetDay,
  PortalTimesheetListItem,
  PortalUser,
  StaffRequestEstimate,
  StaffRequestInput,
} from "../portal";
import type { Locale, Site, StaffRequest, Timesheet, TimesheetDay } from "../types";
import { DEMO_NOW_ISO, DEMO_TODAY, clients, competences, contracts, correctionReasons, disputeReasons, positions, projects, sites, templates, tenant, workers } from "./generate";
import { alerts, computeSiteLive, staffRequests } from "./ops";
import { clientUsers } from "./org";
import { progressCells, requestView } from "./requests";
import { getTimesheet, periodFor, timesheetById } from "./timesheets";

/**
 * In-memory client portal for the demo, signed in as Jan Nowak (Nordlog). It shares the demo's
 * requests and timesheets with the back-office demo code, and follows the same rules as the
 * backend's portal module.
 */

const wait = (min = 120, max = 320) => new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
const clone = <T,>(x: T): T => structuredClone(x);
const NOW = new Date(DEMO_NOW_ISO);

const demoUser = clientUsers.find((u) => u.id === "u-jan")!;
let locale: Locale = demoUser.locale;

function me(): PortalUser {
  const client = clients.find((c) => c.id === demoUser.clientId)!;
  const [first = "", last = ""] = demoUser.fullName.split(" ");
  return {
    id: demoUser.id,
    fullName: demoUser.fullName,
    initials: `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase(),
    email: demoUser.email,
    locale,
    role: demoUser.role,
    permissions: permissionsFor(demoUser.role),
    client: { id: client.id, name: client.name, shortName: client.shortName },
  };
}

function require(permission: string) {
  if (!me().permissions.includes(permission)) throw new ApiError(403, { code: "forbidden", permission });
}

const clientSites = () => sites.filter((s) => s.clientId === demoUser.clientId);
const projectOf = (siteId: string) => projects.find((p) => p.siteId === siteId)!;
const contractOf = (siteId: string) => contracts.find((c) => c.id === projectOf(siteId).contractId)!;

function ownSite(siteId: string): Site {
  const s = clientSites().find((x) => x.id === siteId);
  if (!s) throw new ApiError(404, { code: "not_found" });
  return s;
}

function portalSite(s: Site): PortalSite {
  const k = contractOf(s.id);
  return { id: s.id, name: s.name, city: s.city, address: s.address, contractNumber: k.number, contractTo: k.validTo, currency: k.currency };
}

/** Warsaw calendar date of an instant. */
function localDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

const earliestStart = (siteId: string) => localDate(new Date(NOW.getTime() + contractOf(siteId).sla.minLeadHours * 3600000));

function workingDays(from: string, to: string): number {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (weekdayIndex(d) !== 6) n++;
  return n;
}

function estimateOf(input: StaffRequestInput): StaffRequestEstimate {
  const k = contractOf(input.siteId);
  const tpls = templates.filter((t) => input.templateIds.includes(t.id));
  const days = input.from && input.to && input.to >= input.from ? workingDays(input.from, input.to) : 0;
  const hc = Math.max(0, Math.floor(input.headcount || 0));
  const plannedHours = tpls.reduce((s, t) => s + hc * days * shiftHours(t.start, t.end, t.unpaidBreakMin), 0);
  const rateCard = k.rates.find((r) => r.positionId === input.positionId);
  const rate = k.showRatesInPortal && rateCard ? rateCard.current : null;
  return {
    days,
    personShifts: hc * days * tpls.length,
    plannedHours,
    rate,
    amount: rate === null ? null : (plannedHours * Number(rate)).toFixed(2),
    currency: k.currency,
    slaResponseHours: k.sla.responseHours,
  };
}

/** Checks for «Отправить заявку» (12.1-01…06); a draft skips them. */
function validate(input: StaffRequestInput) {
  const bad = (message: string) => new ApiError(400, { code: "bad_request", message });
  const site = ownSite(input.siteId);
  if (input.draft) return;
  const k = contractOf(site.id);
  if (!k.rates.some((r) => r.positionId === input.positionId)) throw bad("positionId");
  if (!Number.isInteger(input.headcount) || input.headcount < 1 || input.headcount > 500) throw bad("headcount");
  if (!input.from || input.from < earliestStart(site.id)) throw bad("from");
  if (!input.to || input.to < input.from || input.to > k.validTo) throw bad("to");
  const own = templates.filter((t) => t.projectId === projectOf(site.id).id && t.positionId === input.positionId).map((t) => t.id);
  if (!input.templateIds.length || input.templateIds.some((t) => !own.includes(t))) throw bad("templateIds");
  if (!input.contactName) throw bad("contactName");
}

function toRequest(input: StaffRequestInput, base: Partial<StaffRequest>): StaffRequest {
  const k = contractOf(input.siteId);
  return {
    id: base.id!,
    number: base.number!,
    siteId: input.siteId,
    positionId: input.positionId,
    headcount: input.headcount,
    assigned: 0,
    from: input.from,
    to: input.to,
    status: input.draft ? "draft" : "new",
    slaDueAt: new Date(NOW.getTime() + k.sla.responseHours * 3600000).toISOString(),
    templateIds: input.templateIds,
    competenceIds: input.competenceIds,
    experiencedOnly: input.experiencedOnly,
    ...(input.clientRef ? { clientRef: input.clientRef } : {}),
    ...(input.comment ? { comment: input.comment } : {}),
    contactName: input.contactName,
    createdAt: base.createdAt ?? DEMO_NOW_ISO,
    createdByName: demoUser.fullName,
  };
}

/* ------------------------------------------------------------------- timesheets */

function ownTimesheet(id: string): Timesheet {
  const t = timesheetById(id);
  const site = sites.find((s) => s.id === projects.find((p) => p.id === t.projectId)!.siteId)!;
  if (site.clientId !== demoUser.clientId) throw new ApiError(404, { code: "not_found" });
  return t;
}

/** Night work 22:00–06:00 within a shift, in hours (12.2-04 «из них ночные»). */
export function nightHoursOf(shiftLabel: string | undefined, hours: number): number {
  if (!shiftLabel || hours <= 0) return 0;
  const [a, b] = shiftLabel.split("–") as [string, string];
  let s = toMinutes(a);
  let e = toMinutes(b);
  if (e <= s) e += 1440;
  const overlap = (x: number, y: number) => Math.max(0, Math.min(e, y) - Math.max(s, x));
  const night = overlap(0, 360) + overlap(1320, 1800) + overlap(2760, 2880);
  return Math.min(hours, night / 60);
}

function portalDay(d: TimesheetDay, stageConfirmed: boolean): PortalTimesheetDay {
  const last = d.corrections[d.corrections.length - 1];
  const dispute = d.disputes?.[d.disputes.length - 1];
  const out: PortalTimesheetDay = { date: d.date, hasShift: d.hasShift, hours: d.billableHours, nightHours: nightHoursOf(d.shiftLabel, d.billableHours), confirmed: stageConfirmed || !!d.clientConfirmed };
  if (d.shiftLabel) out.shiftLabel = d.shiftLabel;
  if (last) out.correction = { reasonId: last.reasonId, comment: last.comment, before: last.billableBefore, after: last.billableAfter };
  if (dispute) {
    const pd: PortalDayDispute = { id: dispute.id, status: dispute.status, reasonId: dispute.reasonId, comment: dispute.comment };
    if (dispute.clientHours !== undefined) pd.clientHours = dispute.clientHours;
    if (dispute.resolution?.comment) pd.answer = dispute.resolution.comment;
    out.dispute = pd;
  }
  return out;
}

function portalTimesheet(t: Timesheet): PortalTimesheet {
  const site = sites.find((s) => s.id === projects.find((p) => p.id === t.projectId)!.siteId)!;
  const closed = t.clientStage.kind === "confirmed" || t.clientStage.kind === "auto_accepted";
  const rows = t.rows
    .filter((r) => r.days.some((d) => d.hasShift))
    .map((r) => {
      const w = workerNames.get(r.workerId)!;
      const days = r.days.map((d) => portalDay(d, closed));
      return { id: r.id, worker: w, positionId: r.positionId, days, total: days.reduce((s, d) => s + d.hours, 0) };
    });
  return {
    id: t.id,
    site: { id: site.id, name: site.name },
    from: t.from,
    to: t.to,
    stage: t.clientStage,
    ...(t.sentAt ? { sentAt: t.sentAt } : {}),
    ...(t.sentByName ? { sentByName: t.sentByName } : {}),
    totals: {
      hours: rows.reduce((s, r) => s + r.total, 0),
      workers: rows.length,
      nightHours: rows.reduce((s, r) => s + r.days.reduce((x, d) => x + d.nightHours, 0), 0),
    },
    rows,
  };
}

const workerNames = new Map(workers.map((w) => [w.id, { firstName: w.firstName, lastName: w.lastName }]));

function reviewTimesheets(): Timesheet[] {
  return clientSites().map((s) => {
    const p = projectOf(s.id);
    const { from, to } = periodFor(p.id, addDays(DEMO_TODAY, -7));
    return getTimesheet(p.id, from, to);
  });
}

/* --------------------------------------------------------------------------- API */

export function createPortalMockApi(): PortalApi {
  return {
    async me() {
      await wait(40, 90);
      return me();
    },
    async tenant() {
      await wait(30, 60);
      return clone(tenant);
    },
    async updateLocale(l) {
      await wait(40, 90);
      locale = l;
    },
    async dictionaries() {
      await wait(30, 60);
      return clone({ positions, competences, disputeReasons, correctionReasons });
    },
    async overview() {
      require("portal.read");
      await wait();
      const own = clientSites();
      const live = own.map((s) => computeSiteLive(s.id, alerts.filter((a) => a.status !== "closed")));
      const reqs = staffRequests.filter((r) => own.some((s) => s.id === r.siteId)).map(requestView);
      const sheets = reviewTimesheets();
      const waiting = sheets.filter((t) => t.clientStage.kind === "waiting");
      let planned = 0;
      let billable = 0;
      let rows = 0;
      let disputedRows = 0;
      for (const t of sheets) {
        for (const r of t.rows) {
          if (!r.days.some((d) => d.hasShift)) continue;
          rows++;
          if (r.days.some((d) => d.disputes?.length)) disputedRows++;
          for (const d of r.days) {
            planned += d.plannedHours;
            billable += d.billableHours;
          }
        }
      }
      const k = contractOf(own[0]!.id);
      const until = waiting.map((t) => (t.clientStage.kind === "waiting" ? t.clientStage.until : "")).sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0];
      const kpiFrom = sheets.map((t) => t.from).sort()[0] ?? DEMO_TODAY;
      const kpiTo = sheets.map((t) => t.to).sort().at(-1) ?? DEMO_TODAY;
      return clone({
        onShiftNow: live.reduce((s, l) => s + l.actual, 0),
        plannedNow: live.reduce((s, l) => s + l.planned, 0),
        sites: live.map((l) => ({ siteId: l.siteId, siteName: l.siteName, shiftLabel: l.shiftLabel, actual: l.actual, planned: l.planned, status: l.status })),
        requestsNew: reqs.filter((r) => r.status === "new").length,
        requestsInProgress: reqs.filter((r) => r.status === "in_progress").length,
        timesheetsToConfirm: waiting.length,
        ...(until ? { nearestDeadline: until } : {}),
        kpi: {
          from: kpiFrom,
          to: kpiTo,
          staffingPct: planned ? Math.round((billable / planned) * 1000) / 10 : 0,
          staffingTarget: k.kpiTargets.staffingPct,
          disputedPct: rows ? Math.round((disputedRows / rows) * 1000) / 10 : 0,
          disputedTarget: k.kpiTargets.disputedPct,
        },
      });
    },
    async sites() {
      require("portal.read");
      await wait(60, 140);
      return clone(clientSites().map(portalSite));
    },
    async siteOptions(siteId) {
      require("portal.read");
      await wait(80, 180);
      const site = ownSite(siteId);
      const k = contractOf(siteId);
      const tpls = templates.filter((t) => t.projectId === projectOf(siteId).id);
      return clone({
        site: portalSite(site),
        positions: k.rates
          .filter((r) => tpls.some((t) => t.positionId === r.positionId))
          .sort((a, b) => Math.min(...tpls.filter((t) => t.positionId === a.positionId).map((t) => t.sortOrder)) - Math.min(...tpls.filter((t) => t.positionId === b.positionId).map((t) => t.sortOrder)))
          .map((r) => ({ id: r.positionId, rate: k.showRatesInPortal ? r.current : null })),
        templates: tpls.map((t) => ({ id: t.id, positionId: t.positionId, start: t.start, end: t.end, hours: shiftHours(t.start, t.end, t.unpaidBreakMin) })),
        competenceIds: competences.map((c) => c.id),
        contacts: clientUsers.filter((u) => u.clientId === site.clientId).map((u) => ({ id: u.id, name: u.fullName })),
        earliestStart: earliestStart(siteId),
        slaResponseHours: k.sla.responseHours,
        showRates: k.showRatesInPortal,
      });
    },
    async estimate(input) {
      require("portal.read");
      await wait(60, 140);
      ownSite(input.siteId);
      return estimateOf(input);
    },
    async createRequest(input) {
      require("staffrequest.create");
      await wait(250, 450);
      validate(input);
      const number = Math.max(...staffRequests.map((r) => r.number)) + 1;
      const r = toRequest(input, { id: `sr-${number}`, number });
      staffRequests.push(r);
      return clone(requestView(r));
    },
    async updateRequest(id, input) {
      require("staffrequest.create");
      await wait(250, 450);
      const i = staffRequests.findIndex((r) => r.id === id && clientSites().some((s) => s.id === r.siteId));
      if (i < 0) throw new ApiError(404, { code: "not_found" });
      const old = staffRequests[i]!;
      if (old.status !== "draft") throw new ApiError(409, { code: "conflict", byName: "", at: "" });
      validate(input);
      const r = toRequest(input, { id: old.id, number: old.number, createdAt: old.createdAt });
      staffRequests[i] = r;
      return clone(requestView(r));
    },
    async requests() {
      require("portal.read");
      await wait();
      return clone(staffRequests.filter((r) => clientSites().some((s) => s.id === r.siteId)).map(requestView).sort((a, b) => b.number - a.number));
    },
    async request(id) {
      require("portal.read");
      await wait(80, 180);
      const r = staffRequests.find((x) => x.id === id && clientSites().some((s) => s.id === x.siteId));
      if (!r) throw new ApiError(404, { code: "not_found" });
      const site = ownSite(r.siteId);
      return clone({
        request: requestView(r),
        site: portalSite(site),
        templates: templates.filter((t) => t.projectId === projectOf(site.id).id).map((t) => ({ id: t.id, positionId: t.positionId, start: t.start, end: t.end })),
        cells: progressCells(r.id),
      });
    },
    async timesheets() {
      require("portal.read");
      await wait();
      const order = { waiting: 0, disputed: 1, not_sent: 2, confirmed: 3, auto_accepted: 4 } as const;
      const list: PortalTimesheetListItem[] = reviewTimesheets()
        .filter((t) => t.clientStage.kind !== "not_sent")
        .map((t) => {
          const p = portalTimesheet(t);
          return { id: t.id, siteId: p.site.id, siteName: p.site.name, from: t.from, to: t.to, stage: t.clientStage, billableHours: p.totals.hours, workers: p.totals.workers, ...(t.sentAt ? { sentAt: t.sentAt } : {}) };
        })
        .sort((a, b) => order[a.stage.kind] - order[b.stage.kind]);
      return clone(list);
    },
    async timesheet(id) {
      require("portal.read");
      await wait();
      return clone(portalTimesheet(ownTimesheet(id)));
    },
    async dispute(id, input) {
      require("timesheet.client.confirm");
      await wait(250, 450);
      const t = ownTimesheet(id);
      if (t.clientStage.kind !== "waiting" && t.clientStage.kind !== "disputed") throw new ApiError(409, { code: "conflict", byName: "", at: "" });
      if (!input.items.length || !input.reasonId || !input.comment.trim()) throw new ApiError(400, { code: "bad_request", message: "input" });
      for (const item of input.items) {
        const day = t.rows.find((r) => r.id === item.rowId)?.days.find((d) => d.date === item.date);
        if (!day || !day.hasShift || day.clientConfirmed || day.disputed) throw new ApiError(400, { code: "bad_request", message: "day" });
      }
      for (const item of input.items) {
        const day = t.rows.find((r) => r.id === item.rowId)!.days.find((d) => d.date === item.date)!;
        day.disputes = [
          ...(day.disputes ?? []),
          {
            id: `dsp-${Date.now()}-${item.rowId}-${item.date}`,
            reasonId: input.reasonId,
            ...(input.clientHours !== undefined ? { clientHours: input.clientHours } : {}),
            comment: input.comment.trim(),
            createdAt: DEMO_NOW_ISO,
            createdByName: demoUser.fullName,
            status: "open",
          },
        ];
        day.disputed = true;
      }
      t.clientStage = { kind: "disputed", rows: t.rows.filter((r) => r.days.some((d) => d.disputed)).length };
      return clone(portalTimesheet(t));
    },
    async confirm(id) {
      require("timesheet.client.confirm");
      await wait(250, 450);
      const t = ownTimesheet(id);
      if (t.clientStage.kind !== "waiting" && t.clientStage.kind !== "disputed") throw new ApiError(409, { code: "conflict", byName: "", at: "" });
      for (const r of t.rows) for (const d of r.days) if (d.hasShift && !d.disputed) d.clientConfirmed = true;
      if (!t.rows.some((r) => r.days.some((d) => d.disputed))) t.clientStage = { kind: "confirmed" };
      return clone(portalTimesheet(t));
    },
  };
}
