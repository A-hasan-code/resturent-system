/** Restaurant business shift: open (dayStart) → close (dayClose), using the server clock.
 * Overnight example: open 10:00 → close 03:00 next calendar morning.
 * Same-day example: open 09:00 → close 22:00.
 * Between close and next open → upcoming business date (not previous).
 * If close times are omitted, legacy behaviour is open → next open (24h).
 */

const HM = /^(\d{1,2}):(\d{2})$/;

export type DayHm = { h: number; m: number; label: string };

export type ShiftClock = DayHm & {
  closeH: number;
  closeM: number;
  closeLabel: string;
};

export function parseDayStart(raw: string | undefined | null): DayHm {
  const match = HM.exec((raw || "11:00").trim());
  let h = 11;
  let m = 0;
  if (match) {
    h = Math.min(23, Math.max(0, Number(match[1])));
    m = Math.min(59, Math.max(0, Number(match[2])));
  }
  const label = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return { h, m, label };
}

/** Alias — open or close HH:mm. */
export const parseHm = parseDayStart;

export function isoDay(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function minutesOf(h: number, m: number) {
  return h * 60 + m;
}

/**
 * Calendar date the current shift started on.
 * Overnight (close < open): before open and after previous close → previous calendar day.
 * Legacy (no close): before open → yesterday.
 */
export function businessDateOf(
  now: Date,
  openH: number,
  openM: number,
  closeH?: number,
  closeM?: number
) {
  const x = new Date(now);
  const t = minutesOf(x.getHours(), x.getMinutes());
  const open = minutesOf(openH, openM);

  if (closeH === undefined || closeM === undefined) {
    if (t < open) x.setDate(x.getDate() - 1);
    return isoDay(x);
  }

  const close = minutesOf(closeH, closeM);

  if (close > open) {
    // Same-calendar-day shift (e.g. 09:00–22:00).
    if (t < open) x.setDate(x.getDate() - 1);
    return isoDay(x);
  }

  // Overnight shift (e.g. 10:00 → next day 03:00).
  if (t >= open) return isoDay(x);
  if (t < close) {
    // After midnight, still inside previous night's shift.
    x.setDate(x.getDate() - 1);
    return isoDay(x);
  }
  // Between close and next open — next shift's calendar date (not previous).
  return isoDay(x);
}

/**
 * Exact shift window for a business date label.
 * Overnight: [date open, next calendar day close).
 * Same-day: [date open, date close).
 * Legacy: [date open, next day open).
 */
export function businessWindow(
  date: string,
  openH: number,
  openM: number,
  closeH?: number,
  closeM?: number
) {
  const [y, mo, d] = date.split("-").map(Number);
  const from = new Date(y, mo - 1, d, openH, openM, 0, 0);
  const to = new Date(from);

  if (closeH === undefined || closeM === undefined) {
    to.setDate(to.getDate() + 1);
    return { from, to };
  }

  const open = minutesOf(openH, openM);
  const close = minutesOf(closeH, closeM);
  if (close > open) {
    to.setHours(closeH, closeM, 0, 0);
  } else {
    to.setDate(to.getDate() + 1);
    to.setHours(closeH, closeM, 0, 0);
  }
  return { from, to };
}

/**
 * Timestamp for a business-date form field — always inside that shift window.
 */
export function businessDayStamp(
  date: string,
  openH: number,
  openM: number,
  closeH?: number,
  closeM?: number
) {
  return businessWindow(date, openH, openM, closeH, closeM).from;
}

/**
 * Optional widen for rare clock skew. Default padHours=0.
 */
export function padBusinessRange(
  range: { from: Date; to: Date } | { gte: Date; lt: Date },
  hours = 0
) {
  const gte = "gte" in range ? range.gte : range.from;
  const lt = "lt" in range ? range.lt : range.to;
  const ms = Math.max(0, hours) * 60 * 60 * 1000;
  return { gte: new Date(gte.getTime() - ms), lt: new Date(lt.getTime() + ms) };
}

/**
 * Exact shift window + Prisma filter bounds.
 * Must stay in sync across Dashboard, Bills, Payments, Finance, Close, Audit.
 */
export function businessQueryWindow(
  date: string,
  openH: number,
  openM: number,
  closeH?: number,
  closeM?: number,
  padHours = 0
) {
  const { from, to } = businessWindow(date, openH, openM, closeH, closeM);
  const padded = padBusinessRange({ from, to }, padHours);
  return { from, to, gte: padded.gte, lt: padded.lt };
}

/** Inclusive multi-day range — same shift bounds as businessQueryWindow. */
export function businessQueryRange(
  fromDay: string,
  toDay: string,
  openH: number,
  openM: number,
  closeH?: number,
  closeM?: number,
  padHours = 0
) {
  const a = businessWindow(fromDay, openH, openM, closeH, closeM);
  const b = businessWindow(toDay, openH, openM, closeH, closeM);
  const padded = padBusinessRange({ from: a.from, to: b.to }, padHours);
  return { from: a.from, to: b.to, gte: padded.gte, lt: padded.lt };
}

/** Add/subtract whole calendar days on a YYYY-MM-DD business date string. */
export function addBusinessDays(date: string, deltaDays: number) {
  const [y, mo, d] = date.split("-").map(Number);
  const x = new Date(y, mo - 1, d, 12, 0, 0, 0);
  x.setDate(x.getDate() + deltaDays);
  return isoDay(x);
}

/**
 * Default cook target date:
 * - Normal business date from clock + shift
 * - If that day already finished (leftover close / locked), cook goes to next calendar day
 */
export function defaultCookBusinessDate(
  now: Date,
  openH: number,
  openM: number,
  naturalDayFinished: boolean,
  closeH?: number,
  closeM?: number
) {
  const natural = businessDateOf(now, openH, openM, closeH, closeM);
  if (!naturalDayFinished) return natural;
  const cal = isoDay(now);
  if (natural === cal) return addBusinessDays(cal, 1);
  return cal;
}
