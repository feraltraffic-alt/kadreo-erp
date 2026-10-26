import { distanceM, type ClockInput, type ClockIssueKind, type ClockResult, type ClockState, type ClockType, type MobileShift, type WorkerToday } from "@kadreo/domain";
import { useI18n } from "@kadreo/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Camera, Clock3, MapPin, Pause, Play, Square } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { CameraSheet } from "../../components/CameraSheet";
import { NotificationsSheet } from "../../components/NotificationsSheet";
import { OfflineBar } from "../../components/OfflineBar";
import { QrScanSheet } from "../../components/QrScanSheet";
import { ShiftDetailsSheet } from "../../components/ShiftDetailsSheet";
import { deviceTime, enqueue, getFix, isNetworkError, isOfflineSimulated, newKey, syncServerTime, useNow, useQueue, type Fix } from "../../device";
import { greetingKey, hmm, loc, siteHm, toMin, useDuration, useErrorText, useLongDate, useShortDate } from "../../format";
import { useApi, useSession } from "../../session";
import { color } from "../../theme";
import { Badge, Button, Card, Choice, DarkCard, ErrorBox, Field, IconButton, Input, Loading, Row, Screen, SectionTitle, Sheet, Text, Toast } from "../../ui";

type SheetState =
  | { kind: "none" }
  | { kind: "nogeo"; type: ClockType }
  | { kind: "outside_deny"; dist: number }
  | { kind: "outside_comment"; type: ClockType; fix: Fix; dist: number }
  | { kind: "camera"; type: ClockType; fix: Fix; comment?: string }
  | { kind: "finish" }
  | { kind: "qr" }
  | { kind: "issue" }
  | { kind: "shift"; shift: MobileShift }
  | { kind: "notifications" };

const next: Record<ClockState, ClockType[]> = { before: ["in"], on_shift: ["break_start", "out"], on_break: ["break_end"], finished: [], no_shift: [] };
function applyQueued(state: ClockState, types: ClockType[]): ClockState {
  let s = state;
  for (const t of types) s = t === "in" || t === "break_end" ? "on_shift" : t === "break_start" ? "on_break" : "finished";
  return s;
}

