/** Ordered sections of a customer bill (thermal layout builder). */
export const BILL_BLOCK_IDS = [
  "logo",
  "name",
  "phone",
  "address",
  "tagline",
  "title",
  "meta",
  "staff",
  "items",
  "totals",
  "stamp",
  "footer",
] as const;

export type BillBlockId = (typeof BILL_BLOCK_IDS)[number];

export const DEFAULT_BILL_BLOCK_ORDER: BillBlockId[] = [...BILL_BLOCK_IDS];

const ID_SET = new Set<string>(BILL_BLOCK_IDS);

/** Normalize saved / preview order — unknown ids dropped, missing ids appended in default order. */
export function normalizeBillBlockOrder(raw: unknown): BillBlockId[] {
  const seen = new Set<string>();
  const out: BillBlockId[] = [];
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? (() => {
          try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return raw.split(/[,\s]+/).filter(Boolean);
          }
        })()
      : [];

  for (const item of list) {
    const id = String(item || "").trim();
    if (!ID_SET.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id as BillBlockId);
  }
  for (const id of BILL_BLOCK_IDS) {
    if (!seen.has(id)) out.push(id);
  }
  return out;
}
