import { ApiError, isoWeekToken, mondayOf, type StaffRequestDetail } from "@kadreo/domain";
import { useI18n } from "@kadreo/i18n";
import { Badge, Button, Card, cn, Dialog, DialogContent, DialogFooter, ErrorState, Field, ProgressBar, Skeleton, Tag, Textarea, useToast } from "@kadreo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, XCircle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import { api, useSession } from "../../app/session";
import { NOW, useFormat } from "../../lib/format";
import { PageHeader } from "../../shell/Layout";
import { requestTone } from "./RequestsPage";

/** One client request: what was ordered, SLA, staffing by day, accept / cancel. URL: /requests/:id */
export function RequestPage() {
  const { id = "" } = useParams();
  const { t } = useI18n();
  const { positionName, competenceName, weekdayShort, dayMonth, fullDate, dateTime, until } = useFormat();
  const { can } = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["staffRequest", id], queryFn: () => api.staffRequest(id) });
  const [cancelOpen, setCancelOpen] = useState(false);

  const done = (d: StaffRequestDetail, text: string) => {
    qc.setQueryData(["staffRequest", id], d);
    void qc.invalidateQueries({ queryKey: ["staffRequests"] });
    void qc.invalidateQueries({ queryKey: ["navCounters"] });
    void qc.invalidateQueries({ queryKey: ["schedule"] });
    toast.push({ tone: "ok", text });
  };
  const failed = (e: unknown) => {
    toast.push({ tone: "critical", text: e instanceof ApiError && e.status === 409 ? t("req.conflict") : t("common.saveError") });
    void q.refetch();
  };
  const accept = useMutation({ mutationFn: () => api.acceptStaffRequest(id), onSuccess: (d) => done(d, t("req.accepted")), onError: failed });

  if (q.isError) return <ErrorState message={t("common.loadError")} retryLabel={t("common.retry")} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const r = d?.request;
  const tplById = new Map((d?.templates ?? []).map((x) => [x.id, x]));
  const shiftLabel = (tid: string) => {
    const x = tplById.get(tid);
    return x ? `${x.start}–${x.end}` : "—";
  };
  const firstShort = d?.cells.find((c) => c.assigned < c.needed) ?? d?.cells[0];
  const pick = () => {
    if (!d || !firstShort) return;
    navigate(`/workforce/projects/${d.projectId}/schedule?week=${isoWeekToken(mondayOf(firstShort.date))}&cell=${encodeURIComponent(`${firstShort.templateId}|${firstShort.date}`)}`);
  };
  const workingDays = d ? new Set(d.cells.map((c) => c.date)).size || countWorkingDays(d.request.from, d.request.to) : 0;
  const active = r && ["new", "in_progress", "staffed", "draft"].includes(r.status);

  return (
    <div>
      <PageHeader
        crumbs={[{ label: t("req.title"), to: "/requests" }, { label: r ? String(r.number) : "…" }]}
        title={r ? t("req.card.title", { n: r.number }) : "…"}
        meta={
          r && d ? (
            <>
              <Badge tone={requestTone[r.status]}>{t(`req.status.${r.status}`)}</Badge>
              <span className="text-[14px] text-muted">{d.client.shortName}</span>
              {r.clientRef && <span className="text-[14px] text-muted">· {t("req.clientRef", { ref: r.clientRef })}</span>}
            </>
          ) : undefined
        }
        actions={
          r && can("staffrequest.manage") && active ? (
            <>
              <Button variant="danger-link" onClick={() => setCancelOpen(true)}>
                {t("req.cancel")}
              </Button>
              {r.status === "new" ? (
                <Button variant="primary" loading={accept.isPending} onClick={() => accept.mutate()}>
                  {t("req.accept")}
                </Button>
              ) : (
                can("shift.schedule.read") && (
                  <Button variant="primary" onClick={pick}>
                    {t("req.pick")}
                  </Button>
                )
              )}
            </>
          ) : r && r.status !== "new" && d?.cells.length && can("shift.schedule.read") ? (
            <Button onClick={pick}>{t("req.pick")}</Button>
          ) : undefined
        }
      />

      {!d || !r ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <Skeleton className="h-80 rounded-card" />
          <Skeleton className="h-80 rounded-card" />
        </div>
      ) : (
        <>
          <SlaPlate d={d} dateTime={dateTime} until={until} />
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <Card className="p-6">
              <h2 className="mb-4 text-[16px] font-bold">{t("req.ordered")}</h2>
              <dl className="grid grid-cols-[150px_1fr] gap-x-4 gap-y-3.5 text-[14px]">
                <Item label={t("req.f.site")}>
                  <div className="font-semibold">{d.site.name}</div>
                  <div className="text-[13px] text-muted">{d.site.address}</div>
                </Item>
                <Item label={t("req.f.position")}>{positionName(r.positionId)}</Item>
                <Item label={t("req.f.headcount")}>
                  <span className="font-semibold">{t("req.f.headcount.value", { n: r.headcount })}</span>
                </Item>
                <Item label={t("req.f.period")}>
                  <span className="tabular">{r.from === r.to ? fullDate(r.from) : `${dayMonth(r.from)} – ${fullDate(r.to)}`}</span>
                  <span className="text-muted"> · {t("req.days", { n: workingDays })}</span>
                </Item>
                <Item label={t("req.f.shifts")}>
                  <div className="flex flex-wrap gap-1.5">
                    {r.templateIds.map((tid) => (
                      <Tag key={tid}>
                        <span className="tabular">{shiftLabel(tid)}</span>
                      </Tag>
                    ))}
                  </div>
                </Item>
                <Item label={t("req.f.requirements")}>
                  {r.competenceIds.length || r.experiencedOnly ? (
                    <>
                      <div className="flex flex-wrap gap-1.5">
                        {r.competenceIds.map((c) => (
                          <Tag key={c} tone="accent">
                            {competenceName(c)}
                          </Tag>
                        ))}
                        {r.experiencedOnly && <Tag tone="accent">{t("req.f.experienced")}</Tag>}
                      </div>
                      {active && r.status !== "new" && <p className="mt-1.5 text-[12px] text-muted">{t("req.f.requirementsNote")}</p>}
                    </>
                  ) : (
                    <span className="text-muted">{t("req.f.none")}</span>
                  )}
                </Item>
                <Item label={t("req.f.contact")}>{r.contactName}</Item>
                {r.comment && (
                  <Item label={t("req.f.comment")}>
                    <blockquote className="rounded-[10px] border-l-[3px] border-accent bg-bg px-3 py-2 text-[14px] leading-relaxed">{r.comment}</blockquote>
                  </Item>
                )}
                <Item label={t("req.f.created")}>
                  <span className="text-muted">
                    {dateTime(r.createdAt)} · {r.createdByName}
                  </span>
                </Item>
              </dl>
            </Card>

            <Card className="p-6">
              <div className="mb-4 flex items-baseline justify-between gap-3">
                <h2 className="text-[16px] font-bold">{t("req.staffing")}</h2>
                {d.cells.length > 0 && <span className="text-[12px] text-muted">{t("req.staffing.hint")}</span>}
              </div>
              {d.cells.length === 0 ? (
                <p className="rounded-[12px] bg-bg px-4 py-3.5 text-[14px] leading-relaxed text-muted">{t("req.staffing.before", { n: r.headcount })}</p>
              ) : (
                <>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[32px] leading-none font-extrabold tabular">{r.assigned}</span>
                    <span className="text-[18px] text-muted tabular">/ {r.headcount}</span>
                  </div>
                  <ProgressBar className="mt-3 mb-5" value={r.assigned / r.headcount} tone={r.assigned >= r.headcount ? "ok" : "accent"} />
                  <table className="w-full text-[14px]">
                    <thead>
                      <tr className="text-left text-[12px] font-semibold text-muted">
                        <th className="border-b border-divider py-2 pr-3">{t("req.col.day")}</th>
                        <th className="border-b border-divider px-3 py-2">{t("req.col.shift")}</th>
                        <th className="border-b border-divider px-3 py-2">{t("req.col.filled")}</th>
                        <th className="border-b border-divider py-2 pl-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {d.cells.map((c) => {
                        const full = c.assigned >= c.needed;
                        return (
                          <tr key={`${c.templateId}|${c.date}`} className="border-b border-divider last:border-0">
                            <td className="py-2.5 pr-3 whitespace-nowrap tabular">
                              {weekdayShort(c.date)} {dayMonth(c.date)}
                            </td>
                            <td className="px-3 py-2.5 text-muted tabular">{shiftLabel(c.templateId)}</td>
                            <td className="w-[45%] px-3 py-2.5">
                              <div className="flex items-center gap-3">
                                <span className={cn("w-12 font-semibold tabular", full ? "text-ok-text" : "text-ink")}>
                                  {c.assigned}/{c.needed}
                                </span>
                                <ProgressBar className="h-1.5 flex-1" value={c.assigned / c.needed} tone={full ? "ok" : "accent"} />
                              </div>
                            </td>
                            <td className="py-2.5 pl-3 text-right">
                              {can("shift.schedule.read") && (
                                <Button
                                  size="xs"
                                  variant="ghost"
                                  onClick={() => navigate(`/workforce/projects/${d.projectId}/schedule?week=${isoWeekToken(mondayOf(c.date))}&cell=${encodeURIComponent(`${c.templateId}|${c.date}`)}`)}
                                >
                                  {t("req.open")}
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              )}
            </Card>
          </div>
          <CancelDialog
            open={cancelOpen}
            onOpenChange={setCancelOpen}
            number={r.number}
            accepted={!!r.acceptedAt}
            onDone={(next) => {
              setCancelOpen(false);
              done(next, t("req.cancelled"));
            }}
            onError={failed}
            id={id}
          />
        </>
      )}
    </div>
  );
}

function countWorkingDays(from: string, to: string) {
  let n = 0;
  for (let d = new Date(from); d <= new Date(to); d.setUTCDate(d.getUTCDate() + 1)) if (d.getUTCDay() !== 0) n++;
  return n;
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="pt-px text-[13px] text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

function SlaPlate({ d, dateTime, until }: { d: StaffRequestDetail; dateTime: (iso: string) => string; until: (iso: string) => string }) {
  const { t } = useI18n();
  const r = d.request;
  let tone: "warn" | "critical" | "ok" | "neutral" = "neutral";
  let icon = <Clock className="size-4 shrink-0" />;
  let text = "";
  if (r.status === "cancelled") {
    icon = <XCircle className="size-4 shrink-0" />;
    text = t("req.plate.cancelled", { date: r.cancelledAt ? dateTime(r.cancelledAt) : "—", name: r.cancelledByName ?? "—", reason: r.cancelReason ?? "—" });
  } else if (r.status === "new") {
    const overdue = new Date(r.slaDueAt).getTime() <= NOW.getTime();
    tone = overdue || new Date(r.slaDueAt).getTime() - NOW.getTime() < 3600000 ? "critical" : "warn";
    icon = <AlertTriangle className="size-4 shrink-0" />;
    text = overdue ? t("req.plate.overdue", { date: dateTime(r.slaDueAt) }) : t("req.plate.new", { date: dateTime(r.slaDueAt), d: until(r.slaDueAt), h: d.slaResponseHours });
  } else if (r.acceptedAt) {
    const late = new Date(r.acceptedAt).getTime() > new Date(r.slaDueAt).getTime();
    tone = late ? "warn" : "ok";
    icon = late ? <AlertTriangle className="size-4 shrink-0" /> : <CheckCircle2 className="size-4 shrink-0" />;
    text = `${t("req.plate.accepted", { date: dateTime(r.acceptedAt), name: r.acceptedByName ?? "—" })} · ${t(late ? "req.plate.lateSla" : "req.plate.inSla")}`;
  }
  if (!text) return null;
  const cls = { warn: "bg-warn-bg text-warn-text", critical: "bg-critical-bg text-critical-text", ok: "bg-ok-bg text-ok-text", neutral: "bg-neutral-bg text-neutral-text" }[tone];
  return (
    <div role="status" className={cn("mb-6 flex items-center gap-2.5 rounded-[12px] px-4 py-3 text-[14px] font-medium", cls)}>
      {icon}
      {text}
    </div>
  );
}

function CancelDialog({ open, onOpenChange, number, accepted, id, onDone, onError }: { open: boolean; onOpenChange: (v: boolean) => void; number: number; accepted: boolean; id: string; onDone: (d: StaffRequestDetail) => void; onError: (e: unknown) => void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const cancel = useMutation({ mutationFn: () => api.cancelStaffRequest(id, reason.trim()), onSuccess: onDone, onError });
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) {
          setReason("");
          setTried(false);
        }
      }}
    >
      <DialogContent title={t("req.cancel.title", { n: number })} closeLabel={t("common.close")} width={480}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setTried(true);
            if (reason.trim()) cancel.mutate();
          }}
        >
          {accepted && <p className="mb-4 rounded-[10px] bg-warn-bg px-3.5 py-2.5 text-[13px] leading-relaxed text-warn-text">{t("req.cancel.note")}</p>}
          <Field label={t("req.cancel.reason")} required htmlFor="req-cancel-reason" error={tried && !reason.trim() ? t("req.cancel.reason.required") : undefined}>
            <Textarea id="req-cancel-reason" autoFocus maxLength={500} value={reason} placeholder={t("req.cancel.reason.ph")} aria-invalid={tried && !reason.trim()} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>{t("req.cancel.keep")}</Button>
            <Button type="submit" variant="primary" loading={cancel.isPending}>
              {t("req.cancel.confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
