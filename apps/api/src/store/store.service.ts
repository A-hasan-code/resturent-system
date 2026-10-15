import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PackUnit } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { toNumber } from "../common/units";
import {
  CreateStoreItemDto,
  StockAdjustDto,
  StockInDto,
  StockOutDto,
  UpdateStoreItemDto,
} from "./dto";

function normalizePack(
  packUnit: PackUnit | undefined,
  unitsPerPack: number | undefined
): { packUnit: PackUnit; unitsPerPack: number } {
  const unit = packUnit ?? PackUnit.NONE;
  if (unit === PackUnit.NONE) return { packUnit: PackUnit.NONE, unitsPerPack: 1 };
  const n = Math.max(1, Number(unitsPerPack ?? 1));
  return { packUnit: unit, unitsPerPack: Number(n.toFixed(3)) };
}

/** Net plate usage: SALE − RESTORE (COOK excluded — that is pot cook, not bill). */
function applySaleRestoreNet(
  map: Map<string, number>,
  type: string,
  storeItemId: string,
  quantity: number
) {
  const abs = Math.abs(quantity);
  if (type === "SALE") {
    map.set(storeItemId, (map.get(storeItemId) ?? 0) + abs);
  } else if (type === "RESTORE") {
    map.set(storeItemId, (map.get(storeItemId) ?? 0) - abs);
  }
}

@Injectable()
export class StoreService {
  constructor(private readonly prisma: PrismaService) {}

