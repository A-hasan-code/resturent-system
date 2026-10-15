/** Restaurant business day. Default 11:00 → next day 11:00, using the server clock. */

const HM = /^(\d{1,2}):(\d{2})$/;

export function parseDayStart(raw: string | undefined | null) {
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

export function isoDay(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Calendar date the business day started on. Before day-start, it is still yesterday. */
export function businessDateOf(now: Date, h: number, m: number) {
  const x = new Date(now);
  const before = x.getHours() < h || (x.getHours() === h && x.getMinutes() < m);
  if (before) x.setDate(x.getDate() - 1);
  return isoDay(x);
}

export function businessWindow(date: string, h: number, m: number) {
  const [y, mo, d] = date.split("-").map(Number);
  const from = new Date(y, mo - 1, d, h, m, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from, to };
}

/**
 * Widen a business window for list filters.
 * Absorbs Node/Postgres timezone skew on installed Windows servers
 * (local PC OK, service host TZ different → empty Paid history / empty dashboard).
 */
export function padBusinessRange(range: { from: Date; to: Date } | { gte: Date; lt: Date }, hours = 14) {
  const gte = "gte" in range ? range.gte : range.from;
  const lt = "lt" in range ? range.lt : range.to;
  const ms = Math.max(0, hours) * 60 * 60 * 1000;
  return { gte: new Date(gte.getTime() - ms), lt: new Date(lt.getTime() + ms) };
}

/**
 * Exact business window + padded Prisma filter bounds.
 * Use `from`/`to` for labels & locking; use `gte`/`lt` for every createdAt/spentAt query.
 * Must stay in sync across Dashboard, Bills, Payments, Finance, Close.
 */
export function businessQueryWindow(date: string, h: number, m: number, padHours = 14) {
  const { from, to } = businessWindow(date, h, m);
  const padded = padBusinessRange({ from, to }, padHours);
  return { from, to, gte: padded.gte, lt: padded.lt };
}

/** Inclusive multi-day range with the same TZ pad as businessQueryWindow. */
export function businessQueryRange(fromDay: string, toDay: string, h: number, m: number, padHours = 14) {
  const a = businessWindow(fromDay, h, m);
  const b = businessWindow(toDay, h, m);
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
 * - Normal business date from clock + dayStart
 * - If that day already has leftover close (or is locked), cook goes to the next calendar day
 *   (morning prep after close, before dayStart → today's calendar date).
 */
export function defaultCookBusinessDate(
  now: Date,
  h: number,
  m: number,
  naturalDayFinished: boolean
) {
  const natural = businessDateOf(now, h, m);
  if (!naturalDayFinished) return natural;
  const cal = isoDay(now);
  if (natural === cal) return addBusinessDays(cal, 1);
  return cal;
}
