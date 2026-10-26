import type { ClientRole } from "../portal";
import type { Client, Contract, LegalEntity, Locale, Site, Tenant } from "../types";

/**
 * Demo tenant. Company, client and person names are invented; addresses are city-level only.
 * The product name is tenant branding (spec 0.2): screens read it from here, never from code.
 */
export const tenant: Tenant = {
  id: "t-demo",
  name: "Demo Outsourcing Sp. z o.o.",
  defaultLocale: "pl",
  branding: {
    productName: "Kadreo ERP",
    productTagline: { pl: "Platforma operacyjna", uk: "Операційна платформа", ru: "Операционная платформа", en: "Operations platform" },
    logoLetter: "K",
  },
  settings: { payrollVisibleToSiteManagers: false, dpiaCompleted: false, targetMarginPct: 18, noShowThresholdMin: 30 },
};

export const legalEntities: LegalEntity[] = [
  { id: "le-1", name: "Demo Outsourcing Sp. z o.o.", nip: "7251234560", country: "PL" },
  { id: "le-2", name: "Demo Personal Serwis Sp. z o.o.", nip: "7259876541", country: "PL" },
];

export const clients: Client[] = [
  { id: "cl-a", name: "Nordlog Sp. z o.o.", shortName: "Nordlog", nip: "5213000111", country: "PL", managerUserId: "u-marta" },
  { id: "cl-b", name: "Weser Automotive GmbH", shortName: "Weser Automotive", nip: "DE811000222", country: "DE", managerUserId: "u-iryna" },
  { id: "cl-c", name: "Polmarket Logistics S.A.", shortName: "Polmarket", nip: "7792000333", country: "PL", managerUserId: "u-pawel" },
  { id: "cl-d", name: "Odra Food Sp. z o.o.", shortName: "Odra Food", nip: "8951000444", country: "PL", managerUserId: "u-pawel" },
  { id: "cl-e", name: "Silesia Cold Chain Sp. z o.o.", shortName: "Silesia Cold Chain", nip: "6312000555", country: "PL", managerUserId: "u-anna" },
  { id: "cl-f", name: "Vistula Retail Sp. z o.o.", shortName: "Vistula Retail", nip: "5272000666", country: "PL", managerUserId: "u-marta" },
  { id: "cl-g", name: "Baltic Parcel Sp. z o.o.", shortName: "Baltic Parcel", nip: "5842000777", country: "PL", managerUserId: "u-anna" },
  { id: "cl-h", name: "Mazovia Pharma Sp. z o.o.", shortName: "Mazovia Pharma", nip: "5291000888", country: "PL", managerUserId: "u-marta" },
  { id: "cl-i", name: "Rhein Logistik GmbH", shortName: "Rhein Logistik", nip: "DE299000999", country: "DE", managerUserId: "u-iryna" },
];

type SiteSeed = Omit<Site, "timeZone" | "lateThresholdMin" | "clockWindowMin" | "outsideGeofence"> &
  Partial<Pick<Site, "lateThresholdMin" | "clockWindowMin" | "outsideGeofence">>;