export function ClockScreen({ onOpenSchedule }: { onOpenSchedule: () => void }) {
  const api = useApi();
  const { locale } = useSession();
  const { t } = useI18n();
  const qc = useQueryClient();
  const errorText = useErrorText();
  const longDate = useLongDate();
  const shortDate = useShortDate();
  const dur = useDuration();
  const queue = useQueue();
  const [sheet, setSheet] = useState<SheetState>({ kind: "none" });
  const [toast, setToast] = useState<{ text: string; tone?: "ok" | "critical" | "dark" } | null>(null);
  const [busy, setBusy] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const q = useQuery({
    queryKey: ["today"],
    queryFn: async () => {
      const d = await api.today();
      syncServerTime(d.now);
      return d;
    },
    refetchInterval: 30000,
  });
  const nowD = useNow(1000);

  // Geolocation badge: on open and every 30 s while the screen is open (14.1-05), no tracking.
  const site = q.data?.site ?? null;
  const geo = useQuery({
    queryKey: ["geo", site?.id],
    enabled: !!site,
    queryFn: async () => {
      const fix = await getFix(site!);
      return fix ? { fix, dist: distanceM(fix.lat, fix.lng, site!.lat, site!.lng) } : null;
    },
    refetchInterval: 30000,
  });

  function showToast(text: string, tone?: "ok" | "critical" | "dark") {
    setToast({ text, tone });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }
  useEffect(() => () => void (toastTimer.current && clearTimeout(toastTimer.current)), []);

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Screen><ErrorBox message={errorText(q.error)} onRetry={() => q.refetch()} retryLabel={t("common.retry")} /></Screen>;
  const d: WorkerToday = q.data;
  const queuedTypes = queue.filter((x) => x.assignmentId === d.shift?.id).map((x) => x.type);
  const state = d.shift ? applyQueued(d.state, queuedTypes) : "no_shift";
  const nowHm = siteHm(nowD);
  const nowMin = nowHm.h * 60 + nowHm.m;
  const shift = d.shift;
  const startMin = shift ? toMin(shift.start) : 0;
  const tooEarly = state === "before" && d.opensAt !== null && nowMin < toMin(d.opensAt) && nowMin > startMin - 12 * 60;
  const firstIn = d.events.find((e) => e.type === "in");
  const lastBreak = [...d.events].reverse().find((e) => e.type === "break_start");

  async function send(type: ClockType, extra: Partial<ClockInput>, method: "gps_photo" | "qr" = "gps_photo") {
    if (!shift) return;
    const input: ClockInput = { idempotencyKey: newKey(), assignmentId: shift.id, type, deviceTime: deviceTime(), method, photo: false, ...extra };
    setBusy(true);
    try {
      if (isOfflineSimulated()) throw new TypeError("offline");
      const r: ClockResult = await api.clock(input);
      const key = type === "in" ? (r.lateMin > 0 ? "clock.done.in_late" : "clock.done.in") : `clock.done.${type}`;
      showToast(t(key, { time: r.event.time, m: r.lateMin }) + (r.outcome === "flagged" ? ` · ${t("clock.flagged")}` : ""), "ok");
      await qc.invalidateQueries({ queryKey: ["today"] });
    } catch (e) {
      if (isNetworkError(e)) {
        enqueue(input);
        showToast(t("offline.saved"), "dark");
      } else showToast(errorText(e), "critical");
    } finally {
      setBusy(false);
      setSheet({ kind: "none" });
    }
  }

  async function start(type: ClockType) {
    if (!site) return;
    setBusy(true);
    const fix = await getFix(site);
    setBusy(false);
    if (!fix) return setSheet({ kind: "nogeo", type });
    const dist = distanceM(fix.lat, fix.lng, site.lat, site.lng);
    if (fix.accuracyM > site.requiredAccuracyM) return showToast(t("reject.low_accuracy"), "critical");
    if (dist > site.radiusM) {
      if (site.outsideGeofence === "deny") return setSheet({ kind: "outside_deny", dist });
      return setSheet({ kind: "outside_comment", type, fix, dist });
    }
    proceed(type, fix);
  }
  function proceed(type: ClockType, fix: Fix, comment?: string) {
    // A photo from the front camera confirms the start of the shift (14.1 step 5).
    if (type === "in") return setSheet({ kind: "camera", type, fix, comment });
    void send(type, { lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM, comment });
  }

  const geoBadge = !geo.data
    ? geo.isLoading
      ? null
      : { tone: "critical" as const, label: t("geo.unavailable") }
    : geo.data.dist <= (site?.radiusM ?? 0)
      ? { tone: "ok" as const, label: t("geo.inside") }
      : { tone: "warn" as const, label: t("geo.outside", { m: geo.data.dist }) };

  const methodLabel = site?.methods.includes("gps_photo") ? t("method.gps_photo") : site?.methods.includes("qr") ? t("method.qr") : site?.methods.includes("face") ? t("method.face") : t("method.access_card");

  let timeLine: string;
  if (state === "on_shift" && firstIn) timeLine = t("clock.running", { d: hmm(nowMin - toMin(firstIn.time)) });
  else if (state === "on_break" && lastBreak) timeLine = t("clock.break_running", { d: hmm(nowMin - toMin(lastBreak.time)) });
  else if (state === "before" && shift) timeLine = nowMin <= startMin ? t("clock.until_start", { now: nowHm.hm, d: dur(startMin - nowMin) }) : t("clock.late_now", { now: nowHm.hm, d: dur(nowMin - startMin) });
  else timeLine = t("clock.now", { now: nowHm.hm });

  return (
    <View style={{ flex: 1 }}>
      <OfflineBar />
      <Screen>
        <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <View style={{ gap: 2, flex: 1 }}>
            <Text c={color.muted}>{longDate(nowD)}</Text>
            <Text w={800} size={25} accessibilityRole="header">
              {t(greetingKey(nowHm.h), { name: d.worker.firstName })}
            </Text>
          </View>
          <IconButton label={t("notif.title_n", { n: d.unread })} badge={d.unread > 0 ? "dot" : undefined} onPress={() => setSheet({ kind: "notifications" })}>
            <Bell size={21} color={color.ink} />
          </IconButton>
        </Row>

        <DarkCard style={{ gap: 6 }}>
          {shift ? (
            <>
              <Row style={{ justifyContent: "space-between" }}>
                <Text c={color.darkMuted}>{t("clock.shift_today")}</Text>
                {geoBadge ? <Badge label={geoBadge.label} tone={geoBadge.tone} /> : null}
              </Row>
              <Text w={800} size={26} c="#fff">
                {shift.start} – {shift.end}
              </Text>
              <Text c="#d0d5dd" size={15}>
                {shift.siteName} · {loc(shift.positionName, locale)}
              </Text>
              <Row style={{ marginTop: 10 }} gap={6}>
                <MapPin size={16} color={color.darkMuted} />
                <Text c={color.darkMuted} size={13}>
                  {geo.data ? (geo.data.dist <= (site?.radiusM ?? 0) ? t("geo.line_inside", { a: geo.data.fix.accuracyM }) : t("geo.line_outside", { m: geo.data.dist, a: geo.data.fix.accuracyM })) : geo.isLoading ? t("geo.locating") : t("geo.line_unavailable")}
                </Text>
              </Row>
            </>
          ) : (
            <>
              <Text c={color.darkMuted}>{t("clock.shift_today")}</Text>
              <Text w={800} size={22} c="#fff">
                {t("clock.no_shift_title")}
              </Text>
              {d.nextShift ? (
                <Text c="#d0d5dd">
                  {t("clock.next_shift", { date: shortDate(d.nextShift.date), time: `${d.nextShift.start} – ${d.nextShift.end}` })}
                </Text>
              ) : null}
            </>
          )}
        </DarkCard>

        <Text c={color.muted} style={{ textAlign: "center", marginTop: 4 }} testID="clock-timeline">
          {timeLine}
        </Text>

        <MainButtons
          state={state}
          disabled={busy || tooEarly || state === "no_shift" || state === "finished"}
          busy={busy}
          onStart={() => start("in")}
          onBreak={() => start("break_start")}
          onBack={() => start("break_end")}
          onFinish={() => setSheet({ kind: "finish" })}
        />
        {tooEarly && d.opensAt ? (
          <Text c={color.muted} style={{ textAlign: "center" }}>
            {t("clock.opens_at", { time: d.opensAt })}
          </Text>
        ) : null}
        {state === "no_shift" ? (
          <Text c={color.muted} style={{ textAlign: "center" }}>
            {t("clock.no_shift_hint")}
          </Text>
        ) : null}
        {state === "finished" ? (
          <Text c={color.okText} w={600} style={{ textAlign: "center" }}>
            {t("clock.finished_at", { time: [...d.events].reverse().find((e) => e.type === "out")?.time ?? "" })}
          </Text>
        ) : null}

        {site ? (
          <View style={{ alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: color.border, backgroundColor: "#fff", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 }}>
            <Camera size={16} color={color.ink} />
            <Text w={500} size={14}>
              {t("method.label", { method: methodLabel })}
            </Text>
          </View>
        ) : null}

        <Row gap={10}>
          {site?.methods.includes("qr") || site?.demoQrPayload ? <Button label={t("clock.scan_qr")} style={{ flex: 1 }} onPress={() => setSheet({ kind: "qr" })} disabled={!shift || state === "finished"} /> : null}
          <Button label={t("clock.problem")} style={{ flex: 1 }} onPress={() => setSheet({ kind: "issue" })} disabled={!shift} />
        </Row>

        {d.issues.filter((i) => i.status === "open" && i.kind !== "late").length ? (
          <Card bar="warn" style={{ gap: 4 }}>
            <Text w={700}>{t("issue.open_title")}</Text>
            {d.issues
              .filter((i) => i.status === "open" && i.kind !== "late")
              .map((i) => (
                <Text key={i.id} c={color.muted} size={14}>
                  {t(`issue.kind.${i.kind}`)} · {i.time} · {t("issue.waiting")}
                </Text>
              ))}
          </Card>
        ) : null}

        <SectionTitle title={t("clock.upcoming")} action={t("clock.all_schedule")} onAction={onOpenSchedule} />
        {d.upcoming.length === 0 ? <Text c={color.muted}>{t("clock.no_upcoming")}</Text> : null}
        {d.upcoming.map((s) => (
          <UpcomingCard key={s.id} shift={s} onOpen={() => setSheet({ kind: "shift", shift: s })} />
        ))}
      </Screen>

      {toast ? <Toast text={toast.text} tone={toast.tone} /> : null}

      <Sheet open={sheet.kind === "nogeo"} onClose={() => setSheet({ kind: "none" })} title={t("geo.unavailable")}>
        <Text c={color.muted}>{t("geo.unavailable_text")}</Text>
        <Button label={t("clock.scan_qr")} onPress={() => setSheet({ kind: "qr" })} />
        <Button label={t("clock.problem")} onPress={() => setSheet({ kind: "issue" })} />
        <Text c={color.muted} size={13}>
          {t("geo.kiosk_hint")}
        </Text>
      </Sheet>

      <Sheet open={sheet.kind === "outside_deny"} onClose={() => setSheet({ kind: "none" })} title={t("geo.outside_title")}>
        <Text>{t("reject.outside_geofence", { m: sheet.kind === "outside_deny" ? sheet.dist : 0 })}</Text>
        <Button label={t("clock.problem")} onPress={() => setSheet({ kind: "issue" })} />
      </Sheet>

      {sheet.kind === "outside_comment" ? <OutsideCommentSheet dist={sheet.dist} onClose={() => setSheet({ kind: "none" })} onContinue={(c) => proceed(sheet.type, sheet.fix, c)} /> : null}

      {sheet.kind === "camera" ? (
        <CameraSheet
          onClose={() => setSheet({ kind: "none" })}
          busy={busy}
          onPhoto={(photo) => void send(sheet.type, { lat: sheet.fix.lat, lng: sheet.fix.lng, accuracyM: sheet.fix.accuracyM, photo, comment: sheet.comment })}
        />
      ) : null}

      <Sheet open={sheet.kind === "finish"} onClose={() => setSheet({ kind: "none" })} title={t("clock.finish_confirm_title")}>
        <Text c={color.muted}>{t("clock.finish_confirm_text", { time: nowHm.hm })}</Text>
        <Button kind="primary" label={t("clock.finish")} onPress={() => { setSheet({ kind: "none" }); void start("out"); }} />
        <Button label={t("common.cancel")} onPress={() => setSheet({ kind: "none" })} />
      </Sheet>

      {sheet.kind === "qr" && site ? (
        <QrScanSheet
          demoPayload={site.demoQrPayload}
          actions={next[state]}
          onClose={() => setSheet({ kind: "none" })}
          onScanned={(payload, type) => void send(type, { qrPayload: payload }, "qr")}
        />
      ) : null}

      {sheet.kind === "issue" && shift ? (
        <IssueSheet
          state={state}
          nowHm={nowHm.hm}
          onClose={() => setSheet({ kind: "none" })}
          onSubmit={async (kind, type, time, comment) => {
            try {
              await api.reportIssue({ assignmentId: shift.id, kind, type, time, comment });
              setSheet({ kind: "none" });
              showToast(t(kind === "late" ? "issue.sent_late" : "issue.sent"), "ok");
              await qc.invalidateQueries({ queryKey: ["today"] });
            } catch (e) {
              showToast(errorText(e), "critical");
            }
          }}
        />
      ) : null}

      {sheet.kind === "shift" ? <ShiftDetailsSheet shift={sheet.shift} onClose={() => setSheet({ kind: "none" })} onDone={(text) => showToast(text, "ok")} /> : null}
      {sheet.kind === "notifications" ? <NotificationsSheet onClose={() => { setSheet({ kind: "none" }); void qc.invalidateQueries({ queryKey: ["today"] }); }} /> : null}
    </View>
  );
}

