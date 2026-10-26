import { DEMO_TODAY, type CandidateView, type ScheduleRow } from "@kadreo/domain";
import { useI18n } from "@kadreo/i18n";
import { Avatar, Button, Card, Checkbox, cn, EmptyState, ErrorState, initialsOf, Input, Popover, PopoverContent, PopoverTrigger, Skeleton, Tag, useToast } from "@kadreo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { api, useSession } from "../../app/session";
import { useFormat } from "../../lib/format";
import { useViolationText } from "./violations";

export interface SelectedCell {
  row: ScheduleRow;
  date: string;
}

/** «Рекомендации AI» side panel (9.1-13…18). Candidates can also be dragged onto any cell. */
export function CandidatesPanel({ selected, projectId }: { selected: SelectedCell | null; projectId: string }) {
  const { t } = useI18n();
  const { positionName, weekdayShort, dayMonth, competenceName } = useFormat();
  const { can } = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const violationText = useViolationText();
  const [filters, setFilters] = useState<{ maxKm?: number; experiencedOnly?: boolean; noOvertime?: boolean }>({});

  const cell = selected ? selected.row.cells.find((c) => c.date === selected.date) : undefined;
  const past = !!selected && selected.date < DEMO_TODAY;
  const candidates = useQuery({
    queryKey: ["candidates", selected?.row.templateId, selected?.date, filters],
    queryFn: () => api.candidates(selected!.row.templateId, selected!.date, filters),
    enabled: !!selected && !!cell && cell.planned !== null && !past,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["schedule", projectId] });
    void qc.invalidateQueries({ queryKey: ["candidates"] });
    void qc.invalidateQueries({ queryKey: ["cellAssignments"] });
  };

  const assign = useMutation({
    mutationFn: (c: CandidateView) => api.assign({ workerId: c.workerId, templateId: selected!.row.templateId, date: selected!.date }),
    onSuccess: (_a, c) => {
      toast.push({ tone: "ok", text: t("assign.done", { name: `${c.firstName} ${c.lastName}`, date: dayMonth(selected!.date) }) });
      invalidate();
    },
    onError: (e) => toast.push({ tone: "critical", text: violationText(e, selected!.date) }),
  });

  const shortage = cell && cell.planned !== null ? Math.max(0, cell.planned - cell.assigned) : 0;
  const assignBest = useMutation({
    mutationFn: async () => {
      const top = (candidates.data ?? []).slice(0, shortage);
      let ok = 0;
      for (const c of top) {
        await api.assign({ workerId: c.workerId, templateId: selected!.row.templateId, date: selected!.date, source: "ai" });
        ok++;
      }
      return ok;
    },
    onSuccess: (n) => {
      toast.push({ tone: "ok", text: t("assign.bestDone", { n }) });
      invalidate();
    },
    onError: (e) => {
      toast.push({ tone: "critical", text: violationText(e, selected!.date) });
      invalidate();
    },
  });

  return (
    <Card className="sticky top-[94px] flex max-h-[calc(100vh-118px)] w-full flex-col overflow-hidden">
      {!selected || !cell ? (
        <div className="px-5 py-6">
          <div className="text-[12px] font-bold tracking-[0.08em] text-accent-strong uppercase">{t("panel.kicker")}</div>
          <EmptyState title={t("panel.empty")} className="py-12" />
        </div>
      ) : (
        <>
          <div className="px-5 pt-5">
            <div className="text-[12px] font-bold tracking-[0.08em] text-accent-strong uppercase">{t("panel.kicker")}</div>
            <h2 className="mt-1 text-[18px] leading-snug font-bold">
              {weekdayShort(selected.date)} {dayMonth(selected.date)} · {positionName(selected.row.positionId)} · {selected.row.start}–{selected.row.end}
            </h2>
            <p className="mt-1 text-[14px] text-muted">
              {cell.planned === null ? t("panel.noShift") : shortage > 0 ? t("panel.shortage", { x: cell.assigned, y: cell.planned, n: shortage }) : t("panel.full", { x: cell.assigned, y: cell.planned })}
            </p>
            {cell.planned !== null && !past && (
              <div className="mt-4 flex gap-2">
                {shortage > 0 && can("shift.schedule.edit") && (
                  <Button variant="primary" className="flex-1" loading={assignBest.isPending} disabled={!candidates.data?.length} onClick={() => assignBest.mutate()}>
                    {t("panel.assignBest", { n: Math.min(shortage, candidates.data?.length ?? shortage) })}
                  </Button>
                )}
                <FiltersPopover value={filters} onChange={setFilters} />
              </div>
            )}
          </div>
          <div className="mt-4 flex-1 overflow-y-auto px-5 pb-4">
            {past ? (
              <EmptyState title={t("panel.past")} />
            ) : cell.planned === null ? null : candidates.isError ? (
              <ErrorState message={t("common.loadError")} retryLabel={t("common.retry")} onRetry={() => void candidates.refetch()} />
            ) : candidates.isLoading ? (
              <div className="flex flex-col gap-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[92px] rounded-[12px]" />)}</div>
            ) : !candidates.data?.length ? (
              <EmptyState title={t("panel.noCandidates")} />
            ) : (
              <ul className="flex flex-col gap-3">
                {candidates.data.map((c) => (
                  <li
                    key={c.workerId}
                    draggable={can("shift.schedule.edit")}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("application/x-kadreo-worker", JSON.stringify({ workerId: c.workerId, name: `${c.firstName} ${c.lastName}` }));
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    className="flex gap-3 rounded-[12px] border border-border bg-surface p-3.5 transition-shadow hover:shadow-card"
                  >
                    <Avatar initials={initialsOf(c.firstName, c.lastName)} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[14px] leading-tight font-semibold">
                          {c.firstName} {c.lastName}
                        </span>
                        <span className={cn("text-[15px] font-extrabold tabular", c.score >= 90 ? "text-accent-strong" : "text-ink")} title={t("panel.score", { score: c.score })}>
                          {c.score}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {c.tags.map((tag, i) => {
                          if (tag.kind === "shifts_here") return <Tag key={i} tone="ok">{t("tag.shiftsHere", { n: tag.count })}</Tag>;
                          if (tag.kind === "distance_km") return <Tag key={i}>{t("common.km", { km: tag.km })}</Tag>;
                          if (tag.kind === "competence") return <Tag key={i} tone="ok">{competenceName(tag.competenceId)}</Tag>;
                          if (tag.kind === "prefers_morning") return <Tag key={i} tone="ok">{t("tag.prefersMorning")}</Tag>;
                          return <Tag key={i}>{t("tag.docUntil", { doc: t(`doc.${tag.docType}`), date: tag.validTo.slice(5, 7) + "." + tag.validTo.slice(0, 4) })}</Tag>;
                        })}
                        {c.warnings.map((w, i) => (
                          <Tag key={`w${i}`} tone="warn">
                            {w.kind === "near_hour_limit" ? t("warn.nearLimit", { used: w.used, limit: w.limit }) : w.kind === "first_on_site" ? t("warn.firstOnSite") : t("warn.newcomer")}
                          </Tag>
                        ))}
                      </div>
                    </div>
                    {can("shift.schedule.edit") && (
                      <Button
                        size="icon-sm"
                        aria-label={t("panel.assign", { name: `${c.firstName} ${c.lastName}` })}
                        loading={assign.isPending && assign.variables?.workerId === c.workerId}
                        onClick={() => assign.mutate(c)}
                        className="shrink-0"
                      >
                        {!(assign.isPending && assign.variables?.workerId === c.workerId) && <Plus className="size-4" />}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-[12px] leading-relaxed text-muted">{t("panel.footnote")}</p>
          </div>
        </>
      )}
    </Card>
  );
}

function FiltersPopover({ value, onChange }: { value: { maxKm?: number; experiencedOnly?: boolean; noOvertime?: boolean }; onChange: (v: { maxKm?: number; experiencedOnly?: boolean; noOvertime?: boolean }) => void }) {
  const { t } = useI18n();
  const active = !!(value.maxKm || value.experiencedOnly || value.noOvertime);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button className={cn(active && "border-accent-strong")} icon={<SlidersHorizontal className="size-4" />}>
          {t("panel.filters")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="flex flex-col gap-3 text-[14px]">
          <label className="flex items-center justify-between gap-3">
            {t("panel.filters.maxKm")}
            <Input type="number" min={1} max={200} value={value.maxKm ?? ""} onChange={(e) => onChange({ ...value, maxKm: e.target.value ? Number(e.target.value) : undefined })} className="h-9 w-20" />
          </label>
          <label className="flex items-center gap-2.5">
            <Checkbox checked={!!value.experiencedOnly} onCheckedChange={(c) => onChange({ ...value, experiencedOnly: c === true })} />
            {t("panel.filters.experienced")}
          </label>
          <label className="flex items-center gap-2.5">
            <Checkbox checked={!!value.noOvertime} onCheckedChange={(c) => onChange({ ...value, noOvertime: c === true })} />
            {t("panel.filters.noOvertime")}
          </label>
          <Button size="sm" variant="ghost" className="self-start" onClick={() => onChange({})}>
            {t("common.reset")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
