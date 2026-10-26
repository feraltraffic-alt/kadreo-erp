import { addDays, daysBetween, mondayOf, shiftInterval, toMinutes, fromMinutes, weekdayIndex } from "../dates";
import type {
  Assignment,
  ClockEvent,
  CountryCode,
  Locale,
  Project,
  ShiftPlan,
  ShiftTemplate,
  Worker,
  WorkerDocument,
} from "../types";
import { competences, correctionReasons, disputeReasons, positions } from "./dictionaries";
import { namePools } from "./names";
import { clients, contractForClient, contracts, legalEntities, sites, teamLeaders, templateSeeds, tenant } from "./org";
import { createRng, hashString } from "./rng";

/** The demo runs on a fixed clock so every screen matches the reference mock-ups. */
export const DEMO_TODAY = "2026-10-26";
export const DEMO_NOW_TIME = "08:14:52";
export const DEMO_NOW_ISO = "2026-10-26T08:14:52+01:00";
export const DEMO_RANGE_FROM = "2026-10-12";
export const DEMO_RANGE_TO = "2026-11-15";

const rng = createRng(20261026);

/* --------------------------------------------------------------- projects, templates */

export const projects: Project[] = sites.map((s) => {
  const contract = contractForClient(s.clientId);
  const seeds = templateSeeds[s.id] ?? [];
  return {
    id: `pr-${s.id.slice(2)}`,
    siteId: s.id,
    contractId: contract.id,
    name: s.name,
    managerName: s.managerName,
    positionIds: [...new Set(seeds.map((t) => t[0]))],
  };
});

export const templates: ShiftTemplate[] = projects.flatMap((p) =>
  (templateSeeds[p.siteId] ?? []).map(([positionId, start, end], i) => ({
    id: `tpl-${p.siteId.slice(2)}-${i + 1}`,
    projectId: p.id,
    positionId,
    start,
    end,
    unpaidBreakMin: 0,
    sortOrder: i,
  })),
);

/* --------------------------------------------------------------------------- plans */

export const plans: ShiftPlan[] = [];
for (const p of projects) {
  const seeds = templateSeeds[p.siteId] ?? [];
  seeds.forEach(([, , , weekday, saturday], i) => {
    const templateId = `tpl-${p.siteId.slice(2)}-${i + 1}`;
    for (let d = DEMO_RANGE_FROM; d <= DEMO_RANGE_TO; d = addDays(d, 1)) {
      const wd = weekdayIndex(d);
      const planned = wd < 5 ? weekday : wd === 5 ? saturday : 0;
      if (planned > 0) plans.push({ templateId, date: d, planned });
    }
  });
}

/* ------------------------------------------------------------------------- workers */

type Origin = keyof typeof namePools;
const originWeights: [Origin, number][] = [["UA", 0.62], ["PL", 0.2], ["BY", 0.08], ["GE", 0.05], ["MD", 0.05]];
const localeByOrigin: Record<Origin, Locale> = { UA: "uk", PL: "pl", BY: "ru", GE: "ru", MD: "ru" };

function pickOrigin(): Origin {
  let x = rng.next();
  for (const [o, w] of originWeights) {
    if ((x -= w) <= 0) return o;
  }
  return "UA";
}

function randomName(origin: Origin): { first: string; last: string } {
  const female = rng.chance(0.38);
  if (origin === "PL") {
    const pool = namePools.PL;
    return female
      ? { first: rng.pick(pool.female), last: rng.pick(pool.lastFemale) }
      : { first: rng.pick(pool.male), last: rng.pick(pool.lastMale) };
  }
  const pool = namePools[origin];
  return { first: rng.pick(female ? pool.female : pool.male), last: rng.pick(pool.last) };
}

export const workers: Worker[] = [];
export const documents: WorkerDocument[] = [];
/** Worker → the shift template they normally work on (their "line"). */
export const homeTemplate = new Map<string, string>();

let workerSeq = 1;
function nextNumber() {
  return `W-${String(workerSeq++).padStart(5, "0")}`;
}

function addDocs(w: Worker, siteCountry: CountryCode) {
  const far = () => addDays(DEMO_TODAY, rng.int(120, 900));
  const isEu = w.citizenship === "PL";
  const docs: WorkerDocument["type"][] = ["medical", "bhp"];
  if (!isEu) docs.push("work_permit");
  if (w.competenceIds.includes("c-udt")) docs.push("udt");
  if (siteCountry === "DE") docs.push("a1");
  for (const type of docs) {
    documents.push({ id: `doc-${w.id}-${type}`, workerId: w.id, type, validTo: far() });
  }
}

