import { createPortalHttpApi, createPortalMockApi, demoTokenProvider, type PortalApi, type PortalDictionaries, type PortalUser, type Tenant } from "@kadreo/domain";
import { I18nProvider, mergeCatalogs, type Locale } from "@kadreo/i18n";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { portal } from "../i18n/portal";

/**
 * Portal session: the client user, tenant branding, dictionaries. VITE_API_URL switches from the
 * in-memory demo (Jan Nowak, Nordlog) to the backend; "/" means the same origin.
 */
const rawApiUrl = import.meta.env.VITE_API_URL as string | undefined;
const apiUrl = rawApiUrl ? rawApiUrl.replace(/\/$/, "") : null;
export const api: PortalApi =
  apiUrl !== null
    ? createPortalHttpApi({ baseUrl: apiUrl, token: demoTokenProvider(apiUrl, (import.meta.env.VITE_DEMO_EMAIL as string | undefined) ?? "jan.nowak@nordlog.pl") })
    : createPortalMockApi();

const catalogs = mergeCatalogs(portal);

interface SessionValue {
  user: PortalUser;
  tenant: Tenant;
  dict: PortalDictionaries;
  can: (permission: string) => boolean;
  setLocale: (l: Locale) => void;
}

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
  const tenant = useQuery({ queryKey: ["tenant"], queryFn: () => api.tenant(), staleTime: Infinity });
  const dict = useQuery({ queryKey: ["dict"], queryFn: () => api.dictionaries(), staleTime: Infinity });

  const setLocale = useCallback(
    (l: Locale) => {
      void api.updateLocale(l).then(() => qc.invalidateQueries({ queryKey: ["me"] }));
    },
    [qc],
  );

  const value = useMemo<SessionValue | null>(() => {
    if (!me.data || !tenant.data || !dict.data) return null;
    const perms = me.data.permissions;
    return { user: me.data, tenant: tenant.data, dict: dict.data, can: (p) => perms.includes(p), setLocale };
  }, [me.data, tenant.data, dict.data, setLocale]);

  useEffect(() => {
    if (value) {
      document.documentElement.lang = value.user.locale;
      document.title = `${value.tenant.branding.productName} · ${catalogs[value.user.locale]["shell.caption"]}`;
    }
  }, [value]);

  if (me.isError || tenant.isError) return <div className="p-10 text-center text-muted">Could not reach the server.</div>;
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
