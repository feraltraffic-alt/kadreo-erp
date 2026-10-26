import type { ClockType, KioskClockResult, KioskIdentity, KioskIdentifyInput, KioskRecent } from "@kadreo/domain";
import { ApiError } from "@kadreo/domain";
import { LOCALES, LOCALE_LABEL, useI18n } from "@kadreo/i18n";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Delete, UserRound } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, View, useWindowDimensions } from "react-native";
import { deviceTime, isNetworkError, newKey, syncServerTime, useNow } from "../../device";
import { siteHm, useErrorText } from "../../format";
import { isDemo, useApi, useSession } from "../../session";
import { color } from "../../theme";
import { Button, Input, Text } from "../../ui";

const RESULT_MS = 5000;
const CHOICE_MS = 10000;
const ADMIN_CODE = "2468"; // demo service code; per device in production (MDM)

type Panel = { kind: "idle" } | { kind: "pin" } | { kind: "qr" } | { kind: "choose"; id: KioskIdentity } | { kind: "service" };
type Result = (KioskClockResult & { at: number }) | { outcome: "error"; text: string; at: number };

interface Queued {
  ticket: string;
  type: ClockType;
  idempotencyKey: string;
  deviceTime: string;
  name: string;
}

/**
 * Site kiosk (14.4): a 10″ tablet at the entrance, landscape. Identification by card, PIN or the
 * rotating QR of the worker's app; face only where the site enabled it and the worker consented.
 * The result panel stays for 5 seconds; the last five clock-ins are on the right.
 */
