import { addDays, DEMO_TODAY, isoWeek, isoWeekToken, mondayOf } from "@kadreo/domain";
import { useI18n } from "@kadreo/i18n";
import { Card, ErrorState, Input, ProgressBar, Skeleton } from "@kadreo/ui";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../../app/session";
import { useFormat } from "../../lib/format";
import { PageHeader } from "../../shell/Layout";

/**
 * Entry to shift planning from the menu: projects in the user's scope with this week's fill.
 * Not specified in the spec (audit: «Выбор проекта для планирования») — proposed design.
 */
export function ProjectsPage() {
  const { t } = useI18n();
  const { dayMonth } = useFormat();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const monday = mondayOf(DEMO_TODAY);
  const list = useQuery({ queryKey: ["projects", monday], queryFn: () => api.projects(monday) });
  const rows = useMemo(
    () =>
      (list.data ?? [])
        .filter((p) => `${p.site.name} ${p.client.shortName}`.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => a.filledThisWeek / Math.max(1, a.totalThisWeek) - b.filledThisWeek / Math.max(1, b.totalThisWeek)),
    [list.data, q],
  );

  return (
    <div>
      <PageHeader
        title={t("projects.title")}
        meta={<span className="text-[14px] text-muted">{t("projects.subtitle", { week: isoWeek(monday).week, from: dayMonth(monday), to: dayMonth(addDays(monday, 6)) })}</span>}
        actions={
          <div className="relative w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("projects.search")} className="pl-9" aria-label={t("projects.search")} />
          </div>
        }
      />
      <Card className="overflow-x-auto px-2 py-2">
        {list.isError ? (
          <ErrorState message={t("common.loadError")} retryLabel={t("common.retry")} onRetry={() => void list.refetch()} />
        ) : list.isLoading ? (
          <div className="flex flex-col gap-2 p-3">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-muted">{t("projects.empty")}</p>
        ) : (
          <table className="w-full min-w-[760px] text-[14px]">
            <thead>
              <tr className="text-left text-[12px] font-semibold tracking-wide text-muted uppercase">
                <th className="border-b border-border px-3 py-3">{t("projects.col.site")}</th>
                <th className="border-b border-border px-3 py-3">{t("projects.col.client")}</th>
                <th className="border-b border-border px-3 py-3">{t("projects.col.manager")}</th>
                <th className="border-b border-border px-3 py-3">{t("projects.col.fill")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const ratio = p.totalThisWeek ? p.filledThisWeek / p.totalThisWeek : 1;
                const tone = ratio >= 1 ? "ok" : ratio >= 0.8 ? "warn" : "critical";
                const open = () => navigate(`/workforce/projects/${p.project.id}/schedule?week=${isoWeekToken(monday)}`);
                return (
                  <tr key={p.project.id} onClick={open} className="cursor-pointer border-b border-divider last:border-0 hover:bg-bg">
                    <td className="px-3 py-3.5 font-semibold">
                      <button type="button" className="text-left hover:underline" onClick={open}>
                        {p.site.name}
                      </button>
                    </td>
                    <td className="px-3 py-3.5 text-muted">{p.client.shortName}</td>
                    <td className="px-3 py-3.5">{p.project.managerName}</td>
                    <td className="px-3 py-3.5">
                      <div className="flex items-center gap-3">
                        <ProgressBar value={ratio} tone={tone} className="w-40" />
                        <span className="tabular text-muted">
                          {p.filledThisWeek} / {p.totalThisWeek} · {Math.floor(ratio * 100)}%
                        </span>
                      </div>
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
