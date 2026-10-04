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

  /** Block the order when any recipe ingredient is short. Shared ingredients in one order are added together. */
  async assertCanSell(lines: { recipeId: string; quantity: number; name: string }[]) {
    const wanted = lines.filter((l) => l.recipeId && l.quantity > 0);
    if (!wanted.length) return;

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
          onHand: toNumber(ing.storeItem.quantityOnHand),
          dishes: new Set<string>(),
        };
        row.need += deduct;
        row.dishes.add(line.name);
        needs.set(ing.storeItemId, row);
      }
    }

    const short = [...needs.values()].filter((n) => n.need - n.onHand > 0.0001);
    if (!short.length) return;

    const parts = short.map((n) => {
      const dishes = [...n.dishes].join(", ");
      const state = n.onHand <= 0.0001 ? "is out of stock" : "is short";
      return `${dishes}: ${n.name} ${state} (${qtyLabel(n.onHand, n.unit)} in store, this order needs ${qtyLabel(n.need, n.unit)})`;
    });
    throw new BadRequestException(`${parts.join(". ")}. Order was not placed.`);
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

  async deductRecipeStock(
    recipeId: string,
    orderQty: number,
    note: string,
    orderId?: string
  ) {
    const { recipe, costPerBase } = await this.recipeUnitCost(recipeId);
    const scale = orderQty / (toNumber(recipe.baseQty) || 1);

    for (const ing of recipe.ingredients) {
      const deduct = convertQty(
        toNumber(ing.quantity) * scale,
        ing.unit,
        ing.storeItem.unit
      );

      await this.prisma.storeItem.update({
        where: { id: ing.storeItemId },
        data: { quantityOnHand: { decrement: deduct } },
      });
      await this.prisma.stockMovement.create({
        data: {
          storeItemId: ing.storeItemId,
          type: "SALE",
          quantity: -deduct,
          ratePerUnit: ing.storeItem.ratePerUnit,
          note,
          orderId: orderId ?? null,
        },
      });
    }

    return costPerBase * orderQty;
  }
}