const siteSeeds: SiteSeed[] = [
  { id: "s-strykow", name: "Stryków · Magazyn B", city: "Stryków", address: "ul. Logistyczna 4, 95-010 Stryków", country: "PL", region: "Łódzkie", clientId: "cl-a", lat: 51.902, lng: 19.601, managerName: "Marta Kowalska", clockMethods: ["gps_photo", "access_card", "kiosk"], accessControl: { kind: "api_online" } },
  { id: "s-lodz", name: "Łódź · Centrum sortowania", city: "Łódź", address: "ul. Rokicińska 160, 92-412 Łódź", country: "PL", region: "Łódzkie", clientId: "cl-a", lat: 51.759, lng: 19.556, managerName: "Marta Kowalska", clockMethods: ["gps_photo", "qr"], accessControl: { kind: "none" } },
  { id: "s-poznan", name: "Poznań · Magazyn A", city: "Poznań", address: "ul. Dąbrowskiego 400, 60-406 Poznań", country: "PL", region: "Wielkopolskie", clientId: "cl-c", lat: 52.433, lng: 16.817, managerName: "Paweł Nowak", clockMethods: ["kiosk", "face"], accessControl: { kind: "sftp", intervalMin: 15 } },
  { id: "s-leipzig", name: "Leipzig · Linie 2", city: "Leipzig", address: "Porsche-Straße 1, 04158 Leipzig", country: "DE", region: "Sachsen", clientId: "cl-b", lat: 51.405, lng: 12.392, managerName: "Iryna Szewczuk", clockMethods: ["access_card", "gps_photo"], accessControl: { kind: "error", sinceMin: 40 } },
  { id: "s-wroclaw", name: "Wrocław · Produkcja", city: "Wrocław", address: "ul. Krakowska 180, 52-015 Wrocław", country: "PL", region: "Dolnośląskie", clientId: "cl-d", lat: 51.083, lng: 17.072, managerName: "Paweł Nowak", clockMethods: ["qr", "kiosk"], accessControl: { kind: "none" } },
  { id: "s-gliwice", name: "Gliwice · Magazyn chłodniczy", city: "Gliwice", address: "ul. Portowa 10, 44-100 Gliwice", country: "PL", region: "Śląskie", clientId: "cl-e", lat: 50.311, lng: 18.689, managerName: "Anna Lis", clockMethods: ["kiosk", "access_card"], accessControl: { kind: "kiosk_reader" } },
  { id: "s-piotrkow", name: "Piotrków Tryb. · Hub", city: "Piotrków Trybunalski", address: "ul. Wojska Polskiego 250, 97-300 Piotrków Trybunalski", country: "PL", region: "Łódzkie", clientId: "cl-a", lat: 51.381, lng: 19.665, managerName: "Marta Kowalska", clockMethods: ["gps_photo", "qr"], accessControl: { kind: "none" } },
  { id: "s-gadki", name: "Gądki · Magazyn 3", city: "Gądki", address: "ul. Magazynowa 5, 62-023 Gądki", country: "PL", region: "Wielkopolskie", clientId: "cl-c", lat: 52.31, lng: 17.05, managerName: "Paweł Nowak", clockMethods: ["kiosk", "gps_photo"], accessControl: { kind: "none" } },
  { id: "s-sosnowiec", name: "Sosnowiec · Kompletacja", city: "Sosnowiec", address: "ul. Inwestycyjna 7, 41-208 Sosnowiec", country: "PL", region: "Śląskie", clientId: "cl-e", lat: 50.288, lng: 19.157, managerName: "Anna Lis", clockMethods: ["gps_photo", "qr"], accessControl: { kind: "none" } },
  { id: "s-katowice", name: "Katowice · Cross-dock", city: "Katowice", address: "ul. Lwowska 23, 40-389 Katowice", country: "PL", region: "Śląskie", clientId: "cl-e", lat: 50.264, lng: 19.067, managerName: "Anna Lis", clockMethods: ["kiosk"], accessControl: { kind: "kiosk_reader" } },
  { id: "s-bielany", name: "Bielany Wr. · Magazyn", city: "Bielany Wrocławskie", address: "ul. Logistyczna 6, 55-040 Bielany Wrocławskie", country: "PL", region: "Dolnośląskie", clientId: "cl-d", lat: 51.04, lng: 16.968, managerName: "Paweł Nowak", clockMethods: ["gps_photo", "qr"], accessControl: { kind: "none" } },
  { id: "s-legnica", name: "Legnica · Montaż", city: "Legnica", address: "ul. Rolnicza 9, 59-220 Legnica", country: "PL", region: "Dolnośląskie", clientId: "cl-b", lat: 51.192, lng: 16.209, managerName: "Iryna Szewczuk", clockMethods: ["access_card", "kiosk"], accessControl: { kind: "api_online" } },
  { id: "s-teresin", name: "Teresin · Magazyn spożywczy", city: "Teresin", address: "ul. Szymanowska 2, 96-515 Teresin", country: "PL", region: "Mazowieckie", clientId: "cl-f", lat: 52.205, lng: 20.437, managerName: "Marta Kowalska", clockMethods: ["gps_photo", "kiosk"], accessControl: { kind: "none" } },
  { id: "s-blonie", name: "Błonie · Centrum dystrybucji", city: "Błonie", address: "ul. Grodziska 15, 05-870 Błonie", country: "PL", region: "Mazowieckie", clientId: "cl-f", lat: 52.193, lng: 20.616, managerName: "Marta Kowalska", clockMethods: ["gps_photo", "qr"], accessControl: { kind: "sftp", intervalMin: 30 } },
  { id: "s-gdansk", name: "Gdańsk · Magazyn portowy", city: "Gdańsk", address: "ul. Kontenerowa 1, 80-601 Gdańsk", country: "PL", region: "Pomorskie", clientId: "cl-g", lat: 54.385, lng: 18.668, managerName: "Anna Lis", clockMethods: ["kiosk", "access_card"], accessControl: { kind: "api_online" } },
  { id: "s-pruszcz", name: "Pruszcz Gd. · Sortownia", city: "Pruszcz Gdański", address: "ul. Rotmanka 3, 83-000 Pruszcz Gdański", country: "PL", region: "Pomorskie", clientId: "cl-g", lat: 54.272, lng: 18.611, managerName: "Anna Lis", clockMethods: ["gps_photo", "qr"], accessControl: { kind: "none" } },
  { id: "s-grodzisk", name: "Grodzisk Maz. · Pharma", city: "Grodzisk Mazowiecki", address: "ul. Traugutta 42, 05-825 Grodzisk Mazowiecki", country: "PL", region: "Mazowieckie", clientId: "cl-h", lat: 52.109, lng: 20.627, managerName: "Marta Kowalska", clockMethods: ["kiosk", "face"], accessControl: { kind: "api_online" } },
  { id: "s-dresden", name: "Dresden · Lager", city: "Dresden", address: "Radeburger Str. 1, 01129 Dresden", country: "DE", region: "Sachsen", clientId: "cl-i", lat: 51.116, lng: 13.744, managerName: "Iryna Szewczuk", clockMethods: ["access_card", "gps_photo"], accessControl: { kind: "api_online" } },
  { id: "s-halle", name: "Halle · Logistikzentrum", city: "Halle", address: "Am Saaleufer 10, 06132 Halle", country: "DE", region: "Sachsen-Anhalt", clientId: "cl-i", lat: 51.441, lng: 11.993, managerName: "Iryna Szewczuk", clockMethods: ["gps_photo", "kiosk"], accessControl: { kind: "none" } },
  { id: "s-erfurt", name: "Erfurt · Kommissionierung", city: "Erfurt", address: "Am Urbicher Kreuz 5, 99099 Erfurt", country: "DE", region: "Thüringen", clientId: "cl-b", lat: 50.958, lng: 11.072, managerName: "Iryna Szewczuk", clockMethods: ["access_card"], accessControl: { kind: "sftp", intervalMin: 15 } },
  { id: "s-berlin", name: "Berlin · Paketzentrum", city: "Berlin", address: "Lahnstraße 30, 12055 Berlin", country: "DE", region: "Berlin", clientId: "cl-i", lat: 52.47, lng: 13.443, managerName: "Iryna Szewczuk", clockMethods: ["gps_photo", "qr"], accessControl: { kind: "none" } },
  { id: "s-rawa", name: "Rawa Maz. · Magazyn", city: "Rawa Mazowiecka", address: "ul. Tatar 1, 96-200 Rawa Mazowiecka", country: "PL", region: "Łódzkie", clientId: "cl-f", lat: 51.765, lng: 20.25, managerName: "Marta Kowalska", clockMethods: ["gps_photo", "kiosk"], accessControl: { kind: "none" } },
  { id: "s-torun", name: "Toruń · Produkcja", city: "Toruń", address: "ul. Grudziądzka 159, 87-100 Toruń", country: "PL", region: "Kujawsko-Pomorskie", clientId: "cl-g", lat: 53.034, lng: 18.613, managerName: "Anna Lis", clockMethods: ["qr", "kiosk"], accessControl: { kind: "none" } },
];

