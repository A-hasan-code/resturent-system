import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
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

function parseDay(iso: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y!, m! - 1, d!);
  if (dt.getFullYear() !== y || dt.getMonth() !== m! - 1 || dt.getDate() !== d) return null;
  return dt;
}

function toIso(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function clampIso(iso: string, min?: string, max?: string) {
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const POP_WIDTH = 280;
const POP_GAP = 6;
const VIEW_PAD = 8;

export function DateField({ id, value, onChange, min, max, disabled }: Props) {
  const t = useT();
  const autoId = useId();
  const inputId = id ?? autoId;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PopPos | null>(null);
  const selected = parseDay(value);
  const [view, setView] = useState(() => startOfMonth(selected ?? new Date()));

  useEffect(() => {
    if (open) setView(startOfMonth(selected ?? new Date()));
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
      const popH = pop?.offsetHeight ?? 320;
      const popW = Math.min(POP_WIDTH, window.innerWidth - VIEW_PAD * 2);
      const spaceBelow = window.innerHeight - rect.bottom - VIEW_PAD;
      const openUp = spaceBelow < popH && rect.top > spaceBelow;

      let top = openUp ? rect.top - popH - POP_GAP : rect.bottom + POP_GAP;
      top = Math.max(VIEW_PAD, Math.min(top, window.innerHeight - popH - VIEW_PAD));

      // Prefer left-align with trigger; if that overflows, right-align to trigger.
      let left = rect.left;
      if (left + popW > window.innerWidth - VIEW_PAD) {
        left = rect.right - popW;
      }
      left = Math.max(VIEW_PAD, Math.min(left, window.innerWidth - popW - VIEW_PAD));

      setPos({ top, left });
    };

    place();
    // Second pass after paint so measured pop height is accurate.
    const raf = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, view]);

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

  const days = useMemo(() => {
    const first = startOfMonth(view);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const iso = toIso(d);
      const inMonth = d.getMonth() === view.getMonth();
      const disabledDay = (!!min && iso < min) || (!!max && iso > max);
      const isSelected = value === iso;
      const isToday = iso === toIso(new Date());
      return { d, iso, inMonth, disabledDay, isSelected, isToday };
    });
  }, [view, value, min, max]);

  const title = view.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const display = selected
    ? selected.toLocaleDateString("en-PK", { day: "2-digit", month: "2-digit", year: "numeric" })
    : "—";

  function pick(iso: string) {
    onChange(clampIso(iso, min, max));
    setOpen(false);
  }

  const popover =
    open &&
    createPortal(
      <div
        className="date-pop"
        role="dialog"
        aria-label={title}
        ref={popRef}
        style={
          pos
            ? { top: pos.top, left: pos.left, width: Math.min(POP_WIDTH, window.innerWidth - VIEW_PAD * 2) }
            : { visibility: "hidden", top: 0, left: 0 }
        }
      >
        <div className="date-pop-head">
          <strong>{title}</strong>
          <div className="date-pop-nav">
            <button type="button" className="date-nav-btn" aria-label="Previous month" onClick={() => setView((v) => addMonths(v, -1))}>
              ‹
            </button>
            <button type="button" className="date-nav-btn" aria-label="Next month" onClick={() => setView((v) => addMonths(v, 1))}>
              ›
            </button>
          </div>
        </div>

        <div className="date-pop-week">
          {WEEKDAYS.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>

        <div className="date-pop-grid">
          {days.map((day) => (
            <button
              key={day.iso + String(day.inMonth)}
              type="button"
              disabled={day.disabledDay}
              className={[
                "date-day",
                day.inMonth ? "" : "muted",
                day.isSelected ? "selected" : "",
                day.isToday && !day.isSelected ? "today" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => pick(day.iso)}
            >
              {day.d.getDate()}
            </button>
          ))}
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
            disabled={(!!min && toIso(new Date()) < min) || (!!max && toIso(new Date()) > max)}
            onClick={() => pick(clampIso(toIso(new Date()), min, max))}
          >
            {t("common.today")}
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
