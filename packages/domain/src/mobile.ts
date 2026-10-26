import type { CandidateView } from "./api";
import type { Alert, ClockMethod, ClockSource, CurrentUser, Id, IsoDate, IsoDateTime, Locale, LocalizedText, NotificationItem, SiteLive, WorkerDocument } from "./types";

/**
 * Mobile app and kiosk contract (spec 14). One app, tabs by role: WORKER (14.1, 14.5),
 * TEAM_LEADER (14.2), SITE_MANAGER / OPS_MANAGER (14.3) and the KIOSK device account (14.4).
 * Every method maps to an /api/v1 endpoint (path in the comment).
 */

export type ClockType = "in" | "break_start" | "break_end" | "out";
/** Where the worker is in today's shift; drives the main button (14.1-08). */
export type ClockState = "before" | "on_shift" | "on_break" | "finished" | "no_shift";
export type ClockStatus = "accepted" | "flagged" | "pending" | "rejected";

export interface MobileShift {
  /** Assignment id; for kind «offer» the urgent-offer id. */
  id: Id;
  kind: "assignment" | "offer";
  date: IsoDate;
  start: string;
  end: string;
  siteId: Id;
  /** «Stryków · Magazyn B» */
  siteName: string;
  positionId: Id;
  positionName: LocalizedText;
  /** confirmed, proposed (published, waiting for the worker) or an urgent offer. */
  status: "confirmed" | "proposed" | "offer";
  /** Urgent-shift bonus in points (15), offers only. */
  bonusPoints?: number;
}

export interface ClockEventView {
  id: Id;
  type: ClockType;
  /** HH:mm in site time */
  time: string;
  at: IsoDateTime;
  source: ClockSource;
  status: ClockStatus;
  offline: boolean;
  /** Approver of a manual clock-in («ручная, одобрил …»). */
  approvedByName?: string;
}

export interface MobileSiteRules {
  id: Id;
  name: string;
  lat: number;
  lng: number;
  /** Geofence radius around the site point (a polygon replaces it when the site has one). */
  radiusM: number;
  requiredAccuracyM: number;
  outsideGeofence: "allow_flagged" | "deny";
  methods: ClockMethod[];
  /** Clock-in opens this many minutes before the start (site setting). */
  clockWindowMin: number;
  lateThresholdMin: number;
  /** Demo profile only: a valid signed payload of the site's QR point «вход 1». */
  demoQrPayload?: string;
}

export type ClockIssueKind = "no_gps" | "no_camera" | "forgot" | "other" | "late";

export interface ClockIssue {
  id: Id;
  kind: ClockIssueKind;
  type: ClockType;
  /** HH:mm the worker says it happened (for «late»: expected arrival). */
  time: string;
  comment: string;
  status: "open" | "approved" | "rejected";
  createdAt: IsoDateTime;
  decidedByName?: string;
  decisionReason?: string;
}

/** The «Отметка» screen in one call (14.1). */
export interface WorkerToday {
  now: IsoDateTime;
  worker: { id: Id; firstName: string; lastName: string; number: string };
  /** Today's shift, or the night shift that is still running. */
  shift: MobileShift | null;
  site: MobileSiteRules | null;
  state: ClockState;
  events: ClockEventView[];
  /** HH:mm when «Начать смену» becomes active. */
  opensAt: string | null;
  /** Next two shifts after the current one, offers included (14.1-12). */
  upcoming: MobileShift[];
  /** When there is no shift today: the nearest one (14.1-04). */
  nextShift: MobileShift | null;
  unread: number;
  issues: ClockIssue[];
}

export interface ClockInput {
  /** Generated on the device; repeating a request with the same key returns the first result. */
  idempotencyKey: string;
  assignmentId: Id;
  type: ClockType;
  deviceTime: IsoDateTime;
  method: "gps_photo" | "qr";
  lat?: number;
  lng?: number;
  accuracyM?: number;
  photo: boolean;
  /** Required when clocking in outside the geofence on an «allow_flagged» site. */
  comment?: string;
  /** Signed payload of a site QR point (14.1-10). */
  qrPayload?: string;
  /** Recorded without network and sent later (7.6). */
  offline?: boolean;
}

export interface ClockResult {
  event: ClockEventView;
  /** flagged = outside the geofence with a comment; goes to the timesheet issues (9.2). */
  outcome: "accepted" | "flagged";
  lateMin: number;
  distanceM: number | null;
}

export type ClockRejectReason = "outside_geofence" | "too_early" | "no_shift" | "clock_skew" | "bad_qr" | "wrong_state" | "low_accuracy" | "comment_required";

export interface ClockIssueInput {
  assignmentId: Id;
  kind: ClockIssueKind;
  type: ClockType;
  time: string;
  comment: string;
}

