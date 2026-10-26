import type { BrigadeMember, BrigadeView, ManualClockInput } from "@kadreo/domain";
import { useI18n } from "@kadreo/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { ReplacementSheet } from "../../components/ReplacementSheet";
import { syncServerTime, useNow } from "../../device";
import { loc, siteHm, useErrorText, useShortDate } from "../../format";
import { useApi, useSession } from "../../session";
import { color, toneColors, type Tone } from "../../theme";
import { Badge, Button, Card, Choice, DarkCard, ErrorBox, Field, Input, Loading, Row, Screen, Sheet, Text, Toast } from "../../ui";

type Filter = "attention" | "all" | "on_site" | "late" | "no_show";
type SheetState = { kind: "none" } | { kind: "member"; m: BrigadeMember } | { kind: "manual"; m: BrigadeMember } | { kind: "reply"; m: BrigadeMember } | { kind: "output" } | { kind: "shifts" } | { kind: "replace"; m: BrigadeMember };

const statusTone: Record<BrigadeMember["status"], Tone> = { on_site: "ok", on_break: "ok", finished: "neutral", late: "warn", no_show: "critical", manual_pending: "warn" };

/**
 * «Моя бригада» (14.2): attendance of the team leader's shift in real time. The manager opens the
 * same view of any site from «Сводка» (14.3-06), with manager actions instead of manual clock-ins.
 */
