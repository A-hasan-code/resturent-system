import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../system/settings.service";
import { toNumber } from "../common/units";
import { businessDateOf, businessWindow } from "../common/business-day";
import { AuthUser } from "../common/decorators";
import { SaveDayUseDto } from "./dto";

const money2 = (n: number) => Math.round(n * 100) / 100;
const qty3 = (n: number) => Math.round(n * 1000) / 1000;

@Injectable()
export class DayUseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService
  ) {}

  private async clock() {
    const start = await this.settings.dayStart();
    const now = new Date();
    const businessDate = businessDateOf(now, start.h, start.m);
    const window = businessWindow(businessDate, start.h, start.m);
    return { ...start, businessDate, ...window };
  }

  async sheet() {
    const clock = await this.clock();
    const [items, salesMoves, close, paid] = await Promise.all([
      this.prisma.storeItem.findMany({
        where: { active: true },
        include: { category: true },
        orderBy: [{ category: { sortOrder: "asc" } }, { name: "asc" }],
      }),
      this.prisma.stockMovement.findMany({
        where: { type: "SALE", createdAt: { gte: clock.from, lt: clock.to } },
        select: { storeItemId: true, quantity: true },
      }),
      this.prisma.dayStockClose.findUnique({
        where: { businessDate: clock.businessDate },
        include: { lines: true },
      }),
      this.prisma.order.aggregate({
        where: {
          paymentStatus: "PAID",
          status: { not: "CANCELLED" },
          createdAt: { gte: clock.from, lt: clock.to },
        },
        _sum: { total: true },
      }),
    ]);

    const auto = new Map<string, number>();
    for (const m of salesMoves) {
      auto.set(m.storeItemId, (auto.get(m.storeItemId) ?? 0) + Math.abs(toNumber(m.quantity)));
    }
    const extra = new Map(close?.lines.map((l) => [l.storeItemId, l]) ?? []);

    const rows = items.map((item) => {
      const saved = extra.get(item.id);
      const autoQty = qty3(auto.get(item.id) ?? 0);
      const extraQty = saved ? qty3(toNumber(saved.extraQty)) : 0;
      const rate = toNumber(item.ratePerUnit);
      return {
        id: item.id,
        name: item.name,
        category: item.category.name,
        unit: item.unit,
        onHand: toNumber(item.quantityOnHand),
        rate,
        autoQty,
        extraQty,
        reason: saved?.reason ?? "",
        value: money2((autoQty + extraQty) * rate),
      };
    });

    const stockUsedValue = money2(rows.reduce((s, r) => s + r.value, 0));
    const sales = money2(toNumber(paid._sum.total));
    return {
      businessDate: clock.businessDate,
      dayStart: clock.label,
      from: clock.from.toISOString(),
      to: clock.to.toISOString(),
      saved: !!close,
      sales,
      stockUsedValue,
      profit: money2(sales - stockUsedValue),
      items: rows,
    };
  }

  async save(user: AuthUser, dto: SaveDayUseDto) {
    const clock = await this.clock();
    const wanted = new Map<string, { extraQty: number; reason: string }>();
    for (const line of dto.lines ?? []) {
      const extraQty = qty3(Math.max(0, line.extraQty || 0));
      if (extraQty <= 0) continue;
      wanted.set(line.storeItemId, {
        extraQty,
        reason: (line.reason || "Wastage / spoilage").trim().slice(0, 80),
      });
    }

    await this.prisma.$transaction(async (tx) => {
      const items = await tx.storeItem.findMany({
        where: { active: true },
        include: { category: true },
      });
      const itemIds = new Set(items.map((i) => i.id));
      for (const id of wanted.keys()) {
        if (!itemIds.has(id)) throw new BadRequestException("Item is not in inventory");
      }

      const salesMoves = await tx.stockMovement.findMany({
        where: { type: "SALE", createdAt: { gte: clock.from, lt: clock.to } },
        select: { storeItemId: true, quantity: true },
      });
      const auto = new Map<string, number>();
      for (const m of salesMoves) {
        auto.set(m.storeItemId, (auto.get(m.storeItemId) ?? 0) + Math.abs(toNumber(m.quantity)));
      }

      const existing = await tx.dayStockClose.findUnique({
        where: { businessDate: clock.businessDate },
        include: { lines: true },
      });
      const previous = new Map(existing?.lines.map((l) => [l.storeItemId, toNumber(l.extraQty)]) ?? []);

      for (const item of items) {
        const next = wanted.get(item.id)?.extraQty ?? 0;
        const prev = qty3(previous.get(item.id) ?? 0);
        const delta = qty3(next - prev);
        if (delta > 0 && delta - toNumber(item.quantityOnHand) > 0.0001) {
          throw new BadRequestException(
            `Not enough ${item.name}. Available: ${toNumber(item.quantityOnHand)} ${item.unit}`
          );
        }
      }

      const close = existing
        ? existing
        : await tx.dayStockClose.create({
            data: {
              businessDate: clock.businessDate,
              stockUsedValue: 0,
              sales: 0,
              profit: 0,
              closedById: user.id,
            },
          });

      if (existing) {
        await tx.stockMovement.deleteMany({ where: { dayCloseId: close.id } });
        await tx.dayStockCloseLine.deleteMany({ where: { closeId: close.id } });
      }

      let stockUsed = 0;
      for (const item of items) {
        const next = wanted.get(item.id)?.extraQty ?? 0;
        const prev = qty3(previous.get(item.id) ?? 0);
        const delta = qty3(next - prev);
        if (delta !== 0) {
          await tx.storeItem.update({
            where: { id: item.id },
            data: { quantityOnHand: { increment: -delta } },
          });
        }
        const autoQty = qty3(auto.get(item.id) ?? 0);
        const rate = toNumber(item.ratePerUnit);
        const amount = money2((autoQty + next) * rate);
        stockUsed += amount;
        if (autoQty <= 0 && next <= 0) continue;
        await tx.dayStockCloseLine.create({
          data: {
            closeId: close.id,
            storeItemId: item.id,
            autoQty,
            extraQty: next,
            reason: next > 0 ? wanted.get(item.id)?.reason ?? null : null,
            ratePerUnit: rate,
            amount,
          },
        });
        if (next > 0) {
          await tx.stockMovement.create({
            data: {
              storeItemId: item.id,
              type: "OUT",
              quantity: -next,
              ratePerUnit: rate,
              note: `Day use · ${clock.businessDate} · ${wanted.get(item.id)?.reason ?? "Extra"}`,
              dayCloseId: close.id,
            },
          });
        }
      }

      const paid = await tx.order.aggregate({
        where: {
          paymentStatus: "PAID",
          status: { not: "CANCELLED" },
          createdAt: { gte: clock.from, lt: clock.to },
        },
        _sum: { total: true },
      });
      const sales = money2(toNumber(paid._sum.total));
      stockUsed = money2(stockUsed);
      await tx.dayStockClose.update({
        where: { id: close.id },
        data: {
          stockUsedValue: stockUsed,
          sales,
          profit: money2(sales - stockUsed),
          closedById: user.id,
        },
      });
    });

    return this.sheet();
  }
}
