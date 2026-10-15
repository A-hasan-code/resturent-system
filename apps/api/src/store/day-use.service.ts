import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../system/settings.service";
import { toNumber } from "../common/units";
import { businessDateOf, businessQueryWindow } from "../common/business-day";
import { AuthUser } from "../common/decorators";
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
    const window = businessQueryWindow(businessDate, start.h, start.m);
    return {
      ...start,
      businessDate,
      today,
      isToday: businessDate === today,
      from: window.from,
      to: window.to,
      gte: window.gte,
      lt: window.lt,
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

    const [items, transferMoves, close, paid] = await Promise.all([
      this.prisma.storeItem.findMany({
        where: { active: true },
        include: { category: true },
        orderBy: [{ category: { sortOrder: "asc" } }, { name: "asc" }],
      }),
      this.prisma.stockMovement.findMany({
        where: {
          type: { in: ["KITCHEN_TRANSFER", "KITCHEN_RETURN"] },
          createdAt: { gte: clock.gte, lt: clock.lt },
        },
        select: { storeItemId: true, quantity: true, type: true },
      }),
      this.prisma.dayStockClose.findUnique({
        where: { businessDate: clock.businessDate },
        include: {
          lines: {
            include: {
              storeItem: { include: { category: true } },
            },
          },
          closedBy: { select: { name: true } },
        },
      }),
      this.prisma.order.aggregate({
        where: {
          paymentStatus: "PAID",
          status: { not: "CANCELLED" },
          createdAt: { gte: clock.gte, lt: clock.lt },
        },
        _sum: { total: true },
      }),
    ]);

    // Past dates without a saved close still load (live transfers for that day) so
    // staff/admin can pick a date from the calendar and enter or edit closing.

    /** Store closing tracks kitchen issues (transfers), not recipe bill use. */
    const transferred = new Map<string, number>();
    for (const m of transferMoves) {
      const abs = Math.abs(toNumber(m.quantity));
      if (m.type === "KITCHEN_TRANSFER") {
        transferred.set(m.storeItemId, (transferred.get(m.storeItemId) ?? 0) + abs);
      } else if (m.type === "KITCHEN_RETURN") {
        transferred.set(m.storeItemId, (transferred.get(m.storeItemId) ?? 0) - abs);
      }
    }
    for (const [id, qty] of [...transferred.entries()]) {
      transferred.set(id, qty3(qty));
    }
    const extra = new Map(close?.lines.map((l) => [l.storeItemId, l]) ?? []);

    type SheetRow = {
      id: string;
      name: string;
      category: string;
      unit: string;
      onHand: number;
      rate: number;
      autoQty: number;
      transferredQty: number;
      usedQty: number;
      extraQty: number;
      leftoverQty: number;
      reason: string;
      value: number;
    };

    const lineUsed = (line: {
      usedQty?: unknown;
      extraQty?: unknown;
    }) => {
      const u = qty3(toNumber(line.usedQty));
      const e = qty3(toNumber(line.extraQty));
      // Older rows only had extraQty (used was stored there).
      if (u <= 0 && e > 0 && line.usedQty == null) return { usedQty: e, extraQty: 0 };
      return { usedQty: u, extraQty: e };
    };

    let rows: SheetRow[];
    if (close && !clock.isToday) {
      // Past saved closing: exact snapshot (never mix with today's live stock).
      rows = close.lines
        .map((line) => {
          const item = line.storeItem;
          const transferredQty = qty3(toNumber(line.transferredQty));
          const { usedQty, extraQty } = lineUsed(line as { usedQty?: unknown; extraQty?: unknown });
          const leftoverQty = qty3(toNumber((line as { leftoverQty?: unknown }).leftoverQty));
          const rate = toNumber(line.ratePerUnit);
          return {
            id: item.id,
            name: item.name,
            category: item.category.name,
            unit: item.unit,
            // Past: show counted leftover as on-hand for that day (not current stock).
            onHand: leftoverQty,
            rate,
            autoQty: transferredQty,
            transferredQty,
            usedQty,
            extraQty,
            leftoverQty,
            reason: line.reason ?? "",
            value: money2(toNumber(line.amount)),
          };
        })
        .sort(
          (a, b) =>
            a.category.localeCompare(b.category) || a.name.localeCompare(b.name)
        );
    } else if (!clock.isToday) {
      // Past day, not yet saved: only that day's transfers — no today's leftover stock.
      rows = items
        .map((item) => {
          const transferredQty = qty3(transferred.get(item.id) ?? 0);
          const rate = toNumber(item.ratePerUnit);
          return {
            id: item.id,
            name: item.name,
            category: item.category.name,
            unit: item.unit,
            onHand: 0,
            rate,
            autoQty: transferredQty,
            transferredQty,
            usedQty: 0,
            extraQty: 0,
            leftoverQty: 0,
            reason: "",
            value: money2(transferredQty * rate),
          };
        })
        .filter((r) => Math.abs(r.transferredQty) > 0.0005);
    } else {
      // Today: live transfers + any saved used/extra/leftover.
      rows = items
        .map((item) => {
          const saved = extra.get(item.id);
          // Always use live transfers for today (saved.transferred can be stale mid-day).
          const transferredQty = qty3(transferred.get(item.id) ?? 0);
          const autoQty = transferredQty; // legacy field name kept for older clients
          const split = saved
            ? lineUsed(saved as { usedQty?: unknown; extraQty?: unknown })
            : { usedQty: 0, extraQty: 0 };
          const leftoverQty = saved
            ? qty3(toNumber((saved as { leftoverQty?: unknown }).leftoverQty))
            : qty3(toNumber(item.quantityOnHand));
          const rate = toNumber(item.ratePerUnit);
          const onHand = toNumber(item.quantityOnHand);
          return {
            id: item.id,
            name: item.name,
            category: item.category.name,
            unit: item.unit,
            onHand,
            rate,
            autoQty,
            transferredQty,
            usedQty: split.usedQty,
            extraQty: split.extraQty,
            leftoverQty: saved ? leftoverQty : onHand,
            reason: saved?.reason ?? "",
            value: money2((transferredQty + split.usedQty + split.extraQty) * rate),
          };
        })
        .filter(
          (r) =>
            Math.abs(r.onHand) > 0.0005 ||
            Math.abs(r.transferredQty) > 0.0005 ||
            Math.abs(r.usedQty) > 0.0005 ||
            Math.abs(r.extraQty) > 0.0005 ||
            Math.abs(r.leftoverQty) > 0.0005
        );
    }

    const stockUsedValue = close
      ? money2(toNumber(close.stockUsedValue))
      : money2(rows.reduce((s, r) => s + r.value, 0));
    const sales = close
      ? money2(toNumber(close.sales))
      : money2(toNumber(paid._sum.total));

    // Today: store managers + admin. Past days: admin only.
    const canEdit =
      !!user &&
      (user.permissions.includes("store.manage") || isAdmin) &&
      (clock.isToday || !!isAdmin);

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
    // Past-day admin edits may run after hotel close; today still requires hotel open.
    if (clock.isToday || !isAdmin) {
      await this.settings.assertHotelOpen();
    }

    if (!clock.isToday && !isAdmin) {
      throw new ForbiddenException(
        "Past day closings are view-only. Only an admin can edit a past closing."
      );
    }
    if (!user.permissions.includes("store.manage") && !isAdmin) {
      throw new ForbiddenException("Not allowed to save day closing");
    }

    const wanted = new Map<
      string,
      { usedQty: number; extraQty: number; leftoverQty: number | null; reason: string }
    >();
    for (const line of dto.lines ?? []) {
      const usedQty = qty3(Math.max(0, line.usedQty ?? 0));
      const extraQty = qty3(Math.max(0, line.extraQty ?? 0));
      const leftoverQty =
        line.leftoverQty == null || Number.isNaN(Number(line.leftoverQty))
          ? null
          : qty3(Math.max(0, Number(line.leftoverQty)));
      if (usedQty <= 0 && extraQty <= 0 && leftoverQty == null) continue;
      wanted.set(line.storeItemId, {
        usedQty,
        extraQty,
        leftoverQty,
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

      const transferMoves = await tx.stockMovement.findMany({
        where: {
          type: { in: ["KITCHEN_TRANSFER", "KITCHEN_RETURN"] },
          createdAt: { gte: clock.gte, lt: clock.lt },
        },
        select: { storeItemId: true, quantity: true, type: true },
      });
      const transferred = new Map<string, number>();
      for (const m of transferMoves) {
        const abs = Math.abs(toNumber(m.quantity));
        if (m.type === "KITCHEN_TRANSFER") {
          transferred.set(m.storeItemId, (transferred.get(m.storeItemId) ?? 0) + abs);
        } else {
          transferred.set(m.storeItemId, (transferred.get(m.storeItemId) ?? 0) - abs);
        }
      }
      for (const [id, qty] of [...transferred.entries()]) {
        transferred.set(id, qty3(qty));
      }

      const existing = await tx.dayStockClose.findUnique({
        where: { businessDate: clock.businessDate },
        include: { lines: true },
      });
      const previous = new Map(
        existing?.lines.map((l) => {
          const u = toNumber((l as { usedQty?: unknown }).usedQty);
          const e = toNumber(l.extraQty);
          return [l.storeItemId, u > 0 ? u + e : e] as const;
        }) ?? []
      );
      const onHandById = new Map(items.map((i) => [i.id, toNumber(i.quantityOnHand)]));

      for (const item of items) {
        const w = wanted.get(item.id);
        const next = qty3((w?.usedQty ?? 0) + (w?.extraQty ?? 0));
        const prev = qty3(previous.get(item.id) ?? 0);
        const delta = qty3(next - prev);
        const onHand = onHandById.get(item.id) ?? 0;
        if (delta > 0 && delta - onHand > 0.0001) {
          throw new BadRequestException(
            `Not enough ${item.name}. Available: ${onHand} ${item.unit}`
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
        const w = wanted.get(item.id);
        const usedQty = w?.usedQty ?? 0;
        const extraQty = w?.extraQty ?? 0;
        const next = qty3(usedQty + extraQty);
        const prev = qty3(previous.get(item.id) ?? 0);
        const delta = qty3(next - prev);
        let onHand = onHandById.get(item.id) ?? 0;
        if (delta !== 0) {
          await tx.storeItem.update({
            where: { id: item.id },
            data: { quantityOnHand: { increment: -delta } },
          });
          onHand = qty3(onHand - delta);
          onHandById.set(item.id, onHand);
        }
        const leftoverQty =
          w?.leftoverQty != null ? qty3(Math.max(0, w.leftoverQty)) : qty3(Math.max(0, onHand));
        if (Math.abs(leftoverQty - onHand) > 0.0001) {
          await tx.storeItem.update({
            where: { id: item.id },
            data: { quantityOnHand: leftoverQty },
          });
          onHandById.set(item.id, leftoverQty);
          onHand = leftoverQty;
        }
        const transferredQty = qty3(transferred.get(item.id) ?? 0);
        const rate = toNumber(item.ratePerUnit);
        const amount = money2((transferredQty + next) * rate);
        stockUsed += amount;
        if (transferredQty <= 0 && next <= 0 && leftoverQty <= 0) continue;
        await tx.dayStockCloseLine.create({
          data: {
            closeId: close.id,
            storeItemId: item.id,
            autoQty: transferredQty,
            transferredQty,
            usedQty,
            extraQty,
            leftoverQty,
            reason: next > 0 || w?.leftoverQty != null ? w?.reason ?? null : null,
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
              note: `Day use · ${clock.businessDate} · ${w?.reason ?? "Extra"}`,
              dayCloseId: close.id,
            },
          });
        }
      }

      const paid = await tx.order.aggregate({
        where: {
          paymentStatus: "PAID",
          status: { not: "CANCELLED" },
          createdAt: { gte: clock.gte, lt: clock.lt },
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