export const sites: Site[] = siteSeeds.map((s) => ({
  lateThresholdMin: 5,
  clockWindowMin: 30,
  outsideGeofence: "allow_flagged",
  ...s,
  timeZone: s.country === "DE" ? "Europe/Berlin" : "Europe/Warsaw",
}));

const baseKpi = { staffingPct: 95, latePct: 2, replacedInSlaPct: 90, disputedPct: 1 };
const baseSla = { responseHours: 24, replacementHours: 2, minLeadHours: 48 };

export const contracts: Contract[] = [
  {
    id: "k-2026-014", number: "K-2026-014", clientId: "cl-a", legalEntityId: "le-1", currency: "PLN", status: "active", version: 2, versionFrom: "2026-06-01",
    validFrom: "2026-01-01", validTo: "2026-12-31", timesheetPeriod: "week", autoAcceptHours: 72, paymentDays: 30, showRatesInPortal: true,
    rates: [
      { positionId: "p-picker", previous: "46.00", current: "48.00" },
      { positionId: "p-forklift", previous: "54.00", current: "56.00" },
      { positionId: "p-qc", previous: "50.00", current: "52.00" },
      { positionId: "p-packer", previous: "44.00", current: "46.00" },
      { positionId: "p-sorter", previous: null, current: "45.00" },
    ],
    sla: baseSla, kpiTargets: baseKpi,
  },
  {
    id: "k-2026-022", number: "K-2026-022", clientId: "cl-b", legalEntityId: "le-1", currency: "EUR", status: "active", version: 1, versionFrom: "2026-03-01",
    validFrom: "2026-03-01", validTo: "2027-02-28", timesheetPeriod: "week", autoAcceptHours: 72, paymentDays: 30, showRatesInPortal: false,
    rates: [
      { positionId: "p-line", previous: null, current: "24.00" },
      { positionId: "p-qc", previous: null, current: "26.00" },
      { positionId: "p-forklift", previous: null, current: "27.00" },
    ],
    sla: { ...baseSla, replacementHours: 4 }, kpiTargets: baseKpi,
  },
  {
    id: "k-2025-031", number: "K-2025-031", clientId: "cl-c", legalEntityId: "le-1", currency: "PLN", status: "active", version: 3, versionFrom: "2026-09-01",
    validFrom: "2026-01-01", validTo: "2026-12-31", timesheetPeriod: "two_weeks", autoAcceptHours: 72, paymentDays: 30, showRatesInPortal: true,
    rates: [
      { positionId: "p-picker", previous: "46.00", current: "48.00" },
      { positionId: "p-forklift", previous: "54.00", current: "56.00" },
      { positionId: "p-qc", previous: "50.00", current: "52.00" },
      { positionId: "p-packer", previous: "44.00", current: "46.00" },
    ],
    sla: baseSla, kpiTargets: baseKpi,
  },
  {
    id: "k-2026-007", number: "K-2026-007", clientId: "cl-d", legalEntityId: "le-2", currency: "PLN", status: "active", version: 1, versionFrom: "2026-01-01",
    validFrom: "2026-01-01", validTo: "2026-12-31", timesheetPeriod: "month", autoAcceptHours: 72, paymentDays: 21, showRatesInPortal: true,
    rates: [
      { positionId: "p-line", previous: null, current: "47.00" },
      { positionId: "p-packer", previous: null, current: "45.00" },
      { positionId: "p-qc", previous: null, current: "51.00" },
    ],
    sla: baseSla, kpiTargets: baseKpi,
  },
  {
    id: "k-2026-019", number: "K-2026-019", clientId: "cl-e", legalEntityId: "le-2", currency: "PLN", status: "active", version: 1, versionFrom: "2026-02-01",
    validFrom: "2026-02-01", validTo: "2027-01-31", timesheetPeriod: "week", autoAcceptHours: 48, paymentDays: 30, showRatesInPortal: false,
    rates: [
      { positionId: "p-picker", previous: null, current: "50.00" },
      { positionId: "p-forklift", previous: null, current: "58.00" },
      { positionId: "p-storekeeper", previous: null, current: "52.00" },
    ],
    sla: baseSla, kpiTargets: baseKpi,
  },
  {
    id: "k-2026-025", number: "K-2026-025", clientId: "cl-f", legalEntityId: "le-1", currency: "PLN", status: "active", version: 1, versionFrom: "2026-04-01",
    validFrom: "2026-04-01", validTo: "2026-11-30", timesheetPeriod: "week", autoAcceptHours: 72, paymentDays: 30, showRatesInPortal: true,
    rates: [
      { positionId: "p-picker", previous: null, current: "47.00" },
      { positionId: "p-packer", previous: null, current: "45.00" },
      { positionId: "p-forklift", previous: null, current: "55.00" },
    ],
    sla: baseSla, kpiTargets: baseKpi,
  },
  {
    id: "k-2026-028", number: "K-2026-028", clientId: "cl-g", legalEntityId: "le-2", currency: "PLN", status: "active", version: 1, versionFrom: "2026-05-01",
    validFrom: "2026-05-01", validTo: "2027-04-30", timesheetPeriod: "two_weeks", autoAcceptHours: 72, paymentDays: 30, showRatesInPortal: true,
    rates: [
      { positionId: "p-sorter", previous: null, current: "44.00" },
      { positionId: "p-forklift", previous: null, current: "55.00" },
      { positionId: "p-line", previous: null, current: "46.00" },
    ],
    sla: baseSla, kpiTargets: baseKpi,
  },
  {
    id: "k-2026-031", number: "K-2026-031", clientId: "cl-h", legalEntityId: "le-1", currency: "PLN", status: "active", version: 1, versionFrom: "2026-06-01",
    validFrom: "2026-06-01", validTo: "2027-05-31", timesheetPeriod: "month", autoAcceptHours: 72, paymentDays: 30, showRatesInPortal: false,
    rates: [
      { positionId: "p-picker", previous: null, current: "52.00" },
      { positionId: "p-qc", previous: null, current: "56.00" },
    ],
    sla: baseSla, kpiTargets: { ...baseKpi, staffingPct: 98 },
  },
  {
    id: "k-2026-033", number: "K-2026-033", clientId: "cl-i", legalEntityId: "le-1", currency: "EUR", status: "expiring", version: 1, versionFrom: "2026-02-01",
    validFrom: "2026-02-01", validTo: "2026-11-15", timesheetPeriod: "week", autoAcceptHours: 72, paymentDays: 30, showRatesInPortal: false,
    rates: [
      { positionId: "p-picker", previous: null, current: "23.50" },
      { positionId: "p-sorter", previous: null, current: "22.50" },
      { positionId: "p-forklift", previous: null, current: "26.00" },
    ],
    sla: baseSla, kpiTargets: baseKpi,
  },
];

