import { PackUnit, UnitType } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

const factor: Partial<Record<UnitType, number>> = {
  KG: 1,
  G: 0.001,
  L: 1,
  ML: 0.001,
  PCS: 1,
};

export function hasPack(packUnit: PackUnit | string | null | undefined, unitsPerPack: number) {
  return packUnit != null && packUnit !== PackUnit.NONE && packUnit !== "NONE" && unitsPerPack > 1.0000001;
}

/** Convert purchase qty/rate entered in packs into stock-unit qty/rate. */
export function unpackPurchase(
  quantity: number,
  ratePerUnit: number,
  packUnit: PackUnit | string | null | undefined,
  unitsPerPack: number,
  inPacks: boolean
) {
  if (!inPacks || !hasPack(packUnit, unitsPerPack)) {
    return {
      quantity: Number(quantity.toFixed(3)),
      ratePerUnit: Math.round(ratePerUnit * 100) / 100,
    };
  }
  const stockQty = Number((quantity * unitsPerPack).toFixed(3));
  const ratePerStock = Math.round((ratePerUnit / unitsPerPack) * 100) / 100;
  return { quantity: stockQty, ratePerUnit: ratePerStock };
}

export function toNumber(v: Decimal | number | string | null | undefined | unknown) {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string" || typeof v === "boolean") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  // Prisma Decimal / similar
  if (typeof v === "object" && v !== null && "toNumber" in v && typeof (v as { toNumber: unknown }).toNumber === "function") {
    const n = (v as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(v as number | string);
  return Number.isFinite(n) ? n : 0;
}

/** solid = KG/G, liquid = L/ML, count = PCS — conversions only within a family. */
export function unitFamily(u: UnitType): "solid" | "liquid" | "count" {
  if (u === UnitType.KG || u === UnitType.G) return "solid";
  if (u === UnitType.L || u === UnitType.ML) return "liquid";
  return "count";
}

export function unitsCompatible(a: UnitType, b: UnitType) {
  return unitFamily(a) === unitFamily(b);
}

export function convertQty(qty: number, from: UnitType, to: UnitType) {
  if (from === to) return qty;
  if (!unitsCompatible(from, to)) {
    throw new Error(`Cannot convert ${from} to ${to}`);
  }
  const solid = new Set<UnitType>([UnitType.KG, UnitType.G]);
  const liquid = new Set<UnitType>([UnitType.L, UnitType.ML]);
  if (solid.has(from) && solid.has(to)) {
    return (qty * (factor[from] || 1)) / (factor[to] || 1);
  }
  if (liquid.has(from) && liquid.has(to)) {
    return (qty * (factor[from] || 1)) / (factor[to] || 1);
  }
  throw new Error(`Cannot convert ${from} to ${to}`);
}

export function unitCostFromRate(
  ratePerStoreUnit: number,
  storeUnit: UnitType,
  useQty: number,
  useUnit: UnitType
) {
  return convertQty(useQty, useUnit, storeUnit) * ratePerStoreUnit;
}
