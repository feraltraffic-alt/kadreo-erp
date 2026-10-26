import { ApiError, type ApiErrorBody } from "./api";
import type { HttpApiOptions } from "./http";
import type { MobileApi } from "./mobile";

/** The mobile/kiosk contract over HTTP (`/api/v1`), same names and shapes as the demo. */
export function createMobileHttpApi(opts: HttpApiOptions): MobileApi {
  async function call<T>(method: string, path: string, q?: Record<string, string | number | undefined>, body?: unknown): Promise<T> {
    const qs = Object.entries(q ?? {})
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    const url = `${opts.baseUrl}/api/v1${path}${qs ? `?${qs}` : ""}`;
    const headers: Record<string, string> = { Authorization: `Bearer ${await opts.token()}`, Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) throw new ApiError(res.status, (data ?? { code: "not_found" }) as ApiErrorBody);
    return data as T;
  }
  const get = <T>(path: string, q?: Record<string, string | number | undefined>) => call<T>("GET", path, q);
  const post = <T>(path: string, body?: unknown) => call<T>("POST", path, undefined, body);
  const put = <T>(path: string, body?: unknown, q?: Record<string, string | number | undefined>) => call<T>("PUT", path, q, body);

  return {
    me: () => get("/me"),
    updateLocale: async (locale) => {
      await call("PATCH", "/me", undefined, { locale });
    },
    notifications: () => get("/notifications"),
    markAllNotificationsRead: async () => {
      await post("/notifications/read-all");
    },

    today: () => get("/me/today"),
    myShifts: (from, to) => get("/me/shifts", { from, to }),
    clock: (input) => post("/clock-events", input),
    reportIssue: (input) => post("/clock-issues", input),
    respondToShift: async (shift, decision, reason) => {
      await post(`/${shift.kind === "offer" ? "urgent-offers" : "assignments"}/${shift.id}/${decision}`, reason ? { reason } : undefined);
    },
    myDocuments: () => get("/me/documents"),
    profile: () => get("/me/profile"),
    setBiometricConsent: (consent) => put("/me/biometric-consent", { consent }),
    setKioskPin: (pin) => put("/me/kiosk-pin", { pin }),
    kioskQr: () => get("/me/kiosk-qr"),

    brigade: (shift) => get("/team/brigade", { shift }),
    requestReplacement: (id) => post(`/team/assignments/${id}/replacement`),
    manualClock: (input) => post("/team/manual-clock", input),
    recordOutput: (shift, value) => put("/team/output", { value }, { shift }),
    replyToWorker: async (workerId, text) => {
      await post("/team/messages", { workerId, text });
    },

    managerSummary: () => get("/manager/summary"),
    alerts: () => get("/alerts", { status: "open", limit: 50 }),
    sites: () => get("/dashboard/sites"),
    siteBrigade: (siteId) => get(`/manager/sites/${siteId}/brigade`),
    decisions: () => get("/manager/decisions"),
    decide: async (id, kind, decision, reason) => {
      await post(`/manager/decisions/${kind}/${id}`, { decision, reason });
    },
    candidates: (templateId, date) => get(`/shifts/${templateId}/candidates`, { date }),
    offerShift: (input) => post("/urgent-offers", input),
    urgentShift: async (input) => ({ offered: (await post<{ offeredTo: number }>("/urgent-requests", input)).offeredTo }),
    broadcast: (input) => post("/manager/broadcasts", input),
    siteTemplates: async () => {
      const list = await get<{ site: { id: string; name: string }; templates: { id: string; positionId: string; start: string; end: string }[] }[]>("/sites-with-templates");
      return list.map((x) => ({ siteId: x.site.id, siteName: x.site.name, templates: x.templates }));
    },

    kioskState: () => get("/kiosk/state"),
    kioskIdentify: (input) => post("/kiosk/identify", input),
    kioskClock: (input) => post("/kiosk/clock-events", input),
  };
}
