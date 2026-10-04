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