export interface WorkerProfile {
  worker: { id: Id; firstName: string; lastName: string; number: string; phone: string };
  locale: Locale;
  biometricConsent: boolean;
  kioskPinSet: boolean;
  /** Last 4 digits only. */
  bankAccountLast4: string | null;
  notificationChannel: "push" | "sms";
}

/* ----------------------------------------------------------------------- team leader */

export interface BrigadeShift {
  /** siteId|date|start — one shift of a site may span several templates (positions). */
  key: string;
  siteId: Id;
  siteName: string;
  date: IsoDate;
  start: string;
  end: string;
}

export type MemberStatus = "on_site" | "on_break" | "finished" | "late" | "no_show" | "manual_pending";

export interface BrigadeMember {
  assignmentId: Id;
  templateId: Id;
  workerId: Id;
  firstName: string;
  lastName: string;
  number: string;
  phone: string;
  positionId: Id;
  positionName: LocalizedText;
  status: MemberStatus;
  clockIn: string | null;
  lateMin: number;
  /** The worker's last open problem report or late message (14.2-05, 14.2-08). */
  issue: { kind: ClockIssueKind; time: string; comment: string } | null;
  /** Clocked in outside the geofence (flagged). */
  outsideGeofence: boolean;
  replacement: { status: "searching" } | { status: "found"; name: string; clockIn: string | null } | null;
  /** A replacement for a no-show (shown with «Замена» badge). */
  isReplacement: boolean;
  needsAttention: boolean;
}

export interface ShiftOutput {
  norm: number;
  /** Unit code: lines, pallets, pieces, parcels. */
  unit: string;
  source: "team_leader" | "client";
  value: number;
  updatedAt: IsoDateTime | null;
  /** norm × elapsed share of the shift (14.2-10). */
  planNow: number;
}

export interface BrigadeView {
  now: IsoDateTime;
  shift: BrigadeShift;
  /** The team leader's shifts today and tomorrow (14.2-02). */
  shifts: BrigadeShift[];
  noShowAfterMin: number;
  counters: { planned: number; onSite: number; late: number; noShow: number };
  members: BrigadeMember[];
  output: ShiftOutput | null;
}

export interface ManualClockInput {
  assignmentId: Id;
  type: ClockType;
  time: string;
  reason: "no_gps" | "no_phone" | "camera" | "other";
  comment: string;
}

/* --------------------------------------------------------------------------- manager */

export interface ProblemSite {
  siteId: Id;
  siteName: string;
  onSite: number;
  planned: number;
  severity: "critical" | "warn";
  noShows: number;
  unreplaced: number;
  late: number;
  /** For «Найти замену»: the shift with the most unreplaced no-shows. */
  templateId: Id | null;
  replacesId: Id | null;
}

export type DecisionKind = "manual_clock" | "clock_issue";

export interface Decision {
  id: Id;
  kind: DecisionKind;
  workerName: string;
  siteName: string;
  requestedByName: string;
  at: IsoDateTime;
  /** HH:mm of the clock event asked for */
  time: string;
  type: ClockType;
  reason: string;
  comment: string;
}

export interface ManagerSummary {
  now: IsoDateTime;
  sitesInScope: number;
  staffing: { onShift: number; planned: number; pct: number; targetPct: number };
  problemSites: ProblemSite[];
  problemSitesTotal: number;
  decisions: Decision[];
  decisionsTotal: number;
  openAlerts: number;
}

export interface OfferInput {
  templateId: Id;
  date: IsoDate;
  workerIds: Id[];
  /** The no-show being replaced. */
  replacesId?: Id;
  bonusPoints?: number;
}

/* ----------------------------------------------------------------------------- kiosk */

export interface KioskDevice {
  id: Id;
  code: string;
  siteId: Id;
  siteName: string;
  entry: string;
  faceEnabled: boolean;
}

export interface KioskRecent {
  /** «Viktor H.» — first name and initial only (7.4). */
  name: string;
  type: ClockType | "unrecognized";
  time: string;
  outcome: "accepted" | "late" | "pending" | "unrecognized";
}

export interface KioskState {
  now: IsoDateTime;
  device: KioskDevice;
  recent: KioskRecent[];
}

export type KioskIdentifyInput = { method: "pin"; number: string; pin: string } | { method: "card"; uid: string } | { method: "qr"; payload: string };

export interface KioskIdentity {
  /** Short-lived ticket for the next kiosk clock call. */
  ticket: string;
  name: string;
  /** Allowed next actions; the kiosk shows a choice when there are several. */
  actions: ClockType[];
  shift: { start: string; end: string } | null;
  state: ClockState;
}

export interface KioskClockResult {
  outcome: "accepted" | "late" | "pending";
  name: string;
  type: ClockType;
  time: string;
  lateMin: number;
  shift: { start: string; end: string } | null;
}

export interface KioskQr {
  payload: string;
  expiresAt: IsoDateTime;
}

/* ------------------------------------------------------------------------------- API */

