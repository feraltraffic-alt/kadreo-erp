import type { Decision, ProblemSite } from "@kadreo/domain";
import { useI18n } from "@kadreo/i18n";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { ReplacementSheet } from "../../components/ReplacementSheet";
import { now, syncServerTime, useNow } from "../../device";
import { loc, siteDate, siteHm, useErrorText, useShortDate } from "../../format";
import { useApi, useSession } from "../../session";
import { color } from "../../theme";
import { Button, Card, Choice, DarkCard, ErrorBox, Field, IconButton, Input, Loading, Row, Screen, SectionTitle, Sheet, Text, Toast } from "../../ui";
import { BrigadeScreen } from "../leader/BrigadeScreen";

/* ------------------------------------------------------- decisions with undo */

const REJECT_REASONS = ["no_proof", "not_on_shift", "wrong_time", "other"] as const;

/**
 * ✓ runs the decision after a 5-second «Одобрено · Отменить» window (14.3); ✕ asks for a reason
 * that goes to the requester. Decisions the user already acted on are hidden at once.
 */
function useDecisionActions(onChanged: () => void) {
  const api = useApi();
  const { t } = useI18n();
  const errorText = useErrorText();
  const [hidden, setHidden] = useState<string[]>([]);
  const [toast, setToast] = useState<{ text: string; undo?: () => void; tone?: "ok" | "critical" } | null>(null);
  const [rejecting, setRejecting] = useState<Decision | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => () => timers.current.forEach((h) => clearTimeout(h)), []);

  function approve(d: Decision) {
    setHidden((h) => [...h, d.id]);
    const run = setTimeout(async () => {
      timers.current.delete(d.id);
      setToast(null);
      try {
        await api.decide(d.id, d.kind, "approve");
      } catch (e) {
        setHidden((h) => h.filter((x) => x !== d.id));
        setToast({ text: errorText(e), tone: "critical" });
      }
      onChanged();
    }, 5000);
    timers.current.set(d.id, run);
    setToast({
      text: t("decision.approved"),
      undo: () => {
        clearTimeout(run);
        timers.current.delete(d.id);
        setHidden((h) => h.filter((x) => x !== d.id));
        setToast(null);
      },
    });
  }
  async function reject(d: Decision, reason: string) {
    setRejecting(null);
    setHidden((h) => [...h, d.id]);
    try {
      await api.decide(d.id, d.kind, "reject", reason);
      setToast({ text: t("decision.rejected"), tone: "ok" });
      setTimeout(() => setToast(null), 3000);
    } catch (e) {
      setHidden((h) => h.filter((x) => x !== d.id));
      setToast({ text: errorText(e), tone: "critical" });
    }
    onChanged();
  }

  const ui = (
    <>
      {toast ? <Toast text={toast.text} tone={toast.tone} action={toast.undo ? t("decision.undo") : undefined} onAction={toast.undo} /> : null}
      {rejecting ? <RejectSheet d={rejecting} onClose={() => setRejecting(null)} onReject={(r) => void reject(rejecting, r)} /> : null}
    </>
  );
  return { hidden, approve, askReject: setRejecting, ui };
}

function RejectSheet({ d, onClose, onReject }: { d: Decision; onClose: () => void; onReject: (reason: string) => void }) {
  const { t } = useI18n();
  const [r, setR] = useState<(typeof REJECT_REASONS)[number] | null>(null);
  const [text, setText] = useState("");
  const reason = [r && r !== "other" ? t(`reject_reason.${r}`) : "", text.trim()].filter(Boolean).join(": ");
  return (
    <Sheet open onClose={onClose} title={t("decision.reject_title", { name: d.workerName })}>
      <Field label={t("decision.reason")}>
        <Choice value={r} onChange={setR} options={REJECT_REASONS.map((x) => ({ value: x, label: t(`reject_reason.${x}`) }))} />
      </Field>
      <Field label={t("issue.comment")} hint={`${text.length}/300`}>
        <Input value={text} onChangeText={setText} maxLength={300} multiline accessibilityLabel={t("issue.comment")} style={{ minHeight: 70, textAlignVertical: "top" }} />
      </Field>
      <Button kind="danger" label={t("decision.reject")} disabled={!r || (r === "other" && !text.trim())} onPress={() => onReject(reason)} />
    </Sheet>
  );
}