export function BrigadeScreen({ siteId, onBack }: { siteId?: string; onBack?: () => void }) {
  const api = useApi();
  const { t } = useI18n();
  const qc = useQueryClient();
  const errorText = useErrorText();
  const shortDate = useShortDate();
  const manager = !!siteId;
  const [shiftKey, setShiftKey] = useState<string | undefined>(undefined);
  const [filter, setFilter] = useState<Filter | null>(null);
  const [sheet, setSheet] = useState<SheetState>({ kind: "none" });
  const [toast, setToast] = useState<{ text: string; tone?: "ok" | "critical" } | null>(null);
  const qk = ["brigade", siteId ?? "mine", shiftKey ?? "current"];
  const q = useQuery({
    queryKey: qk,
    queryFn: async () => {
      const b = siteId ? await api.siteBrigade(siteId) : await api.brigade(shiftKey);
      syncServerTime(b.now);
      return b;
    },
    refetchInterval: 30000,
  });
  const nowD = useNow(15000);

  function say(text: string, tone: "ok" | "critical" = "ok") {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 3500);
  }
  const setData = (b: BrigadeView) => qc.setQueryData(qk, b);
  const replace = useMutation({
    mutationFn: (m: BrigadeMember) => api.requestReplacement(m.assignmentId),
    onSuccess: (b) => {
      setData(b);
      say(t("brigade.replacement_requested"));
    },
    onError: (e) => say(errorText(e), "critical"),
  });

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Screen><ErrorBox message={errorText(q.error)} onRetry={() => q.refetch()} /></Screen>;
  const b = q.data;
  const attention = b.members.filter((m) => m.needsAttention);
  const f: Filter = filter ?? (attention.length ? "attention" : "all");
  const list = b.members.filter((m) => {
    if (f === "attention") return m.needsAttention;
    if (f === "on_site") return ["on_site", "on_break", "finished", "manual_pending"].includes(m.status);
    if (f === "late") return m.status === "late";
    if (f === "no_show") return m.status === "no_show";
    return true;
  });
  const hm = siteHm(nowD).hm;

  return (
    <View style={{ flex: 1 }}>
      <Screen>
        <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text c={color.muted}>
              {manager ? t("brigade.site_title") : t("brigade.my_title")} · {shortDate(b.shift.date)} · {hm}
            </Text>
            <Text w={800} size={21} accessibilityRole="header">
              {b.shift.siteName} · {b.shift.start}–{b.shift.end}
            </Text>
          </View>
          {manager && onBack ? <Button size="sm" label={t("common.back")} onPress={onBack} /> : null}
          {!manager && b.shifts.length > 1 ? <Button size="sm" label={t("brigade.switch")} onPress={() => setSheet({ kind: "shifts" })} /> : null}
        </Row>

        <Row gap={8}>
          <Counter n={b.counters.planned} label={t("brigade.planned")} tone="neutral" active={f === "all"} onPress={() => setFilter("all")} />
          <Counter n={b.counters.onSite} label={t("brigade.on_site")} tone="ok" active={f === "on_site"} onPress={() => setFilter("on_site")} />
          <Counter n={b.counters.late} label={t("brigade.late")} tone="warn" active={f === "late"} onPress={() => setFilter("late")} />
          <Counter n={b.counters.noShow} label={t("brigade.no_show")} tone="critical" active={f === "no_show"} onPress={() => setFilter("no_show")} />
        </Row>

        <Row gap={8}>
          <Chip label={t("brigade.attention_n", { n: attention.length })} on={f === "attention"} onPress={() => setFilter("attention")} />
          <Chip label={t("brigade.all_n", { n: b.members.length })} on={f === "all"} onPress={() => setFilter("all")} />
        </Row>

        {list.length === 0 ? <Text c={color.muted}>{t("brigade.empty")}</Text> : null}
        {list.map((m) => (
          <MemberCard
            key={m.assignmentId}
            m={m}
            manager={manager}
            onOpen={() => setSheet({ kind: "member", m })}
            onReplace={() => (manager ? setSheet({ kind: "replace", m }) : replace.mutate(m))}
            replacing={replace.isPending && replace.variables?.assignmentId === m.assignmentId}
            onManual={() => setSheet({ kind: "manual", m })}
            onReply={() => setSheet({ kind: "reply", m })}
          />
        ))}

        {b.output ? (
          <DarkCard style={{ gap: 12 }}>
            <Row style={{ justifyContent: "space-between" }}>
              <Text w={700} size={17} c="#fff">
                {t("output.title")}
              </Text>
              <Text c={color.darkMuted} size={13}>
                {t("output.norm", { n: b.output.norm, unit: t(`unit.${b.output.unit}`) })}
              </Text>
            </Row>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: color.darkBorder, overflow: "hidden" }}>
              <View style={{ width: `${Math.min(100, (b.output.value / b.output.norm) * 100)}%`, height: 8, backgroundColor: color.accent }} />
            </View>
            <Row style={{ justifyContent: "space-between" }}>
              <Text c="#d0d5dd" size={14} style={{ flex: 1 }}>
                {t("output.line", { v: b.output.value, pct: Math.round((b.output.value / b.output.norm) * 100), time: hm, plan: b.output.planNow })}
              </Text>
              {b.output.source === "team_leader" && !manager ? (
                <Button kind="light" size="sm" label={t("output.enter")} onPress={() => setSheet({ kind: "output" })} />
              ) : (
                <Text c={color.darkMuted} size={12}>
                  {b.output.source === "client" ? t("output.client", { time: b.output.updatedAt ? siteHm(new Date(b.output.updatedAt)).hm : "—" }) : ""}
                </Text>
              )}
            </Row>
          </DarkCard>
        ) : null}
      </Screen>

      {toast ? <Toast text={toast.text} tone={toast.tone} /> : null}

      {sheet.kind === "member" ? <MemberSheet m={sheet.m} onClose={() => setSheet({ kind: "none" })} /> : null}
      {sheet.kind === "manual" ? (
        <ManualClockSheet
          m={sheet.m}
          nowHm={hm}
          onClose={() => setSheet({ kind: "none" })}
          onSubmit={async (input) => {
            try {
              setData(await api.manualClock(input));
              setSheet({ kind: "none" });
              say(t("manual.sent"));
            } catch (e) {
              say(errorText(e), "critical");
            }
          }}
        />
      ) : null}
      {sheet.kind === "reply" ? (
        <ReplySheet
          m={sheet.m}
          onClose={() => setSheet({ kind: "none" })}
          onSend={async (text) => {
            await api.replyToWorker(sheet.m.workerId, text);
            setSheet({ kind: "none" });
            say(t("reply.sent"));
          }}
        />
      ) : null}
      {sheet.kind === "output" && b.output ? (
        <OutputSheet
          current={b.output.value}
          unit={t(`unit.${b.output.unit}`)}
          onClose={() => setSheet({ kind: "none" })}
          onSave={async (v) => {
            try {
              setData(await api.recordOutput(b.shift.key, v));
              setSheet({ kind: "none" });
              say(t("output.saved"));
            } catch (e) {
              say(errorText(e), "critical");
            }
          }}
        />
      ) : null}
      {sheet.kind === "shifts" ? (
        <Sheet open onClose={() => setSheet({ kind: "none" })} title={t("brigade.switch")}>
          {b.shifts.map((s) => (
            <Button key={s.key} kind={s.key === b.shift.key ? "primary" : "secondary"} label={`${shortDate(s.date)} · ${s.start}–${s.end}`} onPress={() => { setShiftKey(s.key); setSheet({ kind: "none" }); }} />
          ))}
        </Sheet>
      ) : null}
      {sheet.kind === "replace" ? (
        <ReplacementSheet
          templateId={sheet.m.templateId}
          replacesId={sheet.m.assignmentId}
          date={b.shift.date}
          title={t("replace.for", { name: `${sheet.m.firstName} ${sheet.m.lastName}` })}
          onClose={() => setSheet({ kind: "none" })}
          onDone={(n) => {
            setSheet({ kind: "none" });
            say(t("replace.offered", { n }));
            void q.refetch();
          }}
        />
      ) : null}
    </View>
  );
}

