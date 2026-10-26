import type { AutoAssignProposal, AutoAssignRequest, ScheduleResponse } from "@kadreo/domain";
import { DEMO_TODAY } from "@kadreo/domain";
import { useI18n } from "@kadreo/i18n";
import { Button, cn, Dialog, DialogContent, DialogFooter, ProgressBar, Segmented, Tag, useToast } from "@kadreo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../app/session";
import { useFormat } from "../../lib/format";
import type { SelectedCell } from "./CandidatesPanel";

type Decision = "pending" | "accepted" | "rejected";

/**
 * AI auto-assignment (9.1-07): scope and mode → background job with progress (≤ 60 s) →
 * preview of proposed assignments per cell. Nothing is saved until proposals are accepted.
 */
export function AutoAssignDialog({ open, onOpenChange, schedule, selected }: { open: boolean; onOpenChange: (v: boolean) => void; schedule: ScheduleResponse; selected: SelectedCell | null }) {
  const { t } = useI18n();
  const { positionName, weekdayShort, dayMonth } = useFormat();
  const toast = useToast();
  const qc = useQueryClient();
  const [scope, setScope] = useState<AutoAssignRequest["scope"]>("week");
  const [mode, setMode] = useState<AutoAssignRequest["mode"]>("empty_only");
  const [days, setDays] = useState<string[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [applying, setApplying] = useState(false);
  const dates = schedule.rows[0]?.cells.map((c) => c.date) ?? [];

  useEffect(() => {
    if (!open) {
      setJobId(null);
      setDecisions({});
      setApplying(false);
    }
  }, [open]);

  const job = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.job(jobId!),
    enabled: !!jobId,
    refetchInterval: (q) => (q.state.data?.status === "running" || !q.state.data ? 400 : false),
  });

  const run = async () => {
    const req: AutoAssignRequest = { scope, mode };
    if (scope === "days") req.dates = days;
    if (scope === "cells" && selected) req.cells = [{ templateId: selected.row.templateId, date: selected.date }];
    const { jobId: id } = await api.startAutoAssign(schedule.project.id, schedule.from, req);
    setJobId(id);
  };

  const key = (p: AutoAssignProposal) => `${p.templateId}|${p.date}`;
  const proposals = job.data?.status === "done" ? job.data.proposals : [];
  const total = proposals.reduce((s, p) => s + p.workerIds.length, 0);

  const apply = async (only?: AutoAssignProposal[]) => {
    setApplying(true);
    let ok = 0;
    for (const p of only ?? proposals.filter((x) => !decisions[key(x)])) {
      for (const workerId of p.workerIds) {
        try {
          await api.assign({ workerId, templateId: p.templateId, date: p.date, source: "ai" });
          ok++;
        } catch {
          /* constraint changed since the preview — skip this one */
        }
      }
      setDecisions((d) => ({ ...d, [key(p)]: "accepted" }));
    }
    setApplying(false);
    void qc.invalidateQueries({ queryKey: ["schedule", schedule.project.id] });
    void qc.invalidateQueries({ queryKey: ["candidates"] });
    toast.push({ tone: "ok", text: t("auto.applied", { n: ok }) });
    if (!only) onOpenChange(false);
  };

  const rowOf = (templateId: string) => schedule.rows.find((r) => r.templateId === templateId)!;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("auto.title")} description={t("auto.note")} closeLabel={t("common.close")} width={680}>
        {!jobId ? (
          <div className="flex flex-col gap-5">
            <div>
              <div className="mb-2 text-[13px] font-semibold">{t("auto.scope")}</div>
              <Segmented
                value={scope}
                onChange={setScope}
                options={[
                  { value: "week", label: t("auto.scope.week") },
                  { value: "days", label: t("auto.scope.days") },
                  { value: "cells", label: t("auto.scope.cells"), disabled: !selected },
                ]}
              />
              {scope === "days" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {dates.map((d) => (
                    <button
                      key={d}
                      type="button"
                      disabled={d < DEMO_TODAY}
                      aria-pressed={days.includes(d)}
                      onClick={() => setDays((xs) => (xs.includes(d) ? xs.filter((x) => x !== d) : [...xs, d]))}
                      className={cn(
                        "h-9 rounded-control border px-3 text-[13px] font-semibold disabled:opacity-40",
                        days.includes(d) ? "border-2 border-accent bg-accent-soft text-accent-ink" : "border-input bg-surface",
                      )}
                    >
                      {weekdayShort(d)} {dayMonth(d)}
                    </button>
                  ))}
                </div>
              )}
              {scope === "cells" && selected && (
                <p className="mt-2 text-[13px] text-muted">
                  {positionName(selected.row.positionId)} {selected.row.start}–{selected.row.end} · {weekdayShort(selected.date)} {dayMonth(selected.date)}
                </p>
              )}
            </div>
            <div>
              <div className="mb-2 text-[13px] font-semibold">{t("auto.mode")}</div>
              <div className="flex flex-col gap-2">
                {(["empty_only", "rebuild_proposed"] as const).map((m) => (
                  <label key={m} className={cn("flex cursor-pointer items-center gap-3 rounded-control border px-3.5 py-3 text-[14px]", mode === m ? "border-2 border-accent bg-accent-soft/50" : "border-input")}>
                    <input type="radio" name="auto-mode" className="accent-[var(--color-accent-strong)]" checked={mode === m} onChange={() => setMode(m)} />
                    {t(`auto.mode.${m}`)}
                  </label>
                ))}
              </div>
            </div>
            <p className="text-[13px] text-muted">{t("auto.past")}</p>
            <DialogFooter className="mt-0">
              <Button onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
              <Button variant="primary" icon={<Sparkles className="size-4" />} disabled={scope === "days" && days.length === 0} onClick={() => void run()}>
                {t("auto.run")}
              </Button>
            </DialogFooter>
          </div>
        ) : job.data?.status !== "done" ? (
          <div className="flex flex-col gap-4 py-6">
            <p className="text-[14px] text-muted">{t("auto.running")}</p>
            <ProgressBar value={job.data?.progress ?? 0.05} />
          </div>
        ) : total === 0 ? (
          <div className="flex flex-col gap-4">
            <p className="text-[14px]">{t("auto.nothing")}</p>
            <DialogFooter>
              <Button variant="primary" onClick={() => onOpenChange(false)}>
                {t("common.close")}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-[14px] font-semibold">{t("auto.result", { n: total, m: job.data.unfilled })}</p>
            <ul className="flex max-h-[360px] flex-col gap-2 overflow-y-auto">
              {proposals.map((p) => {
                const r = rowOf(p.templateId);
                const d = decisions[key(p)] ?? "pending";
                return (
                  <li key={key(p)} className={cn("flex items-center gap-3 rounded-control border border-border px-3.5 py-2.5", d === "rejected" && "opacity-50")}>
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-semibold">
                        {weekdayShort(p.date)} {dayMonth(p.date)} · {positionName(r.positionId)} {r.start}–{r.end}
                      </div>
                      <div className="text-[13px] text-muted">+{p.workerIds.length}</div>
                    </div>
                    {d === "pending" ? (
                      <div className="flex gap-1.5">
                        <Button size="xs" variant="secondary" icon={<X className="size-3.5" />} onClick={() => setDecisions((x) => ({ ...x, [key(p)]: "rejected" }))}>
                          {t("auto.reject")}
                        </Button>
                        <Button size="xs" variant="dark" icon={<Check className="size-3.5" />} disabled={applying} onClick={() => void apply([p])}>
                          {t("auto.accept")}
                        </Button>
                      </div>
                    ) : (
                      <Tag tone={d === "accepted" ? "ok" : "neutral"}>{d === "accepted" ? t("auto.accepted") : t("auto.rejected")}</Tag>
                    )}
                  </li>
                );
              })}
            </ul>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>{t("common.close")}</Button>
              <Button variant="primary" loading={applying} disabled={proposals.every((p) => decisions[key(p)])} onClick={() => void apply()}>
                {t("auto.acceptAll")}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
