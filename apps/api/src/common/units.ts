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

export function convertQty(qty: number, from: UnitType, to: UnitType) {
  if (from === to) return qty;
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