function Counter({ n, label, tone, active, onPress }: { n: number; label: string; tone: Tone; active: boolean; onPress: () => void }) {
  const c = toneColors[tone];
  const white = tone === "neutral";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${n}`}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{ flex: 1, minHeight: 78, borderRadius: 14, borderWidth: active ? 2 : 1, borderColor: active ? color.ink : white ? color.border : c.bar + "55", backgroundColor: white ? "#fff" : c.bg, alignItems: "center", justifyContent: "center", gap: 2 }}
    >
      <Text w={800} size={24} c={white ? color.ink : c.fg}>
        {n}
      </Text>
      <Text w={500} size={12} c={white ? color.muted : c.fg}>
        {label}
      </Text>
    </Pressable>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={onPress} style={{ paddingHorizontal: 14, height: 38, justifyContent: "center", borderRadius: 999, backgroundColor: on ? color.dark : "#fff", borderWidth: 1, borderColor: on ? color.dark : color.border }}>
      <Text w={700} size={14} c={on ? "#fff" : color.ink}>
        {label}
      </Text>
    </Pressable>
  );
}

function MemberCard({ m, manager, onOpen, onReplace, replacing, onManual, onReply }: { m: BrigadeMember; manager: boolean; onOpen: () => void; onReplace: () => void; replacing: boolean; onManual: () => void; onReply: () => void }) {
  const { t } = useI18n();
  const { locale } = useSession();
  const tone = m.outsideGeofence || (m.issue && m.status !== "no_show") ? "warn" : statusTone[m.status];
  let sub: string;
  if (m.status === "no_show") sub = m.issue?.kind === "no_gps" ? t("member.gps_problem") : t("member.no_show");
  else if (m.status === "late") sub = m.issue?.kind === "late" ? t("member.wrote", { text: m.issue.comment }) : t("member.late");
  else if (m.status === "manual_pending") sub = t("member.manual_pending");
  else if (m.outsideGeofence) sub = t("member.outside", { time: m.clockIn ?? "" });
  else if (m.status === "on_break") sub = t("member.on_break");
  else if (m.status === "finished") sub = t("member.finished");
  else sub = t("member.on_site", { time: m.clockIn ?? "" });
  const reported = m.issue?.kind === "late";
  return (
    <Card bar={m.needsAttention ? tone : undefined} onPress={onOpen} style={{ gap: 10 }} testID={`member-${m.number}`}>
      <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text w={700} size={16}>
            {m.firstName} {m.lastName}
            {m.isReplacement ? <Text c={color.muted} size={13}> · {t("member.replacement")}</Text> : null}
          </Text>
          <Text c={color.muted} size={14}>
            {loc(m.positionName, locale)} · {sub}
          </Text>
          {m.replacement ? (
            <Text c={color.warnText} size={13} w={600}>
              {m.replacement.status === "searching" ? t("member.searching") : t("member.replaced_by", { name: m.replacement.name })}
            </Text>
          ) : null}
        </View>
        {m.status === "no_show" || (m.status === "late" && !reported) || (m.clockIn && m.lateMin > 0) ? <Badge label={`+${m.lateMin} ${t("unit.min")}`} tone={m.status === "no_show" ? "critical" : "warn"} /> : null}
      </Row>
      {m.status === "no_show" && m.issue?.kind !== "no_gps" ? (
        <Row gap={10}>
          <Button label={t("member.call")} style={{ flex: 1 }} onPress={() => void Linking.openURL(`tel:${m.phone.replace(/\s/g, "")}`)} />
          <Button kind="primary" label={manager ? t("manager.find_replacement") : t("member.request_replacement")} style={{ flex: 1.3 }} disabled={m.replacement?.status === "searching"} busy={replacing} onPress={onReplace} />
        </Row>
      ) : null}
      {reported && !manager ? (
        <Row style={{ justifyContent: "flex-end" }}>
          <Button size="sm" label={t("member.reply")} onPress={onReply} />
        </Row>
      ) : null}
      {m.issue?.kind === "no_gps" && m.status === "no_show" && !manager ? (
        <Row style={{ justifyContent: "flex-end" }}>
          <Button size="sm" label={t("member.manual")} onPress={onManual} />
        </Row>
      ) : null}
    </Card>
  );
}

function MemberSheet({ m, onClose }: { m: BrigadeMember; onClose: () => void }) {
  const { t } = useI18n();
  const { locale } = useSession();
  return (
    <Sheet open onClose={onClose} title={`${m.firstName} ${m.lastName}`}>
      <Text c={color.muted}>
        {m.number} · {loc(m.positionName, locale)}
      </Text>
      <Button label={`${t("member.call")} · ${m.phone}`} onPress={() => void Linking.openURL(`tel:${m.phone.replace(/\s/g, "")}`)} />
      <Field label={t("member.today")}>
        <Text>{m.clockIn ? t("member.on_site", { time: m.clockIn }) : t("member.no_clock")}</Text>
      </Field>
      {m.issue ? (
        <Field label={t("member.message")}>
          <Text>
            {t(`issue.kind.${m.issue.kind}`)} · {m.issue.time}
          </Text>
          <Text c={color.muted}>«{m.issue.comment}»</Text>
        </Field>
      ) : null}
    </Sheet>
  );
}

function ManualClockSheet({ m, nowHm, onClose, onSubmit }: { m: BrigadeMember; nowHm: string; onClose: () => void; onSubmit: (input: ManualClockInput) => Promise<void> }) {
  const { t } = useI18n();
  const [time, setTime] = useState(m.issue?.time ?? nowHm);
  const [reason, setReason] = useState<ManualClockInput["reason"] | null>(m.issue?.kind === "no_gps" ? "no_gps" : null);
  const [comment, setComment] = useState(m.issue?.comment ?? "");
  const [busy, setBusy] = useState(false);
  const valid = reason && /^([01]\d|2[0-3]):[0-5]\d$/.test(time) && (reason !== "other" || comment.trim());
  return (
    <Sheet open onClose={onClose} title={t("manual.title", { name: `${m.firstName} ${m.lastName}` })}>
      <Field label={t("manual.time")}>
        <Input value={time} onChangeText={setTime} maxLength={5} accessibilityLabel={t("manual.time")} />
      </Field>
      <Field label={t("manual.reason")}>
        <Choice value={reason} onChange={setReason} options={(["no_gps", "no_phone", "camera", "other"] as const).map((r) => ({ value: r, label: t(`manual.reason.${r}`) }))} />
      </Field>
      <Field label={t("issue.comment")}>
        <Input value={comment} onChangeText={setComment} multiline maxLength={500} accessibilityLabel={t("issue.comment")} style={{ minHeight: 70, textAlignVertical: "top" }} />
      </Field>
      <Text c={color.muted} size={13}>
        {t("manual.hint")}
      </Text>
      <Button
        kind="primary"
        label={t("manual.submit")}
        disabled={!valid}
        busy={busy}
        onPress={async () => {
          setBusy(true);
          await onSubmit({ assignmentId: m.assignmentId, type: "in", time, reason: reason!, comment: comment.trim() });
          setBusy(false);
        }}
      />
    </Sheet>
  );
}

function ReplySheet({ m, onClose, onSend }: { m: BrigadeMember; onClose: () => void; onSend: (text: string) => Promise<void> }) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const presets = [t("reply.ok"), t("reply.hurry"), t("reply.call_me")];
  return (
    <Sheet open onClose={onClose} title={t("member.reply")}>
      {m.issue ? <Text c={color.muted}>«{m.issue.comment}»</Text> : null}
      {presets.map((p) => (
        <Button key={p} label={p} onPress={() => void onSend(p)} />
      ))}
      <Input value={text} onChangeText={setText} placeholder={t("reply.own")} maxLength={300} accessibilityLabel={t("reply.own")} />
      <Button kind="primary" label={t("reply.send")} disabled={!text.trim()} onPress={() => void onSend(text.trim())} />
    </Sheet>
  );
}

function OutputSheet({ current, unit, onClose, onSave }: { current: number; unit: string; onClose: () => void; onSave: (v: number) => Promise<void> }) {
  const { t } = useI18n();
  const [v, setV] = useState(String(current));
  const n = Number(v);
  return (
    <Sheet open onClose={onClose} title={t("output.enter_title")}>
      <Field label={t("output.value", { unit })}>
        <Input value={v} onChangeText={(x) => setV(x.replace(/\D/g, ""))} keyboardType="number-pad" accessibilityLabel={t("output.value", { unit })} />
      </Field>
      <Text c={color.muted} size={13}>
        {t("output.hint")}
      </Text>
      <Button kind="primary" label={t("common.save")} disabled={!v || !Number.isFinite(n)} onPress={() => void onSave(n)} />
    </Sheet>
  );
}

export function OutputHistoryScreen() {
  const { t } = useI18n();
  return (
    <Screen>
      <Text w={800} size={25} accessibilityRole="header">
        {t("tab.output")}
      </Text>
      <Card style={{ gap: 6 }}>
        <Text w={700}>{t("output.history_soon")}</Text>
        <Text c={color.muted}>{t("output.history_text")}</Text>
      </Card>
    </Screen>
  );
}
