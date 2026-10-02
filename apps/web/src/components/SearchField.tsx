import { useT } from "../i18n";

type Props = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
};

export function SearchField({ value, onChange, placeholder }: Props) {
  const t = useT();
  return (
    <div className="search-field">
      <span className="search-ico" aria-hidden>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || t("common.search")}
        aria-label={t("common.search")}
        autoComplete="off"
      />
      {value ? (
        <button
          type="button"
          className="search-clear"
          onClick={() => onChange("")}
          aria-label={t("common.clearSearch")}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

/** Multi-word search: every token must appear somewhere in the combined text. */
export function matchesSearch(
  q: string,
  ...parts: Array<string | number | null | undefined>
) {
  const raw = q.trim().toLowerCase();
  if (!raw) return true;
  const hay = parts
    .map((p) => String(p ?? "").toLowerCase())
    .join(" ")
    .replace(/\s+/g, " ");
  const tokens = raw.split(/\s+/).filter(Boolean);
  return tokens.every((tok) => hay.includes(tok));
}
