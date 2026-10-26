import { useI18n } from "@kadreo/i18n";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useErrorText } from "../format";
import { useApi } from "../session";
import { color } from "../theme";
import { Badge, Button, ErrorBox, Row, Sheet, Text } from "../ui";

/**
 * «Найти замену» (14.3-05): candidates by score (16.5); the offer goes to one or several, the first
 * to accept gets the shift, the others get «Смена уже занята».
 */
export function ReplacementSheet({ templateId, replacesId, date, title, onClose, onDone }: { templateId: string; replacesId: string | null; date: string; title: string; onClose: () => void; onDone: (offered: number) => void }) {
  const api = useApi();
  const { t } = useI18n();
  const errorText = useErrorText();
  const q = useQuery({ queryKey: ["candidates", templateId, date], queryFn: () => api.candidates(templateId, date) });
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <Sheet open onClose={onClose} title={title}>
      <Text c={color.muted}>{t("replace.hint")}</Text>
      {q.isLoading ? <Text c={color.muted}>{t("common.loading")}</Text> : null}
      {q.error ? <ErrorBox message={errorText(q.error)} /> : null}
      {q.data?.length === 0 ? <Text>{t("replace.none")}</Text> : null}
      {q.data?.slice(0, 8).map((c) => {
        const on = picked.includes(c.workerId);
        const km = c.tags.find((x) => x.kind === "distance_km");
        return (
          <Pressable key={c.workerId} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`${c.firstName} ${c.lastName}`} onPress={() => toggle(c.workerId)} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 14, borderWidth: on ? 2 : 1, borderColor: on ? color.accentStrong : color.border }}>
            <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, borderColor: on ? color.accentStrong : color.input, backgroundColor: on ? color.accentStrong : "#fff", alignItems: "center", justifyContent: "center" }}>{on ? <Check size={16} color="#fff" /> : null}</View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text w={700}>
                {c.firstName} {c.lastName}
              </Text>
              <Text c={color.muted} size={13}>
                {c.number}
                {km && km.kind === "distance_km" ? ` · ${km.km} km` : ""}
              </Text>
            </View>
            <Badge label={String(c.score)} tone={c.score >= 80 ? "ok" : "neutral"} />
          </Pressable>
        );
      })}
      {error ? <Text c={color.criticalText}>{error}</Text> : null}
      <Row>
        <Button
          kind="primary"
          style={{ flex: 1 }}
          label={t("replace.offer", { n: picked.length })}
          disabled={!picked.length}
          busy={busy}
          onPress={async () => {
            setBusy(true);
            setError(null);
            try {
              const r = await api.offerShift({ templateId, date, workerIds: picked, replacesId: replacesId ?? undefined });
              onDone(r.offered);
            } catch (e) {
              setError(errorText(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      </Row>
    </Sheet>
  );
}
