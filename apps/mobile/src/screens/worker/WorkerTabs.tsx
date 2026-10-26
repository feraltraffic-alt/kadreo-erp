import type { WorkerDocument } from "@kadreo/domain";
import { useI18n } from "@kadreo/i18n";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Switch, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { ShiftDetailsSheet } from "../../components/ShiftDetailsSheet";
import { now, setDemoDevice, useDemoDevice, useNow } from "../../device";
import { loc, siteDate, useErrorText, useShortDate } from "../../format";
import { isDemo, useApi, useSession } from "../../session";
import { color } from "../../theme";
import { Badge, Button, Card, Choice, Empty, ErrorBox, Field, Input, Loading, Row, Screen, SectionTitle, Sheet, Text, Toast } from "../../ui";
import { LOCALES, LOCALE_LABEL } from "@kadreo/i18n";
import type { MobileShift } from "@kadreo/domain";

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/* --------------------------------------------------------------- schedule */

export function ScheduleScreen() {
  const api = useApi();
  const { t } = useI18n();
  const { locale } = useSession();
  const shortDate = useShortDate();
  const errorText = useErrorText();
  const from = siteDate(now());
  const to = addDays(from, 13);
  const q = useQuery({ queryKey: ["shifts", from], queryFn: () => api.myShifts(from, to) });
  const [open, setOpen] = useState<MobileShift | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  if (q.isLoading) return <Loading />;
  return (
    <View style={{ flex: 1 }}>
      <Screen>
        <Text w={800} size={25} accessibilityRole="header">
          {t("tab.schedule")}
        </Text>
        <Text c={color.muted}>{t("schedule.range", { from: shortDate(from), to: shortDate(to) })}</Text>
        {q.error ? <ErrorBox message={errorText(q.error)} onRetry={() => q.refetch()} /> : null}
        {q.data?.length === 0 ? <Empty title={t("schedule.empty")} /> : null}
        {q.data?.map((s) => {
          const offer = s.status !== "confirmed";
          return (
            <Card key={s.id} accent={offer} onPress={() => setOpen(s)} style={{ gap: 4 }}>
              <Row style={{ justifyContent: "space-between" }}>
                <Text w={700} size={16}>
                  {shortDate(s.date)} · {s.start} – {s.end}
                </Text>
                <Badge label={s.status === "offer" ? t("shift.offer") : s.status === "proposed" ? t("shift.proposed") : t("shift.confirmed")} tone={offer ? "accent" : "ok"} />
              </Row>
              <Text c={color.muted} size={14}>
                {s.siteName} · {loc(s.positionName, locale)}
              </Text>
            </Card>
          );
        })}
      </Screen>
      {open ? <ShiftDetailsSheet shift={open} onClose={() => setOpen(null)} onDone={(x) => { setToast(x); setTimeout(() => setToast(null), 3000); }} /> : null}
      {toast ? <Toast text={toast} tone="ok" /> : null}
    </View>
  );
}

/* -------------------------------------------------------------- documents */

const DAY = 86400000;
function docTone(d: WorkerDocument, today: string): "ok" | "warn" | "critical" {
  const left = (new Date(d.validTo).getTime() - new Date(today).getTime()) / DAY;
  return left < 0 ? "critical" : left <= 30 ? "warn" : "ok";
}

export function DocumentsScreen() {
  const api = useApi();
  const { t, date } = useI18n();
  const q = useQuery({ queryKey: ["documents"], queryFn: () => api.myDocuments() });
  const today = siteDate(now());
  if (q.isLoading) return <Loading />;
  return (
    <Screen>
      <Text w={800} size={25} accessibilityRole="header">
        {t("tab.documents")}
      </Text>
      {q.data?.map((d) => {
        const tone = docTone(d, today);
        return (
          <Card key={d.id} bar={tone} style={{ gap: 4 }}>
            <Row style={{ justifyContent: "space-between" }}>
              <Text w={700}>{t(`doc.${d.type}`)}</Text>
              <Badge label={t(`doc.state.${tone}`)} tone={tone} />
            </Row>
            <Text c={color.muted} size={14}>
              {t("doc.valid_to", { date: date(d.validTo) })}
            </Text>
          </Card>
        );
      })}
      <Text c={color.muted} size={13}>
        {t("doc.hint")}
      </Text>
    </Screen>
  );
}

/* ---------------------------------------------------------------- bonuses */

export function BonusesScreen() {
  const { t } = useI18n();
  return (
    <Screen>
      <Text w={800} size={25} accessibilityRole="header">
        {t("tab.bonuses")}
      </Text>
      <Empty title={t("bonuses.soon")} text={t("bonuses.soon_text")} />
    </Screen>
  );
}

/* ---------------------------------------------------------------- profile */

