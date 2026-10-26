import { shiftInterval, toMinutes } from "../dates";
import type { Alert, NotificationItem, SiteLive, SiteLiveStatus, StaffRequest } from "../types";
import {
  DEMO_NOW_ISO,
  DEMO_NOW_TIME,
  DEMO_TODAY,
  assignments,
  clients,
  clockEvents,
  plans,
  projects,
  replacementAssignmentIds,
  sites,
  teamLeaders,
  templates,
} from "./generate";

const nowMin = toMinutes(DEMO_NOW_TIME.slice(0, 5));

function plusMinutes(iso: string, min: number): string {
  const d = new Date(new Date(iso).getTime() + min * 60000);
  return d.toISOString();
}

/** Live numbers of the current shift for one site, derived from assignments and clock-ins. */
export function computeSiteLive(siteId: string, openAlerts: Alert[]): SiteLive {
  const site = sites.find((s) => s.id === siteId)!;
  const project = projects.find((p) => p.siteId === siteId)!;
  const current = templates.filter((t) => {
    if (t.projectId !== project.id) return false;
    const [s, e] = shiftInterval(DEMO_TODAY, t.start, t.end, DEMO_TODAY);
    return s <= nowMin && nowMin < e;
  });
  const planned = plans.filter((p) => p.date === DEMO_TODAY && current.some((t) => t.id === p.templateId)).reduce((sum, p) => sum + p.planned, 0);
  const todays = assignments.filter((a) => a.date === DEMO_TODAY && current.some((t) => t.id === a.templateId));
  let actual = 0;
  let late = 0;
  let noShows = 0;
  let noShowsReplaced = 0;
  const replaced = new Set(todays.map((a) => a.replacesId).filter(Boolean));
  for (const a of todays) {
    const tpl = current.find((t) => t.id === a.templateId)!;
    const ev = clockEvents.find((c) => c.workerId === a.workerId && c.date === DEMO_TODAY && c.type === "in");
    if (ev) {
      actual++;
      if (!replacementAssignmentIds.has(a.id) && toMinutes(ev.time) > toMinutes(tpl.start) + site.lateThresholdMin) late++;
    } else if (nowMin > toMinutes(tpl.start) + 30) {
      noShows++;
      if (replaced.has(a.id)) noShowsReplaced++;
    }
  }
  const labels = [...new Set(current.map((t) => `${t.start}–${t.end}`))];
  const shortage = Math.max(0, planned - actual);
  const siteAlerts = openAlerts.filter((a) => a.siteId === siteId && a.status !== "closed");
  let status: SiteLiveStatus = "ok";
  if ((planned > 0 && shortage / planned > 0.2) || siteAlerts.some((a) => a.severity === "critical")) status = "critical";
  else if (shortage >= 1 || late > 5 || siteAlerts.some((a) => a.severity === "warning")) status = "deviation";
  return {
    siteId,
    projectId: project.id,
    siteName: site.name,
    clientName: clients.find((c) => c.id === site.clientId)!.shortName,
    shiftLabel: labels.length > 1 ? `${labels[0]} +${labels.length - 1}` : labels[0] ?? "—",
    actual,
    planned,
    late,
    noShows,
    noShowsReplaced,
    teamLeaderName: teamLeaders[siteId] ?? "—",
    status,
    lat: site.lat,
    lng: site.lng,
    region: site.region,
    country: site.country,
  };
}

function shortageAt(siteId: string): { shortage: number; label: string } {
  const live = computeSiteLive(siteId, []);
  return { shortage: Math.max(0, live.planned - live.actual), label: live.shiftLabel };
}

const strykow = shortageAt("s-strykow");