function DecisionRow({ d, onApprove, onReject, divider }: { d: Decision; onApprove: () => void; onReject: () => void; divider: boolean }) {
  const { t } = useI18n();
  const title = d.kind === "manual_clock" ? t("decision.manual_clock") : t("decision.clock_issue");
  const by = d.kind === "manual_clock" ? (d.reason === "no_shift" ? t("decision.from_kiosk") : t("decision.from_leader", { name: d.requestedByName })) : t("decision.from_worker");
  return (
    <Row gap={10} style={{ paddingVertical: 12, borderTopWidth: divider ? 1 : 0, borderTopColor: color.divider }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text w={700}>
          {title} · {d.workerName}
        </Text>
        <Text c={color.muted} size={13}>
          {by} · {t(`type.${d.type}`)} {d.time} · {t(`decision.reason.${d.reason}`)} · {d.siteName}
        </Text>
        {d.comment ? (
          <Text c={color.muted} size={13} numberOfLines={2}>
            «{d.comment}»
          </Text>
        ) : null}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`${t("decision.reject")}: ${d.workerName}`} onPress={onReject} style={{ width: 44, height: 44, borderRadius: 12, borderWidth: 1, borderColor: color.input, alignItems: "center", justifyContent: "center" }}>
        <X size={20} color={color.criticalText} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`${t("decision.approve")}: ${d.workerName}`} onPress={onApprove} style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: color.accentStrong, alignItems: "center", justifyContent: "center" }}>
        <Check size={22} color="#fff" />
      </Pressable>
    </Row>
  );
}

/* ------------------------------------------------------------------ summary */

type SummarySheet = { kind: "none" } | { kind: "replace"; p: ProblemSite } | { kind: "urgent" } | { kind: "broadcast" } | { kind: "alerts" };