export function contractForClient(clientId: string): Contract {
  const c = contracts.find((k) => k.clientId === clientId);
  if (!c) throw new Error(`No contract for client ${clientId}`);
  return c;
}

/** Shift lines per site: [positionId, start, end, base headcount on weekdays]. */
export type TemplateSeed = [positionId: string, start: string, end: string, weekday: number, saturday: number];

export const templateSeeds: Record<string, TemplateSeed[]> = {
  "s-strykow": [
    ["p-picker", "06:00", "14:00", 14, 10],
    ["p-picker", "14:00", "22:00", 12, 0],
    ["p-forklift", "06:00", "14:00", 6, 3],
    ["p-forklift", "14:00", "22:00", 4, 0],
    ["p-qc", "06:00", "14:00", 3, 1],
    ["p-packer", "22:00", "06:00", 8, 0],
  ],
  "s-lodz": [["p-sorter", "07:00", "15:00", 30, 12], ["p-forklift", "07:00", "15:00", 4, 2], ["p-packer", "07:00", "15:00", 4, 0]],
  "s-poznan": [["p-picker", "06:00", "14:00", 36, 16], ["p-forklift", "06:00", "14:00", 10, 4], ["p-qc", "06:00", "14:00", 4, 2], ["p-packer", "06:00", "14:00", 10, 4], ["p-picker", "14:00", "22:00", 22, 0]],
  "s-leipzig": [["p-line", "06:00", "14:00", 18, 0], ["p-qc", "06:00", "14:00", 4, 0], ["p-forklift", "06:00", "14:00", 3, 0], ["p-line", "14:00", "22:00", 16, 0]],
  "s-wroclaw": [["p-line", "06:00", "18:00", 32, 14], ["p-packer", "06:00", "18:00", 10, 4], ["p-qc", "06:00", "18:00", 4, 2]],
  "s-gliwice": [["p-picker", "06:00", "14:00", 10, 4], ["p-forklift", "06:00", "14:00", 5, 2], ["p-storekeeper", "06:00", "14:00", 3, 1]],
  "s-piotrkow": [["p-picker", "06:00", "14:00", 12, 6], ["p-sorter", "06:00", "14:00", 6, 0]],
  "s-gadki": [["p-picker", "06:00", "14:00", 14, 6], ["p-forklift", "06:00", "14:00", 4, 2]],
  "s-sosnowiec": [["p-picker", "06:00", "14:00", 10, 4], ["p-storekeeper", "06:00", "14:00", 3, 0]],
  "s-katowice": [["p-picker", "06:00", "14:00", 8, 0], ["p-forklift", "06:00", "14:00", 4, 0]],
  "s-bielany": [["p-packer", "07:00", "15:00", 12, 6], ["p-line", "07:00", "15:00", 8, 0]],
  "s-legnica": [["p-line", "06:00", "14:00", 14, 0], ["p-qc", "06:00", "14:00", 3, 0]],
  "s-teresin": [["p-picker", "06:00", "14:00", 12, 6], ["p-packer", "06:00", "14:00", 6, 2]],
  "s-blonie": [["p-picker", "07:00", "15:00", 16, 8], ["p-forklift", "07:00", "15:00", 4, 2]],
  "s-gdansk": [["p-sorter", "06:00", "14:00", 14, 6], ["p-forklift", "06:00", "14:00", 6, 2]],
  "s-pruszcz": [["p-sorter", "06:00", "14:00", 10, 4]],
  "s-grodzisk": [["p-picker", "06:00", "14:00", 10, 0], ["p-qc", "06:00", "14:00", 4, 0]],
  "s-dresden": [["p-picker", "06:00", "14:00", 10, 4], ["p-forklift", "06:00", "14:00", 3, 1]],
  "s-halle": [["p-sorter", "06:00", "14:00", 12, 6], ["p-picker", "06:00", "14:00", 6, 0]],
  "s-erfurt": [["p-line", "06:00", "14:00", 10, 0], ["p-qc", "06:00", "14:00", 2, 0]],
  "s-berlin": [["p-sorter", "06:00", "14:00", 14, 8], ["p-forklift", "06:00", "14:00", 3, 1]],
  "s-rawa": [["p-picker", "06:00", "14:00", 8, 4], ["p-packer", "06:00", "14:00", 4, 0]],
  "s-torun": [["p-line", "06:00", "14:00", 12, 0], ["p-packer", "06:00", "14:00", 4, 0]],
};