function makeWorker(opts: {
  siteId: string;
  templateId?: string;
  positionId: string;
  name?: { first: string; last: string; origin: Origin };
  number?: string;
  extraCompetences?: string[];
  status?: Worker["status"];
}): Worker {
  const site = sites.find((s) => s.id === opts.siteId)!;
  const origin = opts.name?.origin ?? pickOrigin();
  const name = opts.name ?? randomName(origin);
  const position = positions.find((p) => p.id === opts.positionId)!;
  const comp = new Set([...position.competenceIds, ...(opts.extraCompetences ?? [])]);
  if (rng.chance(0.35)) comp.add("c-pl-a2");
  if (site.country === "DE" && rng.chance(0.4)) comp.add("c-de-a2");
  const id = `w-${workerSeq}`;
  const angle = rng.next() * Math.PI * 2;
  const km = 2 + rng.next() * 24;
  const w: Worker = {
    id,
    number: opts.number ?? nextNumber(),
    firstName: name.first,
    lastName: name.last,
    phone: `+48 ${rng.int(500, 799)} ${rng.int(100, 999)} ${rng.int(100, 999)}`,
    citizenship: origin === "PL" ? "PL" : origin,
    language: localeByOrigin[origin],
    contractKind: rng.chance(0.62) ? "uop" : rng.chance(0.75) ? "zlecenie" : "b2b",
    positionIds: [opts.positionId],
    competenceIds: [...comp],
    homeLat: site.lat + (Math.sin(angle) * km) / 111,
    homeLng: site.lng + (Math.cos(angle) * km) / (111 * Math.cos((site.lat * Math.PI) / 180)),
    prefersMorning: rng.chance(0.3),
    weeklyHourLimit: rng.chance(0.85) ? 48 : 40,
    status: opts.status ?? "active",
    badgeCount: rng.int(0, 5),
    rating: Math.round((3.6 + rng.next() * 1.4) * 10) / 10,
    shiftsBySite: { [opts.siteId]: rng.int(4, 90) },
  };
  if (opts.number) workerSeq++;
  workers.push(w);
  if (opts.templateId) homeTemplate.set(w.id, opts.templateId);
  addDocs(w, site.country);
  return w;
}

/** People who appear by name on the reference mock-ups (Stryków unless noted). */
function seedNamedWorkers() {
  const strykowPicker = "tpl-strykow-1";
  const named = [
    { key: "viktor", first: "Viktor", last: "Hnatiuk", origin: "UA" as Origin, pos: "p-picker", tpl: strykowPicker, shifts: 42, km: 4, extra: ["c-pl-a2"], badges: 7, morning: false },
    { key: "oksana", first: "Oksana", last: "Lysenko", origin: "UA" as Origin, pos: "p-picker", tpl: strykowPicker, shifts: 31, km: 7, extra: [], badges: 6, morning: true },
    { key: "tomasz", first: "Tomasz", last: "Majewski", origin: "PL" as Origin, pos: "p-forklift", tpl: "tpl-strykow-3", shifts: 18, km: 12, extra: ["c-wms"], badges: 4, morning: false },
    { key: "dmytro", first: "Dmytro", last: "Rudenko", origin: "UA" as Origin, pos: "p-picker", tpl: strykowPicker, shifts: 6, km: 3, extra: [], badges: 2, morning: false },
    { key: "agnieszka", first: "Agnieszka", last: "Krawczyk", origin: "PL" as Origin, pos: "p-packer", tpl: "tpl-strykow-6", shifts: 26, km: 21, extra: ["c-wms"], badges: 3, morning: false },
  ];
  const site = sites.find((s) => s.id === "s-strykow")!;
  for (const n of named) {
    const w = makeWorker({ siteId: site.id, templateId: n.tpl, positionId: n.pos, name: { first: n.first, last: n.last, origin: n.origin }, extraCompetences: n.extra });
    w.homeLat = site.lat + n.km / 111;
    w.homeLng = site.lng;
    w.shiftsBySite = n.shifts > 0 ? { [site.id]: n.shifts } : {};
    w.badgeCount = n.badges;
    w.prefersMorning = n.morning;
    if (n.key === "viktor") {
      w.number = "W-00012";
      w.contractKind = "uop";
      w.positionIds = ["p-picker"];
      setDoc(w.id, "bhp", "2027-03-01");
    }
    if (n.key === "oksana") {
      w.contractKind = "zlecenie";
      w.number = "W-00044";
    }
    if (n.key === "tomasz") {
      w.contractKind = "b2b";
      w.number = "W-00211";
      w.positionIds = ["p-forklift", "p-picker"];
      w.weeklyHourLimit = 40;
      setDoc(w.id, "bhp", "2026-11-02");
    }
    if (n.key === "dmytro") {
      w.number = "W-00318";
      w.contractKind = "uop";
      // Medical expired on 24.10: blocked for new assignments (15.9) until HR accepts the new one.
      setDoc(w.id, "medical", "2026-10-24");
      w.status = "blocked";
    }
    if (n.key === "agnieszka") {
      w.contractKind = "zlecenie";
      w.number = "W-00156";
      w.positionIds = ["p-packer", "p-picker"];
    }
    namedWorkerIds[n.key] = w.id;
  }
  // Leipzig quality controller on posting to Germany, A1 expiring on 15.11.
  const iryna = makeWorker({ siteId: "s-leipzig", templateId: "tpl-leipzig-2", positionId: "p-qc", name: { first: "Iryna", last: "Dziuba", origin: "UA" }, extraCompetences: ["c-wms", "c-udt", "c-de-a2"] });
  iryna.number = "W-00087";
  iryna.contractKind = "uop";
  iryna.badgeCount = 6;
  iryna.rating = 4.8;
  setDoc(iryna.id, "a1", "2026-11-15");
  namedWorkerIds.iryna = iryna.id;
  // Free worker whose work permit expires on 20.11.
  const marko = makeWorker({ siteId: "s-strykow", positionId: "p-packer", name: { first: "Marko", last: "Savych", origin: "UA" }, status: "free" });
  marko.number = "W-00402";
  marko.contractKind = "zlecenie";
  marko.badgeCount = 0;
  setDoc(marko.id, "work_permit", "2026-11-20");
  namedWorkerIds.marko = marko.id;
}

