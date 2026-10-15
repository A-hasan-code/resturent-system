import { BadRequestException, Injectable } from "@nestjs/common";
import { PaymentMethod, PaymentStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../system/settings.service";
import { businessDateOf, businessQueryRange, businessQueryWindow } from "../common/business-day";
import { toNumber } from "../common/units";

function money2(n: number) {
  return Math.round(n * 100) / 100;
}

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService
  ) {}

  async taxSettings() {
    const s = await this.settings.getMany("billing.");
    const percent = Math.max(0, Number(s["billing.taxPercent"] ?? "0") || 0);
    const enabled = (s["billing.taxEnabled"] ?? (percent > 0 ? "1" : "0")) !== "0" && percent > 0;
    return { enabled, percent: enabled ? percent : 0 };
  }

  async legalIds() {
    const s = await this.settings.getMany("restaurant.");
    return {
      ntn: (s["restaurant.ntn"] || "").trim(),
      strn: (s["restaurant.strn"] || "").trim(),
    };
  }

  /** Tax on food net (gross − discount). Exclusive tax added on top. */
  computeTax(gross: number, discount: number, taxPercent: number) {
    const foodNet = Math.max(0, money2(gross - discount));
    if (!(taxPercent > 0)) return { taxAmount: 0, taxPercent: 0, foodNet, dueBase: foodNet };
    const taxAmount = money2((foodNet * taxPercent) / 100);
    return { taxAmount, taxPercent, foodNet, dueBase: money2(foodNet + taxAmount) };
  }

  private async clock(dateStr?: string) {
    const start = await this.settings.dayStart();
    const now = new Date();
    const today = businessDateOf(now, start.h, start.m);
    const businessDate = dateStr?.trim() || today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
      throw new BadRequestException("Invalid business date");
    }
    // Exact from/to for API labels; gte/lt TZ-padded for Prisma filters (same as Bills).
    const window = businessQueryWindow(businessDate, start.h, start.m);
    return {
      businessDate,
      today,
      isToday: businessDate === today,
      from: window.from,
      to: window.to,
      gte: window.gte,
      lt: window.lt,
    };
  }

  async assertNotLocked(orderCreatedAt: Date) {
    const start = await this.settings.dayStart();
    const businessDate = businessDateOf(orderCreatedAt, start.h, start.m);
    const close = await this.prisma.dayCashClose.findUnique({
      where: { businessDate },
      select: { lockedAt: true },
    });
    if (!close?.lockedAt) return;
    throw new BadRequestException(
      `Business day ${businessDate} is locked after day close. Ask Admin to unlock if a correction is required.`
    );
  }

  async unlockDay(businessDate: string) {
    const row = await this.prisma.dayCashClose.findUnique({ where: { businessDate } });
    if (!row) throw new BadRequestException("No day close for that date");
    await this.prisma.dayCashClose.update({
      where: { id: row.id },
      data: { lockedAt: null },
    });
    return { ok: true, businessDate, locked: false };
  }

  async dayPnl(businessDate?: string) {
    const clock = await this.clock(businessDate);
    const { from, to, gte, lt, businessDate: day } = clock;

    const [orders, payments, stockClose, batchClose, expenses, purchasesPaid, selfExtras, close] =
      await Promise.all([
        this.prisma.order.findMany({
          where: {
            createdAt: { gte, lt },
            status: { not: "CANCELLED" },
            paymentStatus: { in: [PaymentStatus.PAID, PaymentStatus.PARTIAL] },
          },
          select: {
            total: true,
            discountAmount: true,
            taxAmount: true,
            tipAmount: true,
            costTotal: true,
            paidAmount: true,
          },
        }),
        this.prisma.payment.findMany({
          where: { createdAt: { gte, lt } },
          select: { amount: true, tipAmount: true, method: true },
        }),
        this.prisma.dayStockClose.findUnique({ where: { businessDate: day } }),
        this.prisma.dayBatchClose.findUnique({
          where: { businessDate: day },
          include: { lines: { select: { wasteGrams: true, lossCost: true } } },
        }),
        this.prisma.hotelExpense.findMany({
          where: { spentAt: { gte, lt } },
          select: { amount: true },
        }),
        this.prisma.supplierPayment.findMany({
          where: { paidAt: { gte, lt } },
          select: { amount: true },
        }),
        this.prisma.purchase.findMany({
          where: {
            purchasedAt: { gte, lt },
            voidedAt: null,
            extraExpense: { gt: 0 },
            extraExpensePaidBy: "SELF",
          },
          select: { extraExpense: true },
        }),
        this.prisma.dayCashClose.findUnique({ where: { businessDate: day } }),
      ]);

    let grossSales = 0;
    let discounts = 0;
    let tax = 0;
    let tips = 0;
    let cogs = 0;
    let paidFood = 0;
    for (const o of orders) {
      grossSales += toNumber(o.total);
      discounts += toNumber(o.discountAmount);
      tax += toNumber(o.taxAmount);
      tips += toNumber(o.tipAmount);
      cogs += toNumber(o.costTotal);
      paidFood += toNumber(o.paidAmount);
    }
    grossSales = money2(grossSales);
    discounts = money2(discounts);
    tax = money2(tax);
    tips = money2(tips);
    cogs = money2(cogs);
    paidFood = money2(paidFood);
    const netFood = money2(grossSales - discounts);

    const byMethod: Record<string, number> = { CASH: 0, CARD: 0, WALLET: 0, BANK: 0 };
    let tipsCollected = 0;
    for (const p of payments) {
      const m = p.method || PaymentMethod.CASH;
      byMethod[m] = money2((byMethod[m] || 0) + toNumber(p.amount));
      tipsCollected = money2(tipsCollected + toNumber(p.tipAmount));
    }

    const hotelExpenses = money2(expenses.reduce((s, e) => s + toNumber(e.amount), 0));
    const supplierPaid = money2(purchasesPaid.reduce((s, p) => s + toNumber(p.amount), 0));
    const selfExtra = money2(selfExtras.reduce((s, p) => s + toNumber(p.extraExpense), 0));
    const specialsLoss = batchClose
      ? money2(batchClose.lines.reduce((s, l) => s + toNumber(l.lossCost), 0))
      : 0;
    const foodCost = stockClose ? toNumber(stockClose.stockUsedValue) : cogs;
    const netProfit = money2(netFood - foodCost - specialsLoss - hotelExpenses - supplierPaid - selfExtra);

    return {
      businessDate: day,
      from: from.toISOString(),
      to: to.toISOString(),
      locked: !!close?.lockedAt,
      sales: {
        gross: grossSales,
        discounts,
        netFood,
        tax,
        tips: tipsCollected || tips,
        paidFood,
      },
      tender: byMethod,
      costs: {
        cogs: foodCost,
        stockUsedValue: stockClose ? toNumber(stockClose.stockUsedValue) : null,
        specialsLoss,
        hotelExpenses,
        supplierPaid,
        selfExtra,
      },
      netProfit,
      drawer: close
        ? {
            expectedCash: toNumber(close.expectedCash),
            collectedCash: toNumber(close.collectedCash),
            missCash: toNumber(close.missCash),
            cardTotal: toNumber(close.cardTotal),
            walletTotal: toNumber(close.walletTotal),
            bankTotal: toNumber(close.bankTotal),
            openingFloat: toNumber(close.openingFloat),
          }
        : null,
    };
  }

  async exceptions(fromStr: string, toStr: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromStr) || !/^\d{4}-\d{2}-\d{2}$/.test(toStr)) {
      throw new BadRequestException("Invalid from/to date");
    }
    const start = await this.settings.dayStart();
    const range = businessQueryRange(fromStr, toStr, start.h, start.m);
    const { gte, lt } = range;

    const [cancels, edits, heavyDiscount, voids] = await Promise.all([
      this.prisma.order.findMany({
        where: { cancelledAt: { gte, lt } },
        select: {
          orderNo: true,
          tableNo: true,
          total: true,
          cancelReason: true,
          cancelledAt: true,
          cancelledBy: { select: { name: true } },
        },
        orderBy: { cancelledAt: "desc" },
        take: 500,
      }),
      this.prisma.orderBillEdit.findMany({
        where: { createdAt: { gte, lt } },
        select: {
          order: { select: { orderNo: true, tableNo: true } },
          reason: true,
          beforeTotal: true,
          afterTotal: true,
          beforeNet: true,
          afterNet: true,
          editedByName: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
      this.prisma.order.findMany({
        where: {
          createdAt: { gte, lt },
          discountAmount: { gt: 0 },
        },
        select: {
          orderNo: true,
          tableNo: true,
          total: true,
          discountAmount: true,
          paymentStatus: true,
          cashier: { select: { name: true } },
          createdAt: true,
        },
        orderBy: { discountAmount: "desc" },
        take: 300,
      }),
      this.prisma.order.findMany({
        where: { paymentStatus: PaymentStatus.VOID, updatedAt: { gte, lt } },
        select: {
          orderNo: true,
          tableNo: true,
          total: true,
          cancelReason: true,
          updatedAt: true,
        },
        take: 300,
      }),
    ]);

    const discounts = heavyDiscount
      .map((o) => {
        const total = toNumber(o.total);
        const disc = toNumber(o.discountAmount);
        const pct = total > 0 ? money2((disc / total) * 100) : 0;
        return {
          orderNo: o.orderNo,
          tableNo: o.tableNo,
          total,
          discount: disc,
          percent: pct,
          paymentStatus: o.paymentStatus,
          cashier: o.cashier?.name ?? null,
          createdAt: o.createdAt.toISOString(),
        };
      })
      .filter((d) => d.percent >= 10 || d.discount >= 500);

    return {
      from: fromStr,
      to: toStr,
      cancels: cancels.map((c) => ({
        orderNo: c.orderNo,
        tableNo: c.tableNo,
        total: toNumber(c.total),
        reason: c.cancelReason,
        by: c.cancelledBy?.name ?? null,
        at: c.cancelledAt?.toISOString() ?? null,
      })),
      billEdits: edits.map((e) => ({
        orderNo: e.order.orderNo,
        tableNo: e.order.tableNo,
        reason: e.reason,
        beforeTotal: toNumber(e.beforeTotal),
        afterTotal: toNumber(e.afterTotal),
        beforeNet: toNumber(e.beforeNet),
        afterNet: toNumber(e.afterNet),
        by: e.editedByName,
        at: e.createdAt.toISOString(),
      })),
      bigDiscounts: discounts,
      voids: voids.map((v) => ({
        orderNo: v.orderNo,
        tableNo: v.tableNo,
        total: toNumber(v.total),
        reason: v.cancelReason,
        at: v.updatedAt.toISOString(),
      })),
    };
  }
}