export interface MobileApi {
  me(): Promise<CurrentUser>; // GET /api/v1/me
  updateLocale(locale: Locale): Promise<void>; // PATCH /api/v1/me
  notifications(): Promise<NotificationItem[]>; // GET /api/v1/notifications
  markAllNotificationsRead(): Promise<void>;

  /* worker 14.1, 14.5 */
  today(): Promise<WorkerToday>; // GET /api/v1/me/today
  myShifts(from: IsoDate, to: IsoDate): Promise<MobileShift[]>; // GET /api/v1/me/shifts?from=&to=
  clock(input: ClockInput): Promise<ClockResult>; // POST /api/v1/clock-events
  reportIssue(input: ClockIssueInput): Promise<ClockIssue>; // POST /api/v1/clock-issues
  respondToShift(shift: Pick<MobileShift, "id" | "kind">, decision: "accept" | "decline", reason?: string): Promise<void>; // POST /api/v1/assignments/{id}/accept|decline, /urgent-offers/{id}/…
  myDocuments(): Promise<WorkerDocument[]>; // GET /api/v1/me/documents
  profile(): Promise<WorkerProfile>; // GET /api/v1/me/profile
  setBiometricConsent(consent: boolean): Promise<WorkerProfile>; // PUT /api/v1/me/biometric-consent
  setKioskPin(pin: string): Promise<WorkerProfile>; // PUT /api/v1/me/kiosk-pin
  kioskQr(): Promise<KioskQr>; // GET /api/v1/me/kiosk-qr

  /* team leader 14.2 */
  brigade(shiftKey?: string): Promise<BrigadeView>; // GET /api/v1/team/brigade?shift=
  requestReplacement(assignmentId: Id): Promise<BrigadeView>; // POST /api/v1/team/assignments/{id}/replacement
  manualClock(input: ManualClockInput): Promise<BrigadeView>; // POST /api/v1/team/manual-clock
  recordOutput(shiftKey: string, value: number): Promise<BrigadeView>; // PUT /api/v1/team/output?shift=
  replyToWorker(workerId: Id, text: string): Promise<void>; // POST /api/v1/team/messages

  /* manager 14.3 */
  managerSummary(): Promise<ManagerSummary>; // GET /api/v1/manager/summary
  alerts(): Promise<Alert[]>; // GET /api/v1/alerts?status=open
  sites(): Promise<SiteLive[]>; // GET /api/v1/dashboard/sites
  siteBrigade(siteId: Id): Promise<BrigadeView>; // GET /api/v1/manager/sites/{id}/brigade
  decisions(): Promise<Decision[]>; // GET /api/v1/manager/decisions
  decide(id: Id, kind: DecisionKind, decision: "approve" | "reject", reason?: string): Promise<void>; // POST /api/v1/manager/decisions/{kind}/{id}
  candidates(templateId: Id, date: IsoDate): Promise<CandidateView[]>; // GET /api/v1/shifts/{id}/candidates
  offerShift(input: OfferInput): Promise<{ offered: number }>; // POST /api/v1/urgent-offers
  urgentShift(input: { siteId: Id; templateId: Id; date: IsoDate; headcount: number; bonusPoints: number; comment: string }): Promise<{ offered: number }>; // POST /api/v1/urgent-requests
  broadcast(input: { siteId: Id; text: string }): Promise<{ recipients: number }>; // POST /api/v1/manager/broadcasts
  siteTemplates(): Promise<{ siteId: Id; siteName: string; templates: { id: Id; positionId: Id; start: string; end: string }[] }[]>; // GET /api/v1/sites-with-templates

  /* kiosk 14.4 */
  kioskState(): Promise<KioskState>; // GET /api/v1/kiosk/state
  kioskIdentify(input: KioskIdentifyInput): Promise<KioskIdentity>; // POST /api/v1/kiosk/identify
  kioskClock(input: { ticket: string; type: ClockType; idempotencyKey: string; deviceTime: IsoDateTime; offline?: boolean }): Promise<KioskClockResult>; // POST /api/v1/kiosk/clock-events
}

/** Demo personas of the mobile app (stand-in for phone + SMS sign-in). */
export const MOBILE_DEMO_USERS = [
  { key: "worker", email: "viktor.hnatiuk@kadreo-demo.app", name: "Viktor Hnatiuk", role: "WORKER" },
  { key: "leader", email: "oleh.tkachenko@kadreo-demo.app", name: "Oleh Tkachenko", role: "TEAM_LEADER" },
  { key: "manager", email: "marta.kowalska@demo-outsourcing.pl", name: "Marta Kowalska", role: "OPS_MANAGER" },
  { key: "kiosk", email: "kiosk.strykow.1@devices.kadreo-demo.app", name: "KSK-STR-01", role: "KIOSK" },
] as const;

export type MobileDemoUserKey = (typeof MOBILE_DEMO_USERS)[number]["key"];

/** Great-circle distance in metres (geofence check, 14.1 step 4). */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}
