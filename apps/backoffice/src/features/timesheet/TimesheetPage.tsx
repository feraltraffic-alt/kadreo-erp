import { addDays, DEMO_TODAY, mondayOf, type TimesheetResponse, type TimesheetRow } from "@kadreo/domain";
import { useI18n } from "@kadreo/i18n";
import { Badge, Button, Card, cn, Dialog, DialogContent, DialogFooter, ErrorState, Input, Menu, MenuContent, MenuItem, MenuTrigger, Skeleton, Tooltip, useToast, type Tone } from "@kadreo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Search } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import writeXlsxFile from "write-excel-file/universal";
import { api, useSession } from "../../app/session";
import { useFormat } from "../../lib/format";
import { PageHeader } from "../../shell/Layout";
import { CorrectionPanel, type PanelTarget } from "./CorrectionPanel";
import { rowOvertime, rowPlanned, rowStatus, rowTotal } from "./rows";

const rowTone: Record<string, Tone> = { ready: "ok", issues: "warn", disputed: "critical", confirmed: "ok" };
const PAGE = 50;

/** Timesheet review (spec 9.2). URL: /timesheets/projects/:projectId?from=…&to=… */
export function TimesheetPage() {
  const { projectId = "" } = useParams();
  const { t, hours, date } = useI18n();
  const { positionName, weekdayShort, dayMonth, fullDate } = useFormat();
  const { can } = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const from = params.get("from") ?? addDays(mondayOf(DEMO_TODAY), -7);
  const to = params.get("to") ?? addDays(from, 6);

  const q = useQuery({ queryKey: ["timesheet", projectId, from, to], queryFn: () => api.timesheet(projectId, from, to) });
  const data = q.data;

  const [search, setSearch] = useState("");
  const [position, setPosition] = useState<string | null>(null);
  const [onlyIssues, setOnlyIssues] = useState<boolean | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [target, setTarget] = useState<PanelTarget | null>(null);
  const dirty = useRef(false);
  const [pending, setPending] = useState<PanelTarget | null | "close">(null);

  const issueRows = useMemo(() => (data ? data.timesheet.rows.filter((r) => r.days.some((d) => d.issue)) : []), [data]);
  const issuesOn = onlyIssues ?? issueRows.length > 0;
  const rows = useMemo(() => {
    if (!data) return [];
    const s = search.trim().toLowerCase();
    return data.timesheet.rows.filter((r) => {
      const w = data.workers[r.workerId]!;
      if (s.length >= 2 && !`${w.firstName} ${w.lastName}`.toLowerCase().includes(s)) return false;
      if (position && r.positionId !== position) return false;
      if (issuesOn && !r.days.some((d) => d.issue)) return false;
      return true;
    });
  }, [data, search, position, issuesOn]);

  const visibleRows = showAll ? rows : rows.slice(0, PAGE);
  const ts = data?.timesheet;
  const totals = useMemo(() => (ts ? { actual: ts.rows.reduce((s, r) => s + rowTotal(r), 0), planned: ts.rows.reduce((s, r) => s + rowPlanned(r), 0) } : null), [ts]);
  const days = ts ? Array.from({ length: Math.round((new Date(ts.to).getTime() - new Date(ts.from).getTime()) / 86400000) + 1 }, (_, i) => addDays(ts.from, i)) : [];
  const sent = ts ? ts.clientStage.kind !== "not_sent" : false;
  const leadersDone = ts ? ts.teamLeaderDaysConfirmed >= days.length : false;
  const sendBlock = !ts ? "" : sent ? t("ts.send.blocked.sent") : !leadersDone ? t("ts.send.blocked.leaders") : issueRows.length ? t("ts.send.blocked.issues", { n: issueRows.length }) : "";

  const send = useMutation({
    mutationFn: () => api.sendToClient(ts!.id),
    onSuccess: (res) => {
      if (res.clientStage.kind === "waiting") toast.push({ tone: "ok", text: t("ts.sent", { date: `${date(res.clientStage.until, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Warsaw" })}` }) });
      void qc.invalidateQueries({ queryKey: ["timesheet"] });
    },
    onError: () => toast.push({ tone: "critical", text: t("common.saveError") }),
  });

  /** Opening another day or closing with unsaved edits asks first (8.6). */
  const requestTarget = useCallback((next: PanelTarget | null) => {
    if (dirty.current) setPending(next ?? "close");
    else setTarget(next);
  }, []);
  const setDirty = useCallback((v: boolean) => {
    dirty.current = v;
  }, []);

  const exportXlsx = async (d: TimesheetResponse) => {
    const header = [t("ts.col.worker"), ...days.map((x) => `${weekdayShort(x)} ${dayMonth(x)}`), t("ts.col.total"), t("ts.col.overtime"), t("ts.col.status")].map((value) => ({ value, fontWeight: "bold" as const }));
    const body = rows.map((r) => {
      const w = d.workers[r.workerId]!;
      return [
        { value: `${w.firstName} ${w.lastName}` },
        ...r.days.map((x) => (x.hasShift ? { value: x.payableHours, type: Number } : { value: "—" })),
        { value: rowTotal(r), type: Number },
        { value: rowOvertime(r), type: Number },
        { value: t(`ts.row.${rowStatus(r, d.timesheet)}`) },
      ];
    });
    const name = `${d.site.name.replace(/[^\p{L}\p{N}]+/gu, "_")}_${from}_${to}.xlsx`;
    const blob = await writeXlsxFile([header, ...body] as never).toBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast.push({ tone: "ok", text: t("ts.exported", { name }) });
  };

  if (q.isError) return <ErrorState message={t("common.loadError")} retryLabel={t("common.retry")} onRetry={() => void q.refetch()} />;

  const stage = ts?.clientStage;
  const currentStage = !ts ? 0 : !leadersDone ? 1 : !sent ? 2 : 3;

  return (
    <div>
      <PageHeader
        crumbs={[{ label: t("nav.timesheets"), to: "/timesheets" }, { label: data?.client.shortName ?? "…" }, { label: data?.site.name ?? "…" }]}
        title={t("ts.title", { from: dayMonth(from), to: fullDate(to) })}
        actions={
          <>
            <Button disabled={!data} onClick={() => data && void exportXlsx(data)}>
              {t("ts.export")}
            </Button>
            {can("timesheet.send_to_client") && (
              <Tooltip content={sendBlock || t("ts.send")}>
                <span>
                  <Button variant="primary" disabled={!!sendBlock} loading={send.isPending} onClick={() => send.mutate()}>
                    {t("ts.send")}
                  </Button>
                </span>
              </Tooltip>
            )}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {!ts || !totals ? (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[92px] rounded-card" />)
        ) : (
          <>
            <StageCard label={t("ts.hours")}>
              <span className="text-[26px] font-extrabold tabular">{hours(totals.actual)}</span>
              <span className="ml-1.5 text-[16px] text-muted tabular">/ {hours(totals.planned)}</span>
            </StageCard>
            <StageCard label={t("ts.stage1")} active={currentStage === 1}>
              <span className={cn("text-[16px] font-bold", leadersDone ? "text-ok-text" : "text-accent-strong")}>{t("ts.stage1.value", { x: ts.teamLeaderDaysConfirmed, y: days.length })}</span>
            </StageCard>
            <StageCard label={t("ts.stage2")} active={currentStage === 2}>
              <span className={cn("text-[16px] font-bold", sent ? "text-ok-text" : "text-accent-strong")}>{sent ? t("ts.stage2.done") : t("ts.stage2.review", { n: issueRows.length })}</span>
            </StageCard>
            <StageCard label={t("ts.stage3")} active={currentStage === 3}>
              <span className={cn("text-[16px] font-bold", stage?.kind === "not_sent" ? "text-muted" : stage?.kind === "disputed" ? "text-critical-text" : stage?.kind === "waiting" ? "text-warn-text" : "text-ok-text")}>
                {stage?.kind === "waiting"
                  ? t("ts.stage3.waiting", { date: date(stage.until, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Warsaw" }) })
                  : stage?.kind === "disputed"
                    ? t("ts.stage3.disputed", { n: stage.rows })
                    : t(`ts.stage3.${stage?.kind ?? "not_sent"}`)}
              </span>
            </StageCard>
          </>
        )}
      </div>

      <div className={cn("grid items-start gap-6", target && "xl:grid-cols-[minmax(0,1fr)_400px]")}>
        <Card className="min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-divider p-4">
            <div className="relative min-w-60 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("ts.search")} aria-label={t("ts.search")} className="pl-9" />
            </div>
            <Menu>
              <MenuTrigger asChild>
                <Button className={cn("gap-2", position && "border-accent-strong")}>
                  {t("ts.position", { value: position ? positionName(position) : t("common.all") })}
                  <ChevronDown className="size-4 text-muted" />
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem onSelect={() => setPosition(null)}>{t("common.allCap")}</MenuItem>
                {data?.project.positionIds.map((p) => (
                  <MenuItem key={p} onSelect={() => setPosition(p)}>
                    {positionName(p)}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
            <button
              type="button"
              aria-pressed={issuesOn}
              onClick={() => setOnlyIssues(!issuesOn)}
              className={cn("h-10 rounded-control border px-3.5 text-[13px] font-semibold transition-colors", issuesOn ? "border-warn bg-warn-bg text-warn-text" : "border-input bg-surface text-ink hover:bg-divider")}
            >
              {t("ts.onlyIssues", { n: issueRows.length })}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-[14px]">
              <thead>
                <tr className="text-[12px] font-semibold text-muted">
                  <th className="sticky left-0 z-10 border-b border-divider bg-surface px-4 py-3 text-left">{t("ts.col.worker")}</th>
                  {days.map((d) => (
                    <th key={d} className="border-b border-divider px-1 py-3 text-center whitespace-nowrap">
                      {weekdayShort(d)} {Number(d.slice(8))}
                    </th>
                  ))}
                  <th className="border-b border-divider px-2 py-3 text-center">{t("ts.col.total")}</th>
                  <th className="border-b border-divider px-2 py-3 text-center">{t("ts.col.overtime")}</th>
                  <th className="border-b border-divider px-3 py-3 text-left">{t("ts.col.status")}</th>
                </tr>
              </thead>
              <tbody>
                {!data ? (
                  [0, 1, 2, 3, 4].map((i) => (
                    <tr key={i}>
                      <td colSpan={days.length + 4 || 11} className="px-4 py-2">
                        <Skeleton className="h-10" />
                      </td>
                    </tr>
                  ))
                ) : visibleRows.length === 0 ? (
                  <tr>
                    <td colSpan={days.length + 4} className="px-4 py-12 text-center text-muted">
                      {issuesOn && issueRows.length === 0 ? t("ts.noIssues") : t("ts.empty")}
                    </td>
                  </tr>
                ) : (
                  visibleRows.map((r) => (
                    <Row
                      key={r.id}
                      row={r}
                      data={data}
                      selectedDate={target?.rowId === r.id ? target.date : null}
                      onSelect={(d) => requestTarget({ timesheetId: data.timesheet.id, rowId: r.id, date: d })}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
          {rows.length > PAGE && !showAll && (
            <div className="flex items-center justify-between border-t border-divider px-4 py-3 text-[13px] text-muted">
              {t("ts.shown", { n: PAGE, total: rows.length })}
              <Button size="sm" onClick={() => setShowAll(true)}>
                {t("ts.showAll")}
              </Button>
            </div>
          )}
        </Card>
        {target && <CorrectionPanel key={`${target.rowId}|${target.date}`} target={target} locked={sent} onClose={() => requestTarget(null)} onDirtyChange={setDirty} />}
      </div>

      <Dialog open={pending !== null} onOpenChange={(v) => !v && setPending(null)}>
        <DialogContent title={t("common.unsaved.title")} closeLabel={t("common.close")} width={440}>
          <p className="text-[14px] text-muted">{t("common.unsaved.text")}</p>
          <DialogFooter>
            <Button onClick={() => setPending(null)}>{t("common.cancel")}</Button>
            <Button
              onClick={() => {
                dirty.current = false;
                setTarget(pending === "close" ? null : pending);
                setPending(null);
              }}
            >
              {t("common.dontSave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StageCard({ label, children, active }: { label: string; children: React.ReactNode; active?: boolean }) {
  return (
    <div className={cn("rounded-card border bg-surface px-5 py-4", active ? "border-2 border-accent" : "border-border")}>
      <div className="text-[13px] text-muted">{label}</div>
      <div className="mt-1.5 flex items-baseline">{children}</div>
    </div>
  );
}

function Row({ row, data, selectedDate, onSelect }: { row: TimesheetRow; data: TimesheetResponse; selectedDate: string | null; onSelect: (date: string) => void }) {
  const { t, hours } = useI18n();
  const { positionName, dayMonth } = useFormat();
  const w = data.workers[row.workerId]!;
  const name = `${w.firstName} ${w.lastName}`;
  const status = rowStatus(row, data.timesheet);
  const ot = rowOvertime(row);
  return (
    <tr className={cn("border-b border-divider last:border-0", selectedDate && "bg-accent-soft/40")}>
      <td className={cn("sticky left-0 z-10 px-4 py-2.5", selectedDate ? "bg-[#fff8f4]" : "bg-surface")}>
        <div className="font-semibold">{name}</div>
        <div className="text-[12px] text-muted">{positionName(row.positionId)}</div>
      </td>
      {row.days.map((d) => {
        const sel = selectedDate === d.date;
        const corrected = d.corrections.length > 0;
        return (
          <td key={d.date} className="px-1 py-2 text-center">
            <button
              type="button"
              onClick={() => onSelect(d.date)}
              aria-pressed={sel}
              aria-label={d.hasShift ? t("ts.cell.aria", { name, date: dayMonth(d.date), hours: hours(d.payableHours) }) : t("ts.cell.none", { name, date: dayMonth(d.date) })}
              className={cn(
                "mx-auto flex h-10 w-[52px] items-center justify-center rounded-[10px] border text-[14px] font-semibold tabular transition-colors",
                !d.hasShift ? "border-transparent text-muted/70 hover:bg-bg" : d.issue ? "border-warn/60 bg-warn-bg text-warn-text" : d.disputed ? "border-critical/40 bg-critical-bg text-critical-text" : corrected ? "border-dashed border-muted/60 bg-bg" : "border-transparent hover:bg-bg",
                sel && "border-2 border-accent bg-accent-soft text-accent-ink",
              )}
            >
              {d.hasShift ? (
                <>
                  {hours(d.payableHours)}
                  {corrected && !d.issue && <span className="ml-0.5 text-[11px]">✎</span>}
                </>
              ) : (
                "—"
              )}
            </button>
          </td>
        );
      })}
      <td className="px-2 py-2.5 text-center font-bold tabular">{hours(rowTotal(row))}</td>
      <td className="px-2 py-2.5 text-center text-muted tabular">{hours(ot)}</td>
      <td className="px-3 py-2.5">
        <Badge tone={rowTone[status]}>{t(`ts.row.${status}`)}</Badge>
      </td>
    </tr>
  );
}
