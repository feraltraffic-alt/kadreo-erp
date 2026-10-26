import type { Alert } from "@kadreo/domain";
import { isoWeekToken } from "@kadreo/domain";
import { useI18n, useLocalized } from "@kadreo/i18n";
import { Button, Card, cn, EmptyState, ErrorState, Skeleton, useToast } from "@kadreo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { api, useSession } from "../../app/session";
import { useFormat } from "../../lib/format";

type BadgeKind = "critical" | "sla" | "anomaly" | "document" | "warning" | "info";

function badgeOf(a: Alert): BadgeKind {
  if (a.severity === "critical") return "critical";
  if (a.kind === "sla") return "sla";
  if (a.kind === "anomaly") return "anomaly";
  if (a.kind === "document") return "document";
  return a.severity === "warning" ? "warning" : "info";
}

const cardTone: Record<BadgeKind, string> = {
  critical: "bg-critical-bg",
  sla: "bg-warn-bg",
  anomaly: "bg-bg",
  document: "bg-critical-bg/60",
  warning: "bg-warn-bg/60",
  info: "bg-bg",
};
const badgeTone: Record<BadgeKind, string> = {
  critical: "bg-critical text-white",
  sla: "bg-warn text-ink",
  anomaly: "bg-accent-soft text-accent-ink",
  document: "bg-critical-bg text-critical-text ring-1 ring-critical/30",
  warning: "bg-warn-bg text-warn-text ring-1 ring-warn/40",
  info: "bg-neutral-bg text-neutral-text",
};

/** «Алерты» block of the dashboard (11.1-13…15): top 5 by severity, then by time. */
export function AlertsBlock({ siteFilter }: { siteFilter: (siteId: string) => boolean }) {
  const { t } = useI18n();
  const loc = useLocalized();
  const { until } = useFormat();
  const { can } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["alerts", "open"], queryFn: () => api.alerts({ status: "open" }), refetchInterval: 30_000 });
  const take = useMutation({
    mutationFn: (id: string) => api.takeAlert(id),
    onSuccess: () => {
      toast.push({ tone: "ok", text: t("alerts.takenToast") });
      void qc.invalidateQueries({ queryKey: ["alerts"] });
    },
    onError: () => toast.push({ tone: "critical", text: t("common.saveError") }),
  });
  const list = (q.data ?? []).filter((a) => siteFilter(a.siteId)).slice(0, 5);

  return (
    <Card className="flex flex-col">
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <h2 className="text-[17px] font-bold">{t("alerts.title")}</h2>
        <Link to="/alerts" className="text-[13px] font-semibold text-accent-strong hover:underline">
          {t("alerts.all")}
        </Link>
      </div>
      <div className="flex flex-col gap-3 px-5 pb-5">
        {q.isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-[12px]" />)}
        {q.isError && <ErrorState message={t("common.loadError")} retryLabel={t("common.retry")} onRetry={() => void q.refetch()} />}
        {q.isSuccess && list.length === 0 && <EmptyState title={t("alerts.empty")} />}
        {list.map((a) => {
          const kind = badgeOf(a);
          const context = [loc(a.context)];
          if (a.nextEscalationAt && a.status === "open") context.push(t("alerts.escalation", { level: a.escalationLevel + 1, time: until(a.nextEscalationAt) }));
          if (a.slaDueAt) context.push(t("alerts.slaIn", { time: until(a.slaDueAt) }));
          return (
            <article key={a.id} className={cn("rounded-[12px] p-4", cardTone[kind])}>
              <div className="flex items-start gap-3">
                <span className={cn("mt-0.5 shrink-0 rounded-[6px] px-1.5 py-0.5 text-[11px] font-bold tracking-wide", badgeTone[kind])}>{t(`alerts.badge.${kind}`)}</span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[14px] leading-snug font-semibold">{loc(a.title)}</h3>
                  <p className="mt-1 text-[13px] text-muted">{context.join(" · ")}</p>
                  {a.status === "taken" && a.takenByName && <p className="mt-1 text-[13px] font-semibold text-ink">{t("alerts.taken", { name: a.takenByName })}</p>}
                  {a.kind === "understaffed" && a.status === "open" && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {a.shiftRef && can("shift.schedule.edit") && (
                        <Button
                          size="sm"
                          variant="dark"
                          onClick={() => navigate(`/workforce/projects/${a.shiftRef!.projectId}/schedule?week=${isoWeekToken(a.shiftRef!.date)}&cell=${a.shiftRef!.templateId}|${a.shiftRef!.date}`)}
                        >
                          {t("alerts.pickReplacement")}
                        </Button>
                      )}
                      {can("alert.take") && (
                        <Button size="sm" loading={take.isPending && take.variables === a.id} onClick={() => take.mutate(a.id)}>
                          {t("alerts.take")}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </Card>
  );
}
