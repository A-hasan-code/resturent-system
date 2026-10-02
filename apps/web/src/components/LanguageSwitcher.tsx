import { Locale, LOCALE_META, useI18n } from "../i18n";

const OPTIONS: Locale[] = ["en", "ur"];

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();

  return (
    <div className={`lang-switch${compact ? " compact" : ""}`} role="group" aria-label={t("shell.language")}>
      {!compact && <span className="lang-switch-label">{t("shell.language")}</span>}
      <div className="lang-switch-btns">
        {OPTIONS.map((code) => (
          <button
            key={code}
            type="button"
            className={locale === code ? "active" : ""}
            aria-pressed={locale === code}
            onClick={() => setLocale(code)}
            title={LOCALE_META[code].label}
          >
            {compact ? LOCALE_META[code].short : LOCALE_META[code].label}
          </button>
        ))}
      </div>
    </div>
  );
}
