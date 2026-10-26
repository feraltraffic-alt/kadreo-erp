import type { StaffRequest, StaffRequestStatus } from "@kadreo/domain";
import { useI18n } from "@kadreo/i18n";
import { Badge, Card, cn, EmptyState, ErrorState, ProgressBar, Segmented, Skeleton, type Tone } from "@kadreo/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { api } from "../../app/session";
import { NOW, useFormat } from "../../lib/format";
import { PageHeader } from "../../shell/Layout";

export const requestTone: Record<StaffRequestStatus, Tone> = { draft: "neutral", new: "accent", in_progress: "warn", staffed: "ok", done: "neutral", cancelled: "neutral" };

type Filter = "new" | "in_progress" | "staffed" | "all";

/** Client requests in the back office (12.1 statuses; list designed in the audit). URL: /requests?status= */
export function RequestsPage() {
  const { t } = useI18n();
  const { positionName, dayMonth, fullDate, dateTime } = useFormat();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: ["staffRequests"], queryFn: () => api.staffRequests() });
  const sites = useQuery({ queryKey: ["sitesWithTemplates"], queryFn: () => api.sitesWithTemplates(), staleTime: Infinity });

  const counts = useMemo(() => {
    const c = { new: 0, in_progress: 0, staffed: 0 };
    for (const r of q.data ?? []) if (r.status in c) c[r.status as keyof typeof c]++;
    return c;
  }, [q.data]);
  const filter = (params.get("status") as Filter | null) ?? (counts.new > 0 || !q.data ? "new" : "all");
  const rows = (q.data ?? []).filter((r) => filter === "all" || r.status === filter);
  const siteById = useMemo(() => new Map((sites.data ?? []).map((s) => [s.site.id, s])), [sites.data]);

  return (
    <div>
      <PageHeader title={t("req.title")} meta={<span className="text-[14px] text-muted">{t("req.subtitle")}</span>} />
      <Segmented
        className="mb-4"
        ariaLabel={t("req.title")}
        value={filter}
        onChange={(v) => setParams(v === "all" ? { status: "all" } : { status: v }, { replace: true })}
        options={[
          { value: "new", label: t("req.filter.new", { n: counts.new }) },
          { value: "in_progress", label: t("req.filter.in_progress", { n: counts.in_progress }) },
          { value: "staffed", label: t("req.filter.staffed", { n: counts.staffed }) },
          { value: "all", label: t("req.filter.all") },
        ]}
      />
      <Card className="overflow-x-auto px-2 py-2">
        {q.isError ? (
          <ErrorState message={t("common.loadError")} retryLabel={t("common.retry")} onRetry={() => void q.refetch()} />
        ) : q.isLoading ? (
          <div className="flex flex-col gap-2 p-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState title={t("req.empty")} className="py-14" />
        ) : (
          <table className="w-full min-w-[960px] text-[14px]">
            <thead>
              <tr className="text-left text-[12px] font-semibold tracking-wide text-muted uppercase">
                {["number", "site", "position", "people", "period", "sla", "status"].map((c) => (
                  <th key={c} className="border-b border-border px-3 py-3">
                    {t(`req.col.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const s = siteById.get(r.siteId);
                const shifts = r.templateIds.map((id) => s?.templates.find((x) => x.id === id)).filter(Boolean).map((x) => `${x!.start}–${x!.end}`);
                const open = () => navigate(`/requests/${r.id}`);
                return (
                  <tr key={r.id} onClick={open} className="cursor-pointer border-b border-divider last:border-0 hover:bg-bg">
                    <td className="px-3 py-3.5 font-bold tabular">
                      <button type="button" onClick={open} className="hover:underline">
                        {r.number}
                      </button>
                    </td>
                    <td className="px-3 py-3.5">
                      <div className="font-semibold">{s?.site.name ?? "…"}</div>
                      <div className="text-[12px] text-muted">{r.contactName}</div>
                    </td>
                    <td className="px-3 py-3.5">
                      <div>{positionName(r.positionId)}</div>
                      <div className="text-[12px] text-muted tabular">{shifts.join(", ")}</div>
                    </td>
                    <td className="w-[150px] px-3 py-3.5">
                      <div className="font-semibold tabular">{t("req.people", { x: r.assigned, n: r.headcount })}</div>
                      {r.status !== "new" && r.status !== "draft" && <ProgressBar className="mt-1.5 h-1.5" value={r.assigned / r.headcount} tone={r.assigned >= r.headcount ? "ok" : "accent"} />}
                    </td>
                    <td className="px-3 py-3.5 whitespace-nowrap tabular">
                      {r.from === r.to ? fullDate(r.from) : `${dayMonth(r.from)} – ${fullDate(r.to)}`}
                    </td>
                    <td className="px-3 py-3.5">
                      <SlaCell r={r} dateTime={dateTime} />
                    </td>
                    <td className="px-3 py-3.5">
                      <Badge tone={requestTone[r.status]}>{t(`req.status.${r.status}`)}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

/** Time left to answer a new request, or when an accepted one was answered (12.1-15). */
function SlaCell({ r, dateTime }: { r: StaffRequest; dateTime: (iso: string) => string }) {
  const { t } = useI18n();
  const { until } = useFormat();
  if (r.status === "new") {
    const left = new Date(r.slaDueAt).getTime() - NOW.getTime();
    if (left <= 0) return <Badge tone="critical">{t("req.sla.overdue")}</Badge>;
    return <Badge tone={left < 3600000 ? "critical" : "warn"}>{t("req.sla.left", { d: until(r.slaDueAt) })}</Badge>;
  }
  if (!r.acceptedAt) return <span className="text-muted">—</span>;
  const late = new Date(r.acceptedAt).getTime() > new Date(r.slaDueAt).getTime();
  return <span className={cn("text-[13px]", late ? "text-critical-text" : "text-muted")}>{t(late ? "req.sla.late" : "req.sla.met", { date: dateTime(r.acceptedAt) })}</span>;
}
