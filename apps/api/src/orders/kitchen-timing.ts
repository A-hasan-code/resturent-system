/** Fallback prep minutes when a menu line has no recipe timer. */
export function defaultPrepMinutes(station: string | null | undefined): number {
  const s = (station || "").toUpperCase();
  if (s === "BEVERAGES") return 5;
  if (s === "BBQ") return 20;
  return 15;
}

export function itemPrepMinutes(opts: {
  kitchenStation?: string | null;
  prepMinutes?: number | null;
}): number {
  const fromRecipe = opts.prepMinutes;
  if (fromRecipe != null && fromRecipe > 0) return fromRecipe;
  return defaultPrepMinutes(opts.kitchenStation);
}

/** Longest target among kitchen lines (order-level timer). */
export function targetPrepMinutes(
  items: { kitchenStation?: string | null; prepMinutes?: number | null }[]
): number {
  if (!items.length) return defaultPrepMinutes(null);
  return Math.max(...items.map((i) => itemPrepMinutes(i)));
}
