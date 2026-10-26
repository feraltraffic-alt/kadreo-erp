import { DEMO_NOW_ISO, weekdayIndex, type IsoDate } from "@kadreo/domain";
import { useI18n, useLocalized } from "@kadreo/i18n";
import { useCallback } from "react";
import { useSession } from "../app/session";

/** The demo clock: all "через N мин" texts count from this moment (matches the mock-ups). */
export const NOW = new Date(DEMO_NOW_ISO);

export function useFormat() {
  const { t, date } = useI18n();
  const loc = useLocalized();
  const { dict } = useSession();

  const positionName = useCallback((id: string) => loc(dict.positions.find((p) => p.id === id)?.name), [dict.positions, loc]);
  const competenceName = useCallback((id: string) => loc(dict.competences.find((c) => c.id === id)?.name), [dict.competences, loc]);
  const reasonName = useCallback((id: string) => loc(dict.correctionReasons.find((r) => r.id === id)?.name), [dict.correctionReasons, loc]);
  const weekdayShort = useCallback((d: IsoDate) => t(`weekday.short.${weekdayIndex(d)}`), [t]);
  /** 26.10 */
  const dayMonth = useCallback((d: IsoDate | string) => date(d, { day: "2-digit", month: "2-digit", timeZone: "UTC" }), [date]);
  /** 26.10.2026 */
  const fullDate = useCallback((d: IsoDate | string) => date(d), [date]);
  /** "12 мин", "2 ч 05 мин" from now until `iso`. */
  const until = useCallback(
    (iso: string) => {
      const min = Math.max(0, Math.round((new Date(iso).getTime() - NOW.getTime()) / 60000));
      if (min < 60) return t("common.minShort", { m: min });
      return t("common.durationHM", { h: Math.floor(min / 60), m: String(min % 60).padStart(2, "0") });
    },
    [t],
  );
  return { positionName, competenceName, reasonName, weekdayShort, dayMonth, fullDate, until };
}
