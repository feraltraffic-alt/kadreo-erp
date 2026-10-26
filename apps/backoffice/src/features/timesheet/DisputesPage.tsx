import type { TimesheetDispute } from "@kadreo/domain";
import { useI18n } from "@kadreo/i18n";
import { Badge, Card, EmptyState, ErrorState, Segmented, Skeleton, type Tone } from "@kadreo/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router";
import { api } from "../../app/session";
import { useFormat } from "../../lib/format";
import { PageHeader } from "../../shell/Layout";

export const disputeTone: Record<TimesheetDispute["status"], Tone> = { open: "critical", agreed: "ok", rejected: "neutral" };

/** Client disputes across timesheets (12.2; list designed in the audit). URL: /timesheets/disputes?status=all */
export function DisputesPage() {
  const { t, hours } = useI18n();
  const { positionName, disputeReasonName, weekdayShort, dayMonth, dateTime } = useFormat();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") === "all" ? "all" : "open";
  const q = useQuery({ queryKey: ["disputes", status], queryFn: () => api.disputes({ status }) });
  const openCount = useQuery({ queryKey: ["disputes", "open"], queryFn: () => api.disputes({ status: "open" }) }).data?.length ?? 0;

  return (
    <div>
      <PageHeader crumbs={[{ label: t("nav.timesheets"), to: "/timesheets" }, { label: t("dsp.title") }]} title={t("dsp.title")} meta={<span className="text-[14px] text-muted">{t("dsp.subtitle")}</span>} />
      <Segmented
        className="mb-4"
        ariaLabel={t("dsp.title")}
        value={status}
        onChange={(v) => setParams(v === "all" ? { status: "all" } : {}, { replace: true })}
        options={[
          { value: "open", label: t("dsp.filter.open", { n: openCount }) },
          { value: "all", label: t("dsp.filter.all") },
        ]}
      />
      <Card className="overflow-x-auto px-2 py-2">
        {q.isError ? (
          <ErrorState message={t("common.loadError")} retryLabel={t("common.retry")} onRetry={() => void q.refetch()} />
        ) : q.isLoading ? (
          <div className="flex flex-col gap-2 p-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>
        ) : !q.data?.length ? (
          <EmptyState title={t(status === "open" ? "dsp.empty" : "dsp.emptyAll")} className="py-14" />
        ) : (
          <table className="w-full min-w-[980px] text-[14px]">
            <thead>
              <tr className="text-left text-[12px] font-semibold tracking-wide text-muted uppercase">
                {["site", "worker", "day", "hours", "reason", "status"].map((c) => (
                  <th key={c} className="border-b border-border px-3 py-3">
                    {t(`dsp.col.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {q.data.map((x) => {
                const open = () => navigate(`/timesheets/projects/${x.projectId}?from=${x.from}&to=${x.to}&cell=${encodeURIComponent(`${x.rowId}|${x.date}`)}`);
                const d = x.dispute;
                return (
                  <tr key={d.id} onClick={open} className="cursor-pointer border-b border-divider align-top last:border-0 hover:bg-bg">
                    <td className="px-3 py-3.5">
                      <div className="font-semibold">{x.siteName}</div>
                      <div className="text-[12px] text-muted">{x.clientName}</div>
                    </td>
                    <td className="px-3 py-3.5">
                      <button type="button" className="text-left font-semibold hover:underline" onClick={open}>
                        {x.worker.firstName} {x.worker.lastName}
                      </button>
                      <div className="text-[12px] text-muted">{positionName(x.positionId)}</div>
                    </td>
                    <td className="px-3 py-3.5 whitespace-nowrap tabular">
                      {weekdayShort(x.date)} {dayMonth(x.date)}
                    </td>
                    <td className="px-3 py-3.5 whitespace-nowrap tabular">
                      <span className="font-semibold">{hours(x.billableHours)}</span>
                      <span className="text-muted"> → </span>
                      <span className="font-semibold text-critical-text">{d.clientHours === undefined ? t("dsp.noHours") : hours(d.clientHours)}</span>
                    </td>
                    <td className="max-w-[360px] px-3 py-3.5">
                      <div className="font-semibold">{disputeReasonName(d.reasonId)}</div>
                      <div className="mt-0.5 line-clamp-2 text-[13px] text-muted">{d.comment}</div>
                      <div className="mt-1 text-[12px] text-muted">{t("dsp.panel.by", { name: d.createdByName, date: dateTime(d.createdAt) })}</div>
                    </td>
                    <td className="px-3 py-3.5">
                      <Badge tone={disputeTone[d.status]}>{t(`dsp.status.${d.status}`)}</Badge>
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
