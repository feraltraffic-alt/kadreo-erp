/**
 * Domain types shared by the web apps and (later) generated from the OpenAPI contract.
 * Field names follow section 4 of the specification. All ids are UUID v7 strings on the
 * server; the demo data uses readable ids so screens and tests stay easy to follow.
 */

export type Id = string;
export type IsoDate = string; // YYYY-MM-DD in the site's time zone
export type IsoDateTime = string; // ISO 8601 with offset, stored in UTC on the server
export type Locale = "pl" | "uk" | "ru" | "en";
export type Currency = "PLN" | "EUR";
export type CountryCode = "PL" | "DE" | "CZ" | "NL";

/** Text kept in every interface language (dictionaries, campaign names, document types). */
export type LocalizedText = Record<Locale, string>;

export interface Money {
  amount: string; // decimal string, never float (spec 4.1)
  currency: Currency;
}

export type StatusTone = "ok" | "warn" | "critical" | "neutral";

/* ----------------------------------------------------------------------------- tenant */

export interface TenantBranding {
  productName: string;
  productTagline: LocalizedText;
  logoLetter: string;
}

export interface Tenant {
  id: Id;
  name: string;
  defaultLocale: Locale;
  branding: TenantBranding;
  settings: {
    payrollVisibleToSiteManagers: boolean;
    dpiaCompleted: boolean;
    targetMarginPct: number;
    noShowThresholdMin: number;
  };
}

export interface LegalEntity {
  id: Id;
  name: string;
  nip: string;
  country: CountryCode;
}

/* ------------------------------------------------------------------- users and access */

export type RoleCode =
  | "TENANT_ADMIN"
  | "EXECUTIVE"
  | "OPS_MANAGER"
  | "SITE_MANAGER"
  | "TEAM_LEADER"
  | "WORKER"
  | "HR"
  | "PAYROLL"
  | "FINANCE"
  | "ANALYST"
  | "AUDITOR"
  | "CLIENT_ADMIN"
  | "CLIENT_MANAGER"
  | "CLIENT_VIEWER"
  | "KIOSK";

/** Granular permission `module.entity.action` (spec 3.3). */
export type Permission = string;

export interface CurrentUser {
  id: Id;
  fullName: string;
  initials: string;
  email: string;
  locale: Locale;
  roles: RoleCode[];
  activeRole: RoleCode;
  permissions: Permission[];
  /** Data scope: regions for OPS_MANAGER, sites for SITE_MANAGER. Empty = whole tenant. */
  scope: { regions: string[]; siteIds: Id[] };
}

/* ----------------------------------------------------------- clients, sites, contracts */

export interface Client {
  id: Id;
  name: string;
  shortName: string;
  nip: string;
  country: CountryCode;
  managerUserId: Id;
}

export type ClockMethod = "gps_photo" | "qr" | "kiosk" | "face" | "access_card";

export type AccessControlStatus =
  | { kind: "api_online" }
  | { kind: "sftp"; intervalMin: number }
  | { kind: "kiosk_reader" }
  | { kind: "error"; sinceMin: number }
  | { kind: "none" };

export interface Site {
  id: Id;
  name: string;
  city: string;
  address: string;
  country: CountryCode;
  region: string;
  timeZone: string;
  clientId: Id;
  lat: number;
  lng: number;
  managerName: string;
  clockMethods: ClockMethod[];
  accessControl: AccessControlStatus;
  lateThresholdMin: number;
  clockWindowMin: number;
  outsideGeofence: "allow_flagged" | "deny";
}

export interface Position {
  id: Id;
  name: LocalizedText;
  competenceIds: Id[];
}

export interface Competence {
  id: Id;
  name: LocalizedText;
  requiresDocument: boolean;
}

export interface ShiftTemplate {
  id: Id;
  projectId: Id;
  positionId: Id;
  start: string; // HH:mm in site time
  end: string; // HH:mm, may be earlier than start (crosses midnight)
  unpaidBreakMin: number;
  sortOrder: number;
}

export interface RateCard {
  positionId: Id;
  previous: string | null;
  current: string;
}

export interface Contract {
  id: Id;
  number: string;
  clientId: Id;
  legalEntityId: Id;
  currency: Currency;
  status: "draft" | "active" | "expiring" | "ended";
  version: number;
  versionFrom: IsoDate;
  validFrom: IsoDate;
  validTo: IsoDate;
  timesheetPeriod: "week" | "two_weeks" | "month";
  autoAcceptHours: number;
  paymentDays: number;
  showRatesInPortal: boolean;
  rates: RateCard[];
  sla: { responseHours: number; replacementHours: number; minLeadHours: number };
  kpiTargets: { staffingPct: number; latePct: number; replacedInSlaPct: number; disputedPct: number };
}

