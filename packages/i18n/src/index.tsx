import { IntlMessageFormat } from "intl-messageformat";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";

/**
 * ICU MessageFormat strings in four languages (spec 7.5). Every string may use {productName};
 * the value comes from tenant branding, so the product name never lives in translations (0.2).
 * Adding a fifth language means adding one more catalog object — no code changes.
 */

export type Locale = "pl" | "uk" | "ru" | "en";
export const LOCALES: Locale[] = ["pl", "uk", "ru", "en"];
export const LOCALE_LABEL: Record<Locale, string> = { pl: "PL", uk: "UK", ru: "RU", en: "EN" };
const BCP47: Record<Locale, string> = { pl: "pl-PL", uk: "uk-UA", ru: "ru-RU", en: "en-GB" };

export type Catalog = Record<string, string>;
export type Catalogs = Record<Locale, Catalog>;

/** Merge per-module catalogs: mergeCatalogs(common, dashboard, …). */
export function mergeCatalogs(...parts: Catalogs[]): Catalogs {
  const out: Catalogs = { pl: {}, uk: {}, ru: {}, en: {} };
  for (const part of parts) for (const l of LOCALES) Object.assign(out[l], part[l]);
  return out;
}

type Values = Record<string, string | number | Date | boolean | null | undefined>;

interface I18nValue {
  locale: Locale;
  t: (key: string, values?: Values) => string;
  num: (n: number, opts?: Intl.NumberFormatOptions) => string;
  hours: (h: number) => string;
  money: (amount: number | string, currency: string) => string;
  date: (d: string | Date, opts?: Intl.DateTimeFormatOptions) => string;
  time: (d: string | Date) => string;
  bcp47: string;
}

const Ctx = createContext<I18nValue | null>(null);

const cache = new Map<string, IntlMessageFormat>();

export function I18nProvider({ locale, catalogs, productName, children }: { locale: Locale; catalogs: Catalogs; productName: string; children: ReactNode }) {
  const bcp47 = BCP47[locale];
  const t = useCallback(
    (key: string, values?: Values) => {
      const msg = catalogs[locale][key] ?? catalogs.en[key] ?? catalogs.pl[key];
      if (msg === undefined) {
        if ((globalThis as { __KADREO_DEV__?: boolean }).__KADREO_DEV__) console.warn(`[i18n] missing key ${key}`);
        return key;
      }
      const cacheKey = `${locale}|${key}`;
      let f = cache.get(cacheKey);
      if (!f) {
        f = new IntlMessageFormat(msg, bcp47);
        cache.set(cacheKey, f);
      }
      return String(f.format({ productName, ...values }));
    },
    [locale, catalogs, productName, bcp47],
  );
  const value = useMemo<I18nValue>(() => {
    const nf = new Intl.NumberFormat(bcp47);
    return {
      locale,
      bcp47,
      t,
      num: (n, opts) => (opts ? new Intl.NumberFormat(bcp47, opts).format(n) : nf.format(n)),
      hours: (h) => new Intl.NumberFormat(bcp47, { maximumFractionDigits: 2 }).format(h),
      money: (amount, currency) => new Intl.NumberFormat(bcp47, { style: "currency", currency, minimumFractionDigits: 2 }).format(Number(amount)),
      date: (d, opts) => new Intl.DateTimeFormat(bcp47, opts ?? { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(typeof d === "string" ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d) : d),
      time: (d) => new Intl.DateTimeFormat(bcp47, { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Warsaw" }).format(typeof d === "string" ? new Date(d) : d),
    };
  }, [locale, bcp47, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n outside I18nProvider");
  return v;
}

/** Pick the user's language from a value stored in all four languages. */
export function useLocalized() {
  const { locale } = useI18n();
  return useCallback((text: Record<Locale, string> | undefined) => (text ? text[locale] || text.pl : ""), [locale]);
}