/* ------------------------------------------------------------------ main button */

function Ring({ children, size = 196 }: { children: React.ReactNode; size?: number }) {
  return (
    <View style={{ alignSelf: "center", width: size + 52, height: size + 52, borderRadius: (size + 52) / 2, backgroundColor: "#fdf0ea", alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: size + 26, height: size + 26, borderRadius: (size + 26) / 2, backgroundColor: color.accentRing, alignItems: "center", justifyContent: "center" }}>{children}</View>
    </View>
  );
}

function Circle({ label, icon, onPress, disabled, size = 196, tone = "accent", testID }: { label: string; icon: React.ReactNode; onPress: () => void; disabled?: boolean; size?: number; tone?: "accent" | "dark"; testID?: string }) {
  const bg = disabled ? "#e8a98c" : tone === "dark" ? color.dark : color.accentStrong;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: "center", justifyContent: "center", gap: 10, opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}
    >
      {icon}
      <Text w={800} size={size > 170 ? 20 : 17} c="#fff" style={{ textAlign: "center", paddingHorizontal: 14 }}>
        {label}
      </Text>
    </Pressable>
  );
}

function MainButtons({ state, disabled, busy, onStart, onBreak, onBack, onFinish }: { state: ClockState; disabled: boolean; busy: boolean; onStart: () => void; onBreak: () => void; onBack: () => void; onFinish: () => void }) {
  const { t } = useI18n();
  if (state === "on_shift") {
    return (
      <Row gap={16} style={{ justifyContent: "center", marginVertical: 6 }}>
        <Circle size={150} tone="dark" label={t("clock.break")} icon={<Pause size={34} color="#fff" />} onPress={onBreak} disabled={busy} testID="clock-break" />
        <Circle size={150} label={t("clock.finish")} icon={<Square size={30} color="#fff" fill="#fff" />} onPress={onFinish} disabled={busy} testID="clock-finish" />
      </Row>
    );
  }
  if (state === "on_break") {
    return (
      <Ring>
        <Circle label={t("clock.back")} icon={<Play size={40} color="#fff" />} onPress={onBack} disabled={disabled} testID="clock-back" />
      </Ring>
    );
  }
  return (
    <Ring>
      <Circle label={t("clock.start")} icon={state === "finished" ? <Clock3 size={40} color="#fff" /> : <Play size={40} color="#fff" />} onPress={onStart} disabled={disabled} testID="clock-start" />
    </Ring>
  );
}

