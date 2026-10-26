import { useI18n } from "@kadreo/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { CloudOff } from "lucide-react-native";
import { useEffect } from "react";
import { View } from "react-native";
import { flushQueue, useDemoDevice, useQueue } from "../device";
import { useApi } from "../session";
import { color } from "../theme";
import { Text } from "../ui";

/**
 * «Нет сети» bar with the number of clock events waiting on the phone (14.1 states). Sends the
 * queue when the network is back: on the browser's online event and every 15 s.
 */
export function OfflineBar() {
  const { t } = useI18n();
  const api = useApi();
  const qc = useQueryClient();
  const queue = useQueue();
  const dev = useDemoDevice();

  useEffect(() => {
    if (!queue.length || dev.offline) return;
    let alive = true;
    const tryFlush = async () => {
      const n = await flushQueue(api);
      if (alive && n > 0) await qc.invalidateQueries({ queryKey: ["today"] });
    };
    void tryFlush();
    const h = setInterval(tryFlush, 15000);
    const w = typeof window !== "undefined" && typeof window.addEventListener === "function" ? window : null;
    w?.addEventListener("online", tryFlush);
    return () => {
      alive = false;
      clearInterval(h);
      w?.removeEventListener("online", tryFlush);
    };
  }, [queue.length, dev.offline, api, qc]);

  if (!dev.offline && !queue.length) return null;
  return (
    <View accessibilityRole={"alert" as never} style={{ backgroundColor: color.warnBg, borderBottomWidth: 1, borderBottomColor: "#f5d76e", paddingHorizontal: 20, paddingVertical: 10, flexDirection: "row", gap: 10, alignItems: "center" }}>
      <CloudOff size={18} color={color.warnText} />
      <Text w={600} size={13} c={color.warnText} style={{ flex: 1 }}>
        {dev.offline ? t("offline.bar") : t("offline.sending")} {queue.length ? t("offline.count", { n: queue.length }) : ""}
      </Text>
    </View>
  );
}