export interface Project {
  id: Id;
  siteId: Id;
  contractId: Id;
  name: string;
  managerName: string;
  positionIds: Id[];
}

/* -------------------------------------------------------------------- workers and HR */

export type ContractKind = "uop" | "zlecenie" | "b2b";

export type WorkerStatus = "active" | "free" | "vacation" | "sick" | "blocked" | "dismissed";

export interface WorkerDocument {
  id: Id;
  workerId: Id;
  type: "work_permit" | "medical" | "bhp" | "a1" | "udt" | "residence_card";
  validTo: IsoDate;
}

export interface Worker {
  id: Id;
  number: string; // W-00012
  firstName: string;
  lastName: string;
  phone: string;
  citizenship: CountryCode | "UA" | "BY" | "GE" | "MD";
  language: Locale;
  contractKind: ContractKind;
  positionIds: Id[];
  competenceIds: Id[];
  homeLat: number;
  homeLng: number;
  prefersMorning: boolean;
  weeklyHourLimit: number;
  status: WorkerStatus;
  statusUntil?: IsoDate;
  badgeCount: number;
  rating: number;
  /** Shifts already worked per site, used by the candidate score. */
  shiftsBySite: Record<Id, number>;
}

/* ----------------------------------------------------------- shifts and assignments */

export type AssignmentStatus = "proposed" | "confirmed" | "declined" | "cancelled";

export interface Assignment {
  id: Id;
  workerId: Id;
  templateId: Id;
  date: IsoDate;
  status: AssignmentStatus;
  source: "manual" | "ai";
  /** Set on an assignment made to replace a no-show; the replaced one no longer counts as filled. */
  replacesId?: Id;
}

/** Planned headcount for one template on one date. Missing = no shift that day. */
export interface ShiftPlan {
  templateId: Id;
  date: IsoDate;
  planned: number;
  cancelled?: boolean;
}

export type SchedulePublishState = "draft" | "published" | "changed_after_publish";

/* ----------------------------------------------------------------- time and timesheets */

export type ClockSource = ClockMethod | "manual";

export interface ClockEvent {
  id: Id;
  workerId: Id;
  date: IsoDate;
  type: "in" | "break_start" | "break_end" | "out";
  time: string; // HH:mm site time
  source: ClockSource;
  detail: string; // "GPS 18 m · фото · лицо ✓", "турникет 2"
  offline?: boolean;
}

/** One clock-in/out/break with the proof that came with it (9.2-18). */
export interface ClockEvidence {
  type: "in" | "break" | "out";
  time: string;
  endTime?: string; // for breaks
  source: ClockSource;
  gpsAccuracyM?: number;
  photo?: boolean;
  faceMatch?: boolean;
  gate?: number;
  kiosk?: number;
  qrPoint?: number;
  outsideGeofenceM?: number;
}

export type TimesheetIssueKind =
  | "missing_clock"
  | "late_or_early"
  | "unapproved_overtime"
  | "outside_geofence"
  | "no_show"
  | "anomaly";

export interface TimesheetCorrection {
  id: Id;
  at: IsoDateTime;
  byName: string;
  payableBefore: number;
  payableAfter: number;
  billableBefore: number;
  billableAfter: number;
  reasonId: Id;
  comment: string;
}

export interface TimesheetDay {
  date: IsoDate;
  hasShift: boolean;
  plannedHours: number;
  payableHours: number;
  billableHours: number;
  shiftLabel?: string; // 06:00–14:00
  issue?: { kind: TimesheetIssueKind; minutes?: number };
  corrections: TimesheetCorrection[];
  /** An open client dispute on this day. */
  disputed?: boolean;
  /** Disputes on this day, oldest first; at most one is open. */
  disputes?: TimesheetDispute[];
}

export type TimesheetRowStatus = "ready" | "issues" | "disputed" | "confirmed";

export interface TimesheetRow {
  id: Id;
  workerId: Id;
  positionId: Id;
  days: TimesheetDay[];
}

export type TimesheetClientStage =
  | { kind: "not_sent" }
  | { kind: "waiting"; until: IsoDateTime }
  | { kind: "confirmed" }
  | { kind: "disputed"; rows: number }
  | { kind: "auto_accepted" };

