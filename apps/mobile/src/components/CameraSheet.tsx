import { useI18n } from "@kadreo/i18n";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRef, useState } from "react";
import { View } from "react-native";
import { isDemo } from "../session";
import { color } from "../theme";
import { Button, Sheet, Text } from "../ui";

/**
 * Front-camera photo confirming a clock-in (14.1 step 5). The photo goes with the event only;
 * face matching runs on the server and only with the worker's consent (7.4).
 */
export function CameraSheet({ onClose, onPhoto, busy }: { onClose: () => void; onPhoto: (photo: boolean) => void; busy: boolean }) {
  const { t } = useI18n();
  const [perm, request] = useCameraPermissions();
  const ref = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  async function shoot() {
    try {
      const pic = await ref.current?.takePictureAsync({ quality: 0.4, skipProcessing: true });
      onPhoto(!!pic);
    } catch {
      setFailed(true);
    }
  }

  const denied = perm && !perm.granted && !perm.canAskAgain;
  return (
    <Sheet open onClose={onClose} title={t("camera.title")}>
      {!perm ? null : !perm.granted && !denied ? (
        <>
          <Text c={color.muted}>{t("camera.ask")}</Text>
          <Button kind="primary" label={t("camera.allow")} onPress={() => void request()} />
        </>
      ) : denied || failed ? (
        <Text c={color.muted}>{t("camera.unavailable")}</Text>
      ) : (
        <>
          <View style={{ height: 320, borderRadius: 20, overflow: "hidden", backgroundColor: color.dark }}>
            <CameraView ref={ref} facing="front" style={{ flex: 1 }} onCameraReady={() => setReady(true)} onMountError={() => setFailed(true)} />
            <View pointerEvents="none" style={{ position: "absolute", left: "18%", right: "18%", top: "10%", bottom: "10%", borderRadius: 999, borderWidth: 3, borderStyle: "dashed", borderColor: color.accent }} />
          </View>
          <Text c={color.muted} size={13}>
            {t("camera.hint")}
          </Text>
          <Button kind="primary" size="lg" label={t("camera.shoot")} disabled={!ready} busy={busy} onPress={() => void shoot()} testID="camera-shoot" />
        </>
      )}
      {isDemo && (denied || failed || (perm && !perm.granted)) ? <Button label={t("camera.demo_skip")} busy={busy} onPress={() => onPhoto(false)} /> : null}
      <Button label={t("common.cancel")} onPress={onClose} />
    </Sheet>
  );
}