export const alerts: Alert[] = [
  {
    id: "al-1",
    kind: "understaffed",
    severity: "critical",
    siteId: "s-strykow",
    title: {
      pl: `Stryków · Magazyn B: brakuje ${strykow.shortage} osób`,
      uk: `Stryków · Magazyn B: недокомплект ${strykow.shortage} осіб`,
      ru: `Stryków · Magazyn B: недокомплект ${strykow.shortage} человек`,
      en: `Stryków · Magazyn B: ${strykow.shortage} people short`,
    },
    context: { pl: `Zmiana ${strykow.label}`, uk: `Зміна ${strykow.label}`, ru: `Смена ${strykow.label}`, en: `Shift ${strykow.label}` },
    createdAt: plusMinutes(DEMO_NOW_ISO, -44),
    escalationLevel: 1,
    nextEscalationAt: plusMinutes(DEMO_NOW_ISO, 12),
    status: "open",
    count: 1,
    shiftRef: { projectId: "pr-strykow", templateId: "tpl-strykow-1", date: DEMO_TODAY },
  },
  {
    id: "al-2",
    kind: "document",
    severity: "critical",
    siteId: "s-leipzig",
    title: {
      pl: "3 pracowników bez ważnego BHP przypisanych do zmiany",
      uk: "3 працівники без чинного BHP призначені на зміну",
      ru: "3 работника без действующего BHP назначены на смену",
      en: "3 workers without valid BHP assigned to a shift",
    },
    context: {
      pl: "Leipzig · Linie 2 · przypisanie zablokowane",
      uk: "Leipzig · Linie 2 · призначення заблоковано",
      ru: "Leipzig · Linie 2 · назначение заблокировано",
      en: "Leipzig · Linie 2 · assignment blocked",
    },
    createdAt: plusMinutes(DEMO_NOW_ISO, -134),
    escalationLevel: 1,
    status: "open",
    count: 3,
  },
  {
    id: "al-3",
    kind: "sla",
    severity: "warning",
    siteId: "s-poznan",
    title: {
      pl: "Zamówienie: 8 kompletujących na 28.10",
      uk: "Заявка: 8 комплектувальників на 28.10",
      ru: "Заявка: 8 комплектовщиков на 28.10",
      en: "Request: 8 pickers for 28.10",
    },
    context: { pl: "Polmarket", uk: "Polmarket", ru: "Polmarket", en: "Polmarket" },
    createdAt: "2026-10-25T10:19:00+01:00",
    escalationLevel: 1,
    slaDueAt: plusMinutes(DEMO_NOW_ISO, 125),
    status: "open",
    count: 1,
  },
  {
    id: "al-4",
    kind: "anomaly",
    severity: "info",
    siteId: "s-poznan",
    title: {
      pl: "Anomalia: 4 odbicia z jednego urządzenia",
      uk: "Аномалія: 4 відмітки з одного пристрою",
      ru: "Аномалия: 4 отметки с одного устройства",
      en: "Anomaly: 4 clock-ins from one device",
    },
    context: { pl: "Poznań · Magazyn A · 05:58–06:01", uk: "Poznań · Magazyn A · 05:58–06:01", ru: "Poznań · Magazyn A · 05:58–06:01", en: "Poznań · Magazyn A · 05:58–06:01" },
    createdAt: plusMinutes(DEMO_NOW_ISO, -132),
    escalationLevel: 1,
    status: "open",
    count: 1,
  },
  {
    id: "al-5",
    kind: "access_control",
    severity: "warning",
    siteId: "s-leipzig",
    title: {
      pl: "Brak zdarzeń z systemu kontroli dostępu od 40 min",
      uk: "Немає подій СКУД 40 хв",
      ru: "Нет событий СКУД 40 мин",
      en: "No access-control events for 40 min",
    },
    context: { pl: "Leipzig · Linie 2 · API", uk: "Leipzig · Linie 2 · API", ru: "Leipzig · Linie 2 · API", en: "Leipzig · Linie 2 · API" },
    createdAt: plusMinutes(DEMO_NOW_ISO, -10),
    escalationLevel: 1,
    status: "open",
    count: 1,
  },
  {
    id: "al-6",
    kind: "kpi",
    severity: "warning",
    siteId: "s-leipzig",
    title: {
      pl: "KPI: nieobecności zastąpione w 2 h — 88% przy celu 90%",
      uk: "KPI: неявки замінено за 2 год — 88% при цілі 90%",
      ru: "KPI: неявки заменены за 2 ч — 88% при цели 90%",
      en: "KPI: no-shows replaced within 2 h — 88% vs 90% target",
    },
    context: { pl: "Weser Automotive · K-2026-022", uk: "Weser Automotive · K-2026-022", ru: "Weser Automotive · K-2026-022", en: "Weser Automotive · K-2026-022" },
    createdAt: "2026-10-26T08:00:00+01:00",
    escalationLevel: 1,
    status: "open",
    count: 1,
  },
];

