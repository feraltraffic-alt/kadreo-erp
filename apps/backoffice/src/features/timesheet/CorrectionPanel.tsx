import type { ClockEvidence, TimesheetDayDetail } from "@kadreo/domain";
import { useI18n } from "@kadreo/i18n";
import { Button, Card, cn, ErrorState, Field, Input, NativeSelect, Skeleton, Textarea, useToast } from "@kadreo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, useSession } from "../../app/session";
import { useFormat } from "../../lib/format";

export interface PanelTarget {
  timesheetId: string;
  rowId: string;
  date: string;
}

/**
 * Correction side panel (9.2-16…24). Any change of hours needs a reason; the change is stored
 * as «было / стало» and the comment is visible to the client in the portal.
 */
export function CorrectionPanel({ target, locked, onClose, onDirtyChange }: { target: PanelTarget; locked: boolean; onClose: () => void; onDirtyChange: (dirty: boolean) => void }) {
  const { t, hours, date: fmtDate, time } = useI18n();
  const { positionName, weekdayShort, dayMonth, reasonName } = useFormat();
  const { can, dict } = useSession();
  const loc = (id: string) => reasonName(id);
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["tsDay", target.timesheetId, target.rowId, target.date], queryFn: () => api.timesheetDay(target.timesheetId, target.rowId, target.date) });

  const [payable, setPayable] = useState("");
  const [billable, setBillable] = useState("");
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");
  const [triedSave, setTriedSave] = useState(false);

  useEffect(() => {
    if (q.data) {
      setPayable(String(q.data.day.payableHours).replace(".", ","));
      setBillable(String(q.data.day.billableHours).replace(".", ","));
      setReason(q.data.day.issue?.kind === "unapproved_overtime" ? "r-ot-unapproved" : "");
      setComment("");
      setTriedSave(false);
    }
  }, [q.data]);

  const parse = (s: string) => Number(s.replace(",", "."));
  const valid = (n: number) => Number.isFinite(n) && n >= 0 && n <= 24 && Math.round(n * 4) === n * 4;
  const changed = !!q.data && (parse(payable) !== q.data.day.payableHours || parse(billable) !== q.data.day.billableHours);
  const dirty = changed || comment.length > 0;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const save = useMutation({
    mutationFn: () =>
      api.correct(target.timesheetId, { rowId: target.rowId, date: target.date, payableHours: parse(payable), billableHours: parse(billable), reasonId: reason, comment }),
    onSuccess: () => {
      toast.push({ tone: "ok", text: t("tsp.saved") });
      onDirtyChange(false);
      void qc.invalidateQueries({ queryKey: ["timesheet"] });
      void qc.invalidateQueries({ queryKey: ["tsDay", target.timesheetId, target.rowId, target.date] });
    },
    onError: () => toast.push({ tone: "critical", text: t("common.saveError") }),
  });

  const submit = () => {
    setTriedSave(true);
    if (!valid(parse(payable)) || !valid(parse(billable)) || !reason) return;
    save.mutate();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const d = q.data;
  const reasons = useMemo(() => dict.correctionReasons, [dict.correctionReasons]);
  const canCorrect = can("timesheet.entry.correct") && !locked && !!d?.day.hasShift;

  return (
    <Card className="sticky top-[94px] flex max-h-[calc(100vh-118px)] flex-col overflow-y-auto p-5" role="complementary" aria-label={d ? `${d.worker.firstName} ${d.worker.lastName}` : undefined}>
      {q.isError ? (
        <ErrorState message={t("common.loadError")} retryLabel={t("common.retry")} onRetry={() => void q.refetch()} />
      ) : !d ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-7 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-16" />
          <Skeleton className="h-32" />
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[18px] leading-snug font-bold">{t("tsp.title", { weekday: weekdayShort(d.day.date), date: dayMonth(d.day.date), name: `${d.worker.firstName} ${d.worker.lastName}` })}</h2>
              <p className="mt-0.5 text-[14px] text-muted">{t("tsp.sub", { position: positionName(d.positionId), shift: d.day.shiftLabel ?? "—" })}</p>
            </div>
            <Button variant="secondary" size="icon-sm" aria-label={t("tsp.close")} onClick={onClose} className="bg-bg">
              <X className="size-4" />
            </Button>
          </div>

          {!d.day.hasShift ? (
            <p className="mt-6 text-[14px] text-muted">{t("tsp.noShift")}</p>
          ) : (
            <>
              {d.day.issue && <div className="mt-4 rounded-[12px] bg-warn-bg px-3.5 py-3 text-[13px] leading-relaxed text-warn-text">{t(`tsp.issue.${d.day.issue.kind}`, { m: d.day.issue.minutes ?? 0 })}</div>}

              {can("clockevent.read") && (
                <>
                  <h3 className="mt-5 mb-2 text-[12px] font-bold tracking-[0.06em] text-muted uppercase">{t("tsp.clocks")}</h3>
                  {d.evidence.length === 0 ? (
                    <p className="text-[13px] text-muted">{t("tsp.noClocks")}</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {d.evidence.map((e, i) => (
                        <EvidenceRow key={i} e={e} showEvidence={can("clockevent.evidence.read")} />
                      ))}
                    </ul>
                  )}
                </>
              )}

              {locked && <p className="mt-5 rounded-control bg-neutral-bg px-3 py-2.5 text-[13px] text-neutral-text">{t("tsp.locked")}</p>}

              <form
                className="mt-5 flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                <div className={cn("grid gap-3", can("contract.rates.read") ? "grid-cols-2" : "grid-cols-1")}>
                  <Field label={t("tsp.payable")} htmlFor="ts-pay" error={triedSave && !valid(parse(payable)) ? t("tsp.hoursRange") : undefined}>
                    <Input id="ts-pay" inputMode="decimal" value={payable} disabled={!canCorrect} aria-invalid={triedSave && !valid(parse(payable))} onChange={(e) => setPayable(e.target.value)} className="h-12 text-[16px] font-semibold tabular" />
                  </Field>
                  {/* Billable hours are hidden from roles without access to contract rates (9.2-20). */}
                  {can("contract.rates.read") && (
                    <Field label={t("tsp.billable")} htmlFor="ts-bill" error={triedSave && !valid(parse(billable)) ? t("tsp.hoursRange") : undefined}>
                      <Input id="ts-bill" inputMode="decimal" value={billable} disabled={!canCorrect} aria-invalid={triedSave && !valid(parse(billable))} onChange={(e) => setBillable(e.target.value)} className="h-12 text-[16px] font-semibold tabular" />
                    </Field>
                  )}
                </div>
                <Field label={t("tsp.reason")} required htmlFor="ts-reason" error={triedSave && !reason ? t("tsp.reason.required") : undefined}>
                  <NativeSelect id="ts-reason" value={reason} disabled={!canCorrect} aria-invalid={triedSave && !reason} onChange={(e) => setReason(e.target.value)} className={cn(reason && "border-accent")}>
                    <option value="">{t("tsp.reason.pick")}</option>
                    {reasons.map((r) => (
                      <option key={r.id} value={r.id}>
                        {loc(r.id)}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label={t("tsp.comment")} htmlFor="ts-comment">
                  <Textarea id="ts-comment" maxLength={500} value={comment} disabled={!canCorrect} placeholder={t("tsp.comment.ph")} onChange={(e) => setComment(e.target.value)} />
                </Field>
                {canCorrect && (
                  <div className="flex gap-3">
                    <Button type="submit" variant="primary" className="h-12 flex-1" loading={save.isPending} disabled={!changed && !d.day.issue}>
                      {t("common.save")}
                    </Button>
                    <Button className="h-12" onClick={onClose}>
                      {t("common.cancel")}
                    </Button>
                  </div>
                )}
              </form>

              {d.day.corrections.length > 0 && (
                <>
                  <h3 className="mt-6 mb-2 text-[12px] font-bold tracking-[0.06em] text-muted uppercase">{t("tsp.history")}</h3>
                  <ul className="flex flex-col gap-2 text-[13px]">
                    {d.day.corrections.map((c) => (
                      <li key={c.id} className="flex gap-2 rounded-[10px] bg-bg px-3 py-2">
                        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-ok" />
                        <div>
                          <div>{t("tsp.history.line", { name: c.byName, date: `${fmtDate(c.at, { day: "2-digit", month: "2-digit" })} ${time(c.at)}`, before: hours(c.payableBefore), after: hours(c.payableAfter) })}</div>
                          <div className="text-muted">
                            {loc(c.reasonId)}
                            {c.comment ? ` · ${c.comment}` : ""}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </>
      )}
    </Card>
  );
}

function EvidenceRow({ e, showEvidence }: { e: ClockEvidence; showEvidence: boolean }) {
  const { t } = useI18n();
  const parts: string[] = [];
  if (showEvidence) {
    if (e.source === "gps_photo") {
      parts.push(t("tsp.src.gps", { m: e.gpsAccuracyM ?? 0 }));
      if (e.photo) parts.push(t("tsp.src.photo"));
      if (e.faceMatch) parts.push(t("tsp.src.face"));
    } else if (e.source === "access_card") parts.push(t("tsp.src.card", { n: e.gate ?? 1 }));
    else if (e.source === "kiosk") parts.push(t("tsp.src.kiosk", { n: e.kiosk ?? 1 }));
    else if (e.source === "face") parts.push(t("tsp.src.kiosk", { n: e.kiosk ?? 1 }), t("tsp.src.face"));
    else if (e.source === "qr") parts.push(t("tsp.src.qr", { n: e.qrPoint ?? 1 }));
    else parts.push(t("tsp.src.manual"));
  }
  return (
    <li className="flex items-center justify-between gap-3 rounded-[10px] border border-border px-3.5 py-2.5 text-[14px]">
      <span>
        <span className="font-semibold">{t(`tsp.ev.${e.type}`)}</span> <span className="tabular">{e.endTime ? `${e.time}–${e.endTime}` : e.time}</span>
      </span>
      <span className="text-right text-[13px] text-muted">{parts.join(" · ")}</span>
    </li>
  );
}

export type { TimesheetDayDetail };
