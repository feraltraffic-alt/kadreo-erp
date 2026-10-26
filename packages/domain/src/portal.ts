import type { Client, Currency, Id, IsoDate, IsoDateTime, Locale, Permission, Position, Reason, StaffRequest, StaffRequestCell, Tenant, TimesheetClientStage, Competence } from "./types";

/**
 * Client portal contract (spec 12). A client user sees only their own client's sites, requests and
 * billable hours; never payroll data, other clients or workers' personal data beyond name and
 * position. Every method maps to an /api/v1/portal endpoint (path in the comment).
 */

export type ClientRole = "CLIENT_ADMIN" | "CLIENT_MANAGER" | "CLIENT_VIEWER";

export interface PortalUser {
  id: Id;
  fullName: string;
  initials: string;
  email: string;
  locale: Locale;
  role: ClientRole;
  permissions: Permission[];
  client: Pick<Client, "id" | "name" | "shortName">;
}

export interface PortalSite {
  id: Id;
  name: string;
  city: string;
  address: string;
  contractNumber: string;
  contractTo: IsoDate;
  currency: Currency;
}

/** What can be ordered on one site under its contract (12.1-02…08, 13, 15). */
export interface PortalSiteOptions {
  site: PortalSite;
  /** Positions with a rate in the contract; `rate` is null when rates are hidden from the portal. */
  positions: { id: Id; rate: string | null }[];
  templates: { id: Id; positionId: Id; start: string; end: string; hours: number }[];
  /** Requirements the client can ask for (12.1-07). */
  competenceIds: Id[];
  contacts: { id: Id; name: string }[];
  /** Earliest start date allowed by the contract's minimum lead time (12.1-04). */
  earliestStart: IsoDate;
  slaResponseHours: number;
  showRates: boolean;
}

export interface StaffRequestInput {
  siteId: Id;
  positionId: Id;
  headcount: number;
  from: IsoDate;
  to: IsoDate;
  templateIds: Id[];
  competenceIds: Id[];
  experiencedOnly: boolean;
  contactName: string;
  clientRef?: string;
  comment?: string;
  /** true = «Сохранить черновик» (no checks, no SLA); false = «Отправить заявку». */
  draft: boolean;
}

/** «Итог заявки» (12.1-11…15). */
export interface StaffRequestEstimate {
  days: number;
  personShifts: number;
  plannedHours: number;
  rate: string | null;
  amount: string | null;
  currency: Currency;
  slaResponseHours: number;
}

export interface PortalRequestDetail {
  request: StaffRequest;
  site: PortalSite;
  templates: { id: Id; positionId: Id; start: string; end: string }[];
  cells: StaffRequestCell[];
}

export interface PortalTimesheetListItem {
  id: Id;
  siteId: Id;
  siteName: string;
  from: IsoDate;
  to: IsoDate;
  stage: TimesheetClientStage;
  billableHours: number;
  workers: number;
  sentAt?: IsoDateTime;
}

export interface PortalDayDispute {
  id: Id;
  status: "open" | "agreed" | "rejected";
  reasonId: Id;
  clientHours?: number;
  comment: string;
  /** The contractor's answer, once decided. */
  answer?: string;
}

/** One day as the client sees it: billable hours only (12.2, 9.2-20). */
export interface PortalTimesheetDay {
  date: IsoDate;
  hasShift: boolean;
  hours: number;
  nightHours: number;
  shiftLabel?: string;
  /** «*»: the contractor's manager corrected the hours; reason and comment on click (12.2-07). */
  correction?: { reasonId: Id; comment: string; before: number; after: number };
  dispute?: PortalDayDispute;
  confirmed: boolean;
}

export interface PortalTimesheetRow {
  id: Id;
  worker: { firstName: string; lastName: string };
  positionId: Id;
  days: PortalTimesheetDay[];
  total: number;
}

export interface PortalTimesheet {
  id: Id;
  site: { id: Id; name: string };
  from: IsoDate;
  to: IsoDate;
  stage: TimesheetClientStage;
  sentAt?: IsoDateTime;
  sentByName?: string;
  totals: { hours: number; workers: number; nightHours: number };
  rows: PortalTimesheetRow[];
}

export interface PortalDisputeInput {
  items: { rowId: Id; date: IsoDate }[];
  reasonId: Id;
  clientHours?: number;
  comment: string;
}

export interface PortalOverview {
  onShiftNow: number;
  plannedNow: number;
  sites: { siteId: Id; siteName: string; shiftLabel: string; actual: number; planned: number; status: "ok" | "deviation" | "critical" }[];
  requestsNew: number;
  requestsInProgress: number;
  timesheetsToConfirm: number;
  nearestDeadline?: IsoDateTime;
  /** Last closed week, against the contract targets (10.3 KPI). */
  kpi: { from: IsoDate; to: IsoDate; staffingPct: number; staffingTarget: number; disputedPct: number; disputedTarget: number };
}

export interface PortalDictionaries {
  positions: Position[];
  competences: Competence[];
  disputeReasons: Reason[];
  correctionReasons: Reason[];
}

export interface PortalApi {
  me(): Promise<PortalUser>; // GET /api/v1/portal/me
  tenant(): Promise<Tenant>; // GET /api/v1/tenant
  updateLocale(locale: Locale): Promise<void>; // PATCH /api/v1/me
  dictionaries(): Promise<PortalDictionaries>; // GET /api/v1/portal/dictionaries
  overview(): Promise<PortalOverview>; // GET /api/v1/portal/overview
  sites(): Promise<PortalSite[]>; // GET /api/v1/portal/sites
  siteOptions(siteId: Id): Promise<PortalSiteOptions>; // GET /api/v1/portal/sites/{id}/positions
  estimate(input: StaffRequestInput): Promise<StaffRequestEstimate>; // POST /api/v1/portal/staff-requests/estimate
  createRequest(input: StaffRequestInput): Promise<StaffRequest>; // POST /api/v1/portal/staff-requests
  updateRequest(id: Id, input: StaffRequestInput): Promise<StaffRequest>; // PUT /api/v1/portal/staff-requests/{id} (drafts)
  requests(): Promise<StaffRequest[]>; // GET /api/v1/portal/staff-requests
  request(id: Id): Promise<PortalRequestDetail>; // GET /api/v1/portal/staff-requests/{id}
  timesheets(): Promise<PortalTimesheetListItem[]>; // GET /api/v1/portal/timesheets
  timesheet(id: Id): Promise<PortalTimesheet>; // GET /api/v1/portal/timesheets/{id}
  dispute(id: Id, input: PortalDisputeInput): Promise<PortalTimesheet>; // POST /api/v1/portal/timesheets/{id}/disputes
  confirm(id: Id): Promise<PortalTimesheet>; // POST /api/v1/portal/timesheets/{id}/confirm
}
