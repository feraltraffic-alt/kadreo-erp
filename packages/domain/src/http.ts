import { ApiError, type Api, type ApiErrorBody, type DashboardFilter } from "./api";
import type { RoleCode } from "./types";

/**
 * The `Api` contract over HTTP, against the Kadreo backend (`/api/v1`). Same names and shapes as
 * the in-memory demo, so screens do not know which one they talk to.
 */
export interface HttpApiOptions {
  baseUrl: string;
  /** Returns a valid access token (Keycloak in production, the dev-token endpoint in the demo). */
  token: () => Promise<string>;
}

/** Signs in against the demo profile's token endpoint. Never available in production. */
export function demoTokenProvider(baseUrl: string, email: string): () => Promise<string> {
  let cached: { token: string; until: number } | null = null;
  return async () => {
    if (cached && cached.until > Date.now() + 60_000) return cached.token;
    const res = await fetch(`${baseUrl}/api/v1/dev/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
    if (!res.ok) throw new Error(`Sign-in failed: ${res.status}`);
    const body = (await res.json()) as { accessToken: string; expiresIn: number };
    cached = { token: body.accessToken, until: Date.now() + body.expiresIn * 1000 };
    return body.accessToken;
  };
}

type Query = Record<string, string | number | boolean | string[] | undefined | null>;

export function createHttpApi(opts: HttpApiOptions): Api {
  let activeRole: RoleCode | null = null;

  async function call<T>(method: string, path: string, q?: Query, body?: unknown): Promise<T> {
    const url = new URL(`${opts.baseUrl}/api/v1${path}`, typeof location === "undefined" ? "http://localhost" : location.href);
    for (const [k, v] of Object.entries(q ?? {})) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x));
      else url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${await opts.token()}`, Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (activeRole) headers["X-Active-Role"] = activeRole;
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) throw new ApiError(res.status, (data ?? { code: "not_found" }) as ApiErrorBody);
    return data as T;
  }
  const get = <T>(path: string, q?: Query) => call<T>("GET", path, q);
  const post = <T>(path: string, body?: unknown, q?: Query) => call<T>("POST", path, q, body);
  const filter = (f: DashboardFilter): Query => ({ regions: f.regions, clientIds: f.clientIds });

  return {
    setActiveRole(role) {
      activeRole = role;
    },
    async updateLocale(locale) {
      await call("PATCH", "/me", undefined, { locale });
    },

    me: () => get("/me"),
    tenant: () => get("/tenant"),
    dictionaries: () => get("/dictionaries"),
    search: (q) => get("/search", { q }),
    notifications: () => get("/notifications"),
    navCounters: () => get("/nav-counters"),
    markAllNotificationsRead: () => post("/notifications/read-all"),

    dashboardSummary: (f) => get("/dashboard/summary", filter(f)),
    dashboardSites: (f) => get("/dashboard/sites", filter(f)),
    dashboardFilterOptions: () => get("/dashboard/filter-options"),
    alerts: (q) => get("/alerts", { status: q.status, limit: q.limit }),
    takeAlert: (id) => post(`/alerts/${id}/take`),
    createUrgentRequest: (input) => post("/urgent-requests", input),
    urgentRequestStatus: (id) => get(`/urgent-requests/${id}`),
    staffRequests: () => get("/staff-requests"),
    staffRequest: (id) => get(`/staff-requests/${id}`),
    acceptStaffRequest: (id) => post(`/staff-requests/${id}/accept`),
    cancelStaffRequest: (id, reason) => post(`/staff-requests/${id}/cancel`, { reason }),
    sitesWithTemplates: () => get("/sites-with-templates"),

    projects: (weekOf) => get("/projects", { weekOf }),
    schedule: (projectId, from, to) => get(`/projects/${projectId}/schedule`, { from, to }),
    cellAssignments: (templateId, date) => get(`/shifts/${templateId}/assignments`, { date }),
    candidates: (templateId, date, f) => get(`/shifts/${templateId}/candidates`, { date, maxKm: f?.maxKm, experiencedOnly: f?.experiencedOnly, noOvertime: f?.noOvertime }),
    assign: (input) => post("/assignments", input),
    unassign: (id) => call("DELETE", `/assignments/${id}`),
    changePlan: (templateId, date, planned) => call("PUT", `/shifts/${templateId}/plans/${date}`, undefined, { planned }),
    cancelShift: (templateId, date) => post(`/shifts/${templateId}/plans/${date}/cancel`),
    copyToNextWeek: async (templateId, date) => (await post<{ copied: number }>(`/shifts/${templateId}/plans/${date}/copy-to-next-week`)).copied,
    startAutoAssign: (projectId, from, req) => post(`/projects/${projectId}/schedule/auto-assign`, req, { from }),
    job: (jobId) => get(`/jobs/${jobId}`),
    publishSchedule: (projectId, from) => post(`/projects/${projectId}/schedule/publish`, undefined, { from }),

    timesheets: () => get("/timesheets"),
    timesheet: (projectId, from) => get("/timesheets/by-period", { projectId, from }),
    timesheetDay: (timesheetId, rowId, date) => get(`/timesheets/${timesheetId}/rows/${rowId}/days/${date}`),
    correct: (timesheetId, input) => post(`/timesheets/${timesheetId}/corrections`, input),
    sendToClient: (timesheetId) => post(`/timesheets/${timesheetId}/send-to-client`),
    disputes: (q) => get("/timesheet-disputes", { status: q?.status }),
    resolveDispute: (timesheetId, disputeId, input) => post(`/timesheets/${timesheetId}/disputes/${disputeId}/resolve`, input),

    workerDocuments: (workerId) => get(`/workers/${workerId}/documents`),
  };
}
