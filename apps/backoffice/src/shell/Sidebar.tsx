import { useI18n, useLocalized } from "@kadreo/i18n";
import { cn, Tooltip } from "@kadreo/ui";
import { useQuery } from "@tanstack/react-query";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NavLink } from "react-router";
import { api, useSession } from "../app/session";
import { navItems, settingsItem, type NavItem } from "./nav";

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  const loc = useLocalized();
  const { tenant, can } = useSession();
  const counters = useQuery({ queryKey: ["navCounters"], queryFn: () => api.navCounters(), refetchInterval: 60_000 });
  const visible = (item: NavItem) => item.anyOf.some((p) => can(p));

  return (
    <aside
      className={cn("sticky top-0 flex h-screen shrink-0 flex-col bg-sidebar text-white transition-[width] duration-200", collapsed ? "w-[72px]" : "w-[232px]")}
      aria-label={t("nav.main")}
    >
      <NavLink to="/dashboard" className={cn("flex items-center gap-3 px-6 pt-6 pb-7", collapsed && "justify-center px-0")}>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-accent text-[18px] font-extrabold">{tenant.branding.logoLetter}</span>
        {!collapsed && (
          <span className="min-w-0">
            <span className="block truncate text-[16px] leading-tight font-bold">{tenant.branding.productName}</span>
            <span className="block truncate text-[12px] text-sidebar-muted">{loc(tenant.branding.productTagline)}</span>
          </span>
        )}
      </NavLink>

      <nav className="flex-1 overflow-y-auto px-3">
        <ul className="flex flex-col gap-1">
          {navItems.filter(visible).map((item) => (
            <li key={item.key}>
              <NavItemLink item={item} collapsed={collapsed} label={t(`nav.${item.key}`)} counter={counterFor(item, counters.data)} />
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex flex-col gap-1 px-3 pt-2 pb-5">
        {visible(settingsItem) && <NavItemLink item={settingsItem} collapsed={collapsed} label={t("nav.settings")} />}
        <button
          type="button"
          onClick={onToggle}
          className={cn("flex h-10 items-center gap-3 rounded-control px-3 text-[13px] text-sidebar-muted hover:bg-white/8 hover:text-white", collapsed && "justify-center px-0")}
          aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
        >
          {collapsed ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}
          {!collapsed && t("nav.collapse")}
        </button>
      </div>
    </aside>
  );
}

function counterFor(item: NavItem, c: { requestsNew: number; docsAttention: number; docsExpired: number } | undefined) {
  if (!c || !item.counter) return undefined;
  if (item.counter === "requests") return c.requestsNew ? { n: c.requestsNew, red: false } : undefined;
  return c.docsAttention ? { n: c.docsAttention, red: c.docsExpired > 0 } : undefined;
}

function NavItemLink({ item, collapsed, label, counter }: { item: NavItem; collapsed: boolean; label: string; counter?: { n: number; red: boolean } | undefined }) {
  const Icon = item.icon;
  const link = (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(
          "relative flex min-h-10 items-center gap-3 rounded-control px-3 py-2 text-[14px] leading-tight font-medium transition-colors",
          isActive ? "bg-accent-strong text-white" : "text-white/85 hover:bg-white/8 hover:text-white",
          collapsed && "justify-center px-0",
        )
      }
    >
      <Icon className="size-[18px] shrink-0" aria-hidden />
      {!collapsed && <span className="flex-1">{label}</span>}
      {counter &&
        (collapsed ? (
          <span className={cn("absolute top-1.5 right-3 size-2 rounded-full", counter.red ? "bg-critical" : "bg-white/70")} aria-label={String(counter.n)} />
        ) : (
          <span className={cn("rounded-full px-2 py-0.5 text-[12px] font-semibold tabular", counter.red ? "bg-critical text-white" : "bg-white/12 text-white")}>{counter.n}</span>
        ))}
    </NavLink>
  );
  return collapsed ? (
    <Tooltip content={label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}
