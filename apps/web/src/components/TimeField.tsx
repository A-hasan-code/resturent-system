import { useId } from "react";

type Props = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** HH:MM step — default 1 minute. */
  step?: number;
};

/** Shared time control — same shell look as DateField. */
export function TimeField({ id, value, onChange, disabled, step = 60 }: Props) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const display = /^\d{2}:\d{2}/.test(value) ? value.slice(0, 5) : "—";

  return (
    <div className="date-field time-field">
      <label className="date-field-trigger time-field-trigger" htmlFor={inputId}>
        <span>{display}</span>
        <svg className="date-field-ico" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.6" />
          <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <input
          id={inputId}
          type="time"
          className="time-field-native"
          value={value}
          step={step}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    </div>
  );
}
