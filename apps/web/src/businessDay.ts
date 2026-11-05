/** Local calendar YYYY-MM-DD (not UTC — avoids midnight PK/UTC flip). */
export function localIsoDay(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDayStart(label: string | null | undefined) {
  const match = /^(\d{1,2}):(\d{2})$/.exec((label || "11:00").trim());
  let h = 11;
  let m = 0;
  if (match) {
    h = Math.min(23, Math.max(0, Number(match[1])));
    m = Math.min(59, Math.max(0, Number(match[2])));
  }
  return { h, m, label: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` };
}

/**
 * Restaurant business date from clock + shift open/close (same rule as API).
 * Overnight: open 10:00 → close 03:00. After close until next open → upcoming day.
 */
export function businessDateOf(
  now: Date,
  openH: number,
  openM: number,
  closeH?: number,
  closeM?: number
) {
  const x = new Date(now);
  const t = x.getHours() * 60 + x.getMinutes();
  const open = openH * 60 + openM;

  if (closeH === undefined || closeM === undefined) {
    if (t < open) x.setDate(x.getDate() - 1);
    return localIsoDay(x);
  }

  const close = closeH * 60 + closeM;
  if (close > open) {
    if (t < open) x.setDate(x.getDate() - 1);
    return localIsoDay(x);
  }

  // Overnight shift
  if (t >= open) return localIsoDay(x);
  if (t < close) {
    x.setDate(x.getDate() - 1);
    return localIsoDay(x);
  }
  return localIsoDay(x);
}
