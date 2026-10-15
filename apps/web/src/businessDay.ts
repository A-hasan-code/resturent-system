/** Local calendar YYYY-MM-DD (not UTC — avoids midnight PK/UTC flip). */
export function localIsoDay(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Restaurant business date from clock + day-start (same rule as API businessDateOf).
 * Before dayStart it is still yesterday.
 */
export function businessDateOf(now: Date, h: number, m: number) {
  const x = new Date(now);
  const before = x.getHours() < h || (x.getHours() === h && x.getMinutes() < m);
  if (before) x.setDate(x.getDate() - 1);
  return localIsoDay(x);
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
