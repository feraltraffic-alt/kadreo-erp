import { useI18n } from "@kadreo/i18n";
import { Badge, Button, Card, cn, ErrorState, ProgressBar, Skeleton, type Tone } from "@kadreo/ui";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { api, useSession } from "../app/session";
import { useFormat } from "../lib/format";
import { PageHeader } from "../shell/PortalLayout";

const statusTone: Record<string, Tone> = { ok: "ok", deviation: "warn", critical: "critical" };

/** Portal overview (section «Обзор» of 12; designed in the audit): today, requests, hours to confirm, KPI. */
export function OverviewPage() {
  const { t, num } = useI18n();
  const { user, can } = useSession();
  const { dayMonth, fullDate, dateTime } = useFormat();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["overview"], queryFn: () => api.overview() });

  if (q.isError) return <ErrorState message={t("common.loadError")} retryLabel={t("common.retry")} onRetry={() => void q.refetch()} />;
  const o = q.data;

  return (
    <div>
      <PageHeader
        title={t("ov.title")}
        meta={<span className="text-[14px] text-muted">{user.client.name}</span>}
        actions={
          can("staffrequest.create") ? (
            <Button variant="primary" onClick={() => navigate("/requests/new")}>
              {t("ov.newRequest")}
            </Button>
          ) : undefined
        }
      />
      {!o ? (
        <div className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[132px] rounded-card" />)}</div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Tile label={t("ov.now")}>
              <div className="flex items-baseline gap-2">
                <span className="text-[34px] leading-none font-extrabold tabular">{o.onShiftNow}</span>
                <span className="text-[15px] text-muted">{t("ov.of", { n: o.plannedNow })}</span>
              </div>
              <ProgressBar className="mt-4" value={o.plannedNow ? o.onShiftNow / o.plannedNow : 0} tone={o.onShiftNow >= o.plannedNow ? "ok" : "accent"} />
            </Tile>
            <Tile label={t("ov.requests")} onClick={() => navigate("/requests")}>
              <div className="text-[18px] font-bold">{t("ov.requests.value", { n: o.requestsNew, m: o.requestsInProgress })}</div>
            </Tile>
            <Tile label={t("ov.timesheets")} highlight={o.timesheetsToConfirm > 0} onClick={() => navigate("/timesheets")}>
              <div className="text-[18px] font-bold">{t("ov.timesheets.value", { n: o.timesheetsToConfirm })}</div>
              <div className={cn("mt-1.5 text-[13px]", o.nearestDeadline ? "font-semibold text-warn-text" : "text-muted")}>
                {o.nearestDeadline ? t("ov.deadline", { date: dateTime(o.nearestDeadline) }) : t("ov.noDeadline")}
              </div>
            </Tile>
          </div>

          <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <Card className="overflow-x-auto px-2 py-2">
              <h2 className="px-3 pt-3 pb-1 text-[16px] font-bold">{t("ov.sites")}</h2>
              <table className="w-full min-w-[520px] text-[14px]">
                <thead>
                  <tr className="text-left text-[12px] font-semibold tracking-wide text-muted uppercase">
                    {["site", "shift", "now", "status"].map((c) => (
                      <th key={c} className="border-b border-border px-3 py-3">
                        {t(`ov.col.${c}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {o.sites.map((s) => (
                    <tr key={s.siteId} className="border-b border-divider last:border-0">
                      <td className="px-3 py-3.5 font-semibold">{s.siteName}</td>
                      <td className="px-3 py-3.5 text-muted tabular">{s.shiftLabel}</td>
                      <td className="px-3 py-3.5 font-semibold tabular">
                        {s.actual} <span className="font-normal text-muted">/ {s.planned}</span>
                      </td>
                      <td className="px-3 py-3.5">
                        <Badge tone={statusTone[s.status]}>{t(`ov.status.${s.status}`)}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card className="p-6">
              <h2 className="text-[16px] font-bold">{t("ov.kpi", { from: dayMonth(o.kpi.from), to: fullDate(o.kpi.to) })}</h2>
              <Kpi
                label={t("ov.kpi.staffing")}
                value={`${num(o.kpi.staffingPct, { maximumFractionDigits: 1 })}%`}
                target={t("ov.kpi.target", { v: o.kpi.staffingTarget })}
                ok={o.kpi.staffingPct >= o.kpi.staffingTarget}
                progress={o.kpi.staffingPct / 100}
              />
              <Kpi
                label={t("ov.kpi.disputed")}
                value={`${num(o.kpi.disputedPct, { maximumFractionDigits: 1 })}%`}
                target={t("ov.kpi.targetMax", { v: o.kpi.disputedTarget })}
                ok={o.kpi.disputedPct <= o.kpi.disputedTarget}
              />
              {o.timesheetsToConfirm > 0 && (
                <Button variant="accent-outline" className="mt-6 w-full gap-2" onClick={() => navigate("/timesheets")}>
                  {t("ov.checkHours")}
                  <ArrowRight className="size-4" />
                </Button>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Tile({ label, children, onClick, highlight }: { label: string; children: ReactNode; onClick?: () => void; highlight?: boolean }) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "rounded-card border bg-surface px-6 py-5 text-left transition-colors",
        highlight ? "border-2 border-accent" : "border-border",
        onClick && "cursor-pointer hover:border-accent-strong",
      )}
    >
      <div className="mb-3 text-[13px] text-muted">{label}</div>
      {children}
    </Comp>
  );
}

function Kpi({ label, value, target, ok, progress }: { label: string; value: string; target: string; ok: boolean; progress?: number }) {
  return (
    <div className="mt-5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[14px]">{label}</span>
        <span className={cn("text-[20px] font-extrabold tabular", ok ? "text-ok-text" : "text-critical-text")}>{value}</span>
      </div>
      {progress !== undefined && <ProgressBar className="mt-2" value={Math.min(1, progress)} tone={ok ? "ok" : "critical"} />}
      <div className="mt-1 text-[12px] text-muted">{target}</div>
    </div>
  );
}