export function SummaryScreen({ onOpenSites, onOpenDecisions, onOpenSite }: { onOpenSites: () => void; onOpenDecisions: () => void; onOpenSite: (siteId: string) => void }) {
  const api = useApi();
  const { t, num } = useI18n();
  const qc = useQueryClient();
  const errorText = useErrorText();
  const shortDate = useShortDate();
  const q = useQuery({
    queryKey: ["summary"],
    queryFn: async () => {
      const s = await api.managerSummary();
      syncServerTime(s.now);
      return s;
    },
    refetchInterval: 60000,
  });
  const nowD = useNow(15000);
  const [sheet, setSheet] = useState<SummarySheet>({ kind: "none" });
  const [msg, setMsg] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["summary"] }).then(() => qc.invalidateQueries({ queryKey: ["decisions"] }));
  const actions = useDecisionActions(refresh);
  function say(x: string) {
    setMsg(x);
    setTimeout(() => setMsg(null), 3500);
  }

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Screen><ErrorBox message={errorText(q.error)} onRetry={() => q.refetch()} /></Screen>;
  const s = q.data;
  const decisions = s.decisions.filter((d) => !actions.hidden.includes(d.id));
  const decisionsLeft = s.decisionsTotal - actions.hidden.length;

  return (
    <View style={{ flex: 1 }}>
      <Screen>
        <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text c={color.muted}>
              {shortDate(siteDate(nowD))} · {siteHm(nowD).hm} · {t("summary.sites_n", { n: s.sitesInScope })}
            </Text>
            <Text w={800} size={25} accessibilityRole="header">
              {t("tab.summary")}
            </Text>
          </View>
          <IconButton label={t("summary.alerts_n", { n: s.openAlerts })} badge={s.openAlerts} onPress={() => setSheet({ kind: "alerts" })}>
            <Bell size={21} color={color.ink} />
          </IconButton>
        </Row>

        <DarkCard style={{ gap: 8 }}>
          <Row style={{ justifyContent: "space-between" }}>
            <Text c={color.darkMuted}>{t("summary.staffing")}</Text>
            <Text c={color.darkMuted} size={13}>
              {t("summary.target", { pct: s.staffing.targetPct })}
            </Text>
          </Row>
          <Row gap={12} style={{ alignItems: "baseline" }}>
            <Text w={800} size={40} c="#fff" style={{ lineHeight: 46 }} testID="staffing-pct">
              {num(s.staffing.pct, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
            </Text>
            <Text c="#d0d5dd">{t("summary.on_shifts", { a: s.staffing.onShift, b: s.staffing.planned })}</Text>
          </Row>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: color.darkBorder, overflow: "hidden" }}>
            <View style={{ width: `${Math.min(100, s.staffing.pct)}%`, height: 8, backgroundColor: s.staffing.pct >= s.staffing.targetPct ? color.ok : color.accent }} />
          </View>
        </DarkCard>

        <SectionTitle title={t("summary.problems")} action={t("summary.all_n", { n: s.problemSitesTotal })} onAction={onOpenSites} />
        {s.problemSites.length === 0 ? <Text c={color.muted}>{t("summary.no_problems")}</Text> : null}
        {s.problemSites.map((p) => (
          <Card key={p.siteId} bar={p.severity === "critical" ? "critical" : "warn"} style={{ paddingVertical: 14 }}>
            <Row style={{ justifyContent: "space-between" }} gap={10}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text w={700} size={16}>
                  {p.siteName}
                </Text>
                <Text c={color.muted} size={14}>
                  {p.onSite}/{p.planned} · {p.unreplaced > 0 ? t("summary.unreplaced", { n: p.unreplaced }) : t("summary.late_n", { n: p.late })}
                </Text>
              </View>
              {p.unreplaced > 0 && p.templateId ? (
                <Button kind="primary" size="sm" label={t("manager.find_replacement")} onPress={() => setSheet({ kind: "replace", p })} />
              ) : (
                <Pressable accessibilityRole="link" onPress={() => onOpenSite(p.siteId)} hitSlop={10}>
                  <Text w={700} c={color.accentStrong}>
                    {t("summary.open")}
                  </Text>
                </Pressable>
              )}
            </Row>
            {p.unreplaced > 0 ? (
              <Pressable accessibilityRole="link" onPress={() => onOpenSite(p.siteId)} style={{ marginTop: 8 }}>
                <Text w={600} size={13} c={color.accentStrong}>
                  {t("summary.open_shift")}
                </Text>
              </Pressable>
            ) : null}
          </Card>
        ))}

        <Card style={{ paddingVertical: 6 }}>
          <Row style={{ justifyContent: "space-between", paddingTop: 10 }}>
            <Text w={700} size={17}>
              {t("summary.decisions_n", { n: decisionsLeft })}
            </Text>
            <Pressable accessibilityRole="link" onPress={onOpenDecisions} hitSlop={8}>
              <Text w={700} c={color.accentStrong}>
                {t("summary.all")}
              </Text>
            </Pressable>
          </Row>
          {decisions.length === 0 ? (
            <Text c={color.muted} style={{ paddingVertical: 12 }}>
              {t("decision.none")}
            </Text>
          ) : null}
          {decisions.map((d, i) => (
            <DecisionRow key={d.id} d={d} divider={i > 0} onApprove={() => actions.approve(d)} onReject={() => actions.askReject(d)} />
          ))}
        </Card>

        <Row gap={10}>
          <Button label={t("summary.urgent")} style={{ flex: 1 }} onPress={() => setSheet({ kind: "urgent" })} />
          <Button label={t("summary.broadcast")} style={{ flex: 1 }} onPress={() => setSheet({ kind: "broadcast" })} />
        </Row>
      </Screen>

      {actions.ui}
      {msg ? <Toast text={msg} tone="ok" /> : null}
      {sheet.kind === "replace" && sheet.p.templateId ? (
        <ReplacementSheet
          templateId={sheet.p.templateId}
          replacesId={sheet.p.replacesId}
          date={siteDate(now())}
          title={t("replace.title", { site: sheet.p.siteName })}
          onClose={() => setSheet({ kind: "none" })}
          onDone={(n) => {
            setSheet({ kind: "none" });
            say(t("replace.offered", { n }));
            refresh();
          }}
        />
      ) : null}
      {sheet.kind === "urgent" ? <UrgentSheet onClose={() => setSheet({ kind: "none" })} onDone={(n) => { setSheet({ kind: "none" }); say(t("urgent.sent", { n })); }} /> : null}
      {sheet.kind === "broadcast" ? <BroadcastSheet onClose={() => setSheet({ kind: "none" })} onDone={(n) => { setSheet({ kind: "none" }); say(t("broadcast.sent", { n })); }} /> : null}
      {sheet.kind === "alerts" ? <AlertsSheet onClose={() => setSheet({ kind: "none" })} /> : null}
    </View>
  );
}

