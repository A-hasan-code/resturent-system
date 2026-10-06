export type QtyRules = {
  sellUnit: string;
  minQty?: number | null;
  maxQty?: number | null;
  qtyStep?: number | null;
  allowCustomQty?: boolean;
  listPortionQty?: number | null;
};

export type QtyIssue = "invalid" | "below_min" | "above_max" | "bad_step" | null;

export function defaultQtyStep(unit: string) {
  return unit === "KG" || unit === "L" ? 0.5 : 1;
}

export function qtyStepOf(m: QtyRules) {
  const raw = m.qtyStep == null ? 0 : Number(m.qtyStep);
  return raw > 0 ? raw : defaultQtyStep(m.sellUnit);
}

export function startQtyOf(m: QtyRules) {
  const list = Number(m.listPortionQty || 0);
  if (list > 0) return +list.toFixed(3);
  const min = Number(m.minQty || 0);
  if (min > 0) return +min.toFixed(3);
  return qtyStepOf(m);
}

/** Menu / waiter label: "450 / 500 g" from list portion. */
export function listPriceLabel(
  m: {
    sellUnit: string;
    sellingPrice: number;
    listPortionQty?: number | null;
    listAmount?: number | null;
  },
  moneyFn: (n: number) => string
) {
  const portion = Number(m.listPortionQty || 0) > 0 ? Number(m.listPortionQty) : 1;
  const amount =
    m.listAmount != null && Number(m.listAmount) > 0
      ? Number(m.listAmount)
      : Math.round(m.sellingPrice * portion * 100) / 100;
  if (m.sellUnit === "KG") {
    const g = Math.round(portion * 1000 * 1000) / 1000;
    return `${moneyFn(amount)} / ${g} g`;
  }
  if (m.sellUnit === "L") {
    const ml = Math.round(portion * 1000 * 1000) / 1000;
    return `${moneyFn(amount)} / ${ml} ml`;
  }
  const u = m.sellUnit.toLowerCase();
  return `${moneyFn(amount)} / ${portion} ${u}`;
}

export function minQtyOf(m: QtyRules) {
  const min = Number(m.minQty || 0);
  return min > 0 ? min : 0;
}

export function maxQtyOf(m: QtyRules) {
  if (m.maxQty == null || m.maxQty === ("" as unknown)) return null;
  const max = Number(m.maxQty);
  return max > 0 ? max : null;
}

export function allowCustomOf(m: QtyRules) {
  return m.allowCustomQty !== false;
}

/** Quick chips for cart — few useful values even when the range is large. */
export function quickQtys(m: QtyRules): number[] {
  const step = qtyStepOf(m);
  const min = minQtyOf(m);
  const max = maxQtyOf(m);
  const start = min > 0 ? min : step;
  const end = max != null ? max : +(start + step * 3).toFixed(3);
  if (end + 1e-9 < start) return [start];

  const span = end - start;
  const stepsCount = Math.max(0, Math.round(span / step));
  const out: number[] = [];
  const push = (q: number) => {
    const v = +q.toFixed(3);
    if (!out.includes(v)) out.push(v);
  };

  if (stepsCount <= 5) {
    for (let q = start; q <= end + 1e-9; q = +(q + step).toFixed(3)) push(q);
    return out;
  }

  push(start);
  for (let i = 1; i <= 3; i++) {
    const raw = start + (span * i) / 4;
    const n = Math.round((raw - start) / step);
    push(start + n * step);
  }
  push(end);
  return out.filter((q) => q >= start - 1e-9 && q <= end + 1e-9).sort((a, b) => a - b);
}

/** Soft clamp for +/- / chips only — not while typing. */
export function clampQty(m: QtyRules, qty: number): number {
  if (qty <= 0) return 0;
  const step = qtyStepOf(m);
  const min = minQtyOf(m);
  const max = maxQtyOf(m);
  let q = +qty.toFixed(3);
  if (min > 0 && q < min) q = min;
  if (max != null && q > max) q = max;
  if (!allowCustomOf(m)) {
    const origin = min > 0 ? min : step;
    const n = Math.round((q - origin) / step);
    q = +(origin + Math.max(0, n) * step).toFixed(3);
    if (max != null && q > max) {
      const maxN = Math.floor((max - origin) / step + 1e-9);
      q = +(origin + Math.max(0, maxN) * step).toFixed(3);
    }
  }
  return q;
}

export function bumpQty(m: QtyRules, qty: number, dir: 1 | -1): number {
  const step = qtyStepOf(m);
  return clampQty(m, +(qty + dir * step).toFixed(3));
}

function nearlyMultiple(qty: number, step: number, origin: number): boolean {
  if (step <= 0) return true;
  const n = (qty - origin) / step;
  return Math.abs(n - Math.round(n)) < 0.0005 / step || Math.abs(qty - origin) < 0.0005;
}

/** Validate a typed / committed qty against menu rules (no auto-fix). */
export function qtyIssueOf(m: QtyRules, qty: number): QtyIssue {
  if (!Number.isFinite(qty) || qty <= 0) return "invalid";
  const min = minQtyOf(m);
  const max = maxQtyOf(m);
  const step = qtyStepOf(m);
  if (min > 0 && qty + 0.0005 < min) return "below_min";
  if (max != null && qty - 0.0005 > max) return "above_max";
  if (!allowCustomOf(m)) {
    const origin = min > 0 ? min : step;
    if (!nearlyMultiple(qty, step, origin) && Math.abs(qty - origin) >= 0.0005) return "bad_step";
  }
  return null;
}