  async categories() {
    const rows = await this.prisma.storeCategory.findMany({
      orderBy: { sortOrder: "asc" },
      include: {
        items: { where: { active: true }, orderBy: { name: "asc" } },
      },
    });

    return rows.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      items: c.items.map((i) => {
        const qty = toNumber(i.quantityOnHand);
        const rate = toNumber(i.ratePerUnit);
        const reorder = toNumber(i.reorderLevel);
        return {
          id: i.id,
          name: i.name,
          unit: i.unit,
          packUnit: i.packUnit,
          unitsPerPack: toNumber(i.unitsPerPack),
          quantityOnHand: qty,
          ratePerUnit: rate,
          reorderLevel: reorder,
          stockValue: qty * rate,
          lowStock: qty <= reorder,
          negativeStock: qty < -0.0001,
        };
      }),
    }));
  }

  async summary() {
    const items = await this.prisma.storeItem.findMany({
      where: { active: true },
      include: { category: true },
    });

    let totalValue = 0;
    let lowCount = 0;
    let negativeCount = 0;
    const byCategory: Record<string, { count: number; value: number }> = {};

    for (const i of items) {
      const qty = toNumber(i.quantityOnHand);
      const rate = toNumber(i.ratePerUnit);
      const value = qty * rate;
      totalValue += value;
      if (qty <= toNumber(i.reorderLevel)) lowCount += 1;
      if (qty < -0.0001) negativeCount += 1;
      const key = i.category.name;
      if (!byCategory[key]) byCategory[key] = { count: 0, value: 0 };
      byCategory[key].count += 1;
      byCategory[key].value += value;
    }

    return {
      itemCount: items.length,
      totalValue,
      lowStockCount: lowCount,
      negativeStockCount: negativeCount,
      byCategory: Object.entries(byCategory).map(([name, v]) => ({
        name,
        ...v,
      })),
    };
  }

  private mapItem(item: {
    quantityOnHand: unknown;
    ratePerUnit: unknown;
    reorderLevel: unknown;
    unitsPerPack: unknown;
    [key: string]: unknown;
  }) {
    return {
      ...item,
      quantityOnHand: toNumber(item.quantityOnHand as never),
      ratePerUnit: toNumber(item.ratePerUnit as never),
      reorderLevel: toNumber(item.reorderLevel as never),
      unitsPerPack: toNumber(item.unitsPerPack as never),
    };
  }

  async createItem(dto: CreateStoreItemDto) {
    const opening = Math.max(0, Number(dto.quantityOnHand ?? 0));
    const pack = normalizePack(dto.packUnit, dto.unitsPerPack);
    const name = dto.name.trim();
    if (!name) throw new BadRequestException("Name required");

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.storeItem.findUnique({
        where: { categoryId_name: { categoryId: dto.categoryId, name } },
      });
      if (existing?.active) {
        throw new BadRequestException(`Item "${name}" already exists in this category`);
      }

      // Re-add after soft-delete: reactivate same row so recipes/history stay linked.
      if (existing && !existing.active) {
        const item = await tx.storeItem.update({
          where: { id: existing.id },
          data: {
            unit: dto.unit,
            packUnit: pack.packUnit,
            unitsPerPack: pack.unitsPerPack,
            quantityOnHand: opening,
            ratePerUnit: dto.ratePerUnit ?? 0,
            reorderLevel: dto.reorderLevel ?? 0,
            active: true,
          },
        });
        if (opening > 0) {
          await tx.stockMovement.create({
            data: {
              storeItemId: item.id,
              type: "IN",
              quantity: opening,
              ratePerUnit: dto.ratePerUnit ?? 0,
              note: "Re-added · opening stock",
            },
          });
        }
        return this.mapItem(item);
      }

      const item = await tx.storeItem.create({
        data: {
          name,
          categoryId: dto.categoryId,
          unit: dto.unit,
          packUnit: pack.packUnit,
          unitsPerPack: pack.unitsPerPack,
          quantityOnHand: opening,
          ratePerUnit: dto.ratePerUnit ?? 0,
          reorderLevel: dto.reorderLevel ?? 0,
        },
      });
      if (opening > 0) {
        await tx.stockMovement.create({
          data: {
            storeItemId: item.id,
            type: "IN",
            quantity: opening,
            ratePerUnit: dto.ratePerUnit ?? 0,
            note: "Opening stock",
          },
        });
      }
      return this.mapItem(item);
    });
  }

  /** Soft-delete: hide from stock list. Same name can be re-added later. */
  async deleteItem(id: string) {
    const item = await this.prisma.storeItem.findUnique({ where: { id } });
    if (!item || !item.active) throw new NotFoundException("Item not found");

    const recipeLinks = await this.prisma.recipeIngredient.findMany({
      where: { storeItemId: id, recipe: { active: true } },
      include: { recipe: { select: { name: true } } },
      take: 8,
    });
    const recipeNames = [...new Set(recipeLinks.map((r) => r.recipe.name))];

    const updated = await this.prisma.storeItem.update({
      where: { id },
      data: { active: false },
    });
    return {
      id: updated.id,
      name: updated.name,
      active: false,
      usedInRecipes: recipeNames,
    };
  }

  async updateItem(id: string, dto: UpdateStoreItemDto) {
    const current = await this.prisma.storeItem.findUnique({ where: { id } });
    if (!current || !current.active) throw new NotFoundException("Item not found");

    const data: {
      name?: string;
      ratePerUnit?: number;
      reorderLevel?: number;
      active?: boolean;
      packUnit?: PackUnit;
      unitsPerPack?: number;
    } = {};

    if (dto.name != null) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException("Name required");
      if (name !== current.name) {
        const clash = await this.prisma.storeItem.findUnique({
          where: { categoryId_name: { categoryId: current.categoryId, name } },
        });
        if (clash && clash.id !== id) {
          throw new BadRequestException(`Item "${name}" already exists in this category`);
        }
        data.name = name;
      }
    }

    if (dto.ratePerUnit != null) data.ratePerUnit = dto.ratePerUnit;
    if (dto.reorderLevel != null) data.reorderLevel = dto.reorderLevel;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.packUnit != null || dto.unitsPerPack != null) {
      const pack = normalizePack(
        dto.packUnit ?? current.packUnit,
        dto.unitsPerPack ?? toNumber(current.unitsPerPack)
      );
      data.packUnit = pack.packUnit;
      data.unitsPerPack = pack.unitsPerPack;
    }

    try {
      return await this.prisma.storeItem.update({
        where: { id },
        data,
      });
    } catch {
      throw new NotFoundException("Item not found");
    }
  }

  async stockIn(id: string, dto: StockInDto) {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.storeItem.findUniqueOrThrow({ where: { id } });
      const rate = dto.ratePerUnit ?? toNumber(item.ratePerUnit);
      const updated = await tx.storeItem.update({
        where: { id },
        data: {
          quantityOnHand: { increment: dto.quantity },
          ratePerUnit: rate,
        },
      });
      await tx.stockMovement.create({
        data: {
          storeItemId: id,
          type: "IN",
          quantity: dto.quantity,
          ratePerUnit: rate,
          note: dto.note ?? "Purchase / stock in",
        },
      });
      return {
        id: updated.id,
        quantityOnHand: toNumber(updated.quantityOnHand),
        ratePerUnit: toNumber(updated.ratePerUnit),
      };
    });
  }

  async stockOut(id: string, dto: StockOutDto) {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.storeItem.findUniqueOrThrow({ where: { id } });
      const onHand = toNumber(item.quantityOnHand);
      if (dto.quantity > onHand) {
        throw new BadRequestException(
          `Not enough stock. Available: ${onHand} ${item.unit}`
        );
      }
      const updated = await tx.storeItem.update({
        where: { id },
        data: { quantityOnHand: { decrement: dto.quantity } },
      });
      await tx.stockMovement.create({
        data: {
          storeItemId: id,
          type: "OUT",
          quantity: -dto.quantity,
          ratePerUnit: item.ratePerUnit,
          note: dto.note ?? "Stock out / wastage",
        },
      });
      return {
        id: updated.id,
        quantityOnHand: toNumber(updated.quantityOnHand),
      };
    });
  }

  async adjust(id: string, dto: StockAdjustDto) {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.storeItem.findUniqueOrThrow({ where: { id } });
      const oldQty = toNumber(item.quantityOnHand);
      const diff = dto.newQuantity - oldQty;
      const updated = await tx.storeItem.update({
        where: { id },
        data: { quantityOnHand: dto.newQuantity },
      });
      await tx.stockMovement.create({
        data: {
          storeItemId: id,
          type: "ADJUST",
          quantity: diff,
          ratePerUnit: item.ratePerUnit,
          note: dto.note ?? `Adjust ${oldQty} → ${dto.newQuantity}`,
        },
      });
      return {
        id: updated.id,
        quantityOnHand: toNumber(updated.quantityOnHand),
      };
    });
  }

  async movements(limit = 200) {
    const rows = await this.prisma.stockMovement.findMany({
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        storeItem: { include: { category: true } },
        order: { select: { id: true, orderNo: true, tableNo: true } },
      },
    });
    return rows.map((m) => ({
      id: m.id,
      type: m.type,
      quantity: toNumber(m.quantity),
      usedQty: Math.abs(toNumber(m.quantity)),
      ratePerUnit: m.ratePerUnit != null ? toNumber(m.ratePerUnit) : null,
      value:
        m.ratePerUnit != null
          ? Math.abs(toNumber(m.quantity)) * toNumber(m.ratePerUnit)
          : null,
      note: m.note,
      reason: m.note,
      createdAt: m.createdAt,
      itemName: m.storeItem.name,
      unit: m.storeItem.unit,
      category: m.storeItem.category.name,
      orderId: m.orderId,
      orderNo: m.order?.orderNo ?? null,
      tableNo: m.order?.tableNo ?? null,
    }));
  }

  async usageByItem() {
    const rows = await this.prisma.stockMovement.findMany({
      where: { type: { in: ["SALE", "RESTORE"] } },
      include: {
        storeItem: { include: { category: true } },
        order: { select: { orderNo: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const map = new Map<
      string,
      {
        itemId: string;
        itemName: string;
        category: string;
        unit: string;
        totalUsed: number;
        totalValue: number;
        orderCount: number;
        orders: Set<number>;
      }
    >();

    for (const m of rows) {
      const key = m.storeItemId;
      const used = Math.abs(toNumber(m.quantity));
      const rate = m.ratePerUnit != null ? toNumber(m.ratePerUnit) : 0;
      let row = map.get(key);
      if (!row) {
        row = {
          itemId: m.storeItemId,
          itemName: m.storeItem.name,
          category: m.storeItem.category.name,
          unit: m.storeItem.unit,
          totalUsed: 0,
          totalValue: 0,
          orderCount: 0,
          orders: new Set(),
        };
        map.set(key, row);
      }
      if (m.type === "SALE") {
        row.totalUsed += used;
        row.totalValue += used * rate;
        if (m.order?.orderNo) row.orders.add(m.order.orderNo);
      } else if (m.type === "RESTORE") {
        row.totalUsed -= used;
        row.totalValue -= used * rate;
      }
    }

    return Array.from(map.values())
      .map((r) => ({
        itemId: r.itemId,
        itemName: r.itemName,
        category: r.category,
        unit: r.unit,
        totalUsed: Number(Math.max(0, r.totalUsed).toFixed(3)),
        totalValue: Number(Math.max(0, r.totalValue).toFixed(2)),
        orderCount: r.orders.size,
        orderNos: Array.from(r.orders).sort((a, b) => a - b).join(", "),
      }))
      .filter((r) => r.totalUsed > 0.0001)
      .sort((a, b) => b.totalUsed - a.totalUsed);
  }

  async lowStock() {
    const items = await this.prisma.storeItem.findMany({
      where: { active: true },
      include: { category: true },
      orderBy: { name: "asc" },
    });
    return items
      .filter((i) => toNumber(i.quantityOnHand) <= toNumber(i.reorderLevel))
      .map((i) => ({
        id: i.id,
        name: i.name,
        category: i.category.name,
        unit: i.unit,
        packUnit: i.packUnit,
        unitsPerPack: toNumber(i.unitsPerPack),
        quantityOnHand: toNumber(i.quantityOnHand),
        reorderLevel: toNumber(i.reorderLevel),
        ratePerUnit: toNumber(i.ratePerUnit),
      }));
  }
}

export { applySaleRestoreNet };
