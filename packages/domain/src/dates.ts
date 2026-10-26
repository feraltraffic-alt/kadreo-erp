import type { IsoDate } from "./types";

/** Date helpers that work on plain YYYY-MM-DD strings (site-local calendar days). */

export function parseIsoDate(d: IsoDate): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, day ?? 1));
}

export function toIsoDate(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: IsoDate, n: number): IsoDate {
  const x = parseIsoDate(d);
  x.setUTCDate(x.getUTCDate() + n);
  return toIsoDate(x);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(d: IsoDate): number {
  return (parseIsoDate(d).getUTCDay() + 6) % 7;
}

export function mondayOf(d: IsoDate): IsoDate {
  return addDays(d, -weekdayIndex(d));
}

export function weekDates(monday: IsoDate): IsoDate[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** ISO 8601 week number and week-year, e.g. { year: 2026, week: 44 }. */
export function isoWeek(d: IsoDate): { year: number; week: number } {
  const date = parseIsoDate(d);
  const thursday = new Date(date);
  thursday.setUTCDate(date.getUTCDate() + 3 - ((date.getUTCDay() + 6) % 7));
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((thursday.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return { year, week };
}

/** "2026-W44" → Monday of that ISO week. */
export function mondayOfIsoWeek(token: string): IsoDate | null {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(token);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const mondayW1 = new Date(jan4);
  mondayW1.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  mondayW1.setUTCDate(mondayW1.getUTCDate() + (week - 1) * 7);
  return toIsoDate(mondayW1);
}

export function isoWeekToken(d: IsoDate): string {
  const { year, week } = isoWeek(d);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((parseIsoDate(b).getTime() - parseIsoDate(a).getTime()) / 86400000);
}

/** Minutes since midnight for "HH:mm". */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function fromMinutes(min: number): string {
  const n = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}

/** Shift length in hours; an end earlier than the start crosses midnight. */
export function shiftHours(start: string, end: string, unpaidBreakMin = 0): number {
  let len = toMinutes(end) - toMinutes(start);
  if (len <= 0) len += 1440;
  return (len - unpaidBreakMin) / 60;
}

/** Shift interval as absolute minutes from the start of `date`'s day. */
export function shiftInterval(date: IsoDate, start: string, end: string, epoch: IsoDate): [number, number] {
  const base = daysBetween(epoch, date) * 1440;
  const s = base + toMinutes(start);
  let e = base + toMinutes(end);
  if (e <= s) e += 1440;
  return [s, e];
}
