import { BadRequestException } from "@nestjs/common";
import { UnitType } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { toNumber } from "./units";

type QtyField = Decimal | number | string | null | undefined;

export type MenuQtyRules = {
  name: string;
  sellUnit: UnitType;
  minQty: QtyField;
  maxQty?: QtyField;
  qtyStep?: QtyField;
  allowCustomQty: boolean;
};

const EPS = 0.0005;

export function defaultQtyStep(unit: UnitType): number {
  return unit === "KG" || unit === "L" ? 0.5 : 1;
}

export function resolveQtyStep(rules: Pick<MenuQtyRules, "sellUnit" | "qtyStep">): number {
  const raw = rules.qtyStep == null ? 0 : toNumber(rules.qtyStep);
  return raw > 0 ? raw : defaultQtyStep(rules.sellUnit);
}

/** First qty when adding the item to a cart / order. Prefer listed portion. */
export function resolveStartQty(
  rules: MenuQtyRules & { listPortionQty?: QtyField }
) {
  const list = rules.listPortionQty != null ? toNumber(rules.listPortionQty) : 0;
  if (list > 0) return +list.toFixed(3);
  const step = resolveQtyStep(rules);
  const min = toNumber(rules.minQty);
  if (min > 0) return +min.toFixed(3);
  return step;
}

export function resolveMinQty(rules: MenuQtyRules): number {
  const min = toNumber(rules.minQty);
  if (min > 0) return min;
  return 0;
}

export function resolveMaxQty(rules: MenuQtyRules): number | null {
  if (rules.maxQty == null) return null;
  const max = toNumber(rules.maxQty);
  return max > 0 ? max : null;
}

function nearlyMultiple(qty: number, step: number, origin: number): boolean {
  if (step <= 0) return true;
  const n = (qty - origin) / step;
  return Math.abs(n - Math.round(n)) < EPS / step || Math.abs(qty - origin) < EPS;
}

/** Throws if qty is outside admin rules. qty 0 (line remove) is allowed by callers before this. */
export function assertMenuQty(rules: MenuQtyRules, qty: number) {
  if (!(qty > 0)) throw new BadRequestException(`${rules.name}: quantity must be greater than 0`);

  const step = resolveQtyStep(rules);
  const min = resolveMinQty(rules);
  const max = resolveMaxQty(rules);
  const floor = min > 0 ? min : rules.allowCustomQty ? 0 : step;

  if (floor > 0 && qty + EPS < floor) {
    throw new BadRequestException(
      `${rules.name}: minimum is ${floor} ${rules.sellUnit.toLowerCase()}`
    );
  }
  if (max != null && qty - EPS > max) {
    throw new BadRequestException(
      `${rules.name}: maximum is ${max} ${rules.sellUnit.toLowerCase()}`
    );
  }
  if (!rules.allowCustomQty) {
    const origin = min > 0 ? min : step;
    if (!nearlyMultiple(qty, step, origin) && Math.abs(qty - origin) >= EPS) {
      throw new BadRequestException(
        `${rules.name}: use steps of ${step} ${rules.sellUnit.toLowerCase()} from ${origin}`
      );
    }
  }
}

export function menuQtyDto(rules: {
  minQty: QtyField;
  maxQty?: QtyField;
  qtyStep?: QtyField;
  allowCustomQty: boolean;
}) {
  return {
    minQty: toNumber(rules.minQty),
    maxQty: rules.maxQty == null ? null : toNumber(rules.maxQty),
    qtyStep: rules.qtyStep == null ? null : toNumber(rules.qtyStep),
    allowCustomQty: rules.allowCustomQty,
  };
}
