import { useI18n } from "@kadreo/i18n";
import { Badge, Card, ErrorState, Skeleton, type Tone } from "@kadreo/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api } from "../../app/session";
import { useFormat } from "../../lib/format";
import { PageHeader } from "../../shell/Layout";

/** List of timesheets (menu entry; not specified in the spec — proposed design from the audit). */
export function TimesheetListPage() {
  const { t, hours, date } = useI18n();
  const { dayMonth, fullDate } = useFormat();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["timesheets"], queryFn: () => api.timesheets() });

  const stage = (s: NonNullable<typeof q.data>[number]): { label: string; tone: Tone } => {
    const ts = s.timesheet;
    if (ts.clientStage.kind === "not_sent") return ts.managerConfirmed ? { label: t("ts.stage3.not_sent"), tone: "neutral" } : { label: t("tsList.stage.manager"), tone: "accent" };
    if (ts.clientStage.kind === "waiting") return { label: t("ts.stage3.waiting", { date: date(ts.clientStage.until, { day: "2-digit", month: "2-digit", timeZone: "Europe/Warsaw" }) }), tone: "warn" };
    if (ts.clientStage.kind === "disputed") return { label: t("ts.stage3.disputed", { n: ts.clientStage.rows }), tone: "critical" };
    return { label: t(`ts.stage3.${ts.clientStage.kind}`), tone: "ok" };
  };

  return (
    <div>
      <PageHeader title={t("tsList.title")} meta={<span className="text-[14px] text-muted">{t("tsList.subtitle")}</span>} />
      <Card className="overflow-x-auto px-2 py-2">
        {q.isError ? (
          <ErrorState message={t("common.loadError")} retryLabel={t("common.retry")} onRetry={() => void q.refetch()} />
        ) : q.isLoading ? (
          <div className="flex flex-col gap-2 p-3">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : (
          <table className="w-full min-w-[860px] text-[14px]">
            <thead>
              <tr className="text-left text-[12px] font-semibold tracking-wide text-muted uppercase">
                {["site", "period", "hours", "issues", "stage"].map((c) => (
                  <th key={c} className="border-b border-border px-3 py-3">
                    {t(`tsList.col.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...(q.data ?? [])]
                .sort((a, b) => b.issues - a.issues)
                .map((s) => {
                  const st = stage(s);
                  const open = () => navigate(`/timesheets/projects/${s.projectId}?from=${s.from}&to=${s.to}`);
                  return (
                    <tr key={s.id} onClick={open} className="cursor-pointer border-b border-divider last:border-0 hover:bg-bg">
                      <td className="px-3 py-3.5">
                        <button type="button" className="text-left font-semibold hover:underline" onClick={open}>
                          {s.siteName}
                        </button>
                        <div className="text-[12px] text-muted">{s.clientName}</div>
                      </td>
                      <td className="px-3 py-3.5 tabular">
                        {dayMonth(s.from)} – {fullDate(s.to)}
                      </td>
                      <td className="px-3 py-3.5 tabular">
                        <span className="font-semibold">{hours(s.payableHours)}</span> <span className="text-muted">/ {hours(s.plannedHours)}</span>
                      </td>
                      <td className="px-3 py-3.5">{s.issues ? <Badge tone="warn">{t("tsList.issues", { n: s.issues })}</Badge> : <span className="text-muted">{t("tsList.issues", { n: 0 })}</span>}</td>
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
