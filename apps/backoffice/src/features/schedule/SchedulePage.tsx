import { addDays, DEMO_TODAY, isoWeek, isoWeekToken, mondayOf, mondayOfIsoWeek, type ScheduleCell, type ScheduleRow } from "@kadreo/domain";
import { useI18n } from "@kadreo/i18n";
import {
  Badge,
  Button,
  Card,
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  ErrorState,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Segmented,
  Skeleton,
  useToast,
} from "@kadreo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, MoreHorizontal, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { api, useSession } from "../../app/session";
import { useFormat } from "../../lib/format";
import { PageHeader } from "../../shell/Layout";
import { AutoAssignDialog } from "./AutoAssignDialog";
import { CandidatesPanel, type SelectedCell } from "./CandidatesPanel";
import { CellDialogs, type CellAction } from "./CellDialogs";
import { useViolationText } from "./violations";

type Tone = "ok" | "warn" | "critical";
function cellTone(c: ScheduleCell): Tone | null {
  if (c.planned === null) return null;
  const short = Math.max(0, c.planned - c.assigned);
  if (short === 0) return "ok";
  return short / c.planned <= 0.2 ? "warn" : "critical";
}
const toneCell: Record<Tone, string> = {
  ok: "bg-ok-bg/70 border-ok/30 text-ok-text",
  warn: "bg-warn-bg border-warn/50 text-warn-text",
  critical: "bg-critical-bg border-critical/40 text-critical-text",
};
const toneBar: Record<Tone, string> = { ok: "bg-ok", warn: "bg-warn", critical: "bg-critical" };

