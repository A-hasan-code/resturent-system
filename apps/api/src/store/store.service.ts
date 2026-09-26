import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { toNumber } from "../common/units";
import {
  CreateStoreItemDto,
  StockAdjustDto,
  StockInDto,
  StockOutDto,
  UpdateStoreItemDto,
} from "./dto";

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
          quantityOnHand: qty,
          ratePerUnit: rate,
          reorderLevel: reorder,
          stockValue: qty * rate,
          lowStock: qty <= reorder,
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
    const byCategory: Record<string, { count: number; value: number }> = {};

    for (const i of items) {
      const qty = toNumber(i.quantityOnHand);
      const rate = toNumber(i.ratePerUnit);
      const value = qty * rate;
      totalValue += value;
      if (qty <= toNumber(i.reorderLevel)) lowCount += 1;
      const key = i.category.name;
      if (!byCategory[key]) byCategory[key] = { count: 0, value: 0 };
      byCategory[key].count += 1;
      byCategory[key].value += value;
    }

    return {
      itemCount: items.length,
      totalValue,
      lowStockCount: lowCount,
      byCategory: Object.entries(byCategory).map(([name, v]) => ({
        name,
        ...v,
      })),
    };
  }

  createItem(dto: CreateStoreItemDto) {
    return this.prisma.storeItem.create({
      data: {
        name: dto.name,
        categoryId: dto.categoryId,
        unit: dto.unit,
        quantityOnHand: dto.quantityOnHand ?? 0,
        ratePerUnit: dto.ratePerUnit ?? 0,
        reorderLevel: dto.reorderLevel ?? 0,
      },
    });
  }

  async updateItem(id: string, dto: UpdateStoreItemDto) {
    try {
      return await this.prisma.storeItem.update({
        where: { id },
        data: dto,
      });
    } catch {
      throw new NotFoundException("Item not found");
    }
  }

  async stockIn(id: string, dto: StockInDto) {
    const item = await this.prisma.storeItem.findUniqueOrThrow({
      where: { id },
    });
    const rate = dto.ratePerUnit ?? toNumber(item.ratePerUnit);
    const updated = await this.prisma.storeItem.update({
      where: { id },
      data: {
        quantityOnHand: { increment: dto.quantity },
        ratePerUnit: rate,
      },
    });
    await this.prisma.stockMovement.create({
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
  }

  async stockOut(id: string, dto: StockOutDto) {
    const item = await this.prisma.storeItem.findUniqueOrThrow({
      where: { id },
    });
    const onHand = toNumber(item.quantityOnHand);
    if (dto.quantity > onHand) {
      throw new BadRequestException(
        `Stock kam hai. Available: ${onHand} ${item.unit}`
      );
    }
    const updated = await this.prisma.storeItem.update({
      where: { id },
      data: { quantityOnHand: { decrement: dto.quantity } },
    });
    await this.prisma.stockMovement.create({
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
  }

  async adjust(id: string, dto: StockAdjustDto) {
    const item = await this.prisma.storeItem.findUniqueOrThrow({
      where: { id },
    });
    const oldQty = toNumber(item.quantityOnHand);
    const diff = dto.newQuantity - oldQty;
    const updated = await this.prisma.storeItem.update({
      where: { id },
      data: { quantityOnHand: dto.newQuantity },
    });
    await this.prisma.stockMovement.create({
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
      where: { type: "SALE" },
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
      row.totalUsed += used;
      row.totalValue += used * rate;
      if (m.order?.orderNo) row.orders.add(m.order.orderNo);
    }

    return Array.from(map.values())
      .map((r) => ({
        itemId: r.itemId,
        itemName: r.itemName,
        category: r.category,
        unit: r.unit,
        totalUsed: Number(r.totalUsed.toFixed(3)),
        totalValue: Number(r.totalValue.toFixed(2)),
        orderCount: r.orders.size,
        orderNos: Array.from(r.orders).sort((a, b) => a - b).join(", "),
      }))
      .sort((a, b) => b.totalUsed - a.totalUsed);
  }

  async lowStock() {
    const items = await this.prisma.storeItem.findMany({
      where: { active: true },
      include: { category: true },
      orderBy: { name: "asc" },
    });
    return items
      .filter(
        (i) => toNumber(i.quantityOnHand) <= toNumber(i.reorderLevel)
      )
      .map((i) => ({
        id: i.id,
        name: i.name,
        category: i.category.name,
        unit: i.unit,
        quantityOnHand: toNumber(i.quantityOnHand),
        reorderLevel: toNumber(i.reorderLevel),
        ratePerUnit: toNumber(i.ratePerUnit),
      }));
  }
}
