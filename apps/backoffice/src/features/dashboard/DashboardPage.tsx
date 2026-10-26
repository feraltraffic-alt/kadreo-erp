import type { SiteLive, SiteLiveStatus } from "@kadreo/domain";
import { useI18n } from "@kadreo/i18n";
import {
  Badge,
  Button,
  Card,
  cn,
  Dialog,
  DialogContent,
  ErrorState,
  Input,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  ProgressBar,
  Segmented,
  Skeleton,
  StatusDot,
  Tooltip,
  type Tone,
} from "@kadreo/ui";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Plus } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { api, useSession } from "../../app/session";
import { NOW, useFormat } from "../../lib/format";
import { PageHeader } from "../../shell/Layout";
import { AlertsBlock } from "./AlertsBlock";
import { SitesMap } from "./SitesMap";
import { UrgentDialog } from "./UrgentDialog";

const statusTone: Record<SiteLiveStatus, Tone> = { ok: "ok", deviation: "warn", critical: "critical" };
const statusRank: Record<SiteLiveStatus, number> = { critical: 0, deviation: 1, ok: 2 };
const barTone = { ok: "ok", deviation: "warn", critical: "critical" } as const;

/** Operations dashboard (spec 11.1). Filters live in the URL so a view can be shared. */
export function DashboardPage() {
  const { t, time, date } = useI18n();
  const { until } = useFormat();
  const { can } = useSession();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const regions = params.getAll("region");
  const clientIds = params.getAll("client");
  const filter = { regions, clientIds };
  const [urgentOpen, setUrgentOpen] = useState(false);
  const [drill, setDrill] = useState<null | "onShift" | "late" | "noShows">(null);
  const [tab, setTab] = useState<"all" | "deviation">("all");

  const options = useQuery({ queryKey: ["dashOptions"], queryFn: () => api.dashboardFilterOptions(), staleTime: Infinity });
  const summary = useQuery({ queryKey: ["dashSummary", regions, clientIds], queryFn: () => api.dashboardSummary(filter), refetchInterval: 30_000 });
  const sites = useQuery({ queryKey: ["dashSites", regions, clientIds], queryFn: () => api.dashboardSites(filter), refetchInterval: 30_000 });

  const setMulti = (key: "region" | "client", values: string[]) => {
    const next = new URLSearchParams(params);
    next.delete(key);
    values.forEach((v) => next.append(key, v));
    setParams(next, { replace: true });
  };

  const siteIds = useMemo(() => new Set((sites.data ?? []).map((s) => s.siteId)), [sites.data]);
  const sorted = useMemo(
    () => [...(sites.data ?? [])].sort((a, b) => statusRank[a.status] - statusRank[b.status] || a.siteName.localeCompare(b.siteName, "pl")),
    [sites.data],
  );
  const deviating = sorted.filter((s) => s.status !== "ok");
  const counts = { ok: sorted.length - deviating.length, deviation: deviating.filter((s) => s.status === "deviation").length, critical: deviating.filter((s) => s.status === "critical").length };
  const s = summary.data;
  const updated = s ? new Date(s.updatedAt) : NOW;

  return (
    <div>
      <PageHeader
        title={t("dash.title")}
        meta={
          <span className="flex items-center gap-2 text-[14px] text-muted">
            <span className="flex items-center gap-1.5 font-semibold text-ok-text">
              <StatusDot tone="ok" />
              {t("live.on")}
            </span>
            {t("dash.updated", { date: date(updated, { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Warsaw" }), time: time(updated) + ":" + String(updated.getSeconds()).padStart(2, "0") })}
          </span>
        }
        actions={
          <>
            <MultiFilter
              label={t("dash.filter.region", { value: regions.length ? (regions.length === 1 ? regions[0]! : t("dash.filter.selected", { n: regions.length })) : t("common.all") })}
              options={(options.data?.regions ?? []).map((r) => ({ value: r, label: r }))}
              selected={regions}
              onChange={(v) => setMulti("region", v)}
            />
            <MultiFilter
              searchable
              label={t("dash.filter.client", {
                value: clientIds.length ? (clientIds.length === 1 ? (options.data?.clients.find((c) => c.id === clientIds[0])?.shortName ?? "") : t("dash.filter.selected", { n: clientIds.length })) : t("common.all"),
              })}
              options={(options.data?.clients ?? []).map((c) => ({ value: c.id, label: c.shortName }))}
              selected={clientIds}
              onChange={(v) => setMulti("client", v)}
            />
            <Menu>
              <MenuTrigger asChild>
                <Button className="gap-2">
                  {t("dash.filter.shift", { value: t("dash.shift.current") })}
                  <ChevronDown className="size-4 text-muted" />
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem>{t("dash.shift.current")}</MenuItem>
                <MenuItem disabled>{t("dash.shift.today")}</MenuItem>
                <MenuItem disabled title={t("dash.shift.atHint")}>
                  {t("dash.shift.at")}
                </MenuItem>
              </MenuContent>
            </Menu>
            {can("shift.urgent.create") && (
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setUrgentOpen(true)}>
                {t("dash.urgent")}
              </Button>
            )}
          </>
        }
      />

      {/* KPI row 11.1-07…11 */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
        {summary.isError ? (
          <ErrorState className="col-span-full" message={t("common.loadError")} retryLabel={t("common.retry")} onRetry={() => void summary.refetch()} />
        ) : !s ? (
          [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[158px] rounded-card" />)
        ) : (
          <>
            <KpiCard accent onClick={() => setDrill("onShift")} label={t("kpi.onShift")}>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-[36px] leading-none font-extrabold tabular">{s.onShiftNow}</span>
                <span className="text-[14px] text-white/90">{t("kpi.ofPlan", { plan: s.plannedNow })}</span>
              </div>
              <ProgressBar value={s.plannedNow ? s.onShiftNow / s.plannedNow : 0} tone="white" className="mt-4 bg-white/25" />
              <div className="mt-2 text-[13px] text-white/90">{t("kpi.staffing", { pct: s.plannedNow ? Math.floor((s.onShiftNow / s.plannedNow) * 100) : 0 })}</div>
            </KpiCard>
            <KpiCard onClick={() => setDrill("late")} label={t("kpi.late")}>
              <div className="mt-3 text-[36px] leading-none font-extrabold tabular">{s.lateToday}</div>
              <div className={cn("mt-4 text-[13px] font-semibold", s.lateToday > s.lateSameDayLastWeek ? "text-warn-text" : "text-ok-text")}>
                {t("kpi.lateDelta", { delta: Math.abs(s.lateToday - s.lateSameDayLastWeek), sign: s.lateToday >= s.lateSameDayLastWeek ? "+" : "−" })}
              </div>
            </KpiCard>
            <KpiCard onClick={() => setDrill("noShows")} label={t("kpi.noShows")}>
              <div className="mt-3 text-[36px] leading-none font-extrabold tabular">{s.noShows}</div>
              <div className="mt-4 text-[13px] text-muted">{t("kpi.replaced", { n: s.noShowsReplaced })}</div>
            </KpiCard>
            <KpiCard onClick={can("alert.read") ? () => navigate("/alerts") : undefined} label={t("kpi.alerts")}>
              <div className="mt-3 text-[36px] leading-none font-extrabold tabular">{s.openAlerts}</div>
              <div className={cn("mt-4 text-[13px] font-semibold", s.criticalAlerts ? "text-critical-text" : "text-muted")}>{t("kpi.critical", { n: s.criticalAlerts })}</div>
            </KpiCard>
            <KpiCard onClick={can("staffrequest.read") ? () => navigate("/requests") : undefined} label={t("kpi.requests")}>
              <div className="mt-3 text-[36px] leading-none font-extrabold tabular">{s.staffRequestsOpen}</div>
              <div className="mt-4 text-[13px] text-muted">{s.nearestSlaDueAt ? t("kpi.slaNearest", { time: until(s.nearestSlaDueAt) }) : t("kpi.noRequests")}</div>
            </KpiCard>
          </>
        )}
      </div>

      {/* Map + alerts */}
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,1fr)]">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-3">
            <h2 className="text-[17px] font-bold">{t("map.title")}</h2>
            <div className="flex flex-wrap items-center gap-4 text-[13px] text-muted">
              {(["ok", "deviation", "critical"] as const).map((k) => (
                <span key={k} className="flex items-center gap-1.5">
                  <StatusDot tone={statusTone[k]} />
                  {t("map.legend", { label: t(`status.${k}`), n: counts[k] })}
                </span>
              ))}
            </div>
          </div>
          <div className="px-5 pb-5">{sites.data ? <SitesMap sites={sites.data} /> : <Skeleton className="h-[340px] rounded-[12px]" />}</div>
        </Card>
        <AlertsBlock siteFilter={(id) => siteIds.size === 0 || siteIds.has(id)} />
      </div>

      {/* Sites now 11.1-16 */}
      <Card className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-2">
          <h2 className="text-[17px] font-bold">{t("sitesNow.title")}</h2>
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "all", label: t("sitesNow.all", { n: sorted.length }) },
              { value: "deviation", label: t("sitesNow.deviation", { n: deviating.length }) },
            ]}
          />
        </div>
        <div className="overflow-x-auto px-2 pb-3">
          <SitesTable rows={tab === "all" ? sorted : deviating} loading={sites.isLoading} onOpen={(id) => navigate(`/sites/${id}`)} />
        </div>
      </Card>

      <UrgentDialog open={urgentOpen} onOpenChange={setUrgentOpen} />
      <DrillDialog kind={drill} sites={sorted} onClose={() => setDrill(null)} />
    </div>
  );
}

function KpiCard({ label, children, accent, onClick }: { label: string; children: ReactNode; accent?: boolean; onClick?: (() => void) | undefined }) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex min-h-[158px] flex-col rounded-card border p-5 text-left transition-shadow",
        accent ? "border-transparent bg-accent-strong text-white" : "border-border bg-surface",
        onClick && "hover:shadow-pop",
      )}
    >
      <span className={cn("text-[14px] font-medium", accent ? "text-white/90" : "text-muted")}>{label}</span>
      {children}
    </Comp>
  );
}

