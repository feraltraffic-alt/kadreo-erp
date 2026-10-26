import { useI18n } from "@kadreo/i18n";
import { Button, cn } from "@kadreo/ui";
import { ChevronRight, Lock, Monitor } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, Outlet, useLocation } from "react-router";
import { useSession } from "../app/session";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

function useMedia(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return match;
}

/** Back-office frame (8.3–8.4): menu 232 px, 72 px at 1024–1279 px, dashboard only below 1024 px. */
export function Layout() {
  const { t } = useI18n();
  const wide = useMedia("(min-width: 1280px)");
  const usable = useMedia("(min-width: 1024px)");
  const [userCollapsed, setUserCollapsed] = useState<boolean | null>(null);
  const collapsed = userCollapsed ?? !wide;
  const { pathname } = useLocation();
  const narrowBlocked = !usable && !pathname.startsWith("/dashboard");

  return (
    <div className="flex min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:rounded-control focus:bg-surface focus:px-3 focus:py-2">
        {t("shell.skip")}
      </a>
      {usable && <Sidebar collapsed={collapsed} onToggle={() => setUserCollapsed(!collapsed)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main id="main" className="min-w-0 flex-1 px-8 pt-7 pb-12">
          {narrowBlocked ? (
            <div className="mx-auto mt-16 flex max-w-md flex-col items-center gap-4 text-center">
              <Monitor className="size-10 text-muted" />
              <p className="text-muted">{t("shell.narrow")}</p>
              <Link to="/dashboard">
                <Button variant="primary">{t("forbidden.back")}</Button>
              </Link>
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- page building blocks */

export function Breadcrumbs({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav aria-label="breadcrumbs" className="mb-1.5 flex flex-wrap items-center gap-1 text-[13px] text-muted">
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="size-3.5" aria-hidden />}
          {it.to ? (
            <Link to={it.to} className="hover:text-ink hover:underline">
              {it.label}
            </Link>
          ) : (
            <span>{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function PageHeader({ title, crumbs, meta, actions, className }: { title: ReactNode; crumbs?: { label: string; to?: string }[]; meta?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-6 flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {crumbs && <Breadcrumbs items={crumbs} />}
        <h1 className="text-[28px] leading-tight font-extrabold tracking-[-0.01em]">{title}</h1>
        {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}

/** 403 page (8.5): names the missing permission. */
export function Forbidden({ permission }: { permission: string }) {
  const { t } = useI18n();
  return (
    <div className="mx-auto mt-20 flex max-w-lg flex-col items-center gap-4 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-neutral-bg">
        <Lock className="size-6 text-muted" />
      </span>
      <h1 className="text-[24px] font-extrabold">{t("forbidden.title")}</h1>
      <p className="text-muted">{t("forbidden.text", { permission })}</p>
      <Link to="/dashboard">
        <Button variant="primary">{t("forbidden.back")}</Button>
      </Link>
    </div>
  );
}

export function RequirePermission({ anyOf, children }: { anyOf: string[]; children: ReactNode }) {
  const { can } = useSession();
  if (!anyOf.some((p) => can(p))) return <Forbidden permission={anyOf[0]!} />;
  return <>{children}</>;
}

export function PlaceholderPage({ titleKey, specRef, noSpec }: { titleKey: string; specRef?: string; noSpec?: boolean }) {
  const { t } = useI18n();
  return (
    <div>
      <PageHeader title={t(titleKey)} />
      <div className="rounded-card border border-dashed border-input bg-surface/60 px-8 py-14 text-center text-muted">
        {noSpec ? t("placeholder.noSpec") : t("placeholder.text", { ref: specRef ?? "—" })}
      </div>
    </div>
  );
}
