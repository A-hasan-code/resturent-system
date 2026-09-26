type Props = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
};

export function SearchField({ value, onChange, placeholder }: Props) {
  return (
    <div className="search-field">
      <span className="search-ico" aria-hidden>
        ⌕
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || "Search…"}
        aria-label="Search"
        autoComplete="off"
      />
      {value ? (
        <button
          type="button"
          className="search-clear"
          onClick={() => onChange("")}
          aria-label="Clear search"
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
  return tokens.every((t) => hay.includes(t));
}