/* ------------------------------------------------------------------ upcoming */

function UpcomingCard({ shift, onOpen }: { shift: MobileShift; onOpen: () => void }) {
  const { t } = useI18n();
  const shortDate = useShortDate();
  const api = useApi();
  const qc = useQueryClient();
  const errorText = useErrorText();
  const offer = shift.status === "offer" || shift.status === "proposed";
  const accept = useMutation({
    mutationFn: () => api.respondToShift(shift, "accept"),
    onSettled: () => qc.invalidateQueries({ queryKey: ["today"] }),
  });
  return (
    <Card accent={offer} onPress={onOpen} style={{ paddingVertical: 12 }} testID={`shift-${shift.date}`}>
      <Row style={{ justifyContent: "space-between" }}>
        <View style={{ gap: 2, flex: 1 }}>
          <Text w={700} size={16}>
            {shortDate(shift.date)} · {shift.start} – {shift.end}
          </Text>
          <Text c={color.muted} size={14}>
            {offer ? (shift.status === "offer" ? t("shift.offer") : t("shift.proposed")) : shift.siteName}
            {shift.bonusPoints ? ` · +${shift.bonusPoints} ${t("shift.points")}` : ""}
          </Text>
          {accept.error ? (
            <Text c={color.criticalText} size={13}>
              {errorText(accept.error)}
            </Text>
          ) : null}
        </View>
        {offer ? <Button kind="primary" size="sm" label={t("shift.accept")} busy={accept.isPending} onPress={() => accept.mutate()} /> : <Badge label={t("shift.confirmed")} tone="ok" />}
      </Row>
    </Card>
  );
}

