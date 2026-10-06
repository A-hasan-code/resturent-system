import { BadRequestException, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../system/settings.service";
import { dataDir } from "../config/env";
import { toNumber } from "../common/units";
import { businessDateOf, businessWindow } from "../common/business-day";
import { renderAuditPdf } from "./audit-pdf";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 4000;
const KEEP_MONTHS = 36;
const REFRESH_MS = 12 * 60 * 60 * 1000;
const FILE_RE = /^audit-\d{4}-\d{2}\.pdf$/;

export type AuditDay = {
  date: string;
  orders: number;
  cancelled: number;
  paymentsIn: number;
  purchasesOut: number;
  billsPaid: number;
  sales: number;
  discounts: number;
  tax: number;
  tips: number;
  stockUsed: number;
  profit: number;
};

export type AuditReport = {
  from: string;
  to: string;
  firstSaleDate: string | null;
  staff: string | null;
  summary: {
    orders: number;
    cancelled: number;
    billsPaid: number;
    /** Food sale on paid bills in the selected range (tip excluded, after discount). */
    salesTotal: number;
    /** Paid food sales for the current business day (independent of filter range). */
    salesToday: number;
    /** Paid food sales for the current calendar month so far. */
    salesMonth: number;
    /** Paid food sales for the current calendar year so far. */
    salesYear: number;
    discountsTotal: number;
    taxTotal: number;
    tipsTotal: number;
    paymentsIn: number;
    paymentCount: number;
    byMethod: { CASH: number; CARD: number; WALLET: number; BANK: number };
    creditSales: number;
    creditCount: number;
    purchasesOut: number;
    purchaseCount: number;
    foodCost: number;
    unpaidAmount: number;
    unpaidCount: number;
    stockUsed: number;
    profit: number;
  };
  days: AuditDay[];
  byStaff: { name: string; role: string; amount: number; count: number }[];
  byOrderTaker: { name: string; role: string; orders: number; sales: number; tips: number }[];
  sales: {
    time: string;
    orderNo: number;
    tableNo: string | null;
    total: number;
    discountAmount: number;
    taxAmount: number;
    tipAmount: number;
    orderedBy: string | null;
    servedBy: string | null;
    cashier: string | null;
    paymentStatus: string;
    isCredit: boolean;
    creditName: string | null;
  }[];
  payments: {
    time: string;
    orderNo: number;
    tableNo: string | null;
    amount: number;
    tipAmount: number;
    method: string;
    collectedBy: string;
    role: string;
    handedTo: string | null;
    confirmedAt: string | null;
  }[];
  purchases: { time: string; item: string; quantity: number; unit: string; amount: number; note: string | null }[];
};

export type StoredAudit = { file: string; month: string; size: number; updatedAt: string; closed: boolean };

/** Local calendar midnight for YYYY-MM-DD (avoids UTC date-only parsing bugs). */
function dayStart(d: string) {
  if (!DATE.test(d)) throw new BadRequestException("Dates must be YYYY-MM-DD");
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day, 0, 0, 0, 0);
}

function dayEndExclusive(d: string) {
  if (!DATE.test(d)) throw new BadRequestException("Dates must be YYYY-MM-DD");
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day + 1, 0, 0, 0, 0);
}

