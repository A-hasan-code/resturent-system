import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n";

type Props = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
};

type PopPos = { top: number; left: number };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const POP_WIDTH = 280;
const POP_GAP = 6;
const VIEW_PAD = 8;

function parseMonth(ym: string) {
  if (!/^\d{4}-\d{2}$/.test(ym)) return null;
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return null;
  return { y, m };
}

function toYm(y: number, m: number) {
  return `${y}-${String(m).padStart(2, "0")}`;
}

function clampYm(ym: string, min?: string, max?: string) {
  if (min && ym < min) return min;
  if (max && ym > max) return max;
  return ym;
}

export function MonthField({ id, value, onChange, min, max, disabled }: Props) {
  const t = useT();
  const autoId = useId();
  const inputId = id ?? autoId;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PopPos | null>(null);
  const selected = parseMonth(value);
  const [viewYear, setViewYear] = useState(() => selected?.y ?? new Date().getFullYear());

  useEffect(() => {
    if (open) setViewYear(selected?.y ?? new Date().getFullYear());
  }, [open, value]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }

    const place = () => {
      const trigger = triggerRef.current;
      const pop = popRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const popH = pop?.offsetHeight ?? 280;
      const popW = Math.min(POP_WIDTH, window.innerWidth - VIEW_PAD * 2);
      const spaceBelow = window.innerHeight - rect.bottom - VIEW_PAD;
      const openUp = spaceBelow < popH && rect.top > spaceBelow;

      let top = openUp ? rect.top - popH - POP_GAP : rect.bottom + POP_GAP;
      top = Math.max(VIEW_PAD, Math.min(top, window.innerHeight - popH - VIEW_PAD));

      let left = rect.left;
      if (left + popW > window.innerWidth - VIEW_PAD) {
        left = rect.right - popW;
      }
      left = Math.max(VIEW_PAD, Math.min(left, window.innerWidth - popW - VIEW_PAD));

      setPos({ top, left });
    };

    place();
    const raf = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, viewYear]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || popRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const display = selected
    ? new Date(selected.y, selected.m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : "—";

  const now = new Date();
  const thisYm = toYm(now.getFullYear(), now.getMonth() + 1);

  function pick(ym: string) {
    onChange(clampYm(ym, min, max));
    setOpen(false);
  }

  function yearAllowed(delta: number) {
    const y = viewYear + delta;
    if (min && `${y}-12` < min) return false;
    if (max && `${y}-01` > max) return false;
    return true;
  }

  const popover =
    open &&
    createPortal(
      <div
        className="date-pop"
        role="dialog"
        aria-label={String(viewYear)}
        ref={popRef}
        style={
          pos
            ? { top: pos.top, left: pos.left, width: Math.min(POP_WIDTH, window.innerWidth - VIEW_PAD * 2) }
            : { visibility: "hidden", top: 0, left: 0 }
        }
      >
        <div className="date-pop-head">
          <strong>{viewYear}</strong>
          <div className="date-pop-nav">
            <button
              type="button"
              className="date-nav-btn"
              aria-label="Previous year"
              disabled={!yearAllowed(-1)}
              onClick={() => setViewYear((y) => y - 1)}
            >
              ‹
            </button>
            <button
              type="button"
              className="date-nav-btn"
              aria-label="Next year"
              disabled={!yearAllowed(1)}
              onClick={() => setViewYear((y) => y + 1)}
            >
              ›
            </button>
          </div>
        </div>

        <div className="month-pop-grid">
          {MONTHS.map((label, i) => {
            const m = i + 1;
            const ym = toYm(viewYear, m);
            const disabledMonth = (!!min && ym < min) || (!!max && ym > max);
            const isSelected = value === ym;
            const isThis = ym === thisYm;
            return (
              <button
                key={ym}
                type="button"
                disabled={disabledMonth}
                className={[
                  "month-day",
                  isSelected ? "selected" : "",
                  isThis && !isSelected ? "today" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => pick(ym)}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="date-pop-foot">
          <button
            type="button"
            className="date-foot-btn"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            {t("common.clear")}
          </button>
          <button
            type="button"
            className="date-foot-btn"
            disabled={(!!min && thisYm < min) || (!!max && thisYm > max)}
            onClick={() => pick(clampYm(thisYm, min, max))}
          >
            {t("audit.presetMonth")}
          </button>
        </div>
      </div>,
      document.body
    );

  return (
    <div className={`date-field${open ? " open" : ""}`} ref={rootRef}>
      <button
        type="button"
        id={inputId}
        ref={triggerRef}
        className="date-field-trigger"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{display}</span>
        <svg className="date-field-ico" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3.5" y="5.5" width="17" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8 3.5v3.5M16 3.5v3.5M3.5 10h17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      {popover}
    </div>
  );
}
