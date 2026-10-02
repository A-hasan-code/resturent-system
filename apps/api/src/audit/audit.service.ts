import { BadRequestException, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../system/settings.service";
import { dataDir } from "../config/env";
import { toNumber } from "../common/units";
import { renderAuditPdf } from "./audit-pdf";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;
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
};

export type AuditReport = {
  from: string;
  to: string;
  summary: {
    orders: number;
    cancelled: number;
    billsPaid: number;
    paymentsIn: number;
    paymentCount: number;
    purchasesOut: number;
    purchaseCount: number;
    foodCost: number;
    unpaidAmount: number;
    unpaidCount: number;
  };
  days: AuditDay[];
  byStaff: { name: string; role: string; amount: number; count: number }[];
  payments: {
    time: string;
    orderNo: number;
    tableNo: string | null;
    amount: number;
    collectedBy: string;
    role: string;
    handedTo: string | null;
    confirmedAt: string | null;
  }[];
  purchases: { time: string; item: string; quantity: number; unit: string; amount: number; note: string | null }[];
};

export type StoredAudit = { file: string; month: string; size: number; updatedAt: string; closed: boolean };

function dayStart(d: string) {
  if (!DATE.test(d)) throw new BadRequestException("Dates must be YYYY-MM-DD");
  return new Date(`${d}T00:00:00`);
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

  async report(from: string, to: string): Promise<AuditReport> {
    const start = dayStart(from);
    const end = dayStart(to);
    end.setDate(end.getDate() + 1);
    if (end <= start) throw new BadRequestException("End date is before the start date");
    if (end.getTime() - start.getTime() > MAX_DAYS * 86400000) {
      throw new BadRequestException("Pick one year or less");
    }

    const [orders, payments, purchases] = await Promise.all([
      this.prisma.order.findMany({
        where: { createdAt: { gte: start, lt: end } },
        select: {
          orderNo: true,
          status: true,
          paymentStatus: true,
          total: true,
          paidAmount: true,
          costTotal: true,
          createdAt: true,
        },
      }),
      this.prisma.payment.findMany({
        where: { createdAt: { gte: start, lt: end } },
        include: {
          order: { select: { orderNo: true, tableNo: true } },
          collectedBy: { select: { name: true, role: { select: { name: true } } } },
          handedTo: { select: { name: true } },
        },
        orderBy: { createdAt: "asc" },
        take: 8000,
      }),
      this.prisma.stockMovement.findMany({
        where: { type: "IN", createdAt: { gte: start, lt: end } },
        include: { storeItem: { select: { name: true, unit: true } } },
        orderBy: { createdAt: "asc" },
        take: 8000,
      }),
    ]);

    const days = new Map<string, AuditDay>();
    for (let t = start.getTime(); t < end.getTime(); t += 86400000) {
      const date = isoDay(new Date(t));
      days.set(date, { date, orders: 0, cancelled: 0, paymentsIn: 0, purchasesOut: 0, billsPaid: 0 });
    }
    const bucket = (d: Date) => days.get(isoDay(d));

    let cancelled = 0;
    let unpaidAmount = 0;
    let unpaidCount = 0;
    let foodCost = 0;
    let billsPaid = 0;
    for (const o of orders) {
      const day = bucket(o.createdAt);
      if (o.status === "CANCELLED") {
        cancelled += 1;
        if (day) day.cancelled += 1;
        continue;
      }
      if (day) day.orders += 1;
      if (o.paymentStatus === "PAID") {
        billsPaid += 1;
        foodCost += toNumber(o.costTotal);
        if (day) day.billsPaid += 1;
      } else {
        unpaidCount += 1;
        unpaidAmount += Math.max(0, toNumber(o.total) - toNumber(o.paidAmount));
      }
    }

    let paymentsIn = 0;
    const staff = new Map<string, { name: string; role: string; amount: number; count: number }>();
    for (const p of payments) {
      const amount = toNumber(p.amount);
      paymentsIn += amount;
      const day = bucket(p.createdAt);
      if (day) day.paymentsIn += amount;
      const key = p.collectedBy.name;
      const s = staff.get(key) ?? { name: p.collectedBy.name, role: p.collectedBy.role.name, amount: 0, count: 0 };
      s.amount += amount;
      s.count += 1;
      staff.set(key, s);
    }

    let purchasesOut = 0;
    const purchaseRows = purchases.map((m) => {
      const amount = Math.abs(toNumber(m.quantity)) * toNumber(m.ratePerUnit);
      purchasesOut += amount;
      const day = bucket(m.createdAt);
      if (day) day.purchasesOut += amount;
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
      summary: {
        orders: orders.length - cancelled,
        cancelled,
        billsPaid,
        paymentsIn,
        paymentCount: payments.length,
        purchasesOut,
        purchaseCount: purchases.length,
        foodCost,
        unpaidAmount,
        unpaidCount,
      },
      days: [...days.values()],
      byStaff: [...staff.values()].sort((a, b) => b.amount - a.amount),
      payments: payments.map((p) => ({
        time: p.createdAt.toISOString(),
        orderNo: p.order.orderNo,
        tableNo: p.order.tableNo,
        amount: toNumber(p.amount),
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
