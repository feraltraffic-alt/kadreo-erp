import { ApiError, type ApiErrorBody } from "./api";
import type { HttpApiOptions } from "./http";
import type { PortalApi } from "./portal";

/** The client portal contract over HTTP (`/api/v1/portal`), same shapes as the portal demo. */
export function createPortalHttpApi(opts: HttpApiOptions): PortalApi {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = new URL(`${opts.baseUrl}/api/v1${path}`, typeof location === "undefined" ? "http://localhost" : location.href);
    const headers: Record<string, string> = { Authorization: `Bearer ${await opts.token()}`, Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) throw new ApiError(res.status, (data ?? { code: "not_found" }) as ApiErrorBody);
    return data as T;
  }
  return {
    me: () => call("GET", "/portal/me"),
    tenant: () => call("GET", "/tenant"),
    updateLocale: async (locale) => {
      await call("PATCH", "/me", { locale });
    },
    dictionaries: () => call("GET", "/portal/dictionaries"),
    overview: () => call("GET", "/portal/overview"),
    sites: () => call("GET", "/portal/sites"),
    siteOptions: (siteId) => call("GET", `/portal/sites/${siteId}/positions`),
    estimate: (input) => call("POST", "/portal/staff-requests/estimate", input),
    createRequest: (input) => call("POST", "/portal/staff-requests", input),
    updateRequest: (id, input) => call("PUT", `/portal/staff-requests/${id}`, input),
    requests: () => call("GET", "/portal/staff-requests"),
    request: (id) => call("GET", `/portal/staff-requests/${id}`),
    timesheets: () => call("GET", "/portal/timesheets"),
    timesheet: (id) => call("GET", `/portal/timesheets/${id}`),
    dispute: (id, input) => call("POST", `/portal/timesheets/${id}/disputes`, input),
    confirm: (id) => call("POST", `/portal/timesheets/${id}/confirm`),
  };
}