function SitesTable({ rows, loading, onOpen }: { rows: SiteLive[]; loading: boolean; onOpen: (id: string) => void }) {
  const { t } = useI18n();
  if (loading)
    return (
      <div className="flex flex-col gap-2 p-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  if (!rows.length) return <p className="px-3 py-10 text-center text-muted">{t("sitesNow.empty")}</p>;
  return (
    <table className="w-full min-w-[860px] border-collapse text-[14px]">
      <thead>
        <tr className="text-left text-[12px] font-semibold tracking-wide text-muted uppercase">
          {["site", "client", "shift", "fact", "late", "leader", "status"].map((c) => (
            <th key={c} className="border-b border-border px-3 py-3 font-semibold">
              {t(`sitesNow.col.${c}`)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.siteId} onClick={() => onOpen(r.siteId)} className="cursor-pointer border-b border-divider last:border-0 hover:bg-bg">
            <td className="px-3 py-3.5 font-semibold">
              <button type="button" className="text-left hover:underline" onClick={() => onOpen(r.siteId)}>
                {r.siteName}
              </button>
            </td>
            <td className="px-3 py-3.5 text-muted">{r.clientName}</td>
            <td className="px-3 py-3.5 tabular">{r.shiftLabel}</td>
            <td className="px-3 py-3.5">
              <div className="w-[120px]">
                <span className="font-semibold tabular">
                  {r.actual} <span className="font-normal text-muted">/ {r.planned}</span>
                </span>
                <ProgressBar value={r.planned ? r.actual / r.planned : 0} tone={barTone[r.status]} className="mt-1.5" />
              </div>
            </td>
            <td className="px-3 py-3.5 tabular">{r.late}</td>
            <td className="px-3 py-3.5">{r.teamLeaderName}</td>
            <td className="px-3 py-3.5">
              <Badge tone={statusTone[r.status]} dot>
                {t(`status.${r.status}`)}
              </Badge>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MultiFilter({ label, options, selected, onChange, searchable }: { label: string; options: { value: string; label: string }[]; selected: string[]; onChange: (v: string[]) => void; searchable?: boolean }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const shown = options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button className={cn("gap-2", selected.length && "border-accent-strong")}>
          <span className="max-w-[220px] truncate">{label}</span>
          <ChevronDown className="size-4 text-muted" />
        </Button>
      </MenuTrigger>
      <MenuContent className="max-h-[380px] w-64 overflow-y-auto">
        {searchable && (
          <div className="p-1.5" onKeyDown={(e) => e.stopPropagation()}>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="…" className="h-9" aria-label={label} />
          </div>
        )}
        <MenuItem onSelect={() => onChange([])}>{t("common.allCap")}</MenuItem>
        <MenuSeparator />
        {shown.map((o) => (
          <MenuCheckboxItem
            key={o.value}
            checked={selected.includes(o.value)}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={(c) => onChange(c ? [...selected, o.value] : selected.filter((x) => x !== o.value))}
          >
            {o.label}
          </MenuCheckboxItem>
        ))}
        {!shown.length && <MenuLabel>—</MenuLabel>}
      </MenuContent>
    </Menu>
  );
}

/** KPI drill-down lists (11.1-07…09), aggregated by site. */
function DrillDialog({ kind, sites, onClose }: { kind: null | "onShift" | "late" | "noShows"; sites: SiteLive[]; onClose: () => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { can } = useSession();
  const rows = kind === "late" ? sites.filter((s) => s.late > 0).sort((a, b) => b.late - a.late) : kind === "noShows" ? sites.filter((s) => s.noShows > 0).sort((a, b) => b.noShows - a.noShows) : sites;
  return (
    <Dialog open={kind !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={kind ? t(`drill.${kind}.title`) : ""} closeLabel={t("common.close")} width={720}>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-muted">{t("drill.none")}</p>
        ) : (
          <table className="w-full text-[14px]">
            <thead>
              <tr className="text-left text-[12px] font-semibold text-muted uppercase">
                <th className="border-b border-border py-2 pr-3">{t("sitesNow.col.site")}</th>
                <th className="border-b border-border py-2 pr-3">{t("sitesNow.col.shift")}</th>
                <th className="border-b border-border py-2 pr-3">{kind === "late" ? t("drill.col.late") : kind === "noShows" ? t("drill.col.noShows") : t("sitesNow.col.fact")}</th>
                {kind === "noShows" && <th className="border-b border-border py-2 pr-3">{t("drill.col.replaced")}</th>}
                {kind === "noShows" && <th className="border-b border-border py-2" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.siteId} className="border-b border-divider last:border-0">
                  <td className="py-2.5 pr-3 font-semibold">{r.siteName}</td>
                  <td className="py-2.5 pr-3 tabular">{r.shiftLabel}</td>
                  <td className="py-2.5 pr-3 tabular">{kind === "late" ? r.late : kind === "noShows" ? r.noShows : `${r.actual} / ${r.planned}`}</td>
                  {kind === "noShows" && <td className="py-2.5 pr-3 tabular">{r.noShowsReplaced}</td>}
                  {kind === "noShows" && (
                    <td className="py-2.5 text-right">
                      {can("shift.schedule.edit") && r.noShows > r.noShowsReplaced && (
                        <Tooltip content={r.siteName}>
                          <Button size="xs" variant="dark" onClick={() => navigate(`/workforce/projects/pr-${r.siteId.slice(2)}/schedule`)}>
                            {t("drill.noShows.replace")}
                          </Button>
                        </Tooltip>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DialogContent>
    </Dialog>
  );
}
