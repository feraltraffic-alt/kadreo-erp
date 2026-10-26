import type { CandidateScore, ConstraintViolation } from "./scoring";
import type {
  Alert,
  Assignment,
  ClockEvidence,
  Client,
  Competence,
  Contract,
  CurrentUser,
  DashboardSummary,
  IsoDate,
  NotificationItem,
  Position,
  Project,
  Reason,
  SchedulePublishState,
  Site,
  SiteLive,
  StaffRequest,
  Tenant,
  Timesheet,
  TimesheetCorrection,
  TimesheetDay,
  Worker,
  WorkerDocument,
} from "./types";

/**
 * The client-side API contract. Each method maps to an endpoint from sections 9–16 of the
 * specification (path in the comment). The demo implements it in memory; production uses the
 * HTTP client generated from the OpenAPI document with the same names and shapes.
 */

export interface DashboardFilter {
  regions?: string[];
  clientIds?: string[];
}

export interface ScheduleCell {
  date: IsoDate;
  planned: number | null; // null = no shift that day
  assigned: number;
  cancelled: boolean;
}

export interface ScheduleRow {
  templateId: string;
  positionId: string;
  start: string;
  end: string;
  cells: ScheduleCell[];
}

export interface ScheduleResponse {
  project: Project;
  site: Site;
  client: Client;
  from: IsoDate;
  to: IsoDate;
  publishState: SchedulePublishState;
  filled: number;
  total: number;
  rows: ScheduleRow[];
}

export interface CellAssignment {
  assignment: Assignment;
  worker: Pick<Worker, "id" | "firstName" | "lastName" | "number">;
}

export interface CandidateView extends CandidateScore {
  firstName: string;
  lastName: string;
  number: string;
}

export interface AutoAssignProposal {
  templateId: string;
  date: IsoDate;
  workerIds: string[];
}

export interface AutoAssignJob {
  id: string;
  status: "running" | "done" | "failed";
  progress: number; // 0..1
  proposals: AutoAssignProposal[];
  unfilled: number;
}

export interface AutoAssignRequest {
  scope: "week" | "days" | "cells";
  dates?: IsoDate[];
  cells?: { templateId: string; date: IsoDate }[];
  mode: "empty_only" | "rebuild_proposed";
}

export interface TimesheetResponse {
  timesheet: Timesheet;
  project: Project;
  site: Site;
  client: Client;
  contract: Contract;
  workers: Record<string, Pick<Worker, "id" | "firstName" | "lastName" | "number">>;
}

export interface TimesheetDayDetail {
  rowId: string;
  worker: Pick<Worker, "id" | "firstName" | "lastName">;
  positionId: string;
  day: TimesheetDay;
  evidence: ClockEvidence[];
}

export interface CorrectionInput {
  rowId: string;
  date: IsoDate;
  payableHours: number;
  billableHours: number;
  reasonId: string;
  comment: string;
}

export interface UrgentRequestInput {
  siteId: string;
  templateId: string;
  date: IsoDate;
  headcount: number;
  comment: string;
}

export interface UrgentRequestResult {
  id: string;
  offeredTo: number;
  accepted: number;
  needed: number;
}

export interface SearchResults {
  workers: { id: string; label: string; sub: string }[];
  sites: { id: string; label: string; sub: string }[];
  clients: { id: string; label: string; sub: string }[];
  contracts: { id: string; label: string; sub: string }[];
}

export interface ProjectListItem {
  project: Project;
  site: Site;
  client: Client;
  filledThisWeek: number;
  totalThisWeek: number;
}

export interface TimesheetListItem {
  id: string;
  projectId: string;
  siteName: string;
  clientName: string;
  from: IsoDate;
  to: IsoDate;
  payableHours: number;
  plannedHours: number;
  issues: number;
  timesheet: Pick<Timesheet, "clientStage" | "managerConfirmed" | "teamLeaderDaysConfirmed">;
}

export type ApiErrorBody =
  | { code: "constraint"; violations: ConstraintViolation[] }
  | { code: "forbidden"; permission: string }
  | { code: "not_found" }
  | { code: "conflict"; byName: string; at: string };