export const namedWorkerIds: Record<string, string> = {};

function setDoc(workerId: string, type: WorkerDocument["type"], validTo: string) {
  const d = documents.find((x) => x.workerId === workerId && x.type === type);
  if (d) d.validTo = validTo;
  else documents.push({ id: `doc-${workerId}-${type}`, workerId, type, validTo });
}

seedNamedWorkers();

// Pools per shift line: enough people for five working days a week plus a margin.
for (const t of templates) {
  const project = projects.find((p) => p.id === t.projectId)!;
  const seedIdx = Number(t.id.split("-").pop()) - 1;
  const weekdayPlan = templateSeeds[project.siteId]?.[seedIdx]?.[3] ?? 4;
  const already = [...homeTemplate.values()].filter((x) => x === t.id).length;
  const size = Math.ceil(weekdayPlan * 1.32) + 1 - already;
  for (let i = 0; i < size; i++) makeWorker({ siteId: project.siteId, templateId: t.id, positionId: t.positionId });
}

// Reserve: free workers per region who can be offered urgent shifts.
for (const s of sites) {
  const n = rng.int(1, 3);
  const linePositions = projects.find((p) => p.siteId === s.id)!.positionIds;
  for (let i = 0; i < n; i++) makeWorker({ siteId: s.id, positionId: rng.pick(linePositions), status: "free" });
}

// A few people on leave or sick, and a few documents about to expire or already expired.
for (const w of workers) {
  if (Object.values(namedWorkerIds).includes(w.id)) continue;
  if (w.status === "active" && rng.chance(0.025)) {
    w.status = "vacation";
    w.statusUntil = addDays(DEMO_TODAY, rng.int(2, 10));
  } else if (w.status === "active" && rng.chance(0.012)) {
    w.status = "sick";
    w.statusUntil = addDays(DEMO_TODAY, rng.int(1, 6));
  }
}
const oksanaId = namedWorkerIds.oksana!;
const oksana = workers.find((w) => w.id === oksanaId)!;
oksana.status = "vacation";
oksana.statusUntil = "2026-10-30";

{
  const pool = documents.filter((d) => !Object.values(namedWorkerIds).includes(d.workerId));
  for (let i = 0; i < 14; i++) rng.pick(pool).validTo = addDays(DEMO_TODAY, rng.int(3, 30));
  for (let i = 0; i < 2; i++) {
    const d = rng.pick(pool.filter((x) => x.type === "bhp" || x.type === "work_permit"));
    d.validTo = addDays(DEMO_TODAY, -rng.int(1, 5));
    const w = workers.find((x) => x.id === d.workerId)!;
    w.status = "blocked";
  }
}

