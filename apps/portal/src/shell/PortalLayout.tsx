import { LOCALE_LABEL, LOCALES, useI18n } from "@kadreo/i18n";
import { cn, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, useToast } from "@kadreo/ui";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link, NavLink, Outlet } from "react-router";
import { api, useSession } from "../app/session";

const sections = [
  { key: "overview", to: "/overview" },
  { key: "requests", to: "/requests" },
  { key: "timesheets", to: "/timesheets" },
  { key: "reports", to: "/reports" },
  { key: "documents", to: "/documents" },
  { key: "messages", to: "/messages" },
] as const;

/** Portal header (spec 12): logo and product name with «Портал клиента», sections, client and user. */
export function PortalLayout() {
  const { t } = useI18n();
  const { tenant, user } = useSession();
  const sheets = useQuery({ queryKey: ["timesheets"], queryFn: () => api.timesheets() });
  const waiting = sheets.data?.filter((s) => s.stage.kind === "waiting").length ?? 0;

  return (
    <div className="min-h-screen bg-bg">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2">
        {t("shell.skip")}
      </a>
      <header className="sticky top-0 z-30 border-b border-border bg-surface">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-8 px-6">
          <Link to="/overview" className="flex shrink-0 items-center gap-3">
            <span className="flex size-8 items-center justify-center rounded-[9px] bg-accent text-[16px] font-extrabold text-white">{tenant.branding.logoLetter}</span>
            <span className="text-[16px] font-extrabold">{tenant.branding.productName}</span>
            <span className="border-l border-border pl-3 text-[13px] text-muted">{t("shell.caption")}</span>
          </Link>
          <nav aria-label={t("shell.caption")} className="flex h-full min-w-0 items-stretch gap-1 overflow-x-auto">
            {sections.map((s) => (
              <NavLink
                key={s.key}
                to={s.to}
                className={({ isActive }) =>
                  cn(
                    "relative flex items-center gap-2 px-3 text-[14px] whitespace-nowrap transition-colors",
                    isActive ? "font-bold text-ink after:absolute after:inset-x-1 after:bottom-0 after:h-[3px] after:rounded-t after:bg-accent" : "text-muted hover:text-ink",
                  )
                }
              >
                {t(`nav.${s.key}`)}
                {s.key === "timesheets" && waiting > 0 && (
                  <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[11px] font-bold text-white tabular">{waiting}</span>
                )}
              </NavLink>
            ))}
          </nav>
          <UserMenu />
        </div>
      </header>
      <main id="main" className="mx-auto max-w-[1280px] px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}

function UserMenu() {
  const { t } = useI18n();
  const { user, setLocale } = useSession();
  const toast = useToast();
  return (
    <Menu>
      <MenuTrigger asChild>
        <button type="button" className="ml-auto flex shrink-0 items-center gap-3 rounded-[12px] border border-border bg-surface py-1.5 pr-4 pl-1.5 text-left hover:bg-bg">
          <span className="flex size-9 items-center justify-center rounded-[9px] bg-ink text-[12px] font-bold text-white">{user.initials}</span>
          <span className="leading-tight">
            <span className="block text-[13px] font-bold">{user.client.shortName}</span>
            <span className="block text-[12px] text-muted">
              {user.fullName} · {t(`role.${user.role}`)}
            </span>
          </span>
        </button>
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>{t("shell.language")}</MenuLabel>
        {LOCALES.map((l) => (
          <MenuItem key={l} onSelect={() => setLocale(l)}>
            <span className="w-8 font-semibold">{LOCALE_LABEL[l]}</span>
            {user.locale === l && <Check className="ml-auto size-4 text-accent-strong" />}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem onSelect={() => toast.push({ tone: "info", text: t("shell.profileDemo") })}>{user.email}</MenuItem>
        <MenuItem onSelect={() => toast.push({ tone: "info", text: t("shell.logoutDemo") })}>{t("shell.logout")}</MenuItem>
      </MenuContent>
    </Menu>
  );
}

export function PageHeader({ title, crumbs, meta, actions }: { title: ReactNode; crumbs?: { label: string; to?: string }[]; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {crumbs && (
          <nav aria-label="breadcrumbs" className="mb-1.5 flex flex-wrap items-center gap-1 text-[13px] text-muted">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="size-3.5" aria-hidden />}
                {c.to ? (
                  <Link to={c.to} className="text-accent-strong hover:underline">
                    {c.label}
                  </Link>
                ) : (
                  <span>{c.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-[28px] leading-tight font-extrabold tracking-[-0.01em]">{title}</h1>
        {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}

export function Placeholder({ titleKey }: { titleKey: string }) {
  const { t } = useI18n();
  return (
    <div>
      <PageHeader title={t(titleKey)} />
      <div className="rounded-card border border-dashed border-border bg-surface px-6 py-16 text-center text-muted">{t("ph.text")}</div>
    </div>
  );
}
