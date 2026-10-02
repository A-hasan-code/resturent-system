import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_LOCALE,
  Locale,
  LOCALE_META,
  LOCALE_STORAGE_KEY,
  MessageKey,
  MESSAGES,
  statusKey,
} from "./locales";

type Vars = Record<string, string | number>;

type I18nCtx = {
  locale: Locale;
  dir: "ltr" | "rtl";
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, vars?: Vars) => string;
  /** Translate known status codes; falls back to the raw code. */
  ts: (code: string) => string;
};

const Ctx = createContext<I18nCtx | null>(null);

function readStoredLocale(): Locale {
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (raw === "en" || raw === "ur") return raw;
  } catch {
    /* ignore */
  }
  return DEFAULT_LOCALE;
}

function applyDocumentLocale(locale: Locale) {
  const meta = LOCALE_META[locale];
  document.documentElement.lang = locale;
  document.documentElement.dir = meta.dir;
}

function format(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    vars[name] !== undefined ? String(vars[name]) : `{${name}}`,
  );
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readStoredLocale);

  useEffect(() => {
    applyDocumentLocale(locale);
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback(
    (key: MessageKey, vars?: Vars) => {
      const catalog = MESSAGES[locale] ?? MESSAGES.en;
      const text = catalog[key] ?? MESSAGES.en[key] ?? key;
      return format(text, vars);
    },
    [locale],
  );

  const ts = useCallback(
    (code: string) => {
      const key = statusKey(code);
      return key ? t(key) : code;
    },
    [t],
  );

  const value = useMemo<I18nCtx>(
    () => ({
      locale,
      dir: LOCALE_META[locale].dir,
      setLocale,
      t,
      ts,
    }),
    [locale, setLocale, t, ts],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}

/** Shortcut: `const t = useT()` */
export function useT() {
  return useI18n().t;
}
