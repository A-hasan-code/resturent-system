import { useEffect, useId } from "react";

/** Branded Pixalbotics loader used for connection, page waits, and modal waits. */
export function BrandLoader({
  label,
  compact,
}: {
  label?: string;
  compact?: boolean;
}) {
  const uid = useId().replace(/:/g, "");
  return (
    <div className={`px-loader ${compact ? "compact" : ""}`} role="status" aria-live="polite">
      <div className="px-loader-mark" aria-hidden>
        <svg viewBox="0 0 72 72" className="px-loader-ring">
          <defs>
            <linearGradient id={`pxg-${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="var(--accent)" />
              <stop offset="100%" stopColor="var(--accent-2)" />
            </linearGradient>
          </defs>
          <circle className="px-track" cx="36" cy="36" r="28" />
          <circle className="px-arc" cx="36" cy="36" r="28" stroke={`url(#pxg-${uid})`} />
        </svg>
        <span className="px-letter">P</span>
      </div>
      <div className="px-loader-copy">
        <strong>Pixalbotics</strong>
        {label ? <span>{label}</span> : null}
      </div>
    </div>
  );
}

/** Full-screen branded wait (login bootstrap, rare blocking work). */
export function BrandSplash({ label }: { label?: string }) {
  useEffect(() => {
    document.body.classList.add("px-splash-open");
    return () => document.body.classList.remove("px-splash-open");
  }, []);
  return (
    <div className="px-splash">
      <BrandLoader label={label} />
    </div>
  );
}
