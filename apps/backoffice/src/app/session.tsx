import { can as canPerm, createHttpApi, createMockApi, demoTokenProvider, type Api, type CurrentUser, type Position, type Reason, type Competence, type RoleCode, type Tenant } from "@kadreo/domain";
import { I18nProvider, mergeCatalogs, type Locale } from "@kadreo/i18n";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { common } from "../i18n/common";
import { dashboard } from "../i18n/dashboard";
import { schedule } from "../i18n/schedule";
import { timesheet } from "../i18n/timesheet";

/**
 * Session: current user, tenant branding, dictionaries. With VITE_API_URL set the screens talk to
 * the backend over HTTP; without it they use the in-memory demo with the same data and contract.
 * The backend demo profile signs in through its dev-token endpoint as VITE_DEMO_EMAIL; production
 * sign-in goes through Keycloak (later iteration).
 */
const apiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "");
export const api: Api = apiUrl
  ? createHttpApi({ baseUrl: apiUrl, token: demoTokenProvider(apiUrl, (import.meta.env.VITE_DEMO_EMAIL as string | undefined) ?? "marta.kowalska@demo-outsourcing.pl") })
  : createMockApi();

const catalogs = mergeCatalogs(common, dashboard, schedule, timesheet);

interface SessionValue {
  user: CurrentUser;
  tenant: Tenant;
  dict: { positions: Position[]; competences: Competence[]; correctionReasons: Reason[]; disputeReasons: Reason[] };
  can: (permission: string) => boolean;
  setLocale: (l: Locale) => void;
  setRole: (r: RoleCode) => void;
}

const Ctx = createContext<SessionValue | null>(null);

const LOCALE_KEY = "kadreo.locale";

function storedLocale(): Locale | null {
  try {
    const v = localStorage.getItem(LOCALE_KEY);
    return v === "pl" || v === "uk" || v === "ru" || v === "en" ? v : null;
  } catch {
    return null;
  }
}

// Apply the stored language before the first request so the profile matches the UI.
const initial = storedLocale();
if (initial && !apiUrl) void api.updateLocale(initial);

export function SessionProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
  const tenant = useQuery({ queryKey: ["tenant"], queryFn: () => api.tenant(), staleTime: Infinity });
  const dict = useQuery({ queryKey: ["dict"], queryFn: () => api.dictionaries(), staleTime: Infinity });

  const setLocale = useCallback(
    (l: Locale) => {
      void api.updateLocale(l).then(() => qc.invalidateQueries({ queryKey: ["me"] }));
      try {
        localStorage.setItem(LOCALE_KEY, l);
      } catch {
        /* private mode: language still applies for this session */
      }
    },
    [qc],
  );
  const setRole = useCallback(
    (r: RoleCode) => {
      api.setActiveRole(r);
      void qc.invalidateQueries();
    },
    [qc],
  );

  const value = useMemo<SessionValue | null>(() => {
    if (!me.data || !tenant.data || !dict.data) return null;
    const perms = me.data.permissions;
    return { user: me.data, tenant: tenant.data, dict: dict.data, can: (p) => canPerm(perms, p), setLocale, setRole };
  }, [me.data, tenant.data, dict.data, setLocale, setRole]);

  useEffect(() => {
    if (value) {
      document.documentElement.lang = value.user.locale;
      document.title = value.tenant.branding.productName;
    }
  }, [value]);

  if (!value) return <>{fallback}</>;
  return (
    <Ctx.Provider value={value}>
      <I18nProvider locale={value.user.locale} catalogs={catalogs} productName={value.tenant.branding.productName}>
        {children}
      </I18nProvider>
    </Ctx.Provider>
  );
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}
