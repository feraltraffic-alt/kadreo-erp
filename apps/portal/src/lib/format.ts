import { DEMO_NOW_ISO, weekdayIndex, type IsoDate } from "@kadreo/domain";
import { useI18n, useLocalized } from "@kadreo/i18n";
import { useCallback } from "react";
import { useSession } from "../app/session";

/** The demo clock (Monday 26.10.2026, 08:14:52 Warsaw), shared with the back office. */
export const NOW = new Date(DEMO_NOW_ISO);

export function useFormat() {
  const { t, date } = useI18n();
  const loc = useLocalized();
  const { dict } = useSession();
  const positionName = useCallback((id: string) => loc(dict.positions.find((p) => p.id === id)?.name), [dict.positions, loc]);
  const competenceName = useCallback((id: string) => loc(dict.competences.find((c) => c.id === id)?.name), [dict.competences, loc]);
  const disputeReasonName = useCallback((id: string) => loc(dict.disputeReasons.find((r) => r.id === id)?.name), [dict.disputeReasons, loc]);
  const correctionReasonName = useCallback((id: string) => loc(dict.correctionReasons.find((r) => r.id === id)?.name), [dict.correctionReasons, loc]);
  const weekdayShort = useCallback((d: IsoDate) => t(`weekday.short.${weekdayIndex(d)}`), [t]);
  const dayMonth = useCallback((d: IsoDate | string) => date(d, { day: "2-digit", month: "2-digit", timeZone: "UTC" }), [date]);
  const fullDate = useCallback((d: IsoDate | string) => date(d), [date]);
  /** 29.10, 23:59 in Warsaw time. */
  const dateTime = useCallback((iso: string) => date(iso, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Warsaw" }), [date]);
  const dateOnly = useCallback((iso: string) => date(iso, { day: "2-digit", month: "2-digit", timeZone: "Europe/Warsaw" }), [date]);
  return { positionName, competenceName, disputeReasonName, correctionReasonName, weekdayShort, dayMonth, fullDate, dateTime, dateOnly };
}
