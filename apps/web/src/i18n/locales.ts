import { en, type MessageKey } from "./en";
import { ur } from "./ur";

export type Locale = "en" | "ur";
export type { MessageKey };

export const LOCALE_META: Record<
  Locale,
  { label: string; short: string; dir: "ltr" | "rtl" }
> = {
  en: { label: "English", short: "EN", dir: "ltr" },
  ur: { label: "اردو", short: "UR", dir: "rtl" },
};

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_STORAGE_KEY = "hotel.locale";

export const MESSAGES: Record<Locale, Record<MessageKey, string>> = {
  en: en as Record<MessageKey, string>,
  ur,
};

/** Map API status codes to i18n keys when available. */
export function statusKey(code: string): MessageKey | null {
  const k = `status.${code}` as MessageKey;
  return k in en ? k : null;
}