function AlertsSheet({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const { t, time } = useI18n();
  const { locale } = useSession();
  const q = useQuery({ queryKey: ["alerts"], queryFn: () => api.alerts() });
  const list = [...(q.data ?? [])].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));
  return (
    <Sheet open onClose={onClose} title={t("summary.alerts")}>
      {list.map((a) => (
        <Card key={a.id} bar={a.severity === "critical" ? "critical" : "warn"} style={{ gap: 4, paddingVertical: 12 }}>
          <Text w={700}>{loc(a.title, locale)}</Text>
          <Text c={color.muted} size={13}>
            {loc(a.context, locale)} · {time(a.createdAt)}
          </Text>
        </Card>
      ))}
    </Sheet>
  );
}

function useSiteTemplates() {
  const api = useApi();
  return useQuery({ queryKey: ["site-templates"], queryFn: () => api.siteTemplates(), staleTime: 300000 });
}

function UrgentSheet({ onClose, onDone }: { onClose: () => void; onDone: (n: number) => void }) {
  const api = useApi();
  const { t } = useI18n();
  const errorText = useErrorText();
  const sites = useSiteTemplates();
  const today = siteDate(now());
  const tomorrow = (() => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  })();
  const [siteId, setSiteId] = useState<string | null>(null);
  const [tplId, setTplId] = useState<string | null>(null);
  const [date, setDate] = useState(today);
  const [n, setN] = useState(1);
  const [bonus, setBonus] = useState<"0" | "25" | "50" | "100">("50");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const site = sites.data?.find((s) => s.siteId === siteId);
  return (
    <Sheet open onClose={onClose} title={t("summary.urgent")}>
      <Field label={t("urgent.site")}>
        <Choice value={siteId} onChange={(v) => { setSiteId(v); setTplId(null); }} options={(sites.data ?? []).slice(0, 12).map((s) => ({ value: s.siteId, label: s.siteName.split(" · ")[0]! }))} />
      </Field>
      {site ? (
        <Field label={t("urgent.shift")}>
          <Choice value={tplId} onChange={setTplId} options={site.templates.map((x) => ({ value: x.id, label: `${x.start}–${x.end}` }))} />
        </Field>
      ) : null}
      <Field label={t("urgent.date")}>
        <Choice value={date} onChange={setDate} options={[{ value: today, label: t("urgent.today") }, { value: tomorrow, label: t("urgent.tomorrow") }]} />
      </Field>
      <Field label={t("urgent.people")}>
        <Row>
          <Button size="sm" label="−" onPress={() => setN(Math.max(1, n - 1))} accessibilityLabel={t("urgent.less")} />
          <Text w={800} size={20} style={{ minWidth: 36, textAlign: "center" }}>
            {n}
          </Text>
          <Button size="sm" label="+" onPress={() => setN(Math.min(20, n + 1))} accessibilityLabel={t("urgent.more")} />
        </Row>
      </Field>
      <Field label={t("urgent.bonus")}>
        <Choice value={bonus} onChange={setBonus} options={(["0", "25", "50", "100"] as const).map((b) => ({ value: b, label: b === "0" ? t("urgent.no_bonus") : `+${b}` }))} />
      </Field>
      <Input value={comment} onChangeText={setComment} placeholder={t("urgent.comment")} maxLength={300} accessibilityLabel={t("urgent.comment")} />
      {error ? <Text c={color.criticalText}>{error}</Text> : null}
      <Button
        kind="primary"
        label={t("urgent.publish")}
        disabled={!siteId || !tplId}
        busy={busy}
        onPress={async () => {
          setBusy(true);
          try {
            const r = await api.urgentShift({ siteId: siteId!, templateId: tplId!, date, headcount: n, bonusPoints: Number(bonus), comment });
            onDone(r.offered);
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      />
    </Sheet>
  );
}

function BroadcastSheet({ onClose, onDone }: { onClose: () => void; onDone: (n: number) => void }) {
  const api = useApi();
  const { t } = useI18n();
  const errorText = useErrorText();
  const sites = useSiteTemplates();
  const [siteId, setSiteId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const presets = [t("broadcast.p1"), t("broadcast.p2"), t("broadcast.p3")];
  return (
    <Sheet open onClose={onClose} title={t("summary.broadcast")}>
      <Field label={t("urgent.site")}>
        <Choice value={siteId} onChange={setSiteId} options={(sites.data ?? []).slice(0, 12).map((s) => ({ value: s.siteId, label: s.siteName.split(" · ")[0]! }))} />
      </Field>
      <Field label={t("broadcast.template")}>
        <Choice value={presets.includes(text) ? text : null} onChange={setText} options={presets.map((p) => ({ value: p, label: p }))} />
      </Field>
      <Input value={text} onChangeText={setText} multiline maxLength={500} placeholder={t("broadcast.text")} accessibilityLabel={t("broadcast.text")} style={{ minHeight: 80, textAlignVertical: "top" }} />
      <Text c={color.muted} size={13}>
        {t("broadcast.hint")}
      </Text>
      {error ? <Text c={color.criticalText}>{error}</Text> : null}
      <Button
        kind="primary"
        label={t("broadcast.send")}
        disabled={!siteId || !text.trim()}
        busy={busy}
        onPress={async () => {
          setBusy(true);
          try {
            onDone((await api.broadcast({ siteId: siteId!, text: text.trim() })).recipients);
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      />
    </Sheet>
  );
}

/* -------------------------------------------------------------------- sites */

export function SitesScreen() {
  const api = useApi();
  const { t } = useI18n();
  const errorText = useErrorText();
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["sites-live"], queryFn: () => api.sites(), refetchInterval: 60000 });
  if (open) return <BrigadeScreen siteId={open} onBack={() => setOpen(null)} />;
  if (q.isLoading) return <Loading />;
  const order = { critical: 0, deviation: 1, ok: 2, no_shift: 3 } as Record<string, number>;
  const list = [...(q.data ?? [])].filter((s) => s.planned > 0).sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.siteName.localeCompare(b.siteName));
  return (
    <Screen>
      <Text w={800} size={25} accessibilityRole="header">
        {t("tab.sites")}
      </Text>
      {q.error ? <ErrorBox message={errorText(q.error)} /> : null}
      {list.map((s) => (
        <Card key={s.siteId} bar={s.status === "critical" ? "critical" : s.status === "deviation" ? "warn" : "ok"} onPress={() => setOpen(s.siteId)} style={{ gap: 4, paddingVertical: 12 }}>
          <Row style={{ justifyContent: "space-between" }}>
            <Text w={700} style={{ flex: 1 }}>
              {s.siteName}
            </Text>
            <Text w={800}>
              {s.actual}/{s.planned}
            </Text>
          </Row>
          <Text c={color.muted} size={13}>
            {s.clientName} · {s.shiftLabel} · {t("sites.late_noshow", { late: s.late, ns: s.noShows })}
          </Text>
        </Card>
      ))}
    </Screen>
  );
}

export function SiteBrigadeScreen({ siteId, onBack }: { siteId: string; onBack: () => void }) {
  return <BrigadeScreen siteId={siteId} onBack={onBack} />;
}

/* ---------------------------------------------------------------- decisions */

export function DecisionsScreen() {
  const api = useApi();
  const { t } = useI18n();
  const qc = useQueryClient();
  const errorText = useErrorText();
  const q = useQuery({ queryKey: ["decisions"], queryFn: () => api.decisions(), refetchInterval: 60000 });
  const actions = useDecisionActions(() => void qc.invalidateQueries({ queryKey: ["decisions"] }).then(() => qc.invalidateQueries({ queryKey: ["summary"] })));
  if (q.isLoading) return <Loading />;
  const list = (q.data ?? []).filter((d) => !actions.hidden.includes(d.id));
  return (
    <View style={{ flex: 1 }}>
      <Screen>
        <Text w={800} size={25} accessibilityRole="header">
          {t("tab.decisions")}
        </Text>
        {q.error ? <ErrorBox message={errorText(q.error)} /> : null}
        <Card style={{ paddingVertical: 4 }}>
          {list.length === 0 ? (
            <Text c={color.muted} style={{ paddingVertical: 14 }}>
              {t("decision.none")}
            </Text>
          ) : null}
          {list.map((d, i) => (
            <DecisionRow key={d.id} d={d} divider={i > 0} onApprove={() => actions.approve(d)} onReject={() => actions.askReject(d)} />
          ))}
        </Card>
        <Text c={color.muted} size={13}>
          {t("decision.web_hint")}
        </Text>
      </Screen>
      {actions.ui}
    </View>
  );
}

export function useDecisionsCount(): number {
  const api = useApi();
  const q = useQuery({ queryKey: ["decisions"], queryFn: () => api.decisions(), refetchInterval: 60000 });
  return q.data?.length ?? 0;
}