export class ApiError extends Error {
  constructor(public status: number, public body: ApiErrorBody) {
    super(body.code);
  }
}

export interface Api {
  /* core */
  me(): Promise<CurrentUser>; // GET /api/v1/me
  tenant(): Promise<Tenant>; // GET /api/v1/tenant
  dictionaries(): Promise<{ positions: Position[]; competences: Competence[]; correctionReasons: Reason[]; disputeReasons: Reason[] }>;
  search(q: string): Promise<SearchResults>; // GET /api/v1/search?q=
  notifications(): Promise<NotificationItem[]>;
  navCounters(): Promise<{ requestsNew: number; docsAttention: number; docsExpired: number }>;
  markAllNotificationsRead(): Promise<void>;

  /* dashboard 11.1 */
  dashboardSummary(f: DashboardFilter): Promise<DashboardSummary>; // GET /api/v1/dashboard/summary
  dashboardSites(f: DashboardFilter): Promise<SiteLive[]>; // GET /api/v1/dashboard/sites
  dashboardFilterOptions(): Promise<{ regions: string[]; clients: Pick<Client, "id" | "shortName">[] }>;
  alerts(q: { status?: "open"; limit?: number }): Promise<Alert[]>; // GET /api/v1/alerts
  takeAlert(id: string): Promise<Alert>; // POST /api/v1/alerts/{id}/take
  createUrgentRequest(input: UrgentRequestInput): Promise<UrgentRequestResult>; // POST /api/v1/urgent-requests
  urgentRequestStatus(id: string): Promise<UrgentRequestResult>;
  staffRequests(): Promise<StaffRequest[]>;
  sitesWithTemplates(): Promise<{ site: Site; templates: { id: string; positionId: string; start: string; end: string }[] }[]>;

  /* workforce 9.1 */
  projects(weekOf: IsoDate): Promise<ProjectListItem[]>;
  schedule(projectId: string, from: IsoDate, to: IsoDate): Promise<ScheduleResponse>; // GET /api/v1/projects/{id}/schedule
  cellAssignments(templateId: string, date: IsoDate): Promise<CellAssignment[]>;
  candidates(templateId: string, date: IsoDate, filters?: { maxKm?: number; experiencedOnly?: boolean; noOvertime?: boolean }): Promise<CandidateView[]>; // GET /api/v1/shifts/{id}/candidates
  assign(input: { workerId: string; templateId: string; date: IsoDate; source?: "manual" | "ai" }): Promise<Assignment>; // POST /api/v1/assignments
  unassign(assignmentId: string): Promise<void>; // DELETE /api/v1/assignments/{id}
  changePlan(templateId: string, date: IsoDate, planned: number): Promise<void>;
  cancelShift(templateId: string, date: IsoDate): Promise<void>;
  copyToNextWeek(templateId: string, date: IsoDate): Promise<number>;
  startAutoAssign(projectId: string, from: IsoDate, req: AutoAssignRequest): Promise<{ jobId: string }>; // POST …/schedule/auto-assign
  job(jobId: string): Promise<AutoAssignJob>; // GET /api/v1/jobs/{jobId}
  publishSchedule(projectId: string, from: IsoDate): Promise<{ notified: number }>; // POST …/schedule/publish

  /* timesheets 9.2 */
  timesheets(): Promise<TimesheetListItem[]>;
  timesheet(projectId: string, from: IsoDate, to: IsoDate): Promise<TimesheetResponse>; // GET /api/v1/timesheets
  timesheetDay(timesheetId: string, rowId: string, date: IsoDate): Promise<TimesheetDayDetail>; // GET /api/v1/timesheet-entries/{id}
  correct(timesheetId: string, input: CorrectionInput): Promise<TimesheetCorrection>; // POST …/corrections
  sendToClient(timesheetId: string): Promise<Timesheet>; // POST /api/v1/timesheets/{id}/send-to-client

  /* helpers for screens */
  workerDocuments(workerId: string): Promise<WorkerDocument[]>;
}
