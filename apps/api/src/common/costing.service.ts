import { BadRequestException, Injectable } from "@nestjs/common";
import { UnitType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { convertQty, toNumber, unitCostFromRate } from "./units";

const UNIT_LABEL: Record<UnitType, string> = { KG: "kg", G: "g", L: "L", ML: "ml", PCS: "pcs" };

function qtyLabel(n: number, unit: UnitType) {
  const rounded = Math.round(n * 1000) / 1000;
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded);
  return `${text} ${UNIT_LABEL[unit] ?? unit}`;
}

function formatShortfalls(
  short: { name: string; unit: UnitType; need: number; onHand: number; dishes?: string[] }[],
  action: string
) {
  const parts = short.map((n) => {
    const dish = n.dishes?.length ? `${n.dishes.join(", ")} · ` : "";
    const state = n.onHand <= 0.0001 ? "out of stock" : "short";
    return `${dish}${n.name} is ${state} (store ${qtyLabel(n.onHand, n.unit)}, need ${qtyLabel(n.need, n.unit)})`;
  });
  return `${action}: ${parts.join("; ")}. Not done — inventory unchanged.`;
}

@Injectable()
export class CostingService {
  constructor(private readonly prisma: PrismaService) {}

  async recipeUnitCost(recipeId: string) {
    const recipe = await this.prisma.recipe.findUniqueOrThrow({
      where: { id: recipeId },
      include: { ingredients: { include: { storeItem: true } } },
    });

    let cost = 0;
    for (const ing of recipe.ingredients) {
      cost += unitCostFromRate(
        toNumber(ing.storeItem.ratePerUnit),
        ing.storeItem.unit,
        toNumber(ing.quantity),
        ing.unit
      );
    }

    const baseQty = toNumber(recipe.baseQty) || 1;
    return { recipe, costPerBase: cost / baseQty, totalForBase: cost };
  }

  /** Ingredients that would go short for the given recipe quantities (shared items summed). */
  async recipeStockShortfalls(lines: { recipeId: string; quantity: number; name: string }[]) {
    const wanted = lines.filter((l) => l.recipeId && l.quantity > 0);
    if (!wanted.length) return [] as {
      name: string;
      unit: UnitType;
      need: number;
      onHand: number;
      dishes: string[];
    }[];

    const recipes = await this.prisma.recipe.findMany({
      where: { id: { in: [...new Set(wanted.map((l) => l.recipeId))] } },
      include: { ingredients: { include: { storeItem: true } } },
    });
    const byId = new Map(recipes.map((r) => [r.id, r]));

    type Need = {
      name: string;
      unit: UnitType;
      need: number;
      onHand: number;
      dishes: Set<string>;
    };
    const needs = new Map<string, Need>();

    for (const line of wanted) {
      const recipe = byId.get(line.recipeId);
      if (!recipe) continue;
      const scale = line.quantity / (toNumber(recipe.baseQty) || 1);
      for (const ing of recipe.ingredients) {
        const deduct = convertQty(toNumber(ing.quantity) * scale, ing.unit, ing.storeItem.unit);
        const row = needs.get(ing.storeItemId) ?? {
          name: ing.storeItem.name,
          unit: ing.storeItem.unit,
          need: 0,
          onHand: Math.max(0, toNumber(ing.storeItem.quantityOnHand)),
          dishes: new Set<string>(),
        };
        row.need += deduct;
        row.dishes.add(line.name);
        needs.set(ing.storeItemId, row);
      }
    }

    return [...needs.values()]
      .filter((n) => n.need - n.onHand > 0.0001)
      .map((n) => ({
        name: n.name,
        unit: n.unit,
        need: n.need,
        onHand: n.onHand,
        dishes: [...n.dishes],
      }));
  }

  /** Block when any recipe ingredient is short. Shared ingredients in one order are added together. */
  async assertCanSell(lines: { recipeId: string; quantity: number; name: string }[]) {
    const short = await this.recipeStockShortfalls(lines);
    if (!short.length) return;
    throw new BadRequestException(formatShortfalls(short, "Cannot sell"));
  }

  /** Cost for selling `qty` of a menu item (from linked recipe). */
  async menuItemCost(menuItemId: string, qty: number) {
    const menu = await this.prisma.menuItem.findUnique({
      where: { id: menuItemId },
    });
    if (!menu?.recipeId) return { unitCost: 0, costAmount: 0 };
    const { costPerBase } = await this.recipeUnitCost(menu.recipeId);
    return {
      unitCost: costPerBase,
      costAmount: costPerBase * qty,
    };
  }

  /** Fix orders saved with costTotal = 0 but menu items have recipes. */
  async repairMissingOrderCosts() {
    const orders = await this.prisma.order.findMany({
      where: { costTotal: 0, status: { not: "CANCELLED" } },
      include: { items: true },
      take: 200,
    });

    let fixed = 0;
    for (const order of orders) {
      let costTotal = 0;
      for (const item of order.items) {
        if (!item.menuItemId) continue;
        const { unitCost, costAmount } = await this.menuItemCost(
          item.menuItemId,
          toNumber(item.quantity)
        );
        costTotal += costAmount;
        if (costAmount > 0 && toNumber(item.costAmount) === 0) {
          await this.prisma.orderItem.update({
            where: { id: item.id },
            data: { unitCost, costAmount },
          });
        }
      }
      if (costTotal > 0) {
        await this.prisma.order.update({
          where: { id: order.id },
          data: { costTotal },
        });
        fixed += 1;
      }
    }
    return fixed;
  }

