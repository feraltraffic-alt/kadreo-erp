import type { TimesheetClientStage } from "@kadreo/domain";
import { useI18n } from "@kadreo/i18n";
import { Badge, Card, EmptyState, ErrorState, Skeleton, type Tone } from "@kadreo/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api } from "../app/session";
import { useFormat } from "../lib/format";
import { PageHeader } from "../shell/PortalLayout";

export function useStage() {
  const { t } = useI18n();
  const { dateTime } = useFormat();
  return (s: TimesheetClientStage): { label: string; tone: Tone } => {
    if (s.kind === "waiting") return { label: t("stage.waiting", { date: dateTime(s.until) }), tone: "warn" };
    if (s.kind === "disputed") return { label: t("stage.disputed", { n: s.rows }), tone: "critical" };
    return { label: t(`stage.${s.kind}`), tone: s.kind === "not_sent" ? "neutral" : "ok" };
  };
}

/** Timesheets sent to the client (section «Часы на подтверждение»). URL: /timesheets */
export function TimesheetsPage() {
  const { t, hours } = useI18n();
  const { dayMonth, fullDate } = useFormat();
  const stage = useStage();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["timesheets"], queryFn: () => api.timesheets() });

  return (
    <div>
      <PageHeader title={t("pts.title")} meta={<span className="text-[14px] text-muted">{t("pts.sub")}</span>} />
      <Card className="overflow-x-auto px-2 py-2">
        {q.isError ? (
          <ErrorState message={t("common.loadError")} retryLabel={t("common.retry")} onRetry={() => void q.refetch()} />
        ) : !q.data ? (
          <div className="flex flex-col gap-2 p-3">{[0, 1].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : q.data.length === 0 ? (
          <EmptyState title={t("pts.empty")} className="py-14" />
        ) : (
          <table className="w-full min-w-[760px] text-[14px]">
            <thead>
              <tr className="text-left text-[12px] font-semibold tracking-wide text-muted uppercase">
                {["site", "period", "hours", "workers", "status"].map((c) => (
                  <th key={c} className="border-b border-border px-3 py-3">
                    {t(`pts.col.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {q.data.map((s) => {
                const st = stage(s.stage);
                const open = () => navigate(`/timesheets/${s.id}`);
                return (
                  <tr key={s.id} onClick={open} className="cursor-pointer border-b border-divider last:border-0 hover:bg-bg">
                    <td className="px-3 py-3.5">
                      <button type="button" className="font-semibold hover:underline" onClick={open}>
                        {s.siteName}
                      </button>
                    </td>
                    <td className="px-3 py-3.5 tabular">
                      {dayMonth(s.from)} – {fullDate(s.to)}
                    </td>
                    <td className="px-3 py-3.5 font-semibold tabular">{hours(s.billableHours)}</td>
                    <td className="px-3 py-3.5 tabular">{s.workers}</td>
                    <td className="px-3 py-3.5">
                      <Badge tone={st.tone}>{st.label}</Badge>
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