// Named workers carry the numbers shown on the mock-ups; renumber anyone generated with the same number.
{
  const named = new Set(Object.values(namedWorkerIds));
  const reserved = new Set(workers.filter((w) => named.has(w.id)).map((w) => w.number));
  let next = workers.length + 100;
  for (const w of workers) {
    if (!named.has(w.id) && reserved.has(w.number)) w.number = `W-${String(next++).padStart(5, "0")}`;
  }
}

/* --------------------------------------------------------------------- assignments */

/** Assigned headcount on Stryków in week 44 as drawn on the "Планирование смен" mock-up. */
const strykowWeek44: Record<string, (number | null)[]> = {
  "tpl-strykow-1": [14, 14, 9, 12, 14, 8, null],
  "tpl-strykow-2": [12, 11, 12, 10, 12, null, null],
  "tpl-strykow-3": [6, 6, 5, 6, 4, 3, null],
  "tpl-strykow-4": [4, 4, 4, 3, 4, null, null],
  "tpl-strykow-5": [3, 3, 2, 3, 3, 1, null],
  "tpl-strykow-6": [8, 8, 6, 8, 7, null, null],
};

export const assignments: Assignment[] = [];
let assignmentSeq = 1;

const assignedOn = new Map<string, Set<string>>(); // date → worker ids
const weekCount = new Map<string, number>(); // `${monday}|${workerId}` → shifts

function isAvailable(w: Worker, date: string) {
  if (w.status === "dismissed") return false;
  if (date >= DEMO_TODAY && (w.status === "blocked" || w.status === "free")) return false;
  if ((w.status === "vacation" || w.status === "sick") && w.statusUntil && date <= w.statusUntil && date >= DEMO_TODAY) return false;
  return true;
}

function assign(w: Worker, templateId: string, date: string, source: Assignment["source"] = "manual", status?: Assignment["status"]) {
  const a: Assignment = {
    id: `as-${assignmentSeq++}`,
    workerId: w.id,
    templateId,
    date,
    source,
    status: status ?? (date <= DEMO_TODAY ? "confirmed" : rng.chance(0.82) ? "confirmed" : "proposed"),
  };
  assignments.push(a);
  if (!assignedOn.has(date)) assignedOn.set(date, new Set());
  assignedOn.get(date)!.add(w.id);
  const key = `${mondayOf(date)}|${w.id}`;
  weekCount.set(key, (weekCount.get(key) ?? 0) + 1);
  return a;
}

const excludedOn: Record<string, string[]> = {
  // The five recommended candidates on the mock are free on Wednesday 28.10.
  "2026-10-28|tpl-strykow-1": ["viktor", "oksana", "tomasz", "dmytro", "agnieszka"].map((k) => namedWorkerIds[k]!),
};

const poolByTemplate = new Map<string, Worker[]>();
for (const w of workers) {
  const t = homeTemplate.get(w.id);
  if (!t) continue;
  if (!poolByTemplate.has(t)) poolByTemplate.set(t, []);
  poolByTemplate.get(t)!.push(w);
}

for (const plan of [...plans].sort((a, b) => a.date.localeCompare(b.date))) {
  const tpl = templates.find((t) => t.id === plan.templateId)!;
  const pool = poolByTemplate.get(tpl.id) ?? [];
  let target = plan.planned;
  const override = strykowWeek44[tpl.id];
  if (override && plan.date >= "2026-10-26" && plan.date <= "2026-11-01") {
    target = override[weekdayIndex(plan.date)] ?? plan.planned;
  } else if (plan.date > addDays(DEMO_TODAY, 6)) {
    target = Math.max(0, plan.planned - (rng.chance(0.5) ? rng.int(1, Math.ceil(plan.planned * 0.25)) : 0));
  } else if (plan.date > DEMO_TODAY && rng.chance(0.25)) {
    target = Math.max(0, plan.planned - rng.int(1, 2));
  }
  const monday = mondayOf(plan.date);
  const excluded = new Set(excludedOn[`${plan.date}|${tpl.id}`] ?? []);
  const dayIdx = daysBetween(DEMO_RANGE_FROM, plan.date);
  const candidates = pool
    .filter((w) => isAvailable(w, plan.date) && !excluded.has(w.id) && !assignedOn.get(plan.date)?.has(w.id))
    .filter((w) => (weekCount.get(`${monday}|${w.id}`) ?? 0) < 5)
    .sort((a, b) => {
      const ca = weekCount.get(`${monday}|${a.id}`) ?? 0;
      const cb = weekCount.get(`${monday}|${b.id}`) ?? 0;
      if (ca !== cb) return ca - cb;
      return ((hashString(a.id) + dayIdx * 7) % 97) - ((hashString(b.id) + dayIdx * 7) % 97);
    });
  for (const w of candidates.slice(0, target)) assign(w, tpl.id, plan.date);
}

