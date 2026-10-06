import { UnitType } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

const factor: Partial<Record<UnitType, number>> = {
  KG: 1,
  G: 0.001,
  L: 1,
  ML: 0.001,
  PCS: 1,
};

export function toNumber(v: Decimal | number | string | null | undefined) {
  if (v == null) return 0;
  return typeof v === "number" ? v : Number(v);
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