/** Team leader on the current shift, by site (shown on the dashboard). */
export const teamLeaders: Record<string, string> = {
  "s-strykow": "Oleh Tkachenko", "s-leipzig": "Iryna Dziuba", "s-poznan": "Pavlo Nowicki", "s-lodz": "Anna Wójcik",
  "s-wroclaw": "Serhii Kovalenko", "s-gliwice": "Marek Zieliński", "s-piotrkow": "Olena Bondar", "s-gadki": "Jakub Mazur",
  "s-sosnowiec": "Andrii Melnyk", "s-katowice": "Tomasz Kaczmarek", "s-bielany": "Natalia Savchuk", "s-legnica": "Vasyl Ivanov",
  "s-teresin": "Katarzyna Lewandowska", "s-blonie": "Bohdan Kravets", "s-gdansk": "Piotr Wiśniewski", "s-pruszcz": "Halyna Moroz",
  "s-grodzisk": "Ewa Dąbrowska", "s-dresden": "Mykola Shevchuk", "s-halle": "Yulia Polishchuk", "s-erfurt": "Roman Hrytsenko",
  "s-berlin": "Taras Lytvyn", "s-rawa": "Joanna Kamińska", "s-torun": "Oksana Rudenko",
};

/** Client users of the portal (spec 12). Jan Nowak is «Клиент А · менеджер» on the mock-ups. */
export interface DemoClientUser {
  id: string;
  fullName: string;
  email: string;
  clientId: string;
  role: ClientRole;
  locale: Locale;
}

export const clientUsers: DemoClientUser[] = [
  { id: "u-jan", fullName: "Jan Nowak", email: "jan.nowak@nordlog.pl", clientId: "cl-a", role: "CLIENT_MANAGER", locale: "ru" },
  { id: "u-tomasz-l", fullName: "Tomasz Lewandowski", email: "tomasz.lewandowski@nordlog.pl", clientId: "cl-a", role: "CLIENT_ADMIN", locale: "pl" },
  { id: "u-katarzyna", fullName: "Katarzyna Wójcik", email: "katarzyna.wojcik@polmarket.pl", clientId: "cl-c", role: "CLIENT_ADMIN", locale: "pl" },
];
