import { ApiError, type LocalizedText, type Locale } from "@kadreo/domain";
import { useI18n } from "@kadreo/i18n";

/** Greeting by local time (14.1-02): 05–12, 12–18, 18–23, 23–05. */
export function greetingKey(hour: number): string {
  if (hour >= 5 && hour < 12) return "greet.morning";
  if (hour >= 12 && hour < 18) return "greet.day";
  if (hour >= 18 && hour < 23) return "greet.evening";
  return "greet.night";
}

const WARSAW = "Europe/Warsaw";

/** Hours and minutes in site time. */
export function siteHm(d: Date): { h: number; m: number; hm: string } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: WARSAW, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((p) => [p.type, p.value]));
  const h = Number(parts.hour);
  const m = Number(parts.minute);
  return { h, m, hm: `${parts.hour}:${parts.minute}` };
}

export function siteDate(d: Date): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: WARSAW, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

/** «2 ч 14 мин» / «4 мин» */
export function useDuration() {
  const { t } = useI18n();
  return (min: number) => {
    const m = Math.max(0, Math.round(min));
    const h = Math.floor(m / 60);
    return h > 0 ? t("dur.hm", { h, m: m % 60 }) : t("dur.m", { m });
  };
}

/** «H:MM» for running timers (14.1-07). */
export function hmm(min: number): string {
  const m = Math.max(0, Math.floor(min));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

export function loc(text: LocalizedText | undefined, locale: Locale): string {
  return text ? text[locale] ?? text.en : "";
}

/** «Вт 27.10» */
export function useShortDate() {
  const { bcp47 } = useI18n();
  return (iso: string) => {
    const d = new Date(`${iso}T12:00:00Z`);
    const wd = new Intl.DateTimeFormat(bcp47, { weekday: "short", timeZone: "UTC" }).format(d);
    const dm = `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
    return `${wd.charAt(0).toUpperCase()}${wd.slice(1).replace(".", "")} ${dm}`;
  };
}

/** «Пн, 26 октября» */
export function useLongDate() {
  const { bcp47 } = useI18n();
  return (d: Date) => {
    const s = new Intl.DateTimeFormat(bcp47, { weekday: "short", day: "numeric", month: "long", timeZone: WARSAW }).format(d);
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
}

/** Error text for an API error in the interface language. */
export function useErrorText() {
  const { t } = useI18n();
  return (e: unknown): string => {
    if (e instanceof ApiError) {
      const b = e.body;
      if (b.code === "clock_rejected") return t(`reject.${b.reason}`, { m: b.distanceM ?? 0, time: b.opensAt ?? "" });
      if (b.code === "kiosk_auth") return b.lockedUntil ? t("kiosk.locked") : t("kiosk.wrong", { n: b.attemptsLeft });
      if (b.code === "taken") return t("err.taken");
      if (b.code === "forbidden") return t("err.forbidden");
      if (b.code === "conflict") return t("err.conflict");
      if (b.code === "bad_request") return t("err.bad_request");
      return t("err.generic");
    }
    return t("err.network");
  };
}
