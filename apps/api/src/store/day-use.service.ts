import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../system/settings.service";
import { toNumber } from "../common/units";
import { businessDateOf, businessWindow } from "../common/business-day";
import { AuthUser } from "../common/decorators";
import { applySaleRestoreNet } from "./store.service";
import { SaveDayUseDto } from "./dto";

const money2 = (n: number) => Math.round(n * 100) / 100;
const qty3 = (n: number) => Math.round(n * 1000) / 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

@Injectable()
export class DayUseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService
  ) {}

  private async clock(dateStr?: string) {
    const start = await this.settings.dayStart();
    const now = new Date();
    const today = businessDateOf(now, start.h, start.m);
    const businessDate = dateStr?.trim() || today;
    if (!DATE_RE.test(businessDate)) {
      throw new BadRequestException("Invalid business date");
    }
    const window = businessWindow(businessDate, start.h, start.m);
    return {
      ...start,
      businessDate,
      today,
      isToday: businessDate === today,
      ...window,
    };
  }

  /** Date-wise list of saved day closings (newest first). */
  async history(limit = 90) {
    const take = Math.min(365, Math.max(1, limit || 90));
    const rows = await this.prisma.dayStockClose.findMany({
      take,
      orderBy: { businessDate: "desc" },
      include: {
        closedBy: { select: { name: true } },
        _count: { select: { lines: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      businessDate: r.businessDate,
      stockUsedValue: money2(toNumber(r.stockUsedValue)),
      sales: money2(toNumber(r.sales)),
      profit: money2(toNumber(r.profit)),
      closedByName: r.closedBy?.name ?? null,
      closedAt: r.createdAt,
      editedAt: r.editedAt,
      editedByName: r.editedByName,
      editReason: r.editReason,
      lineCount: r._count.lines,
    }));
  }

  async sheet(dateStr?: string, user?: AuthUser) {
    const clock = await this.clock(dateStr);
    const isAdmin = user?.roleCode === "ADMIN";

    const [items, salesMoves, close, paid] = await Promise.all([
      this.prisma.storeItem.findMany({
        where: { active: true },
        include: { category: true },
        orderBy: [{ category: { sortOrder: "asc" } }, { name: "asc" }],
      }),
      this.prisma.stockMovement.findMany({
        where: {
          type: { in: ["SALE", "RESTORE"] },
          createdAt: { gte: clock.from, lt: clock.to },
        },
        select: { storeItemId: true, quantity: true, type: true },
      }),
      this.prisma.dayStockClose.findUnique({
        where: { businessDate: clock.businessDate },
        include: {
          lines: true,
          closedBy: { select: { name: true } },
        },
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

    if (dateStr && !clock.isToday && !close) {
      throw new NotFoundException(`No closing saved for ${clock.businessDate}`);
    }

    const auto = new Map<string, number>();
    for (const m of salesMoves) {
      applySaleRestoreNet(auto, m.type, m.storeItemId, toNumber(m.quantity));
    }
    for (const [id, qty] of [...auto.entries()]) {
      auto.set(id, Math.max(0, qty3(qty)));
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

    const stockUsedValue = close
      ? money2(toNumber(close.stockUsedValue))
      : money2(rows.reduce((s, r) => s + r.value, 0));
    const sales = close
      ? money2(toNumber(close.sales))
      : money2(toNumber(paid._sum.total));

    // Only today’s business day can be entered or updated — past days are view-only.
    const canEdit =
      clock.isToday &&
      !!user &&
      (user.permissions.includes("store.manage") || isAdmin);

    return {
      businessDate: clock.businessDate,
      today: clock.today,
      isToday: clock.isToday,
      dayStart: clock.label,
      from: clock.from.toISOString(),
      to: clock.to.toISOString(),
      saved: !!close,
      canEdit,
      isAdmin: !!isAdmin,
      closedByName: close?.closedBy?.name ?? null,
      closedAt: close?.createdAt ?? null,
      editedAt: close?.editedAt ?? null,
      editedByName: close?.editedByName ?? null,
      editReason: close?.editReason ?? null,
      sales,
      stockUsedValue,
      profit: money2(sales - stockUsedValue),
      items: rows,
    };
  }

  async save(user: AuthUser, dto: SaveDayUseDto) {
    const clock = await this.clock(dto.businessDate);
    const isAdmin = user.roleCode === "ADMIN";

    if (!clock.isToday) {
      throw new ForbiddenException(
        "Past day closings are view-only. Only today’s closing can be saved or edited."
      );
    }
    if (!user.permissions.includes("store.manage") && !isAdmin) {
      throw new ForbiddenException("Not allowed to save day closing");
    }

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
        where: {
          type: { in: ["SALE", "RESTORE"] },
          createdAt: { gte: clock.from, lt: clock.to },
        },
        select: { storeItemId: true, quantity: true, type: true },
      });
      const auto = new Map<string, number>();
      for (const m of salesMoves) {
        applySaleRestoreNet(auto, m.type, m.storeItemId, toNumber(m.quantity));
      }
      for (const [id, qty] of [...auto.entries()]) {
        auto.set(id, Math.max(0, qty3(qty)));
      }

      const existing = await tx.dayStockClose.findUnique({
        where: { businessDate: clock.businessDate },
        include: { lines: true },
      });
      const previous = new Map(
        existing?.lines.map((l) => [l.storeItemId, toNumber(l.extraQty)]) ?? []
      );

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
          closedById: existing ? existing.closedById ?? user.id : user.id,
          ...(existing
            ? {
                editedAt: new Date(),
                editedById: user.id,
                editedByName: user.name,
              }
            : {}),
        },
      });
    });

    return this.sheet(clock.businessDate, user);
  }
}