/* ------------------------------------------------------------------ sheets */

function OutsideCommentSheet({ dist, onClose, onContinue }: { dist: number; onClose: () => void; onContinue: (comment: string) => void }) {
  const { t } = useI18n();
  const [comment, setComment] = useState("");
  return (
    <Sheet open onClose={onClose} title={t("geo.outside_title")}>
      <Text>{t("geo.outside_allow", { m: dist })}</Text>
      <Field label={t("geo.comment")}>
        <Input value={comment} onChangeText={setComment} multiline maxLength={500} placeholder={t("geo.comment_ph")} accessibilityLabel={t("geo.comment")} style={{ minHeight: 80, textAlignVertical: "top" }} />
      </Field>
      <Button kind="primary" label={t("common.continue")} disabled={!comment.trim()} onPress={() => onContinue(comment.trim())} />
    </Sheet>
  );
}

function IssueSheet({ state, nowHm, onClose, onSubmit }: { state: ClockState; nowHm: string; onClose: () => void; onSubmit: (kind: ClockIssueKind, type: ClockType, time: string, comment: string) => Promise<void> }) {
  const { t } = useI18n();
  const [kind, setKind] = useState<ClockIssueKind | null>(null);
  const [type, setType] = useState<ClockType>(state === "on_shift" || state === "on_break" ? "out" : "in");
  const [time, setTime] = useState(nowHm);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = kind && /^([01]\d|2[0-3]):[0-5]\d$/.test(time) && (kind !== "other" || comment.trim()) && comment.length <= 500;
  return (
    <Sheet open onClose={onClose} title={t("clock.problem")}>
      <Field label={t("issue.kind_label")}>
        <Choice<ClockIssueKind>
          value={kind}
          onChange={setKind}
          options={(["no_gps", "no_camera", "forgot", "late", "other"] as const).map((k) => ({ value: k, label: t(`issue.kind.${k}`) }))}
        />
      </Field>
      {kind !== "late" ? (
        <Field label={t("issue.type_label")}>
          <Choice<ClockType> value={type} onChange={setType} options={(["in", "out"] as const).map((k) => ({ value: k, label: t(`type.${k}`) }))} />
        </Field>
      ) : null}
      <Field label={kind === "late" ? t("issue.eta") : t("issue.actual_time")}>
        <Input value={time} onChangeText={setTime} keyboardType="numbers-and-punctuation" maxLength={5} accessibilityLabel={kind === "late" ? t("issue.eta") : t("issue.actual_time")} />
      </Field>
      <Field label={t("issue.comment")} hint={`${comment.length}/500`}>
        <Input value={comment} onChangeText={setComment} multiline maxLength={500} accessibilityLabel={t("issue.comment")} style={{ minHeight: 80, textAlignVertical: "top" }} />
      </Field>
      <Text c={color.muted} size={13}>
        {t(kind === "late" ? "issue.late_hint" : "issue.hint")}
      </Text>
      <Button
        kind="primary"
        label={t("issue.send")}
        disabled={!valid}
        busy={busy}
        onPress={async () => {
          setBusy(true);
          await onSubmit(kind!, kind === "late" ? "in" : type, time, comment.trim());
          setBusy(false);
        }}
      />
    </Sheet>
  );
}