function isoDay(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function yearMonth(d: Date) {
  return isoDay(d).slice(0, 7);
}

@Injectable()
export class AuditService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger("Audit");
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService
  ) {}

  onApplicationBootstrap() {
    setTimeout(() => void this.refreshStored(), 90_000);
    this.timer = setInterval(() => void this.refreshStored(), 30 * 60 * 1000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  dir() {
    return dataDir("audit");
  }

  /** Earliest order date in the system (for “all time” filter). */
  async firstSaleDate(): Promise<string | null> {
    const first = await this.prisma.order.findFirst({
      where: { status: { not: "CANCELLED" } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    return first ? isoDay(first.createdAt) : null;
  }

  async report(from: string, to: string, staffName?: string): Promise<AuditReport> {
    if (!DATE.test(from) || !DATE.test(to)) throw new BadRequestException("Dates must be YYYY-MM-DD");
    const day = await this.settings.dayStart();
    const start = businessWindow(from, day.h, day.m).from;
    const end = businessWindow(to, day.h, day.m).to;
    if (end <= start) throw new BadRequestException("End date is before the start date");
    if (end.getTime() - start.getTime() > MAX_DAYS * 86400000) {
      throw new BadRequestException("Date range is too long");
    }

    const staffFilter = staffName?.trim() || undefined;
    const nameMatch = staffFilter
      ? { contains: staffFilter, mode: "insensitive" as const }
      : undefined;

    const now = new Date();
    const bizToday = businessDateOf(now, day.h, day.m);
    const [y, mo] = bizToday.split("-").map(Number);
    const monthFrom = `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-01`;
    const yearFrom = `${y}-01-01`;
    const todayWin = businessWindow(bizToday, day.h, day.m);
    const monthWin = {
      from: businessWindow(monthFrom, day.h, day.m).from,
      to: todayWin.to,
    };
    const yearWin = {
      from: businessWindow(yearFrom, day.h, day.m).from,
      to: todayWin.to,
    };

    const staffOrderFilter = nameMatch
      ? {
          OR: [
            { waiter: { name: nameMatch } },
            { cashier: { name: nameMatch } },
            { servedByName: nameMatch },
          ],
        }
      : {};

    const paidSalesWhere = (fromAt: Date, toAt: Date) => ({
      createdAt: { gte: fromAt, lt: toAt },
      status: { not: "CANCELLED" as const },
      AND: [
        { OR: [{ paymentStatus: "PAID" as const }, { creditCustomerId: { not: null } }] },
        ...(nameMatch
          ? [
              {
                OR: [
                  { waiter: { name: nameMatch } },
                  { cashier: { name: nameMatch } },
                  { servedByName: nameMatch },
                ],
              },
            ]
          : []),
      ],
    });

    const sumPaidFood = async (fromAt: Date, toAt: Date) => {
      const rows = await this.prisma.order.findMany({
        where: paidSalesWhere(fromAt, toAt),
        select: { total: true, discountAmount: true },
      });
      return Math.round(
        rows.reduce((s, o) => s + Math.max(0, toNumber(o.total) - toNumber(o.discountAmount)), 0) * 100
      ) / 100;
    };

    const [orders, payments, purchases, firstSaleDate, salesToday, salesMonth, salesYear] =
      await Promise.all([
      this.prisma.order.findMany({
        where: {
          createdAt: { gte: start, lt: end },
          ...staffOrderFilter,
        },
        select: {
          orderNo: true,
          tableNo: true,
          status: true,
          paymentStatus: true,
          total: true,
          discountAmount: true,
          taxAmount: true,
          tipAmount: true,
          paidAmount: true,
          costTotal: true,
          creditCustomerId: true,
          createdAt: true,
          servedByName: true,
          waiter: { select: { name: true, role: { select: { name: true } } } },
          cashier: { select: { name: true } },
          creditCustomer: { select: { name: true } },
        },
        orderBy: { createdAt: "asc" },
        take: 20000,
      }),
      this.prisma.payment.findMany({
        where: {
          createdAt: { gte: start, lt: end },
          ...(nameMatch
            ? {
                OR: [
                  { collectedBy: { name: nameMatch } },
                  { handedTo: { name: nameMatch } },
                  { order: { waiter: { name: nameMatch } } },
                  { order: { servedByName: nameMatch } },
                ],
              }
            : {}),
        },
        include: {
          order: { select: { orderNo: true, tableNo: true } },
          collectedBy: { select: { name: true, role: { select: { name: true } } } },
          handedTo: { select: { name: true } },
        },
        orderBy: { createdAt: "asc" },
        take: 20000,
      }),
      this.prisma.stockMovement.findMany({
        where: { type: "IN", createdAt: { gte: start, lt: end } },
        include: { storeItem: { select: { name: true, unit: true } } },
        orderBy: { createdAt: "asc" },
        take: 8000,
      }),
      this.firstSaleDate(),
      sumPaidFood(todayWin.from, todayWin.to),
      sumPaidFood(monthWin.from, monthWin.to),
      sumPaidFood(yearWin.from, yearWin.to),
    ]);

    const days = new Map<string, AuditDay>();
    for (let t = start.getTime(); t < end.getTime(); t += 86400000) {
      const date = isoDay(new Date(t));
      days.set(date, {
        date,
        orders: 0,
        cancelled: 0,
        paymentsIn: 0,
        purchasesOut: 0,
        billsPaid: 0,
        sales: 0,
        discounts: 0,
        tax: 0,
        tips: 0,
        stockUsed: 0,
        profit: 0,
      });
    }
    const bucket = (d: Date) => days.get(businessDateOf(d, day.h, day.m));

    let cancelled = 0;
    let unpaidAmount = 0;
    let unpaidCount = 0;
    let foodCost = 0;
    let billsPaid = 0;
    let salesTotal = 0;
    let discountsTotal = 0;
    let taxTotal = 0;
    let tipsTotal = 0;
    let creditSales = 0;
    let creditCount = 0;
    const takers = new Map<string, { name: string; role: string; orders: number; sales: number; tips: number }>();
    const salesRows: AuditReport["sales"] = [];

    for (const o of orders) {
      const dayRow = bucket(o.createdAt);
      if (o.status === "CANCELLED" || o.paymentStatus === "VOID") {
        cancelled += 1;
        if (dayRow) dayRow.cancelled += 1;
        continue;
      }
      if (dayRow) dayRow.orders += 1;
      const gross = toNumber(o.total);
      const discount = toNumber(o.discountAmount);
      const tax = toNumber(o.taxAmount);
      const total = Math.max(0, gross - discount);
      const tip = toNumber(o.tipAmount);
      const due = Math.max(0, total + tax - toNumber(o.paidAmount));
      const isCredit = !!o.creditCustomerId;
      const takerName = o.waiter?.name ?? "—";
      const takerRole = o.waiter?.role.name ?? "";
      const taker = takers.get(takerName) ?? { name: takerName, role: takerRole, orders: 0, sales: 0, tips: 0 };
      taker.orders += 1;

      if (o.paymentStatus === "PAID" || isCredit) {
        billsPaid += 1;
        const cost = toNumber(o.costTotal);
        foodCost += cost;
        salesTotal += total;
        discountsTotal += discount;
        taxTotal += tax;
        tipsTotal += tip;
        taker.sales += total;
        taker.tips += tip;
        if (isCredit) {
          creditCount += 1;
          creditSales += total;
        }
        if (dayRow) {
          dayRow.billsPaid += 1;
          dayRow.sales += total;
          dayRow.discounts += discount;
          dayRow.tax += tax;
          dayRow.tips += tip;
          dayRow.stockUsed += cost;
          dayRow.profit = Math.round((dayRow.sales - dayRow.stockUsed) * 100) / 100;
        }
      } else if (o.paymentStatus === "UNPAID" || o.paymentStatus === "PARTIAL") {
        unpaidCount += 1;
        unpaidAmount += due;
      }
      takers.set(takerName, taker);

      salesRows.push({
        time: o.createdAt.toISOString(),
        orderNo: o.orderNo,
        tableNo: o.tableNo,
        total,
        discountAmount: discount,
        taxAmount: tax,
        tipAmount: tip,
        orderedBy: o.waiter ? `${o.waiter.name} (${o.waiter.role.name})` : null,
        servedBy: o.servedByName,
        cashier: o.cashier?.name ?? null,
        paymentStatus: o.paymentStatus,
        isCredit,
        creditName: o.creditCustomer?.name ?? null,
      });
    }

    let paymentsIn = 0;
    const byMethod = { CASH: 0, CARD: 0, WALLET: 0, BANK: 0 };
    const collectors = new Map<string, { name: string; role: string; amount: number; count: number }>();
    for (const p of payments) {
      const amount = toNumber(p.amount);
      paymentsIn += amount;
      const method = (p.method || "CASH") as keyof typeof byMethod;
      if (method in byMethod) byMethod[method] = Math.round((byMethod[method] + amount) * 100) / 100;
      const dayRow = bucket(p.createdAt);
      if (dayRow) dayRow.paymentsIn += amount;
      const key = p.collectedBy.name;
      const s = collectors.get(key) ?? { name: p.collectedBy.name, role: p.collectedBy.role.name, amount: 0, count: 0 };
      s.amount += amount;
      s.count += 1;
      collectors.set(key, s);
    }

    let purchasesOut = 0;
    const purchaseRows = purchases.map((m) => {
      const amount = Math.abs(toNumber(m.quantity)) * toNumber(m.ratePerUnit);
      purchasesOut += amount;
      const dayRow = bucket(m.createdAt);
      if (dayRow) dayRow.purchasesOut += amount;
      return {
        time: m.createdAt.toISOString(),
        item: m.storeItem.name,
        quantity: Math.abs(toNumber(m.quantity)),
        unit: m.storeItem.unit,
        amount,
        note: m.note,
      };
    });

    return {
      from,
      to,
      firstSaleDate,
      staff: staffFilter ?? null,
      summary: {
        orders: orders.length - cancelled,
        cancelled,
        billsPaid,
        salesTotal: Math.round(salesTotal * 100) / 100,
        salesToday,
        salesMonth,
        salesYear,
        discountsTotal: Math.round(discountsTotal * 100) / 100,
        taxTotal: Math.round(taxTotal * 100) / 100,
        tipsTotal: Math.round(tipsTotal * 100) / 100,
        paymentsIn: Math.round(paymentsIn * 100) / 100,
        paymentCount: payments.length,
        byMethod,
        creditSales: Math.round(creditSales * 100) / 100,
        creditCount,
        purchasesOut: Math.round(purchasesOut * 100) / 100,
        purchaseCount: purchases.length,
        foodCost: Math.round(foodCost * 100) / 100,
        stockUsed: Math.round(foodCost * 100) / 100,
        profit: Math.round((salesTotal - foodCost) * 100) / 100,
        unpaidAmount: Math.round(unpaidAmount * 100) / 100,
        unpaidCount,
      },
      days: [...days.values()],
      byStaff: [...collectors.values()].sort((a, b) => b.amount - a.amount),
      byOrderTaker: [...takers.values()].sort((a, b) => b.sales - a.sales || b.orders - a.orders),
      sales: salesRows,
      payments: payments.map((p) => ({
        time: p.createdAt.toISOString(),
        orderNo: p.order.orderNo,
        tableNo: p.order.tableNo,
        amount: toNumber(p.amount),
        tipAmount: toNumber(p.tipAmount),
        method: p.method || "CASH",
        collectedBy: p.collectedBy.name,
        role: p.collectedBy.role.name,
        handedTo: p.handedTo?.name ?? null,
        confirmedAt: p.confirmedAt?.toISOString() ?? null,
      })),
      purchases: purchaseRows,
    };
  }

  async toPdf(report: AuditReport) {
    return renderAuditPdf(report, await this.settings.restaurant());
  }

  listStored(): StoredAudit[] {
    const now = yearMonth(new Date());
    const dir = this.dir();
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => FILE_RE.test(f))
      .map((f) => {
        const st = statSync(join(dir, f));
        const month = f.slice(6, 13);
        return { file: f, month, size: st.size, updatedAt: st.mtime.toISOString(), closed: month < now };
      })
      .sort((a, b) => b.month.localeCompare(a.month));
  }

  readStored(file: string) {
    const safe = basename(file);
    if (!FILE_RE.test(safe)) throw new BadRequestException("Report not found");
    const full = join(this.dir(), safe);
    if (!existsSync(full)) throw new BadRequestException("Report not found");
    return { file: safe, body: readFileSync(full) };
  }

  async refreshStored() {
    const now = new Date();
    try {
      await this.writeMonth(yearMonth(now), isoDay(now), true);
      const prev = new Date(now.getFullYear(), now.getMonth(), 0);
      await this.writeMonth(yearMonth(prev), isoDay(prev), false);
      this.prune();
    } catch (e) {
      this.log.warn(`Audit PDF failed: ${(e as Error).message}`);
    }
  }

  private async writeMonth(month: string, to: string, open: boolean) {
    const file = join(this.dir(), `audit-${month}.pdf`);
    if (existsSync(file)) {
      const updatedOn = isoDay(new Date(statSync(file).mtimeMs));
      if (open && Date.now() - statSync(file).mtimeMs < REFRESH_MS) return;
      if (!open && updatedOn >= to) return;
    }
    const pdf = await this.toPdf(await this.report(`${month}-01`, to));
    writeFileSync(file, pdf);
    // Drop the old CSV sheet if it is still around from earlier builds.
    const legacy = join(this.dir(), `audit-${month}.csv`);
    if (existsSync(legacy)) unlinkSync(legacy);
    this.log.log(`Audit PDF ${open ? "updated" : "closed"}: audit-${month}.pdf`);
  }

  private prune() {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - KEEP_MONTHS);
    const limit = yearMonth(cutoff);
    for (const f of this.listStored()) {
      if (f.month < limit) unlinkSync(join(this.dir(), f.file));
    }
  }
}