  /**
   * Convert finished cooked weight (grams) into the recipe's base-unit quantity.
   * KG recipes: 5000g → 5. PCS recipes: uses plateGrams as one "plate" of finished food.
   */
  cookedGramsToRecipeQty(args: {
    baseUnit: UnitType;
    cookedGrams: number;
    plateGrams?: number | null;
  }): number {
    const g = Math.max(0, Number(args.cookedGrams) || 0);
    const plateG = Math.max(1, Number(args.plateGrams) || 1);
    switch (args.baseUnit) {
      case UnitType.KG:
      case UnitType.L:
        return g / 1000;
      case UnitType.G:
      case UnitType.ML:
        return g;
      case UnitType.PCS:
        return g / plateG;
      default:
        return g / 1000;
    }
  }

  /**
   * Deduct recipe ingredients. Never lets quantityOnHand go below 0 —
   * if any ingredient is short, throws and leaves stock unchanged.
   */
  async deductRecipeStock(
    recipeId: string,
    orderQty: number,
    note: string,
    orderId?: string
  ) {
    if (!(orderQty > 0)) return 0;

    return this.prisma.$transaction(async (tx) => {
      const recipe = await tx.recipe.findUniqueOrThrow({
        where: { id: recipeId },
        include: { ingredients: { include: { storeItem: true } } },
      });
      const baseQty = toNumber(recipe.baseQty) || 1;
      const scale = orderQty / baseQty;

      type Plan = {
        storeItemId: string;
        name: string;
        unit: UnitType;
        deduct: number;
        ratePerUnit: (typeof recipe.ingredients)[number]["storeItem"]["ratePerUnit"];
      };
      const needByItem = new Map<string, Plan>();

      for (const ing of recipe.ingredients) {
        const deduct = convertQty(
          toNumber(ing.quantity) * scale,
          ing.unit,
          ing.storeItem.unit
        );
        const prev = needByItem.get(ing.storeItemId);
        if (prev) {
          prev.deduct += deduct;
        } else {
          needByItem.set(ing.storeItemId, {
            storeItemId: ing.storeItemId,
            name: ing.storeItem.name,
            unit: ing.storeItem.unit,
            deduct,
            ratePerUnit: ing.storeItem.ratePerUnit,
          });
        }
      }

      const short: { name: string; unit: UnitType; need: number; onHand: number }[] = [];
      const onHandById = new Map<string, number>();

      for (const plan of needByItem.values()) {
        const fresh = await tx.storeItem.findUniqueOrThrow({
          where: { id: plan.storeItemId },
          select: { quantityOnHand: true, name: true, unit: true },
        });
        const onHand = Math.max(0, toNumber(fresh.quantityOnHand));
        onHandById.set(plan.storeItemId, onHand);
        if (plan.deduct - onHand > 0.0001) {
          short.push({
            name: fresh.name,
            unit: fresh.unit,
            need: plan.deduct,
            onHand,
          });
        }
      }

      if (short.length) {
        throw new BadRequestException(formatShortfalls(short, "Cannot deduct stock"));
      }

      for (const plan of needByItem.values()) {
        const onHand = onHandById.get(plan.storeItemId) ?? 0;
        const next = Math.max(0, Math.round((onHand - plan.deduct) * 1e6) / 1e6);
        await tx.storeItem.update({
          where: { id: plan.storeItemId },
          data: { quantityOnHand: next },
        });
        await tx.stockMovement.create({
          data: {
            storeItemId: plan.storeItemId,
            type: "SALE",
            quantity: -plan.deduct,
            ratePerUnit: plan.ratePerUnit,
            note,
            orderId: orderId ?? null,
          },
        });
      }

      let totalForBase = 0;
      for (const ing of recipe.ingredients) {
        totalForBase += unitCostFromRate(
          toNumber(ing.storeItem.ratePerUnit),
          ing.storeItem.unit,
          toNumber(ing.quantity),
          ing.unit
        );
      }
      return (totalForBase / baseQty) * orderQty;
    });
  }

  /** Put ingredients back when a line quantity is reduced after a sale. */
  async restoreRecipeStock(
    recipeId: string,
    orderQty: number,
    note: string,
    orderId?: string
  ) {
    if (orderQty <= 0) return 0;
    const { recipe, costPerBase } = await this.recipeUnitCost(recipeId);
    const scale = orderQty / (toNumber(recipe.baseQty) || 1);

    for (const ing of recipe.ingredients) {
      const restore = convertQty(
        toNumber(ing.quantity) * scale,
        ing.unit,
        ing.storeItem.unit
      );

      await this.prisma.storeItem.update({
        where: { id: ing.storeItemId },
        data: { quantityOnHand: { increment: restore } },
      });
      await this.prisma.stockMovement.create({
        data: {
          storeItemId: ing.storeItemId,
          type: "ADJUST",
          quantity: restore,
          ratePerUnit: ing.storeItem.ratePerUnit,
          note,
          orderId: orderId ?? null,
        },
      });
    }

    return costPerBase * orderQty;
  }
}