/** Shift planning, week view (spec 9.1). URL: ?week=2026-W44&view=week&cell=<template>|<date> */
export function SchedulePage() {
  const { projectId = "" } = useParams();
  const { t } = useI18n();
  const { positionName, weekdayShort, dayMonth } = useFormat();
  const { can } = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const violationText = useViolationText();
  const [params, setParams] = useSearchParams();
  const monday = mondayOfIsoWeek(params.get("week") ?? "") ?? mondayOf(DEMO_TODAY);
  const sunday = addDays(monday, 6);
  const view = (params.get("view") as "day" | "week" | "workers" | null) ?? "week";
  const cellParam = params.get("cell");
  const [cellAction, setCellAction] = useState<CellAction>(null);
  const [autoOpen, setAutoOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const q = useQuery({ queryKey: ["schedule", projectId, monday], queryFn: () => api.schedule(projectId, monday, sunday) });
  const data = q.data;

  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v === null ? next.delete(k) : next.set(k, v));
    setParams(next, { replace: true });
  };

  const selected: SelectedCell | null = useMemo(() => {
    if (!data || !cellParam) return null;
    const [templateId, date] = cellParam.split("|");
    const row = data.rows.find((r) => r.templateId === templateId);
    return row && date ? { row, date } : null;
  }, [data, cellParam]);

  const assignDrop = useMutation({
    mutationFn: (v: { workerId: string; name: string; row: ScheduleRow; date: string }) => api.assign({ workerId: v.workerId, templateId: v.row.templateId, date: v.date }),
    onSuccess: (_a, v) => {
      toast.push({ tone: "ok", text: t("assign.done", { name: v.name, date: dayMonth(v.date) }) });
      void qc.invalidateQueries({ queryKey: ["schedule", projectId] });
      void qc.invalidateQueries({ queryKey: ["candidates"] });
    },
    onError: (e, v) => toast.push({ tone: "critical", text: violationText(e, v.date) }),
  });

  const copy = useMutation({
    mutationFn: (c: SelectedCell) => api.copyToNextWeek(c.row.templateId, c.date),
    onSuccess: (n, c) => {
      toast.push({ tone: "ok", text: t("sched.copy.done", { n, date: dayMonth(addDays(c.date, 7)) }) });
      void qc.invalidateQueries({ queryKey: ["schedule", projectId] });
    },
  });

  const unfilled = useMemo(() => {
    if (!data) return [];
    return data.rows.flatMap((r) =>
      r.cells.filter((c) => c.planned !== null && c.date >= DEMO_TODAY && c.assigned < c.planned).map((c) => ({ row: r, cell: c, short: c.planned! - c.assigned })),
    );
  }, [data]);

  const publish = useMutation({
    mutationFn: () => api.publishSchedule(projectId, monday),
    onSuccess: (r) => {
      setPublishOpen(false);
      toast.push({ tone: "ok", text: t("publish.done", { n: r.notified }) });
      void qc.invalidateQueries({ queryKey: ["schedule", projectId] });
    },
  });

  if (q.isError) return <ErrorState message={t("common.loadError")} retryLabel={t("common.retry")} onRetry={() => void q.refetch()} />;

  const week = isoWeek(monday).week;
  const pct = data && data.total ? Math.floor((data.filled / data.total) * 100) : 0;
  const stateTone = data?.publishState === "published" ? "ok" : "warn";
  const dates = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  return (
    <div>
      <PageHeader
        crumbs={[
          { label: t("nav.schedule"), to: "/workforce/projects" },
          { label: data?.client.shortName ?? "…" },
          { label: data?.site.name ?? "…" },
        ]}
        title={t("sched.title", { from: dayMonth(monday), to: dayMonth(sunday) })}
        meta={
          data ? (
            <>
              <Badge tone={stateTone} className="px-3 py-1 text-[13px]">
                {t(`sched.state.${data.publishState}`)}
              </Badge>
              <span className="rounded-full border border-border bg-surface px-3 py-1 text-[13px] text-muted tabular">{t("sched.fill", { x: data.filled, y: data.total, pct })}</span>
            </>
          ) : (
            <Skeleton className="h-7 w-80" />
          )
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex h-12 items-center rounded-[12px] border border-border bg-surface px-1.5">
          <Button variant="ghost" size="icon-sm" aria-label={t("sched.prevWeek")} onClick={() => setParam({ week: isoWeekToken(addDays(monday, -7)), cell: null })}>
            <ChevronLeft className="size-4" />
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <button className="min-w-28 px-3 text-[15px] font-bold" aria-label={t("sched.pickWeek")}>
                {t("sched.week", { n: week })}
              </button>
            </PopoverTrigger>
            <PopoverContent align="center">
              <Input
                type="week"
                aria-label={t("sched.pickWeek")}
                defaultValue={isoWeekToken(monday)}
                onChange={(e) => e.target.value && setParam({ week: e.target.value.replace("W0", "W"), cell: null })}
              />
            </PopoverContent>
          </Popover>
          <Button variant="ghost" size="icon-sm" aria-label={t("sched.nextWeek")} onClick={() => setParam({ week: isoWeekToken(addDays(monday, 7)), cell: null })}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <Segmented
          value={view}
          onChange={(v) => setParam({ view: v === "week" ? null : v })}
          options={[
            { value: "day", label: t("sched.view.day") },
            { value: "week", label: t("sched.view.week") },
            { value: "workers", label: t("sched.view.workers") },
          ]}
          className="h-12 items-center rounded-[12px] p-1.5"
        />
        {can("shift.autoassign.run") && (
          <Button variant="accent-outline" className="h-12 rounded-[12px] px-5" icon={<Sparkles className="size-4" />} disabled={!data} onClick={() => setAutoOpen(true)}>
            {t("sched.autoassign")}
          </Button>
        )}
        {can("shift.schedule.publish") && (
          <Button variant="primary" className="h-12 rounded-[12px] px-5" disabled={!data} loading={publish.isPending} onClick={() => (unfilled.length ? setPublishOpen(true) : publish.mutate())}>
            {t("sched.publish")}
          </Button>
        )}
      </div>

      {view !== "week" ? (
        <Card className="px-8 py-14 text-center text-muted">{t("sched.view.notReady", { view: t(`sched.view.${view}`) })}</Card>
      ) : (
        <div className="grid items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_392px] xl:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse">
                <thead>
                  <tr>
                    <th className="w-[200px] border-r border-b border-divider px-4 py-4 text-left text-[12px] font-semibold tracking-wide text-muted uppercase">{t("sched.col")}</th>
                    {dates.map((d) => {
                      const today = d === DEMO_TODAY;
                      return (
                        <th key={d} className={cn("border-b border-divider px-2 py-3 text-center", today && "bg-accent-soft")}>
                          <div className={cn("text-[12px] font-medium", today ? "text-accent-strong" : "text-muted")}>{weekdayShort(d)}</div>
                          <div className={cn("text-[15px] font-bold tabular", today && "text-accent-strong")}>{dayMonth(d)}</div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {!data
                    ? [0, 1, 2, 3, 4].map((i) => (
                        <tr key={i}>
                          <td className="border-r border-b border-divider p-4">
                            <Skeleton className="h-9" />
                          </td>
                          {dates.map((d) => (
                            <td key={d} className="border-b border-divider p-1.5">
                              <Skeleton className="h-[52px] rounded-[10px]" />
                            </td>
                          ))}
                        </tr>
                      ))
                    : data.rows.map((row) => (
                        <tr key={row.templateId}>
                          <th scope="row" className="border-r border-b border-divider px-4 py-3 text-left">
                            <div className="text-[14px] leading-tight font-semibold">{positionName(row.positionId)}</div>
                            <div className="mt-0.5 text-[13px] font-normal text-muted tabular">
                              {row.start}–{row.end}
                            </div>
                          </th>
                          {row.cells.map((c) => {
                            const tone = cellTone(c);
                            const key = `${row.templateId}|${c.date}`;
                            const isSel = cellParam === key;
                            const label = { position: positionName(row.positionId), shift: `${row.start}–${row.end}`, date: `${weekdayShort(c.date)} ${dayMonth(c.date)}` };
                            return (
                              <td key={c.date} className={cn("border-b border-divider p-1.5", c.date === DEMO_TODAY && "bg-accent-soft/40")}>
                                <div className="group relative">
                                  <button
                                    type="button"
                                    aria-pressed={isSel}
                                    aria-label={tone ? t("sched.cell.aria", { ...label, assigned: c.assigned, planned: c.planned }) : t("sched.cell.none", label)}
                                    onClick={() => setParam({ cell: key })}
                                    onDoubleClick={() => tone && setCellAction({ kind: "assigned", cell: { row, date: c.date } })}
                                    onDragOver={(e) => {
                                      if (tone && c.date >= DEMO_TODAY && e.dataTransfer.types.includes("application/x-kadreo-worker")) {
                                        e.preventDefault();
                                        setDragOver(key);
                                      }
                                    }}
                                    onDragLeave={() => setDragOver(null)}
                                    onDrop={(e) => {
                                      setDragOver(null);
                                      const raw = e.dataTransfer.getData("application/x-kadreo-worker");
                                      if (!raw) return;
                                      const { workerId, name } = JSON.parse(raw) as { workerId: string; name: string };
                                      assignDrop.mutate({ workerId, name, row, date: c.date });
                                    }}
                                    className={cn(
                                      "flex h-[52px] w-full flex-col items-center justify-center gap-1.5 rounded-[10px] border text-[15px] font-bold tabular transition-[box-shadow,background-color]",
                                      tone ? toneCell[tone] : "border-dashed border-input bg-bg/60 text-muted",
                                      isSel && "border-2 border-accent bg-accent-soft text-accent-ink",
                                      dragOver === key && "ring-4 ring-accent/30",
                                    )}
                                  >
                                    {tone ? (
                                      <>
                                        <span>
                                          {c.assigned} / {c.planned}
                                        </span>
                                        <span className="h-1 w-3/5 overflow-hidden rounded-full bg-black/8">
                                          <span className={cn("block h-full rounded-full", toneBar[tone])} style={{ width: `${Math.min(1, c.assigned / (c.planned || 1)) * 100}%` }} />
                                        </span>
                                      </>
                                    ) : (
                                      <>
                                        <span className="text-[14px] font-medium">—</span>
                                        <span className="h-1 w-3/5 rounded-full bg-black/6" />
                                      </>
                                    )}
                                  </button>
                                  {can("shift.schedule.edit") && (
                                    <Menu>
                                      <MenuTrigger asChild>
                                        <button
                                          type="button"
                                          aria-label={t("sched.menu.label")}
                                          className="absolute top-0.5 right-0.5 hidden size-6 items-center justify-center rounded-md bg-surface/90 text-muted shadow-card group-focus-within:flex group-hover:flex hover:text-ink"
                                        >
                                          <MoreHorizontal className="size-3.5" />
                                        </button>
                                      </MenuTrigger>
                                      <MenuContent align="start">
                                        {tone && <MenuItem onSelect={() => setCellAction({ kind: "assigned", cell: { row, date: c.date } })}>{t("sched.menu.assigned")}</MenuItem>}
                                        <MenuItem disabled={c.date < DEMO_TODAY} onSelect={() => setCellAction({ kind: "changePlan", cell: { row, date: c.date } })}>
                                          {t("sched.menu.changePlan")}
                                        </MenuItem>
                                        {tone && (
                                          <MenuItem disabled={c.date < DEMO_TODAY} onSelect={() => copy.mutate({ row, date: c.date })}>
                                            {t("sched.menu.copy")}
                                          </MenuItem>
                                        )}
                                        {tone && (
                                          <MenuItem tone="critical" disabled={c.date < DEMO_TODAY} onSelect={() => setCellAction({ kind: "cancel", cell: { row, date: c.date } })}>
                                            {t("sched.menu.cancel")}
                                          </MenuItem>
                                        )}
                                      </MenuContent>
                                    </Menu>
                                  )}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-5 border-t border-divider px-5 py-3.5 text-[13px] text-muted">
              {(
                [
                  ["full", "border-ok/50 bg-ok-bg"],
                  ["warn", "border-warn bg-warn-bg"],
                  ["crit", "border-critical/60 bg-critical-bg"],
                  ["selected", "border-2 border-accent bg-accent-soft"],
                ] as const
              ).map(([k, cls]) => (
                <span key={k} className="flex items-center gap-2">
                  <span className={cn("size-3.5 rounded-[4px] border", cls)} />
                  {t(`sched.legend.${k}`)}
                </span>
              ))}
            </div>
          </Card>
          <CandidatesPanel selected={selected} projectId={projectId} />
        </div>
      )}

      {data && <AutoAssignDialog open={autoOpen} onOpenChange={setAutoOpen} schedule={data} selected={selected} />}
      <CellDialogs action={cellAction} onClose={() => setCellAction(null)} projectId={projectId} />

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent title={t("publish.unfilled.title")} closeLabel={t("common.close")} width={520}>
          <p className="text-[14px] text-muted">{t("publish.unfilled.text", { n: unfilled.reduce((s, u) => s + u.short, 0) })}</p>
          <ul className="mt-4 flex flex-col gap-1.5 text-[14px]">
            {unfilled.slice(0, 6).map((u) => (
              <li key={`${u.row.templateId}|${u.cell.date}`} className="flex justify-between rounded-[8px] bg-bg px-3 py-2">
                <span>
                  {weekdayShort(u.cell.date)} {dayMonth(u.cell.date)} · {positionName(u.row.positionId)} {u.row.start}–{u.row.end}
                </span>
                <span className="font-semibold text-critical-text tabular">−{u.short}</span>
              </li>
            ))}
            {unfilled.length > 6 && <li className="px-3 text-muted">{t("publish.unfilled.more", { n: unfilled.length - 6 })}</li>}
          </ul>
          <DialogFooter>
            <Button onClick={() => setPublishOpen(false)}>{t("common.cancel")}</Button>
            <Button variant="primary" loading={publish.isPending} onClick={() => publish.mutate()}>
              {t("publish.anyway")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