/** Client requests for staff (12.1). Accepted ones get shift cells in ./requests.ts. */
export const staffRequests: StaffRequest[] = [
  {
    id: "sr-1197", number: 1197, siteId: "s-poznan", positionId: "p-picker", headcount: 8, assigned: 0, from: "2026-10-28", to: "2026-10-30", status: "new",
    slaDueAt: plusMinutes(DEMO_NOW_ISO, 125), templateIds: ["tpl-poznan-1"], competenceIds: ["c-wms"], experiencedOnly: false, clientRef: "PM/2026/10/418",
    comment: "Szczyt przed akcją promocyjną, potrzebne osoby z doświadczeniem w skanowaniu.", contactName: "Katarzyna Wójcik", createdAt: "2026-10-25T10:19:00+01:00", createdByName: "Katarzyna Wójcik",
  },
  {
    id: "sr-1196", number: 1196, siteId: "s-strykow", positionId: "p-forklift", headcount: 2, assigned: 1, from: "2026-11-02", to: "2026-11-06", status: "in_progress",
    slaDueAt: "2026-10-23T16:00:00+02:00", templateIds: ["tpl-strykow-3"], competenceIds: [], experiencedOnly: true, contactName: "Tomasz Lewandowski",
    createdAt: "2026-10-22T16:00:00+02:00", createdByName: "Tomasz Lewandowski", acceptedAt: "2026-10-22T17:05:00+02:00", acceptedByName: "Marta Kowalska",
  },
  {
    id: "sr-1199", number: 1199, siteId: "s-leipzig", positionId: "p-line", headcount: 4, assigned: 0, from: "2026-11-02", to: "2026-11-06", status: "new",
    slaDueAt: "2026-10-27T07:30:00+01:00", templateIds: ["tpl-leipzig-1"], competenceIds: [], experiencedOnly: false, clientRef: "WA-4471",
    comment: "Zusätzliche Linie wegen Modellwechsel.", contactName: "Jens Hoffmann", createdAt: "2026-10-26T07:30:00+01:00", createdByName: "Jens Hoffmann",
  },
  {
    id: "sr-1200", number: 1200, siteId: "s-teresin", positionId: "p-packer", headcount: 6, assigned: 2, from: "2026-11-09", to: "2026-11-13", status: "in_progress",
    slaDueAt: "2026-10-24T11:00:00+02:00", templateIds: ["tpl-teresin-2"], competenceIds: [], experiencedOnly: false, contactName: "Agata Zając",
    createdAt: "2026-10-23T11:00:00+02:00", createdByName: "Agata Zając", acceptedAt: "2026-10-23T13:40:00+02:00", acceptedByName: "Marta Kowalska",
  },
  {
    id: "sr-1190", number: 1190, siteId: "s-lodz", positionId: "p-sorter", headcount: 10, assigned: 10, from: "2026-10-26", to: "2026-10-31", status: "staffed",
    slaDueAt: "2026-10-20T12:00:00+02:00", templateIds: ["tpl-lodz-1"], competenceIds: [], experiencedOnly: false, contactName: "Tomasz Lewandowski",
    createdAt: "2026-10-19T12:00:00+02:00", createdByName: "Tomasz Lewandowski", acceptedAt: "2026-10-19T14:10:00+02:00", acceptedByName: "Marta Kowalska",
  },
  {
    id: "sr-1182", number: 1182, siteId: "s-strykow", positionId: "p-packer", headcount: 6, assigned: 6, from: "2026-10-21", to: "2026-10-21", status: "done",
    slaDueAt: "2026-10-16T12:00:00+02:00", templateIds: ["tpl-strykow-6"], competenceIds: [], experiencedOnly: false, clientRef: "NL-0921", contactName: "Tomasz Lewandowski",
    createdAt: "2026-10-15T12:00:00+02:00", createdByName: "Tomasz Lewandowski", acceptedAt: "2026-10-15T15:30:00+02:00", acceptedByName: "Marta Kowalska",
  },
];

export const notifications: NotificationItem[] = [
  { id: "n-1", kind: "alert", title: { pl: "Stryków · Magazyn B: brak osób na zmianie", uk: "Stryków · Magazyn B: недокомплект на зміні", ru: "Stryków · Magazyn B: недокомплект на смене", en: "Stryków · Magazyn B: shift understaffed" }, at: plusMinutes(DEMO_NOW_ISO, -44), read: false, href: "/alerts" },
  { id: "n-2", kind: "approval", title: { pl: "Ręczne odbicie do zatwierdzenia · Łódź", uk: "Ручна відмітка на погодження · Łódź", ru: "Ручная отметка на согласование · Łódź", en: "Manual clock-in to approve · Łódź" }, at: plusMinutes(DEMO_NOW_ISO, -71), read: false },
  { id: "n-3", kind: "alert", title: { pl: "Nowe zamówienie klienta № 1199", uk: "Нова заявка клієнта № 1199", ru: "Новая заявка клиента № 1199", en: "New client request No. 1199" }, at: plusMinutes(DEMO_NOW_ISO, -95), read: false, href: "/requests" },
  { id: "n-4", kind: "mention", title: { pl: "Paweł Nowak wspomniał o Tobie w tabeli Poznań", uk: "Paweł Nowak згадав вас у табелі Poznań", ru: "Paweł Nowak упомянул вас в табеле Poznań", en: "Paweł Nowak mentioned you in the Poznań timesheet" }, at: "2026-10-25T17:20:00+01:00", read: true },
  { id: "n-5", kind: "approval", title: { pl: "Urlop 02–06.11 do zatwierdzenia", uk: "Відпустка 02–06.11 на погодження", ru: "Отпуск 02–06.11 на согласование", en: "Leave 02–06.11 to approve" }, at: "2026-10-25T15:02:00+01:00", read: true },
];