/* --------------------------------------------------------- today's clock-in events */

export const clockEvents: ClockEvent[] = [];
/** Assignments created this morning to replace no-shows. */
export const replacementAssignmentIds = new Set<string>();

type LiveProfile = { noShowShare?: number; noShows?: number; late: number; replaced: number };
const liveProfiles: Record<string, LiveProfile> = {
  "s-strykow": { noShowShare: 0.27, late: 4, replaced: 2 },
  "s-leipzig": { noShowShare: 0.22, late: 1, replaced: 1 },
  "s-poznan": { noShows: 3, late: 6, replaced: 0 },
  "s-gdansk": { noShows: 1, late: 2, replaced: 0 },
  "s-berlin": { noShows: 0, late: 7, replaced: 0 },
  "s-lodz": { noShows: 1, late: 0, replaced: 1 },
  "s-wroclaw": { noShows: 1, late: 2, replaced: 1 },
  "s-blonie": { noShows: 1, late: 1, replaced: 1 },
};

const nowMin = toMinutes(DEMO_NOW_TIME.slice(0, 5));

function clockDetail(method: string, r: ReturnType<typeof createRng>) {
  switch (method) {
    case "gps_photo":
      return `GPS ${r.int(6, 40)} m · foto`;
    case "access_card":
      return `karta · bramka ${r.int(1, 3)}`;
    case "kiosk":
      return `kiosk ${r.int(1, 2)}`;
    case "face":
      return "kiosk · twarz ✓";
    case "qr":
      return `QR · punkt ${r.int(1, 4)}`;
    default:
      return "";
  }
}

for (const site of sites) {
  const project = projects.find((p) => p.siteId === site.id)!;
  const current = templates.filter((t) => {
    if (t.projectId !== project.id) return false;
    const [s, e] = shiftInterval(DEMO_TODAY, t.start, t.end, DEMO_TODAY);
    return s <= nowMin && nowMin < e;
  });
  const todays = assignments.filter((a) => a.date === DEMO_TODAY && current.some((t) => t.id === a.templateId));
  const profile = liveProfiles[site.id] ?? { noShows: 0, late: rng.int(0, 3), replaced: 0 };
  const r = createRng(hashString(site.id));
  const shuffled = r.shuffle(todays);
  const noShows = profile.noShows ?? Math.ceil(todays.length * (profile.noShowShare ?? 0));
  shuffled.forEach((a, i) => {
    const tpl = current.find((t) => t.id === a.templateId)!;
    const start = toMinutes(tpl.start);
    if (i < noShows) return; // no clock-in: a no-show
    const late = i < noShows + profile.late;
    const minute = late ? start + site.lateThresholdMin + r.int(1, 25) : start - r.int(2, 18);
    const method = site.clockMethods[r.int(0, site.clockMethods.length - 1)]!;
    clockEvents.push({ id: `ce-${a.id}`, workerId: a.workerId, date: DEMO_TODAY, type: "in", time: fromMinutes(minute), source: method, detail: clockDetail(method, r) });
  });
  // Replacements found this morning for some of the no-shows.
  const tpl = current[0];
  if (tpl && profile.replaced > 0) {
    const busy = assignedOn.get(DEMO_TODAY) ?? new Set();
    const reserve = workers.filter((w) => w.status === "free" && !busy.has(w.id) && w.positionIds.includes(tpl.positionId));
    const others = workers.filter((w) => w.status === "active" && !busy.has(w.id) && homeTemplate.get(w.id) === tpl.id);
    const missing = todays.filter((a) => a.templateId === tpl.id && !clockEvents.some((c) => c.workerId === a.workerId && c.date === DEMO_TODAY));
    for (const [i, w] of [...reserve, ...others].slice(0, Math.min(profile.replaced, missing.length)).entries()) {
      const a = assign(w, tpl.id, DEMO_TODAY, "manual", "confirmed");
      a.replacesId = missing[i]!.id;
      replacementAssignmentIds.add(a.id);
      const minute = toMinutes(tpl.start) + 70 + r.int(0, 20);
      clockEvents.push({ id: `ce-${a.id}`, workerId: w.id, date: DEMO_TODAY, type: "in", time: fromMinutes(Math.min(minute, nowMin - 2)), source: "gps_photo", detail: clockDetail("gps_photo", r) });
    }
  }
}

export { clients, competences, contracts, correctionReasons, disputeReasons, legalEntities, positions, sites, teamLeaders, tenant };