export interface Timesheet {
  id: Id;
  projectId: Id;
  from: IsoDate;
  to: IsoDate;
  teamLeaderDaysConfirmed: number;
  managerConfirmed: boolean;
  clientStage: TimesheetClientStage;
  rows: TimesheetRow[];
}

export interface Reason {
  id: Id;
  /** Stable code within the tenant ("ot-unapproved"), for logic that must not depend on ids. */
  code: string;
  name: LocalizedText;
}

/* ------------------------------------------------------------------ alerts and requests */

export type AlertSeverity = "critical" | "warning" | "info";
export type AlertKind = "understaffed" | "no_show" | "sla" | "kpi" | "document" | "access_control" | "anomaly";

export interface Alert {
  id: Id;
  kind: AlertKind;
  severity: AlertSeverity;
  siteId: Id;
  title: LocalizedText;
  context: LocalizedText;
  createdAt: IsoDateTime;
  escalationLevel: number;
  nextEscalationAt?: IsoDateTime;
  slaDueAt?: IsoDateTime;
  takenByName?: string;
  takenAt?: IsoDateTime;
  count: number;
  status: "open" | "taken" | "closed";
  /** Where "Подобрать замену" leads: project + template + date of the short shift. */
  shiftRef?: { projectId: Id; templateId: Id; date: IsoDate };
}

export type StaffRequestStatus = "draft" | "new" | "in_progress" | "staffed" | "done" | "cancelled";

/**
 * Client request for staff (12.1). «В работе», «Укомплектована» and «Выполнена» follow from the
 * request's shift cells: an accepted request adds `headcount` places to each of them, and new
 * assignments in those cells count towards it until it has `headcount` people (X of N = the
 * least staffed day).
 */
export interface StaffRequest {
  id: Id;
  number: number;
  siteId: Id;
  positionId: Id;
  headcount: number;
  assigned: number;
  from: IsoDate;
  to: IsoDate;
  status: StaffRequestStatus;
  /** Deadline for accepting the request (contract SLA, 12.1-15). */
  slaDueAt: IsoDateTime;
  templateIds: Id[];
  /** Requirements chosen by the client (12.1-07). */
  competenceIds: Id[];
  experiencedOnly: boolean;
  clientRef?: string;
  comment?: string;
  contactName: string;
  createdAt: IsoDateTime;
  createdByName: string;
  acceptedAt?: IsoDateTime;
  acceptedByName?: string;
  cancelledAt?: IsoDateTime;
  cancelledByName?: string;
  cancelReason?: string;
}

export interface StaffRequestCell {
  templateId: Id;
  date: IsoDate;
  needed: number;
  assigned: number;
}

export interface StaffRequestDetail {
  request: StaffRequest;
  site: Site;
  client: Client;
  projectId: Id;
  templates: Pick<ShiftTemplate, "id" | "positionId" | "start" | "end">[];
  /** Empty until the request is accepted. */
  cells: StaffRequestCell[];
  slaResponseHours: number;
}

/** A client's objection to one timesheet day (12.2) and the manager's decision on it. */
export interface TimesheetDispute {
  id: Id;
  reasonId: Id;
  /** Hours by the client's records, if given (12.2-11). */
  clientHours?: number;
  comment: string;
  createdAt: IsoDateTime;
  createdByName: string;
  status: "open" | "agreed" | "rejected";
  resolution?: {
    comment: string;
    byName: string;
    at: IsoDateTime;
    payableHours?: number;
    billableHours?: number;
  };
}

/* -------------------------------------------------------------------------- live view */

export type SiteLiveStatus = "ok" | "deviation" | "critical";

export interface SiteLive {
  siteId: Id;
  /** Project of the site, for drill-down into its schedule. */
  projectId: Id;
  siteName: string;
  clientName: string;
  shiftLabel: string;
  actual: number;
  planned: number;
  late: number;
  noShows: number;
  noShowsReplaced: number;
  teamLeaderName: string;
  status: SiteLiveStatus;
  lat: number;
  lng: number;
  region: string;
  country: CountryCode;
}

export interface DashboardSummary {
  onShiftNow: number;
  plannedNow: number;
  lateToday: number;
  lateSameDayLastWeek: number;
  noShows: number;
  noShowsReplaced: number;
  openAlerts: number;
  criticalAlerts: number;
  staffRequestsOpen: number;
  nearestSlaDueAt?: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface NotificationItem {
  id: Id;
  kind: "alert" | "approval" | "mention";
  title: LocalizedText;
  at: IsoDateTime;
  read: boolean;
  href?: string;
}