export function KioskScreen() {
  const api = useApi();
  const { t, bcp47 } = useI18n();
  const { locale, setLocale, signOut } = useSession();
  const qc = useQueryClient();
  const errorText = useErrorText();
  const { width } = useWindowDimensions();
  const nowD = useNow(1000);
  const [panel, setPanel] = useState<Panel>({ kind: "idle" });
  const [result, setResult] = useState<Result | null>(null);
  const [recent, setRecent] = useState<KioskRecent[]>([]);
  const [queue, setQueue] = useState<Queued[]>([]);
  const [online, setOnline] = useState(true);
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  const taps = useRef<number[]>([]);

  const state = useQuery({
    queryKey: ["kiosk"],
    queryFn: async () => {
      const s = await api.kioskState();
      syncServerTime(s.now);
      setSyncedAt(new Date(s.now));
      setOnline(true);
      return s;
    },
    refetchInterval: 30000,
  });
  useEffect(() => {
    if (state.data) setRecent(state.data.recent);
  }, [state.data]);
  useEffect(() => {
    if (state.error && isNetworkError(state.error)) setOnline(false);
  }, [state.error]);

  // The result panel and the action choice close by themselves.
  useEffect(() => {
    if (!result) return;
    const h = setTimeout(() => setResult(null), RESULT_MS);
    return () => clearTimeout(h);
  }, [result]);
  useEffect(() => {
    if (panel.kind !== "choose") return;
    const h = setTimeout(() => setPanel({ kind: "idle" }), CHOICE_MS);
    return () => clearTimeout(h);
  }, [panel]);

  // Queued clock-ins go out when the kiosk is online again (14.4: up to 72 h).
  useEffect(() => {
    if (!queue.length) return;
    const h = setInterval(async () => {
      const [first, ...rest] = queue;
      try {
        await api.kioskClock({ ticket: first!.ticket, type: first!.type, idempotencyKey: first!.idempotencyKey, deviceTime: first!.deviceTime, offline: true });
        setQueue(rest);
        setOnline(true);
      } catch (e) {
        if (!isNetworkError(e)) setQueue(rest);
      }
    }, 10000);
    return () => clearInterval(h);
  }, [queue, api]);

  const clock = useCallback(
    async (id: KioskIdentity, type: ClockType) => {
      setPanel({ kind: "idle" });
      const input = { ticket: id.ticket, type, idempotencyKey: newKey(), deviceTime: deviceTime() };
      try {
        const r = await api.kioskClock(input);
        setResult({ ...r, at: Date.now() });
        setRecent((list) => [{ name: r.name, type: r.type, time: r.time, outcome: r.outcome }, ...list].slice(0, 5));
        void qc.invalidateQueries({ queryKey: ["kiosk"] });
      } catch (e) {
        if (isNetworkError(e)) {
          setOnline(false);
          setQueue((q) => [...q, { ...input, name: id.name }]);
          setResult({ outcome: "accepted", name: id.name, type, time: siteHm(nowD).hm, lateMin: 0, shift: id.shift, at: Date.now() });
        } else setResult({ outcome: "error", text: errorText(e), at: Date.now() });
      }
    },
    [api, qc, errorText, nowD],
  );

  const identify = useCallback(
    async (input: KioskIdentifyInput): Promise<string | null> => {
      try {
        const id = await api.kioskIdentify(input);
        if (id.actions.length === 1) void clock(id, id.actions[0]!);
        else if (id.actions.length > 1) setPanel({ kind: "choose", id });
        else {
          setPanel({ kind: "idle" });
          setResult({ outcome: "error", text: t("kiosk.nothing_to_do", { name: id.name }), at: Date.now() });
        }
        return null;
      } catch (e) {
        if (e instanceof ApiError && e.body.code === "kiosk_auth") {
          setRecent((list) => [{ name: "—", type: "unrecognized" as const, time: siteHm(nowD).hm, outcome: "unrecognized" as const }, ...list].slice(0, 5));
        }
        return errorText(e);
      }
    },
    [api, clock, errorText, t, nowD],
  );

  // Card reader as a keyboard wedge: hex digits followed by Enter (web build; native uses the same input).
  useEffect(() => {
    if (Platform.OS !== "web" || panel.kind !== "idle") return;
    let buf = "";
    let last = 0;
    const onKey = async (ev: KeyboardEvent) => {
      const nowMs = Date.now();
      if (nowMs - last > 400) buf = "";
      last = nowMs;
      if (ev.key === "Enter" && buf.length >= 6) {
        const uid = buf;
        buf = "";
        const err = await identify({ method: "card", uid });
        if (err) setResult({ outcome: "error", text: t("kiosk.card_unknown"), at: Date.now() });
      } else if (/^[0-9a-fA-F]$/.test(ev.key)) buf += ev.key.toUpperCase();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel.kind, identify, t]);

  function tapClock() {
    const nowMs = Date.now();
    taps.current = [...taps.current.filter((x) => nowMs - x < 3000), nowMs];
    if (taps.current.length >= 5) {
      taps.current = [];
      setPanel({ kind: "service" });
    }
  }

  const s = state.data;
  const hm = siteHm(nowD).hm;
  const longDay = (() => {
    const x = new Intl.DateTimeFormat(bcp47, { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Warsaw" }).format(nowD);
    return x.charAt(0).toUpperCase() + x.slice(1);
  })();
  const narrow = width < 900;

  return (
    <View style={{ flex: 1, flexDirection: narrow ? "column" : "row", backgroundColor: color.dark }}>
      {/* left: identification */}
      <View style={{ flex: narrow ? undefined : 1, padding: 40, paddingBottom: 32, gap: 24 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
          <Pressable onPress={tapClock} accessibilityLabel={t("kiosk.clock_label")} style={{ gap: 4 }}>
            <Text c={color.darkMuted} size={15}>
              {s ? `${s.device.siteName} · ${s.device.entry}` : " "}
            </Text>
            <Text w={800} size={72} c="#fff" style={{ lineHeight: 80 }} testID="kiosk-time">
              {hm}
            </Text>
            <Text c="#d0d5dd" size={17}>
              {longDay}
            </Text>
          </Pressable>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {LOCALES.map((l) => (
              <Pressable key={l} accessibilityRole="button" accessibilityState={{ selected: l === locale }} onPress={() => setLocale(l)} style={{ width: 62, height: 54, borderRadius: 12, borderWidth: 1, borderColor: l === locale ? "#fff" : color.darkBorder, backgroundColor: l === locale ? "#fff" : color.darkCard, alignItems: "center", justifyContent: "center" }}>
                <Text w={700} size={17} c={l === locale ? color.ink : "#fff"}>
                  {LOCALE_LABEL[l]}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={{ flex: 1, minHeight: 340, borderRadius: 24, borderWidth: 1, borderColor: color.darkBorder, backgroundColor: color.darkCard, alignItems: "center", justifyContent: "center", padding: 24, gap: 14 }}>
          <View style={{ position: "absolute", top: 16, left: 16, backgroundColor: color.dark, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
            <Text size={13} c={color.darkMuted}>
              {s?.device.faceEnabled ? t("kiosk.camera_on") : t("kiosk.face_off")}
            </Text>
          </View>
          <View style={{ width: 230, height: 290, borderRadius: "50%" as never, borderWidth: 3, borderStyle: "dashed", borderColor: color.accent, alignItems: "center", justifyContent: "center" }}>
            <UserRound size={96} color="#5b6474" strokeWidth={1.5} />
          </View>
          <Text w={800} size={26} c="#fff" style={{ textAlign: "center" }}>
            {s?.device.faceEnabled ? t("kiosk.look_or_card") : t("kiosk.card_or_pin")}
          </Text>
          <Text c={color.darkMuted} size={16}>
            {t("kiosk.reader_hint")}
          </Text>
        </View>

        <View style={{ flexDirection: "row", gap: 16 }}>
          <KioskButton label={t("kiosk.enter_pin")} onPress={() => setPanel({ kind: "pin" })} />
          <KioskButton label={t("kiosk.qr")} onPress={() => setPanel({ kind: "qr" })} />
        </View>
      </View>

      {/* right: result and recent clock-ins */}
      <View style={{ width: narrow ? undefined : 400, backgroundColor: color.bg, padding: 28, gap: 14 }}>
        <ResultCard result={result} />
        <Text w={700} size={17} style={{ marginTop: 8 }}>
          {t("kiosk.recent")}
        </Text>
        {recent.map((r, i) => (
          <View key={`${r.time}-${i}`} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: r.outcome === "unrecognized" ? color.warnBg : "#fff", borderWidth: 1, borderColor: r.outcome === "unrecognized" ? "#f5d76e" : color.border, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 13 }}>
            <Text w={700}>{r.outcome === "unrecognized" ? `${t("kiosk.unrecognized")} · ${r.time}` : r.name}</Text>
            <Text c={r.outcome === "unrecognized" ? color.warnText : color.muted} size={14}>
              {r.outcome === "unrecognized" ? t("kiosk.to_leader") : `${t(`kiosk.type.${r.type}`)} ${r.time}`}
            </Text>
          </View>
        ))}
        <View style={{ flex: 1 }} />
        <View style={{ gap: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: online ? color.ok : color.warn }} />
            <Text size={13} c={color.muted}>
              {online ? t("kiosk.online") : t("kiosk.offline")} · {t("kiosk.queue", { n: queue.length })}
            </Text>
          </View>
          <Text size={13} c={color.muted}>
            {t("kiosk.device", { code: s?.device.code ?? "—", time: syncedAt ? siteHm(syncedAt).hm : "—" })}
          </Text>
          {isDemo ? (
            <Pressable accessibilityRole="link" onPress={signOut} style={{ marginTop: 6 }}>
              <Text size={13} w={600} c={color.accentStrong}>
                {t("demo.switch_user")}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {panel.kind === "pin" ? <PinPad onClose={() => setPanel({ kind: "idle" })} onSubmit={(number, pin) => identify({ method: "pin", number, pin })} /> : null}
      {panel.kind === "qr" ? <QrPanel onClose={() => setPanel({ kind: "idle" })} onScanned={(payload) => identify({ method: "qr", payload })} /> : null}
      {panel.kind === "choose" ? <ChoosePanel id={panel.id} onChoose={(type) => void clock(panel.id, type)} onClose={() => setPanel({ kind: "idle" })} /> : null}
      {panel.kind === "service" ? <ServicePanel onClose={() => setPanel({ kind: "idle" })} onSignOut={signOut} code={s?.device.code ?? ""} /> : null}
    </View>
  );
}

function KioskButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ flex: 1, height: 76, borderRadius: 18, borderWidth: 1, borderColor: color.darkBorder, backgroundColor: pressed ? color.darkBorder : color.darkCard, alignItems: "center", justifyContent: "center" })}>
      <Text w={700} size={21} c="#fff">
        {label}
      </Text>
    </Pressable>
  );
}

function ResultCard({ result }: { result: Result | null }) {
  const { t } = useI18n();
  if (!result) {
    return (
      <View style={{ borderRadius: 20, borderWidth: 1, borderColor: color.border, borderStyle: "dashed", padding: 22, minHeight: 148, justifyContent: "center" }}>
        <Text c={color.muted}>{t("kiosk.waiting")}</Text>
      </View>
    );
  }
  if (result.outcome === "error") {
    return (
      <View accessibilityRole={"alert" as never} style={{ borderRadius: 20, backgroundColor: color.critical, padding: 22, minHeight: 148, gap: 6 }}>
        <Text w={700} c="#fff" size={14}>
          {t("kiosk.not_accepted")}
        </Text>
        <Text w={800} c="#fff" size={22}>
          {result.text}
        </Text>
      </View>
    );
  }
  const bg = result.outcome === "accepted" ? color.ok : result.outcome === "late" ? color.warn : color.critical;
  const fg = result.outcome === "late" ? "#3d2a00" : "#06301c";
  const fgStrong = result.outcome === "pending" ? "#fff" : fg;
  return (
    <View accessibilityRole={"alert" as never} testID="kiosk-result" style={{ borderRadius: 20, backgroundColor: bg, padding: 22, minHeight: 148, gap: 4 }}>
      <Text w={700} c={fgStrong} size={14}>
        {result.outcome === "pending" ? t("kiosk.pending") : result.outcome === "late" ? t("kiosk.late", { m: result.lateMin }) : t("kiosk.accepted")}
      </Text>
      <Text w={800} c={fgStrong} size={26}>
        {result.name}
      </Text>
      <Text c={fgStrong} size={16}>
        {t(`kiosk.done.${result.type}`, { time: result.time })}
      </Text>
      {result.shift ? (
        <Text c={fgStrong} size={16}>
          {t("kiosk.shift", { start: result.shift.start, end: result.shift.end })}
        </Text>
      ) : (
        <Text c={fgStrong} size={15}>
          {t("kiosk.pending_text")}
        </Text>
      )}
    </View>
  );
}

function Overlay({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(6,10,20,0.72)", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <View accessibilityRole={"dialog" as never} aria-label={title} style={{ width: 520, maxWidth: "100%", backgroundColor: "#fff", borderRadius: 28, padding: 28, gap: 16 }}>
          <Text w={800} size={24}>
            {title}
          </Text>
          {children}
        </View>
      </View>
    </Modal>
  );
}

function PinPad({ onClose, onSubmit }: { onClose: () => void; onSubmit: (number: string, pin: string) => Promise<string | null> }) {
  const { t } = useI18n();
  const [step, setStep] = useState<"number" | "pin">("number");
  const [number, setNumber] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const value = step === "number" ? number : pin;
  const set = step === "number" ? setNumber : setPin;
  const max = step === "number" ? 5 : 6;

  async function submit(p: string) {
    setBusy(true);
    const err = await onSubmit(number, p);
    setBusy(false);
    if (err) {
      setError(err);
      setPin("");
    }
  }
  function press(k: string) {
    setError(null);
    if (k === "del") return set(value.slice(0, -1));
    if (value.length >= max) return;
    const v = value + k;
    set(v);
    if (step === "pin" && v.length === 6) void submit(v);
  }
  return (
    <Overlay onClose={onClose} title={step === "number" ? t("kiosk.pin_number") : t("kiosk.pin_code")}>
      <View style={{ flexDirection: "row", justifyContent: "center", gap: 10, minHeight: 56, alignItems: "center" }} accessibilityLabel={step === "number" ? t("kiosk.pin_number") : t("kiosk.pin_code")}>
        {step === "number" ? (
          <Text w={800} size={34} testID="kiosk-number">
            W-{number.padStart(5, "·")}
          </Text>
        ) : (
          Array.from({ length: 6 }, (_, i) => <View key={i} style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: i < pin.length ? color.ink : color.border }} />)
        )}
      </View>
      {error ? (
        <Text c={color.criticalText} w={600} style={{ textAlign: "center" }} accessibilityRole={"alert" as never}>
          {error}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"].map((k, i) =>
          k === "" ? (
            <View key={i} style={{ width: 132, height: 64 }} />
          ) : (
            <Pressable key={i} accessibilityRole="button" accessibilityLabel={k === "del" ? t("kiosk.delete") : k} disabled={busy} onPress={() => press(k)} style={({ pressed }) => ({ width: 132, height: 64, borderRadius: 16, backgroundColor: pressed ? color.border : color.neutralBg, alignItems: "center", justifyContent: "center" })}>
              {k === "del" ? <Delete size={26} color={color.ink} /> : <Text w={700} size={26}>{k}</Text>}
            </Pressable>
          ),
        )}
      </View>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Button label={t("common.cancel")} style={{ flex: 1 }} onPress={onClose} />
        {step === "number" ? <Button kind="primary" label={t("common.continue")} style={{ flex: 1 }} disabled={!number} onPress={() => setStep("pin")} /> : null}
      </View>
      {isDemo ? (
        <Text c={color.muted} size={13} style={{ textAlign: "center" }}>
          {t("kiosk.demo_pin")}
        </Text>
      ) : null}
    </Overlay>
  );
}

function QrPanel({ onClose, onScanned }: { onClose: () => void; onScanned: (payload: string) => Promise<string | null> }) {
  const { t } = useI18n();
  const [perm, request] = useCameraPermissions();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  async function go(payload: string) {
    if (busy.current) return;
    busy.current = true;
    const err = await onScanned(payload);
    busy.current = false;
    if (err) setError(err);
  }
  return (
    <Overlay onClose={onClose} title={t("kiosk.qr")}>
      {perm?.granted ? (
        <View style={{ height: 300, borderRadius: 20, overflow: "hidden", backgroundColor: color.dark }}>
          <CameraView facing="front" style={{ flex: 1 }} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={(r) => void go(r.data)} />
        </View>
      ) : (
        <Button kind="primary" label={t("camera.allow")} onPress={() => void request()} />
      )}
      <Text c={color.muted}>{t("kiosk.qr_hint")}</Text>
      {isDemo ? (
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Input value={code} onChangeText={setCode} placeholder={t("kiosk.qr_code")} accessibilityLabel={t("kiosk.qr_code")} style={{ flex: 1 }} />
          <Button label="OK" disabled={!code} onPress={() => void go(code.trim())} />
        </View>
      ) : null}
      {error ? <Text c={color.criticalText}>{error}</Text> : null}
      <Button label={t("common.cancel")} onPress={onClose} />
    </Overlay>
  );
}

function ChoosePanel({ id, onChoose, onClose }: { id: KioskIdentity; onChoose: (t: ClockType) => void; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Overlay onClose={onClose} title={t("kiosk.hello", { name: id.name })}>
      <Text c={color.muted}>{t("kiosk.choose")}</Text>
      {id.actions.map((a, i) => (
        <Button key={a} size="lg" kind={i === 0 ? "primary" : "secondary"} label={t(`action.${a}`)} onPress={() => onChoose(a)} />
      ))}
      <Button label={t("common.cancel")} onPress={onClose} />
    </Overlay>
  );
}

function ServicePanel({ onClose, onSignOut, code }: { onClose: () => void; onSignOut: () => void; code: string }) {
  const { t } = useI18n();
  const [pin, setPin] = useState("");
  const ok = pin === ADMIN_CODE;
  return (
    <Overlay onClose={onClose} title={t("kiosk.service")}>
      {!ok ? (
        <>
          <Input value={pin} onChangeText={setPin} secureTextEntry keyboardType="number-pad" placeholder={t("kiosk.admin_code")} accessibilityLabel={t("kiosk.admin_code")} />
          {isDemo ? (
            <Text c={color.muted} size={13}>
              {t("kiosk.admin_demo", { code: ADMIN_CODE })}
            </Text>
          ) : null}
        </>
      ) : (
        <>
          <Text>{t("kiosk.device", { code, time: "" })}</Text>
          <Button label={t("demo.switch_user")} onPress={onSignOut} />
        </>
      )}
      <Button label={t("common.close")} onPress={onClose} />
    </Overlay>
  );
}
