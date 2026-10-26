import { useI18n } from "@kadreo/i18n";
import { Avatar, Badge, Button, Dialog, DialogContent, DialogFooter, EmptyState, Field, initialsOf, Input, Skeleton, useToast } from "@kadreo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, useSession } from "../../app/session";
import { useFormat } from "../../lib/format";
import type { SelectedCell } from "./CandidatesPanel";

export type CellAction = { kind: "assigned" | "changePlan" | "cancel"; cell: SelectedCell } | null;

/** Dialogs behind a schedule cell (9.1-11): who is assigned, change the plan, cancel the shift. */
export function CellDialogs({ action, onClose, projectId }: { action: CellAction; onClose: () => void; projectId: string }) {
  const { t } = useI18n();
  const { positionName, dayMonth, weekdayShort } = useFormat();
  const { can } = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const cell = action?.cell;
  const label = cell ? { position: positionName(cell.row.positionId), shift: `${cell.row.start}–${cell.row.end}`, date: `${weekdayShort(cell.date)} ${dayMonth(cell.date)}` } : { position: "", shift: "", date: "" };
  const planned = cell?.row.cells.find((c) => c.date === cell.date)?.planned ?? 0;
  const [plan, setPlan] = useState(planned);
  useEffect(() => setPlan(planned || 1), [planned, action]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["schedule", projectId] });
    void qc.invalidateQueries({ queryKey: ["candidates"] });
    void qc.invalidateQueries({ queryKey: ["cellAssignments"] });
  };

  const assigned = useQuery({
    queryKey: ["cellAssignments", cell?.row.templateId, cell?.date],
    queryFn: () => api.cellAssignments(cell!.row.templateId, cell!.date),
    enabled: action?.kind === "assigned",
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.unassign(id),
    onSuccess: (_r, id) => {
      const w = assigned.data?.find((a) => a.assignment.id === id)?.worker;
      if (w) toast.push({ tone: "ok", text: t("sched.unassigned", { name: `${w.firstName} ${w.lastName}` }) });
      invalidate();
    },
    onError: () => toast.push({ tone: "critical", text: t("common.saveError") }),
  });
  const changePlan = useMutation({
    mutationFn: () => api.changePlan(cell!.row.templateId, cell!.date, plan),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });
  const cancel = useMutation({
    mutationFn: () => api.cancelShift(cell!.row.templateId, cell!.date),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  return (
    <>
      <Dialog open={action?.kind === "assigned"} onOpenChange={(v) => !v && onClose()}>
        <DialogContent title={t("sched.assigned.title", label)} closeLabel={t("common.close")} width={560}>
          {assigned.isLoading ? (
            <div className="flex flex-col gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : !assigned.data?.length ? (
            <EmptyState title={t("sched.assigned.empty")} />
          ) : (
            <ul className="flex max-h-[420px] flex-col divide-y divide-divider overflow-y-auto">
              {assigned.data.map(({ assignment, worker }) => (
                <li key={assignment.id} className="flex items-center gap-3 py-2.5">
                  <Avatar initials={initialsOf(worker.firstName, worker.lastName)} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">
                      {worker.firstName} {worker.lastName}
                    </div>
                    <div className="text-[12px] text-muted">{worker.number}</div>
                  </div>
                  <Badge tone={assignment.status === "confirmed" ? "ok" : "accent"}>{t(`sched.assigned.${assignment.status === "confirmed" ? "confirmed" : "proposed"}`)}</Badge>
                  {can("shift.schedule.edit") && (
                    <Button size="xs" loading={remove.isPending && remove.variables === assignment.id} onClick={() => remove.mutate(assignment.id)}>
                      {t("sched.assigned.remove")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={action?.kind === "changePlan"} onOpenChange={(v) => !v && onClose()}>
        <DialogContent title={t("sched.changePlan.title")} description={`${label.position} ${label.shift}, ${label.date}`} closeLabel={t("common.close")} width={420}>
          <Field label={t("sched.changePlan.label")} htmlFor="plan-n">
            <Input id="plan-n" type="number" min={1} max={500} value={plan} onChange={(e) => setPlan(Math.max(1, Number(e.target.value) || 1))} className="w-32" />
          </Field>
          <DialogFooter>
            <Button onClick={onClose}>{t("common.cancel")}</Button>
            <Button variant="primary" loading={changePlan.isPending} onClick={() => changePlan.mutate()}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={action?.kind === "cancel"} onOpenChange={(v) => !v && onClose()}>
        <DialogContent title={t("sched.cancel.title")} closeLabel={t("common.close")} width={460}>
          <p className="text-[14px] text-muted">{t("sched.cancel.text", label)}</p>
          <DialogFooter>
            <Button onClick={onClose}>{t("common.cancel")}</Button>
            <Button variant="primary" className="bg-critical-text hover:bg-critical-text/85" loading={cancel.isPending} onClick={() => cancel.mutate()}>
              {t("sched.cancel.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
