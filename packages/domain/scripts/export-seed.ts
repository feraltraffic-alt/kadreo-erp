/**
 * Exports the front-end demo data as the back-end seed (backend/src/main/resources/demo/seed.json.gz)
 * so both demos show exactly the same tenant, sites, people, shifts and timesheets.
 *
 *   pnpm --filter @kadreo/domain export-seed
 *
 * Readable keys ("s-strykow", "w-12") become name-based UUIDs v3 of "kadreo-demo:<key>", the
 * same function as DemoIds.fromKey on the Java side. Site-local times become UTC instants.
 */
import { createHash, pbkdf2Sync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { addDays, mondayOf, shiftHours } from "../src/dates";
import { contractForClient } from "../src/demo/org";
import {
  DEMO_RANGE_FROM,
  DEMO_RANGE_TO,
  DEMO_TODAY,
  assignments,
  clients,
  clockEvents,
  competences,
  contracts,
  correctionReasons,
  disputeReasons,
  documents,
  legalEntities,
  plans,
  positions,
  projects,
  sites,
  teamLeaders,
  templates,
  tenant,
  workers,
} from "../src/demo/generate";
import { alerts, notifications, staffRequests } from "../src/demo/ops";
import { clientUsers } from "../src/demo/org";
import { biometricConsent, demoCardUid, demoPin, kioskDevice, kioskWorkerIds, seedIssues, seedOutput, seedUrgent, siteOutput, workerUsers } from "../src/demo/mobileData";
import { requestAssignments, requestCells } from "../src/demo/requests";
import { buildTimesheet, evidenceFor } from "../src/demo/timesheets";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../../../backend/src/main/resources/demo/seed.json.gz");

/** Same as java.util.UUID.nameUUIDFromBytes("kadreo-demo:" + key). */
function id(key: string): string {
  const h = createHash("md5").update(`kadreo-demo:${key}`, "utf8").digest();
  h[6] = (h[6]! & 0x0f) | 0x30;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** Site-local date + HH:mm → UTC ISO instant, honouring daylight saving time. */
function instant(date: string, hhmm: string, timeZone: string): string {
  const guess = new Date(`${date}T${hhmm}:00Z`);
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const parts = Object.fromEntries(fmt.formatToParts(guess).map((p) => [p.type, p.value]));
  const local = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  const offset = local - guess.getTime();
  return new Date(guess.getTime() - offset).toISOString();
}

const tenantId = id(tenant.id);
const T = { tenant_id: tenantId };
const siteById = new Map(sites.map((s) => [s.id, s]));
const projectById = new Map(projects.map((p) => [p.id, p]));
const templateById = new Map(templates.map((t) => [t.id, t]));
const siteOfTemplate = (templateId: string) => siteById.get(projectById.get(templateById.get(templateId)!.projectId)!.siteId)!;

const users = [
  { key: "u-marta", email: "marta.kowalska@demo-outsourcing.pl", full_name: "Marta Kowalska", locale: "ru", roles: ["OPS_MANAGER", "TENANT_ADMIN"] },
  { key: "u-pawel", email: "pawel.nowak@demo-outsourcing.pl", full_name: "Paweł Nowak", locale: "pl", roles: ["SITE_MANAGER"], sites: ["s-poznan", "s-wroclaw", "s-gadki", "s-bielany"] },
  { key: "u-anna", email: "anna.lis@demo-outsourcing.pl", full_name: "Anna Lis", locale: "pl", roles: ["SITE_MANAGER"], sites: ["s-gliwice", "s-sosnowiec", "s-katowice", "s-gdansk", "s-pruszcz", "s-torun"] },
  { key: "u-iryna", email: "iryna.szewczuk@demo-outsourcing.pl", full_name: "Iryna Szewczuk", locale: "uk", roles: ["OPS_MANAGER"], regions: ["Sachsen", "Sachsen-Anhalt", "Thüringen", "Berlin"] },
  { key: "u-ewa", email: "ewa.zielinska@demo-outsourcing.pl", full_name: "Ewa Zielińska", locale: "pl", roles: ["HR"] },
  { key: "u-robert", email: "robert.mazur@demo-outsourcing.pl", full_name: "Robert Mazur", locale: "pl", roles: ["FINANCE"] },
];

/** A small square geofence (about 300 m) around the site point. */
function geofence(lat: number, lng: number) {
  const dLat = 0.0014;
  const dLng = 0.0022;
  return [
    [lng - dLng, lat - dLat],
    [lng + dLng, lat - dLat],
    [lng + dLng, lat + dLat],
    [lng - dLng, lat + dLat],
    [lng - dLng, lat - dLat],
  ];
}

const seed: Record<string, unknown[]> = {};

seed.tenant = [{ id: tenantId, name: tenant.name, default_locale: tenant.defaultLocale, branding: tenant.branding, settings: tenant.settings }];
seed.legal_entity = legalEntities.map((l) => ({ id: id(l.id), ...T, name: l.name, nip: l.nip, country: l.country }));
seed.app_user = users.map((u) => ({ id: id(u.key), ...T, email: u.email, full_name: u.full_name, locale: u.locale }));
seed.user_role = users.flatMap((u) => u.roles.map((r) => ({ ...T, user_id: id(u.key), role_code: r })));
seed.user_scope = users.flatMap((u) => [
  ...(u.sites ?? []).map((s) => ({ ...T, user_id: id(u.key), kind: "site", value: id(s) })),
  ...(u.regions ?? []).map((r) => ({ ...T, user_id: id(u.key), kind: "region", value: r })),
]);

const docTypeOf: Record<string, string | null> = { "c-udt": "udt" };
seed.competence = competences.map((c) => ({
  id: id(c.id),
  ...T,
  code: c.id.slice(2),
  name: c.name,
  kind: c.id === "c-pl-a2" || c.id === "c-de-a2" ? "language" : "skill",
  required_document_type: docTypeOf[c.id] ?? null,
}));
seed.position = positions.map((p) => ({ id: id(p.id), ...T, code: p.id.slice(2), name: p.name }));
seed.position_competence = positions.flatMap((p) => p.competenceIds.map((c) => ({ ...T, position_id: id(p.id), competence_id: id(c) })));
seed.reason = [
  ...correctionReasons.map((r, i) => ({ id: id(r.id), ...T, kind: "correction", code: r.id.slice(2), name: r.name, sort: i })),
  ...disputeReasons.map((r, i) => ({ id: id(r.id), ...T, kind: "dispute", code: r.id.slice(2), name: r.name, sort: i })),
];

seed.client = clients.map((c) => ({ id: id(c.id), ...T, name: c.name, short_name: c.shortName, nip: c.nip, country: c.country, manager_user_id: id(c.managerUserId) }));
// Client users of the portal (12), after the clients they belong to ("table#part" keys load into "table").
seed["app_user#client"] = clientUsers.map((u) => ({ id: id(u.id), ...T, email: u.email, full_name: u.fullName, locale: u.locale, client_id: id(u.clientId) }));
seed["user_role#client"] = clientUsers.map((u) => ({ ...T, user_id: id(u.id), role_code: u.role }));
seed.site = sites.map((s) => ({
  id: id(s.id),
  ...T,
  client_id: id(s.clientId),
  name: s.name,
  city: s.city,
  address: s.address,
  country: s.country,
  region: s.region,
  time_zone: s.timeZone,
  lat: s.lat,
  lng: s.lng,
  geofence: geofence(s.lat, s.lng),
  manager_name: s.managerName,
  clock_methods: s.clockMethods,
  access_control: s.accessControl,
  late_threshold_min: s.lateThresholdMin,
  clock_window_min: s.clockWindowMin,
  outside_geofence: s.outsideGeofence,
  team_leader_name: teamLeaders[s.id] ?? null,
  output_norm: siteOutput[s.id]?.norm ?? null,
  output_unit: siteOutput[s.id]?.unit ?? null,
  output_source: siteOutput[s.id]?.source ?? null,
}));
seed.contract = contracts.map((k) => ({
  id: id(k.id),
  ...T,
  number: k.number,
  client_id: id(k.clientId),
  legal_entity_id: id(k.legalEntityId),
  currency: k.currency,
  status: k.status,
  version_no: k.version,
  version_from: k.versionFrom,
  valid_from: k.validFrom,
  valid_to: k.validTo,
  timesheet_period: k.timesheetPeriod,
  auto_accept_hours: k.autoAcceptHours,
  payment_days: k.paymentDays,
  show_rates_in_portal: k.showRatesInPortal,
  sla: k.sla,
  kpi_targets: k.kpiTargets,
}));
seed.rate_card = contracts.flatMap((k) =>
  k.rates.map((r) => ({ id: id(`${k.id}:${r.positionId}`), ...T, contract_id: id(k.id), position_id: id(r.positionId), amount: r.current, previous: r.previous, valid_from: k.versionFrom })),
);
seed.project = projects.map((p) => ({ id: id(p.id), ...T, site_id: id(p.siteId), contract_id: id(p.contractId), name: p.name, manager_name: p.managerName }));
seed.shift_template = templates.map((t) => ({ id: id(t.id), ...T, project_id: id(t.projectId), position_id: id(t.positionId), start_time: t.start, end_time: t.end, unpaid_break_min: t.unpaidBreakMin, sort_order: t.sortOrder }));
seed.shift_plan = plans.map((p) => ({ ...T, template_id: id(p.templateId), date: p.date, planned: p.planned, cancelled: !!p.cancelled }));
seed.schedule_week = projects.flatMap((p) => {
  const weeks: unknown[] = [];
  for (let m = mondayOf(DEMO_RANGE_FROM); m <= DEMO_RANGE_TO; m = addDays(m, 7)) {
    const state = m < "2026-10-26" ? "published" : m === "2026-10-26" ? (p.id === "pr-strykow" ? "draft" : "published") : "draft";
    weeks.push({ ...T, project_id: id(p.id), monday: m, state });
  }
  return weeks;
});

seed.worker = workers.map((w) => ({
  id: id(w.id),
  ...T,
  number: w.number,
  first_name: w.firstName,
  last_name: w.lastName,
  phone: w.phone,
  citizenship: w.citizenship,
  language: w.language,
  contract_kind: w.contractKind,
  lat: w.homeLat,
  lng: w.homeLng,
  prefers_morning: w.prefersMorning,
  weekly_hour_limit: w.weeklyHourLimit,
  status: w.status,
  status_until: w.statusUntil ?? null,
  badge_count: w.badgeCount,
  rating: w.rating,
}));
seed.worker_position = workers.flatMap((w) => w.positionIds.map((p) => ({ ...T, worker_id: id(w.id), position_id: id(p) })));
seed.worker_competence = workers.flatMap((w) => w.competenceIds.map((c) => ({ ...T, worker_id: id(w.id), competence_id: id(c) })));
seed.worker_site_experience = workers.flatMap((w) => Object.entries(w.shiftsBySite).map(([s, n]) => ({ ...T, worker_id: id(w.id), site_id: id(s), shifts: n })));
seed.worker_document = documents.map((d) => ({ id: id(d.id), ...T, worker_id: id(d.workerId), type: d.type, valid_to: d.validTo }));

seed.assignment = assignments.map((a) => ({
  id: id(a.id),
  ...T,
  worker_id: id(a.workerId),
  template_id: id(a.templateId),
  date: a.date,
  status: a.status,
  source: a.source,
  replaces_id: a.replacesId ? id(a.replacesId) : null,
}));

const clocks: unknown[] = [];
for (const c of clockEvents) {
  const a = assignments.find((x) => x.date === c.date && x.workerId === c.workerId)!;
  const site = siteOfTemplate(a.templateId);
  const at = instant(c.date, c.time, site.timeZone);
  clocks.push({ id: id(c.id), ...T, worker_id: id(c.workerId), assignment_id: id(a.id), site_id: id(site.id), type: c.type, device_time: at, server_time: at, source: c.source });
}

// Timesheets: the period containing last Monday for every project, as the list screen shows.
const timesheetRows: unknown[] = [];
const entryRows: unknown[] = [];
const correctionRows: unknown[] = [];
const disputeRows: unknown[] = [];
for (const p of projects) {
  const contract = contractForClient(siteById.get(p.siteId)!.clientId);
  const lastMonday = addDays(mondayOf(DEMO_TODAY), -7);
  let from = lastMonday;
  let to = addDays(lastMonday, 6);
  if (contract.timesheetPeriod === "two_weeks") {
    from = "2026-10-12";
    to = "2026-10-25";
  } else if (contract.timesheetPeriod === "month") {
    from = "2026-10-01";
    to = "2026-10-31";
  }
  const ts = buildTimesheet(p.id, from, to);
  const tsId = id(ts.id);
  const stage = ts.clientStage;
  timesheetRows.push({
    id: tsId,
    ...T,
    project_id: id(p.id),
    period_from: from,
    period_to: to,
    team_leader_days_confirmed: ts.teamLeaderDaysConfirmed,
    manager_confirmed: ts.managerConfirmed,
    client_stage: stage.kind,
    client_due_at: stage.kind === "waiting" ? new Date(stage.until).toISOString() : null,
    sent_at: ts.sentAt ? new Date(ts.sentAt).toISOString() : null,
    sent_by: ts.sentByName ? id(users.find((u) => u.full_name === ts.sentByName)?.key ?? "u-marta") : null,
  });
  for (const row of ts.rows) {
    for (const d of row.days) {
      if (!d.hasShift) continue;
      const a = assignments.find((x) => x.workerId === row.workerId && x.date === d.date && templateById.get(x.templateId)!.projectId === p.id);
      const entryId = id(`${ts.id}:${row.workerId}:${d.date}`);
      entryRows.push({
        id: entryId,
        ...T,
        timesheet_id: tsId,
        worker_id: id(row.workerId),
        position_id: id(row.positionId),
        assignment_id: a ? id(a.id) : null,
        date: d.date,
        shift_label: d.shiftLabel ?? null,
        planned_hours: d.plannedHours,
        payable_hours: d.payableHours,
        billable_hours: d.billableHours,
        issue_kind: d.issue?.kind ?? null,
        issue_minutes: d.issue?.minutes ?? null,
        disputed: !!d.disputed,
      });
      for (const x of d.disputes ?? []) {
        disputeRows.push({
          id: id(x.id),
          ...T,
          timesheet_id: tsId,
          entry_id: entryId,
          reason_id: id(x.reasonId),
          client_hours: x.clientHours ?? null,
          comment: x.comment,
          created_at: new Date(x.createdAt).toISOString(),
          created_by_name: x.createdByName,
          status: x.status,
        });
      }
      for (const c of d.corrections) {
        correctionRows.push({
          id: id(c.id),
          ...T,
          entry_id: entryId,
          at: new Date(c.at).toISOString(),
          by_name: c.byName,
          payable_before: c.payableBefore,
          payable_after: c.payableAfter,
          billable_before: c.billableBefore,
          billable_after: c.billableAfter,
          reason_id: id(c.reasonId),
          comment: c.comment,
        });
      }
      // Clock evidence for past days of the review week, so the correction panel has real events.
      if (d.date < DEMO_TODAY && d.date >= lastMonday && a) {
        const site = siteById.get(p.siteId)!;
        evidenceFor(p.id, row.workerId, d).forEach((e, i) => {
          const base = { ...T, worker_id: id(row.workerId), assignment_id: id(a.id), site_id: id(site.id), source: e.source, gps_accuracy_m: e.gpsAccuracyM ?? null, photo: !!e.photo, face_match: e.faceMatch ?? null, gate: e.gate ?? null, kiosk: e.kiosk ?? null, qr_point: e.qrPoint ?? null };
          // A night shift's events after midnight belong to the next calendar day.
          const startMin = Number(d.shiftLabel!.slice(0, 2)) * 60;
          const dayOf = (hhmm: string) => (Number(hhmm.slice(0, 2)) * 60 < startMin - 120 ? addDays(d.date, 1) : d.date);
          if (e.type === "break") {
            clocks.push({ id: id(`ev:${entryId}:${i}:s`), ...base, type: "break_start", device_time: instant(dayOf(e.time), e.time, site.timeZone), server_time: instant(dayOf(e.time), e.time, site.timeZone) });
            clocks.push({ id: id(`ev:${entryId}:${i}:e`), ...base, type: "break_end", device_time: instant(dayOf(e.endTime!), e.endTime!, site.timeZone), server_time: instant(dayOf(e.endTime!), e.endTime!, site.timeZone) });
          } else {
            const at = instant(dayOf(e.time), e.time, site.timeZone);
            clocks.push({ id: id(`ev:${entryId}:${i}`), ...base, type: e.type, device_time: at, server_time: at });
          }
        });
      }
    }
  }
}
seed.clock_event = clocks;
seed.timesheet = timesheetRows;
seed.timesheet_entry = entryRows;
seed.timesheet_correction = correctionRows;
seed.timesheet_dispute = disputeRows;

seed.alert = alerts.map((a) => ({
  id: id(a.id),
  ...T,
  kind: a.kind,
  severity: a.severity,
  site_id: id(a.siteId),
  title: a.title,
  context: a.context,
  created_at: new Date(a.createdAt).toISOString(),
  escalation_level: a.escalationLevel,
  next_escalation_at: a.nextEscalationAt ? new Date(a.nextEscalationAt).toISOString() : null,
  sla_due_at: a.slaDueAt ? new Date(a.slaDueAt).toISOString() : null,
  status: a.status,
  count: a.count,
  shift_ref: a.shiftRef ? { projectId: id(a.shiftRef.projectId), templateId: id(a.shiftRef.templateId), date: a.shiftRef.date } : null,
}));
seed.staff_request = staffRequests.map((r) => ({
  id: id(r.id),
  ...T,
  number: r.number,
  site_id: id(r.siteId),
  position_id: id(r.positionId),
  headcount: r.headcount,
  assigned: r.assigned,
  date_from: r.from,
  date_to: r.to,
  status: r.status,
  sla_due_at: new Date(r.slaDueAt).toISOString(),
  template_ids: r.templateIds.map(id),
  competence_ids: r.competenceIds.map(id),
  experienced_only: r.experiencedOnly,
  client_ref: r.clientRef ?? null,
  comment: r.comment ?? null,
  contact_name: r.contactName,
  created_at: new Date(r.createdAt).toISOString(),
  created_by_name: r.createdByName,
  accepted_at: r.acceptedAt ? new Date(r.acceptedAt).toISOString() : null,
  accepted_by_name: r.acceptedByName ?? null,
}));
seed.staff_request_cell = [...requestCells].flatMap(([requestId, cells]) =>
  cells.map((c) => ({ ...T, request_id: id(requestId), template_id: id(c.templateId), date: c.date, needed: c.needed })),
);
seed.staff_request_assignment = [...requestAssignments].flatMap(([requestId, ids]) => [...ids].map((a) => ({ ...T, request_id: id(requestId), assignment_id: id(a) })));

/* ------------------------------------------------------- mobile app and kiosk (14) */

const WARSAW = "Europe/Warsaw";
/** PBKDF2-SHA256 hash in the format the backend verifies (Credentials.java). */
function pinHash(pin: string, salt: string): string {
  const s = createHash("sha256").update(`salt:${salt}`).digest().subarray(0, 16);
  return `pbkdf2-sha256$10000$${s.toString("base64")}$${pbkdf2Sync(pin, s, 10000, 32, "sha256").toString("base64")}`;
}
seed["app_user#worker"] = workerUsers.map((u) => ({ id: id(u.id), ...T, email: u.email, full_name: u.fullName, locale: u.locale, worker_id: id(u.workerId) }));
seed["user_role#worker"] = workerUsers.flatMap((u) => u.roles.map((r) => ({ ...T, user_id: id(u.id), role_code: r })));
seed["user_scope#worker"] = workerUsers.filter((u) => u.leadsSiteId).map((u) => ({ ...T, user_id: id(u.id), kind: "site", value: id(u.leadsSiteId!) }));
seed["app_user#kiosk"] = [{ id: id(kioskDevice.userId), ...T, email: kioskDevice.email, full_name: kioskDevice.code, locale: "ru" }];
seed["user_role#kiosk"] = [{ ...T, user_id: id(kioskDevice.userId), role_code: "KIOSK" }];
seed["user_scope#kiosk"] = [{ ...T, user_id: id(kioskDevice.userId), kind: "site", value: id(kioskDevice.siteId) }];
seed.kiosk_device = [{ id: id(kioskDevice.id), ...T, user_id: id(kioskDevice.userId), site_id: id(kioskDevice.siteId), code: kioskDevice.code, entry: kioskDevice.entry, face_enabled: kioskDevice.faceEnabled }];
seed.worker_credential = kioskWorkerIds.map((wid) => {
  const w = workers.find((x) => x.id === wid)!;
  return { ...T, worker_id: id(wid), pin_hash: pinHash(demoPin(w.number), wid), card_uid: demoCardUid(wid), biometric_consent_at: biometricConsent.has(wid) ? "2026-09-01T08:00:00Z" : null };
});
seed.clock_issue = seedIssues.map((x) => ({
  id: id(x.id),
  ...T,
  worker_id: id(x.workerId),
  assignment_id: id(x.assignmentId),
  kind: x.kind,
  type: x.type,
  local_time: x.time,
  comment: x.comment,
  status: "open",
  created_at: instant(DEMO_TODAY, x.createdAt, WARSAW),
  created_by_name: (() => {
    const w = workers.find((y) => y.id === x.workerId)!;
    return `${w.firstName} ${w.lastName}`;
  })(),
}));
seed.urgent_request = [
  {
    id: id(seedUrgent.requestId),
    ...T,
    site_id: id(seedUrgent.siteId),
    template_id: id(seedUrgent.templateId),
    date: seedUrgent.date,
    headcount: seedUrgent.headcount,
    comment: "",
    offered_to: 1,
    accepted: 0,
    bonus_points: seedUrgent.bonusPoints,
    created_at: instant(DEMO_TODAY, seedUrgent.createdAt, WARSAW),
    created_by: id("u-marta"),
  },
];
seed.urgent_offer = [{ id: id(seedUrgent.offerId), ...T, request_id: id(seedUrgent.requestId), worker_id: id(seedUrgent.workerId), status: "sent", sent_at: instant(DEMO_TODAY, seedUrgent.createdAt, WARSAW) }];
seed.shift_output = [{ ...T, site_id: id(seedOutput.siteId), date: seedOutput.date, start_time: seedOutput.start, value: seedOutput.value, updated_at: instant(seedOutput.date, seedOutput.updatedAt, WARSAW) }];

seed.notification = notifications.map((n) => ({ id: id(n.id), ...T, user_id: id("u-marta"), kind: n.kind, title: n.title, href: n.href ?? null, at: new Date(n.at).toISOString(), read: n.read }));

mkdirSync(dirname(out), { recursive: true });
const json = JSON.stringify(seed);
writeFileSync(out, gzipSync(json, { level: 9 }));
console.log(
  `seed: ${(json.length / 1e6).toFixed(1)} MB json → ${out}\n` +
    Object.entries(seed)
      .map(([k, v]) => `  ${k}: ${v.length}`)
      .join("\n"),
);
void shiftHours;
