import type { ClockType } from "@kadreo/domain";
import { useI18n } from "@kadreo/i18n";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useState } from "react";
import { View } from "react-native";
import { color } from "../theme";
import { Button, Sheet, Text } from "../ui";

/**
 * Scans the QR code of a site point (14.1-10). The code carries the point id and the server's
 * signature; the server answers «Код не относится к вашему объекту» for anything else. After a scan
 * the worker picks the action when more than one is possible (break or end of shift).
 */
export function QrScanSheet({ onClose, onScanned, actions, demoPayload }: { onClose: () => void; onScanned: (payload: string, type: ClockType) => void; actions: ClockType[]; demoPayload?: string }) {
  const { t } = useI18n();
  const [perm, request] = useCameraPermissions();
  const [payload, setPayload] = useState<string | null>(null);

  if (payload) {
    return (
      <Sheet open onClose={onClose} title={t("qr.scanned")}>
        <Text c={color.muted}>{t("qr.choose_action")}</Text>
        {actions.map((a) => (
          <Button key={a} kind={a === actions[0] ? "primary" : "secondary"} label={t(`action.${a}`)} onPress={() => onScanned(payload, a)} />
        ))}
        {actions.length === 0 ? <Text>{t("qr.nothing")}</Text> : null}
      </Sheet>
    );
  }
  return (
    <Sheet open onClose={onClose} title={t("clock.scan_qr")}>
      {perm?.granted ? (
        <View style={{ height: 280, borderRadius: 20, overflow: "hidden", backgroundColor: color.dark }}>
          <CameraView facing="back" style={{ flex: 1 }} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={(r) => setPayload(r.data)} />
        </View>
      ) : (
        <Button kind="primary" label={t("camera.allow")} onPress={() => void request()} />
      )}
      <Text c={color.muted} size={13}>
        {t("qr.hint")}
      </Text>
      {demoPayload ? <Button label={t("qr.demo")} onPress={() => setPayload(demoPayload)} testID="qr-demo" /> : null}
      <Button label={t("common.cancel")} onPress={onClose} />
    </Sheet>
  );
}
