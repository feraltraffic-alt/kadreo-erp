import { addDays, type PortalTimesheet, type PortalTimesheetDay, type PortalTimesheetRow } from "@kadreo/domain";
import { useI18n } from "@kadreo/i18n";
import { Button, Card, Checkbox, cn, Dialog, DialogContent, DialogFooter, ErrorState, Field, Input, NativeSelect, Popover, PopoverAnchor, PopoverContent, Skeleton, Textarea, Tooltip, useToast } from "@kadreo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronLeft, ChevronRight, Clock, MessageSquareWarning } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useParams } from "react-router";
import { api, useSession } from "../app/session";
import { useFormat } from "../lib/format";

const PAGE = 50;

/** «Часы на подтверждение» (12.2). URL: /timesheets/:id */
export function TimesheetPage() {
  const { id = "" } = useParams();
  const { t, hours, num, time } = useI18n();
  const { can, dict } = useSession();
  const { dayMonth, fullDate, dateOnly, weekdayShort, positionName, disputeReasonName, correctionReasonName } = useFormat();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["timesheet", id], queryFn: () => api.timesheet(id) });
  const ts = q.data;

  const [page, setPage] = useState(0);
  /** Selected rows and the day chosen to dispute in each (12.2-05…09). */
  const [selected, setSelected] = useState<Record<string, string | null>>({});
  const [reasonId, setReasonId] = useState("");
  const [clientHours, setClientHours] = useState("");
  const [comment, setComment] = useState("");
  const [tried, setTried] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  const open = ts ? ts.stage.kind === "waiting" || ts.stage.kind === "disputed" : false;
  const canAct = open && can("timesheet.client.confirm");
  const days = ts ? Array.from({ length: Math.round((new Date(ts.to).getTime() - new Date(ts.from).getTime()) / 86400000) + 1 }, (_, i) => addDays(ts.from, i)) : [];
  const rows = ts?.rows ?? [];
  const pageRows = rows.slice(page * PAGE, page * PAGE + PAGE);
  const selectedIds = Object.keys(selected);

  /** A day can be disputed while it has hours, is not confirmed and has no open dispute. */
  const disputable = (d: PortalTimesheetDay) => d.hasShift && !d.confirmed && d.dispute?.status !== "open";
  const defaultDay = (r: PortalTimesheetRow) => (r.days.find((d) => disputable(d) && d.correction) ?? r.days.find(disputable))?.date ?? null;

  const toggleRow = (r: PortalTimesheetRow) =>
    setSelected((s) => {
      const next = { ...s };
      if (r.id in next) delete next[r.id];
      else next[r.id] = defaultDay(r);
      return next;
    });
  const pageSelectable = pageRows.filter((r) => r.days.some(disputable));
  const allOnPage = pageSelectable.length > 0 && pageSelectable.every((r) => r.id in selected);
  const toggleAll = () =>
    setSelected((s) => {
      const next = { ...s };
      if (allOnPage) pageSelectable.forEach((r) => delete next[r.id]);
      else pageSelectable.forEach((r) => (next[r.id] = next[r.id] ?? defaultDay(r)));
      return next;
    });

  const parse = (s: string) => Number(s.replace(",", "."));
  const hoursValid = clientHours === "" || (Number.isFinite(parse(clientHours)) && parse(clientHours) >= 0 && parse(clientHours) <= 24 && Math.round(parse(clientHours) * 4) === parse(clientHours) * 4);
  const formValid = !!reasonId && comment.trim().length > 0 && hoursValid && selectedIds.every((rid) => selected[rid]);

  // «Подтвердить остальные»: hours of rows that are neither selected nor in an open dispute.
  const restHours = useMemo(
    () => rows.filter((r) => !(r.id in selected)).reduce((s, r) => s + r.days.filter((d) => !d.confirmed && d.dispute?.status !== "open").reduce((x, d) => x + d.hours, 0), 0),
    [rows, selected],
  );
  const anyOpenDispute = rows.some((r) => r.days.some((d) => d.dispute?.status === "open"));

  const refresh = (next: PortalTimesheet) => {
    qc.setQueryData(["timesheet", id], next);
    void qc.invalidateQueries({ queryKey: ["timesheets"] });
    void qc.invalidateQueries({ queryKey: ["overview"] });
  };
  const disputeInput = () => ({
    items: selectedIds.map((rid) => ({ rowId: rid, date: selected[rid]! })),
    reasonId,
    ...(clientHours !== "" ? { clientHours: parse(clientHours) } : {}),
    comment: comment.trim(),
  });
  const resetSelection = () => {
    setSelected({});
    setComment("");
    setClientHours("");
    setReasonId("");
    setTried(false);
  };

  const dispute = useMutation({
    mutationFn: () => api.dispute(id, disputeInput()),
    onSuccess: (next) => {
      toast.push({ tone: "ok", text: t("pt.disputed", { n: selectedIds.length }) });
      resetSelection();
      refresh(next);
    },
    onError: () => toast.push({ tone: "critical", text: t("common.saveError") }),
  });
  // Selected rows are disputed first, then the rest is confirmed (12.2-14, 15).
  const confirm = useMutation({
    mutationFn: async () => {
      if (selectedIds.length) await api.dispute(id, disputeInput());
      return api.confirm(id);
    },
    onSuccess: (next) => {
      setConfirmOpen(false);
      toast.push({ tone: "ok", text: t("pt.confirmedToast") });
      resetSelection();
      refresh(next);
    },
    onError: () => toast.push({ tone: "critical", text: t("common.saveError") }),
  });

  if (q.isError) return <ErrorState message={t("notFound")} retryLabel={t("common.retry")} onRetry={() => void q.refetch()} />;
  if (!ts) return <Skeleton className="h-[480px] rounded-card" />;

  const first = selectedIds.length === 1 ? rows.find((r) => r.id === selectedIds[0]) : undefined;
  const firstDay = first && selected[first.id] ? first.days.find((d) => d.date === selected[first.id]) : undefined;

  return (
    <div className="pb-28">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px] leading-tight font-extrabold tracking-[-0.01em]">{t("pt.title", { site: ts.site.name, from: dayMonth(ts.from), to: fullDate(ts.to) })}</h1>
          {ts.sentAt && <p className="mt-1.5 text-[14px] text-muted">{t("pt.sent", { date: dateOnly(ts.sentAt), time: time(ts.sentAt), name: ts.sentByName ?? "—" })}</p>}
        </div>
        <StagePlate ts={ts} />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat label={t("pt.hours")}>{num(ts.totals.hours, { maximumFractionDigits: 2 })}</Stat>
        <Stat label={t("pt.workers")}>{ts.totals.workers}</Stat>
        <Stat label={t("pt.night")}>{num(ts.totals.nightHours, { maximumFractionDigits: 2 })}</Stat>
        <Stat label={t("pt.selected")} accent={selectedIds.length > 0}>
          {t("pt.selected.value", { n: selectedIds.length })}
        </Stat>
      </div>

      <div className={cn("grid items-start gap-6", selectedIds.length > 0 && "xl:grid-cols-[minmax(0,1fr)_380px]")}>
        <Card className="min-w-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-[14px]">
              <thead>
                <tr className="text-[12px] font-semibold text-muted">
                  <th className="w-12 border-b border-divider py-3 pl-4">{canAct && <Checkbox checked={allOnPage} onCheckedChange={toggleAll} aria-label={t("pt.selectAll")} />}</th>
                  <th className="border-b border-divider px-2 py-3 text-left">{t("pt.col.worker")}</th>
                  {days.map((d) => (
                    <th key={d} className="border-b border-divider px-1 py-3 text-center whitespace-nowrap">
                      {weekdayShort(d)} {Number(d.slice(8))}
                    </th>
                  ))}
                  <th className="border-b border-divider px-3 py-3 text-right">{t("pt.col.total")}</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => {
                  const isSel = r.id in selected;
                  const name = `${r.worker.firstName} ${r.worker.lastName}`;
                  return (
                    <tr key={r.id} className={cn("border-b border-divider last:border-0", isSel && "bg-accent-soft/60")}>
                      <td className="py-3 pl-4">{canAct && r.days.some(disputable) && <Checkbox checked={isSel} onCheckedChange={() => toggleRow(r)} aria-label={t("pt.selectRow", { name })} />}</td>
                      <td className="px-2 py-3">
                        <div className="font-semibold">{name}</div>
                        <div className="text-[12px] text-muted">{positionName(r.positionId)}</div>
                      </td>
                      {r.days.map((d) => {
                        const key = `${r.id}|${d.date}`;
                        const chosen = isSel && selected[r.id] === d.date;
                        const hasInfo = !!d.correction || !!d.dispute;
                        const click = () => {
                          if (isSel && disputable(d)) setSelected((s) => ({ ...s, [r.id]: d.date }));
                          else if (hasInfo) setInfo(info === key ? null : key);
                        };
                        const label = d.hasShift ? `${hours(d.hours)}${d.correction ? "*" : ""}` : "—";
                        return (
                          <td key={d.date} className="px-1 py-2 text-center">
                            <Popover open={info === key} onOpenChange={(v) => !v && setInfo(null)}>
                              <PopoverAnchor asChild>
                                <button
                                  type="button"
                                  onClick={click}
                                  disabled={!d.hasShift && !hasInfo}
                                  aria-label={d.hasShift ? t("pt.cell", { name, date: dayMonth(d.date), h: hours(d.hours) }) : undefined}
                                  aria-pressed={chosen}
                                  className={cn(
                                    "mx-auto flex h-9 min-w-[46px] items-center justify-center rounded-[8px] px-1.5 tabular transition-colors",
                                    !d.hasShift && "text-muted/70",
                                    d.dispute?.status === "open" && "bg-critical-bg font-semibold text-critical-text",
                                    d.dispute?.status === "agreed" && "bg-ok-bg text-ok-text",
                                    d.dispute?.status === "rejected" && "bg-neutral-bg",
                                    chosen && "border-2 border-accent bg-surface font-bold text-accent-strong",
                                    (hasInfo || (isSel && disputable(d))) && "cursor-pointer hover:ring-1 hover:ring-border",
                                  )}
                                >
                                  {label}
                                </button>
                              </PopoverAnchor>
                              <PopoverContent className="w-72 p-4 text-[13px]">
                                {d.correction && (
                                  <div>
                                    <div className="font-bold">{t("pt.corr.title")}</div>
                                    <div className="mt-1 tabular">{t("pt.corr.hours", { before: hours(d.correction.before), after: hours(d.correction.after) })}</div>
                                    <div className="mt-1 text-muted">{correctionReasonName(d.correction.reasonId)}</div>
                                    {d.correction.comment && <div className="mt-1 text-muted">{d.correction.comment}</div>}
                                  </div>
                                )}
                                {d.dispute && (
                                  <div className={cn(d.correction && "mt-3 border-t border-divider pt-3")}>
                                    <div className="font-bold">{t(`pt.disp.${d.dispute.status}`)}</div>
                                    <div className="mt-1 text-muted">
                                      {disputeReasonName(d.dispute.reasonId)} · {d.dispute.comment}
                                    </div>
                                    {d.dispute.answer && <div className="mt-1.5">{t("pt.disp.answer", { answer: d.dispute.answer })}</div>}
                                  </div>
                                )}
                              </PopoverContent>
                            </Popover>
                          </td>
                        );
                      })}
                      <td className="px-3 py-3 text-right font-bold tabular">{hours(r.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-divider px-4 py-3 text-[13px] text-muted">
            <span>{t("pt.legend", { n: pageRows.length, total: rows.length })}</span>
            <div className="flex gap-2">
              <Button size="icon-sm" aria-label={t("pt.prev")} disabled={page === 0} onClick={() => setPage(page - 1)}>
                <ChevronLeft className="size-4" />
              </Button>
              <Button size="icon-sm" aria-label={t("pt.next")} disabled={(page + 1) * PAGE >= rows.length} onClick={() => setPage(page + 1)}>
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </Card>

        {selectedIds.length > 0 && (
          <Card className="sticky top-[88px] p-5">
            <h2 className="text-[18px] font-bold">{first ? t("pt.panel.one", { name: `${first.worker.firstName} ${first.worker.lastName}` }) : t("pt.panel.many", { n: selectedIds.length })}</h2>
            {first && (
              <p className="mt-1 text-[14px] text-muted">
                {firstDay ? t("pt.panel.day", { weekday: weekdayShort(firstDay.date), date: dayMonth(firstDay.date), h: hours(firstDay.hours) }) : t("pt.panel.pickDay")}
              </p>
            )}
            {!first && (
              <ul className="mt-2 flex flex-col gap-1 text-[13px] text-muted">
                {selectedIds.map((rid) => {
                  const r = rows.find((x) => x.id === rid)!;
                  const d = r.days.find((x) => x.date === selected[rid]);
                  return (
                    <li key={rid}>
                      {r.worker.firstName} {r.worker.lastName} · {d ? `${weekdayShort(d.date)} ${dayMonth(d.date)} · ${hours(d.hours)}` : t("pt.panel.pickDay")}
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="mt-4 flex flex-col gap-4">
              <Field label={t("pt.panel.reason")} required htmlFor="pt-reason" error={tried && !reasonId ? t("nr.required") : undefined}>
                <NativeSelect id="pt-reason" value={reasonId} onChange={(e) => setReasonId(e.target.value)} className={cn(reasonId && "border-accent")}>
                  <option value="">{t("nr.pick")}</option>
                  {dict.disputeReasons.map((r) => (
                    <option key={r.id} value={r.id}>
                      {disputeReasonName(r.id)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label={t("pt.panel.hours")} htmlFor="pt-hours" error={!hoursValid ? t("pt.panel.hoursRange") : undefined}>
                <Input id="pt-hours" inputMode="decimal" value={clientHours} onChange={(e) => setClientHours(e.target.value)} className="h-12 text-[16px] tabular" />
              </Field>
              <Field label={t("pt.panel.comment")} required htmlFor="pt-comment" error={tried && !comment.trim() ? t("nr.required") : undefined}>
                <Textarea id="pt-comment" maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
              </Field>
              <Tooltip content={t("pt.panel.attachSoon")}>
                <label className="flex items-center gap-2.5 text-[14px] text-muted opacity-70">
                  <Checkbox disabled aria-label={t("pt.panel.attach")} />
                  {t("pt.panel.attach")}
                </label>
              </Tooltip>
              <p className="text-[12px] leading-relaxed text-muted">{t("pt.panel.note")}</p>
            </div>
          </Card>
        )}
      </div>

      {canAct && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 backdrop-blur">
          <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-4 px-6 py-4">
            <span className="text-[14px] text-muted">{t("pt.footer")}</span>
            <div className="flex gap-3">
              <Button
                className="h-12"
                disabled={selectedIds.length === 0}
                loading={dispute.isPending}
                onClick={() => {
                  setTried(true);
                  if (formValid) dispute.mutate();
                }}
              >
                {t("pt.dispute", { n: selectedIds.length })}
              </Button>
              <Button
                variant="primary"
                className="h-12"
                disabled={restHours === 0 && selectedIds.length === 0}
                onClick={() => {
                  setTried(true);
                  if (selectedIds.length && !formValid) return;
                  setConfirmOpen(true);
                }}
              >
                {selectedIds.length || anyOpenDispute ? t("pt.confirmRest", { h: num(restHours, { maximumFractionDigits: 2 }) }) : t("pt.confirmAll", { h: num(restHours, { maximumFractionDigits: 2 }) })}
              </Button>
            </div>
          </div>
        </div>
      )}
      {open && !can("timesheet.client.confirm") && <p className="mt-4 text-[13px] text-muted">{t("pt.viewOnly")}</p>}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent title={t("pt.confirm.title", { h: num(restHours, { maximumFractionDigits: 2 }) })} closeLabel={t("common.close")} width={480}>
          <p className="text-[14px] leading-relaxed text-muted">{t("pt.confirm.text")}</p>
          <DialogFooter>
            <Button onClick={() => setConfirmOpen(false)}>{t("common.cancel")}</Button>
            <Button variant="primary" loading={confirm.isPending} onClick={() => confirm.mutate()}>
              {t("pt.confirm.ok")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, children, accent }: { label: string; children: ReactNode; accent?: boolean }) {
  return (
    <div className={cn("rounded-card border bg-surface px-5 py-4", accent ? "border-2 border-accent" : "border-border")}>
      <div className="text-[13px] text-muted">{label}</div>
      <div className={cn("mt-1.5 text-[26px] font-extrabold tabular", accent && "text-accent-strong")}>{children}</div>
    </div>
  );
}

function StagePlate({ ts }: { ts: PortalTimesheet }) {
  const { t } = useI18n();
  const { dateTime } = useFormat();
  const s = ts.stage;
  if (s.kind === "waiting")
    return (
      <div className="flex items-center gap-2.5 rounded-[12px] bg-warn-bg px-4 py-3 text-[14px] font-semibold text-warn-text">
        <Clock className="size-4 shrink-0" />
        {t("pt.deadline", { date: dateTime(s.until) })}
      </div>
    );
  if (s.kind === "disputed")
    return (
      <div className="flex items-center gap-2.5 rounded-[12px] bg-critical-bg px-4 py-3 text-[14px] font-semibold text-critical-text">
        <MessageSquareWarning className="size-4 shrink-0" />
        {t("pt.disputedPlate", { n: s.rows })}
      </div>
    );
  if (s.kind === "confirmed" || s.kind === "auto_accepted")
    return (
      <div className="flex items-center gap-2.5 rounded-[12px] bg-ok-bg px-4 py-3 text-[14px] font-semibold text-ok-text">
        <CheckCircle2 className="size-4 shrink-0" />
        {t(s.kind === "confirmed" ? "pt.closedPlate" : "pt.autoPlate")}
      </div>
    );
  return null;
}
