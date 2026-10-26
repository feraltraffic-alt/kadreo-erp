import { useI18n } from "@kadreo/i18n";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { View } from "react-native";
import { loc } from "../format";
import { useApi, useSession } from "../session";
import { color } from "../theme";
import { Sheet, Text } from "../ui";

export function NotificationsSheet({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const { locale } = useSession();
  const { t, date, time } = useI18n();
  const q = useQuery({ queryKey: ["notifications"], queryFn: () => api.notifications() });
  useEffect(() => {
    if (q.data?.some((n) => !n.read)) void api.markAllNotificationsRead();
  }, [q.data, api]);
  return (
    <Sheet open onClose={onClose} title={t("notif.title")}>
      {q.data?.length === 0 ? <Text c={color.muted}>{t("notif.empty")}</Text> : null}
      {q.data?.map((n) => (
        <View key={n.id} style={{ flexDirection: "row", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: color.divider }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 7, backgroundColor: n.read ? "transparent" : color.accent }} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text w={n.read ? 500 : 700}>{loc(n.title, locale)}</Text>
            <Text c={color.muted} size={13}>
              {date(n.at, { day: "2-digit", month: "2-digit", timeZone: "Europe/Warsaw" })} · {time(n.at)}
            </Text>
          </View>
        </View>
      ))}
    </Sheet>
  );
}
