import type { MobileShift } from "@kadreo/domain";
import { useI18n } from "@kadreo/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { loc, useErrorText, useShortDate } from "../format";
import { useApi, useSession } from "../session";
import { color } from "../theme";
import { Badge, Button, Choice, Field, Input, Row, Sheet, Text } from "../ui";

const DECLINE_REASONS = ["busy", "sick", "transport", "other"] as const;

/** Shift details with «Принять» / «Отклонить» and a reason (14.1-13). */
export function ShiftDetailsSheet({ shift, onClose, onDone }: { shift: MobileShift; onClose: () => void; onDone: (text: string) => void }) {
  const { t } = useI18n();
  const { locale } = useSession();
  const api = useApi();
  const qc = useQueryClient();
  const shortDate = useShortDate();
  const errorText = useErrorText();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState<(typeof DECLINE_REASONS)[number] | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = shift.status !== "confirmed";

  async function respond(decision: "accept" | "decline") {
    setBusy(true);
    setError(null);
    try {
      await api.respondToShift(shift, decision, decision === "decline" ? [reason ? t(`decline.${reason}`) : "", comment].filter(Boolean).join(": ") : undefined);
      await qc.invalidateQueries();
      onDone(t(decision === "accept" ? "shift.accepted" : "shift.declined"));
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={`${shortDate(shift.date)} · ${shift.start} – ${shift.end}`}>
      <Row>
        <Badge label={shift.status === "offer" ? t("shift.offer") : shift.status === "proposed" ? t("shift.proposed") : t("shift.confirmed")} tone={open ? "accent" : "ok"} />
        {shift.bonusPoints ? <Badge label={`+${shift.bonusPoints} ${t("shift.points")}`} tone="warn" /> : null}
      </Row>
      <Text w={600}>{shift.siteName}</Text>
      <Text c={color.muted}>{loc(shift.positionName, locale)}</Text>
      {error ? <Text c={color.criticalText}>{error}</Text> : null}
      {open && !declining ? (
        <>
          <Button kind="primary" label={t("shift.accept")} busy={busy} onPress={() => void respond("accept")} />
          <Button label={t("shift.decline")} onPress={() => setDeclining(true)} />
        </>
      ) : null}
      {open && declining ? (
        <>
          <Field label={t("decline.reason")}>
            <Choice value={reason} onChange={setReason} options={DECLINE_REASONS.map((r) => ({ value: r, label: t(`decline.${r}`) }))} />
          </Field>
          <Input value={comment} onChangeText={setComment} placeholder={t("decline.comment")} maxLength={300} accessibilityLabel={t("decline.comment")} />
          <Button kind="danger" label={t("shift.decline")} disabled={!reason} busy={busy} onPress={() => void respond("decline")} />
        </>
      ) : null}
    </Sheet>
  );
}
