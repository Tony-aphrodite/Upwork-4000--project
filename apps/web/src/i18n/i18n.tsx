"use client";

/**
 * Every string on screen comes from messages/<locale>.json; there is no text in the components.
 * Adding Arabic is translation work: ar.json, plus dir="rtl", which the layout already mirrors
 * because it only uses start/end, never left/right. Numbers and dates are formatted per locale.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { formatMinor, type Currency } from "@qirsh/money";
import en from "./messages/en.json";
import ar from "./messages/ar.json";

export type MessageKey = keyof typeof en;
export type Locale = "en" | "ar";
const MESSAGES: Record<Locale, Partial<Record<MessageKey, string>>> = { en, ar };

interface I18n {
  locale: Locale;
  dir: "ltr" | "rtl";
  setLocale: (l: Locale) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  money: (minor: number | null | undefined, currency: Currency, opts?: { decimals?: "auto" | "always"; sign?: boolean }) => string;
  number: (n: number | null | undefined, digits?: number) => string;
  date: (d: string | Date | null | undefined, style?: "short" | "medium" | "long" | "day" | "month") => string;
  dateTime: (d: string | Date | null | undefined) => string;
  percent: (fraction: number, digits?: number) => string;
}

const Ctx = createContext<I18n | null>(null);
const STORAGE_KEY = "qirsh.locale";
const INTL: Record<Locale, string> = { en: "en-GB", ar: "ar-SD" };

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "ar" || saved === "en") setLocaleState(saved);
    } catch {
      /* private mode: stay in English */
    }
  }, []);
  const dir = locale === "ar" ? "rtl" : "ltr";
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, dir]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<I18n>(() => {
    const tag = INTL[locale];
    const t = (key: MessageKey, vars?: Record<string, string | number>) => {
      // Singular forms: "{n} accounts" has a "_one" twin used when n is 1.
      const one = vars?.n === 1 || vars?.n === "1" ? (`${key}_one` as MessageKey) : null;
      let s = (one && (MESSAGES[locale][one] ?? (en as Record<string, string>)[one])) || MESSAGES[locale][key] || en[key] || key;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
      return s;
    };
    const toDate = (d: string | Date) => (typeof d === "string" ? new Date(d.length === 10 ? `${d}T12:00:00Z` : d) : d);
    return {
      locale,
      dir,
      setLocale,
      t,
      money: (minor, currency, opts = {}) => {
        if (minor === null || minor === undefined) return "—";
        const s = formatMinor(Math.abs(minor), currency, tag, { decimals: opts.decimals });
        const neg = minor < 0 ? "−" : opts.sign && minor > 0 ? "+" : "";
        return neg + s;
      },
      number: (n, digits = 0) => (n === null || n === undefined ? "—" : new Intl.NumberFormat(tag, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n)),
      date: (d, style = "medium") => {
        if (!d) return "—";
        const date = toDate(d);
        const opts: Intl.DateTimeFormatOptions =
          style === "short" ? { day: "numeric", month: "short" } : style === "long" ? { weekday: "long", day: "numeric", month: "long", year: "numeric" } : style === "day" ? { weekday: "short", day: "numeric", month: "short" } : style === "month" ? { month: "long", year: "numeric" } : { day: "numeric", month: "short", year: "numeric" };
        return new Intl.DateTimeFormat(tag, { ...opts, timeZone: "Africa/Khartoum" }).format(date);
      },
      dateTime: (d) => (d ? new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Khartoum" }).format(toDate(d)) : "—"),
      percent: (fraction, digits = 1) => new Intl.NumberFormat(tag, { style: "percent", maximumFractionDigits: digits, minimumFractionDigits: digits }).format(fraction),
    };
  }, [locale, dir, setLocale]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n outside I18nProvider");
  return v;
}