export function ProfileScreen({ worker = true }: { worker?: boolean }) {
  const api = useApi();
  const { t } = useI18n();
  const { me, locale, setLocale, signOut } = useSession();
  const qc = useQueryClient();
  const errorText = useErrorText();
  const dev = useDemoDevice();
  const q = useQuery({ queryKey: ["profile"], queryFn: () => api.profile(), enabled: worker });
  const [pinOpen, setPinOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <View style={{ flex: 1 }}>
      <Screen>
        <Text w={800} size={25} accessibilityRole="header">
          {t("tab.profile")}
        </Text>
        <Card style={{ gap: 4 }}>
          <Text w={700} size={18}>
            {me?.fullName}
          </Text>
          {q.data ? (
            <Text c={color.muted}>
              {q.data.worker.number} · {q.data.worker.phone}
            </Text>
          ) : (
            <Text c={color.muted}>{me?.email}</Text>
          )}
        </Card>

        <SectionTitle title={t("profile.language")} />
        <Choice value={locale} onChange={setLocale} options={LOCALES.map((l) => ({ value: l, label: LOCALE_LABEL[l] }))} testID="profile-language" />

        {worker && q.data ? (
          <>
            <SectionTitle title={t("profile.kiosk")} />
            <Card style={{ gap: 12 }}>
              <Row style={{ justifyContent: "space-between" }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text w={600}>{t("profile.biometric")}</Text>
                  <Text c={color.muted} size={13}>
                    {t("profile.biometric_text")}
                  </Text>
                </View>
                <Switch
                  accessibilityLabel={t("profile.biometric")}
                  value={q.data.biometricConsent}
                  trackColor={{ true: color.accentStrong, false: color.input }}
                  onValueChange={async (v) => {
                    await api.setBiometricConsent(v);
                    await qc.invalidateQueries({ queryKey: ["profile"] });
                    setMsg(t(v ? "profile.biometric_on" : "profile.biometric_off"));
                  }}
                />
              </Row>
              <Row gap={10}>
                <Button label={q.data.kioskPinSet ? t("profile.pin_change") : t("profile.pin_set")} style={{ flex: 1 }} onPress={() => setPinOpen(true)} />
                <Button label={t("profile.qr")} style={{ flex: 1 }} onPress={() => setQrOpen(true)} />
              </Row>
            </Card>
            <SectionTitle title={t("profile.payments")} />
            <Card style={{ gap: 4 }}>
              <Text w={600}>{t("profile.bank")}</Text>
              <Text c={color.muted}>{q.data.bankAccountLast4 ? `•••• ${q.data.bankAccountLast4}` : "—"}</Text>
              <Text c={color.muted} size={13}>
                {t("profile.bank_hint")}
              </Text>
            </Card>
            <SectionTitle title={t("profile.notifications")} />
            <Card>
              <Text>{t(`profile.channel.${q.data.notificationChannel}`)}</Text>
            </Card>
          </>
        ) : null}

        {isDemo ? (
          <>
            <SectionTitle title={t("demo.title")} />
            <Card style={{ gap: 12 }}>
              {worker ? (
                <Field label={t("demo.gps")}>
                  <Choice value={dev.gps} onChange={(gps) => { setDemoDevice({ gps }); void qc.invalidateQueries({ queryKey: ["geo"] }); }} options={(["inside", "outside", "unavailable"] as const).map((v) => ({ value: v, label: t(`demo.gps.${v}`) }))} testID="demo-gps" />
                </Field>
              ) : null}
              {worker ? (
                <Row style={{ justifyContent: "space-between" }}>
                  <Text w={600}>{t("demo.offline")}</Text>
                  <Switch accessibilityLabel={t("demo.offline")} value={dev.offline} trackColor={{ true: color.accentStrong, false: color.input }} onValueChange={(v) => setDemoDevice({ offline: v })} />
                </Row>
              ) : null}
              <Button label={t("demo.switch_user")} onPress={signOut} />
            </Card>
          </>
        ) : (
          <Button label={t("profile.sign_out")} onPress={signOut} />
        )}
        {q.error ? <ErrorBox message={errorText(q.error)} /> : null}
      </Screen>
      {pinOpen ? <PinSheet onClose={() => setPinOpen(false)} onSaved={() => { setPinOpen(false); setMsg(t("profile.pin_saved")); void qc.invalidateQueries({ queryKey: ["profile"] }); }} /> : null}
      {qrOpen ? <KioskQrSheet onClose={() => setQrOpen(false)} /> : null}
      {msg ? <Toast text={msg} tone="ok" action="✕" onAction={() => setMsg(null)} /> : null}
    </View>
  );
}

function PinSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const api = useApi();
  const { t } = useI18n();
  const errorText = useErrorText();
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ok = /^\d{6}$/.test(pin) && pin === pin2;
  return (
    <Sheet open onClose={onClose} title={t("profile.pin_set")}>
      <Text c={color.muted}>{t("profile.pin_text")}</Text>
      <Field label={t("profile.pin")}>
        <Input value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" secureTextEntry accessibilityLabel={t("profile.pin")} />
      </Field>
      <Field label={t("profile.pin_repeat")}>
        <Input value={pin2} onChangeText={(v) => setPin2(v.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" secureTextEntry accessibilityLabel={t("profile.pin_repeat")} invalid={pin2.length === 6 && pin !== pin2} />
      </Field>
      {error ? <Text c={color.criticalText}>{error}</Text> : null}
      <Button
        kind="primary"
        label={t("common.save")}
        disabled={!ok}
        onPress={async () => {
          try {
            await api.setKioskPin(pin);
            onSaved();
          } catch (e) {
            setError(errorText(e));
          }
        }}
      />
    </Sheet>
  );
}

/** Rotating QR for the kiosk (14.4): signed by the server, valid 30 seconds. */
function KioskQrSheet({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const { t } = useI18n();
  const nowD = useNow(1000);
  const q = useQuery({ queryKey: ["kiosk-qr"], queryFn: () => api.kioskQr(), refetchInterval: (qq) => (qq.state.data ? Math.max(1000, new Date(qq.state.data.expiresAt).getTime() - now().getTime()) : 5000) });
  const left = q.data ? Math.max(0, Math.round((new Date(q.data.expiresAt).getTime() - nowD.getTime()) / 1000)) : 0;
  return (
    <Sheet open onClose={onClose} title={t("profile.qr")}>
      <View style={{ alignItems: "center", gap: 12, paddingVertical: 8 }}>
        {q.data ? <QRCode value={q.data.payload} size={220} /> : null}
        <Text c={color.muted}>{t("profile.qr_left", { s: left })}</Text>
      </View>
      <Pressable onPress={onClose} />
    </Sheet>
  );
}
