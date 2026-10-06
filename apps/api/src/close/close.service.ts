import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { CashCounterKind, PaymentStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../system/settings.service";
import { toNumber } from "../common/units";
import { businessDateOf, businessWindow } from "../common/business-day";
import { AuthUser } from "../common/decorators";
import { SaveDayCashCloseDto } from "./close.dto";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const money2 = (n: number) => Math.round(n * 100) / 100;

type PayRow = {
  id: string;
  amount: number;
  tipAmount: number;
  createdAt: string;
  confirmedAt: string | null;
  orderId: string;
  orderNo: number;
  tableNo: string | null;
  orderTotal: number;
  isCredit: boolean;
  creditCustomerName: string | null;
  collectedBy: { id: string; name: string; roleCode: string };
  handedTo: { id: string; name: string; roleCode: string } | null;
  drawerUserId: string;
  drawerName: string;
  drawerRole: string;
  counterKind: CashCounterKind | null;
  pendingHandover: boolean;
};

@Injectable()
export class CloseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService
  ) {}

  private async clock(dateStr?: string) {
    const start = await this.settings.dayStart();
    const now = new Date();
    const today = businessDateOf(now, start.h, start.m);
    const businessDate = dateStr?.trim() || today;
    if (!DATE_RE.test(businessDate)) throw new BadRequestException("Invalid business date");
    const window = businessWindow(businessDate, start.h, start.m);
    return {
      ...start,
      businessDate,
      today,
      isToday: businessDate === today,
      from: window.from,
      to: window.to,
    };
  }

  private counterMeta(kind: CashCounterKind) {
    if (kind === CashCounterKind.COUNTER_1) {
      return { kind, label: "Cash counter 1", roleCode: "MAIN_CASHIER" };
    }
    return { kind, label: "Cash counter 2", roleCode: "CASHIER" };
  }

  private kindForRole(code: string): CashCounterKind | null {
    if (code === "MAIN_CASHIER") return CashCounterKind.COUNTER_1;
    if (code === "CASHIER") return CashCounterKind.COUNTER_2;
    return null;
  }

  private async liveSheet(businessDate?: string) {
    const clock = await this.clock(businessDate);
    const { from, to } = clock;

    const [payments, orders, cashiers, saved] = await Promise.all([
      this.prisma.payment.findMany({
        where: { createdAt: { gte: from, lt: to } },
        include: {
          order: {
            select: {
              id: true,
              orderNo: true,
              tableNo: true,
              total: true,
              creditCustomerId: true,
              creditCustomer: { select: { name: true } },
            },
          },
          collectedBy: { select: { id: true, name: true, role: { select: { code: true } } } },
          handedTo: { select: { id: true, name: true, role: { select: { code: true } } } },
        },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.order.findMany({
        where: { createdAt: { gte: from, lt: to }, status: { not: "CANCELLED" } },
        include: {
          items: {
            where: { lineKind: "MENU" },
            select: { name: true, quantity: true, amount: true },
          },
          cashier: { select: { name: true } },
          assignedCashier: { select: { name: true } },
          creditCustomer: { select: { name: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.user.findMany({
        where: { active: true, deletedAt: null, role: { code: { in: ["MAIN_CASHIER", "CASHIER"] } } },
        select: { id: true, name: true, role: { select: { code: true } } },
        orderBy: { name: "asc" },
      }),
      this.prisma.dayCashClose.findUnique({
        where: { businessDate: clock.businessDate },
        include: {
          counters: true,
          soldItems: { orderBy: { amount: "desc" } },
        },
      }),
    ]);

    const payRows: PayRow[] = payments.map((p) => {
      const drawer = p.handedTo ?? p.collectedBy;
      const drawerRole = drawer.role.code;
      const isCredit = !!p.order.creditCustomerId;
      return {
        id: p.id,
        amount: toNumber(p.amount),
        tipAmount: toNumber(p.tipAmount),
        createdAt: p.createdAt.toISOString(),
        confirmedAt: p.confirmedAt?.toISOString() ?? null,
        orderId: p.order.id,
        orderNo: p.order.orderNo,
        tableNo: p.order.tableNo,
        orderTotal: toNumber(p.order.total),
        isCredit,
        creditCustomerName: p.order.creditCustomer?.name ?? null,
        collectedBy: {
          id: p.collectedBy.id,
          name: p.collectedBy.name,
          roleCode: p.collectedBy.role.code,
        },
        handedTo: p.handedTo
          ? { id: p.handedTo.id, name: p.handedTo.name, roleCode: p.handedTo.role.code }
          : null,
        drawerUserId: drawer.id,
        drawerName: drawer.name,
        drawerRole,
        counterKind: this.kindForRole(drawerRole),
        pendingHandover: !!p.handedToId && !p.confirmedAt,
      };
    });

    const paidOrders = orders.filter((o) => o.paymentStatus === PaymentStatus.PAID);
    const pendingOrders = orders.filter(
      (o) => o.paymentStatus === PaymentStatus.UNPAID || o.paymentStatus === PaymentStatus.PARTIAL
    );

    const soldMap = new Map<string, { name: string; qty: number; amount: number }>();
    for (const o of paidOrders) {
      for (const it of o.items) {
        const cur = soldMap.get(it.name) ?? { name: it.name, qty: 0, amount: 0 };
        cur.qty += toNumber(it.quantity);
        cur.amount = money2(cur.amount + toNumber(it.amount));
        soldMap.set(it.name, cur);
      }
    }
    const soldItems = [...soldMap.values()]
      .map((x) => ({ ...x, qty: Math.round(x.qty * 1000) / 1000 }))
      .sort((a, b) => b.amount - a.amount);

    const pendingBills = pendingOrders.map((o) => {
      const total = toNumber(o.total);
      const paid = toNumber(o.paidAmount);
      const isCredit = !!o.creditCustomerId;
      return {
        orderNo: o.orderNo,
        tableNo: o.tableNo,
        total,
        paidAmount: paid,
        balance: money2(total - paid),
        paymentStatus: o.paymentStatus,
        isCredit,
        creditCustomerName: o.creditCustomer?.name ?? null,
        cashier: o.cashier?.name || o.assignedCashier?.name || null,
      };
    });

    const creditPendingBills = pendingBills.filter((b) => b.isCredit);
    const creditUnpaidAmount = money2(creditPendingBills.reduce((s, b) => s + b.balance, 0));
    const creditUnpaidCount = creditPendingBills.length;
    const creditPayments = payRows.filter((p) => p.isCredit);
    const creditPaidAmount = money2(creditPayments.reduce((s, p) => s + p.amount, 0));
    const creditPaidCount = creditPayments.length;
    const pendingAmount = money2(pendingBills.reduce((s, b) => s + b.balance, 0));
    const paidSalesTotal = money2(paidOrders.reduce((s, o) => s + toNumber(o.total), 0));

    const savedByKind = new Map(saved?.counters.map((c) => [c.kind, c]) ?? []);

    const counters = [CashCounterKind.COUNTER_1, CashCounterKind.COUNTER_2].map((kind) => {
      const meta = this.counterMeta(kind);
      const rows = payRows.filter((p) => p.counterKind === kind);
      const expectedCash = money2(rows.reduce((s, p) => s + p.amount, 0));
      const tipTotal = money2(rows.reduce((s, p) => s + p.tipAmount, 0));
      const billIds = new Set(rows.map((p) => p.orderId));
      const savedC = savedByKind.get(kind);
      const collectedCash = savedC ? toNumber(savedC.collectedCash) : expectedCash;
      const missCash = money2(Math.max(0, expectedCash - collectedCash));
      const staff = cashiers
        .filter((u) => u.role.code === meta.roleCode)
        .map((u) => ({ id: u.id, name: u.name }));

      return {
        kind,
        label: meta.label,
        roleCode: meta.roleCode,
        cashiers: staff,
        expectedCash,
        collectedCash,
        missCash,
        missReason: savedC?.missReason ?? "",
        billCount: billIds.size,
        paymentCount: rows.length,
        tipTotal,
        pendingHandoverCash: money2(rows.filter((p) => p.pendingHandover).reduce((s, p) => s + p.amount, 0)),
        payments: rows,
        bills: [...billIds].map((id) => {
          const sample = rows.find((p) => p.orderId === id)!;
          const paidOnCounter = money2(rows.filter((p) => p.orderId === id).reduce((s, p) => s + p.amount, 0));
          return {
            orderId: id,
            orderNo: sample.orderNo,
            tableNo: sample.tableNo,
            orderTotal: sample.orderTotal,
            paidOnCounter,
            isCredit: sample.isCredit,
            creditCustomerName: sample.creditCustomerName,
          };
        }),
      };
    });

    const otherPayments = payRows.filter((p) => !p.counterKind);
    const expectedCash = money2(counters.reduce((s, c) => s + c.expectedCash, 0));
    const collectedCash = money2(counters.reduce((s, c) => s + c.collectedCash, 0));
    const missCash = money2(counters.reduce((s, c) => s + c.missCash, 0));

    return {
      businessDate: clock.businessDate,
      today: clock.today,
      isToday: clock.isToday,
      dayStart: clock.label,
      canEdit: clock.isToday,
      from: clock.from.toISOString(),
      to: clock.to.toISOString(),
      saved: !!saved,
      closeId: saved?.id ?? null,
      note: saved?.note ?? "",
      closedByName: saved?.closedByName ?? null,
      closedAt: saved?.updatedAt?.toISOString() ?? null,
      counters,
      otherPayments,
      soldItems,
      pendingBills,
      paidBills: paidOrders.map((o) => ({
        orderNo: o.orderNo,
        tableNo: o.tableNo,
        total: toNumber(o.total),
        tipAmount: toNumber(o.tipAmount),
        isCredit: !!o.creditCustomerId,
        creditCustomerName: o.creditCustomer?.name ?? null,
        cashier: o.cashier?.name || o.assignedCashier?.name || null,
        createdAt: o.createdAt.toISOString(),
      })),
      totals: {
        expectedCash,
        collectedCash,
        missCash,
        pendingAmount,
        pendingCount: pendingBills.length,
        paidBillsCount: paidOrders.length,
        paidSalesTotal,
        totalSale: paidSalesTotal,
        cashPlusPending: money2(expectedCash + pendingAmount),
        creditUnpaidAmount,
        creditUnpaidCount,
        creditPaidAmount,
        creditPaidCount,
      },
    };
  }

  async preview(date?: string) {
    return this.liveSheet(date);
  }

  async history(limit = 60) {
    const take = Math.min(Math.max(Number(limit) || 60, 1), 365);
    const rows = await this.prisma.dayCashClose.findMany({
      orderBy: { businessDate: "desc" },
      take,
      include: { counters: { orderBy: { kind: "asc" } } },
    });
    return rows.map((r) => ({
      id: r.id,
      businessDate: r.businessDate,
      expectedCash: toNumber(r.expectedCash),
      collectedCash: toNumber(r.collectedCash),
      missCash: toNumber(r.missCash),
      pendingAmount: toNumber(r.pendingAmount),
      pendingCount: r.pendingCount,
      paidBillsCount: r.paidBillsCount,
      totalSale: toNumber(r.totalSale),
      closedByName: r.closedByName,
      closedAt: r.updatedAt.toISOString(),
      counters: r.counters.map((c) => ({
        kind: c.kind,
        label: c.label,
        expectedCash: toNumber(c.expectedCash),
        collectedCash: toNumber(c.collectedCash),
        missCash: toNumber(c.missCash),
        missReason: c.missReason,
      })),
    }));
  }

  async save(dto: SaveDayCashCloseDto, user: AuthUser) {
    const sheet = await this.liveSheet(dto.businessDate);
    if (!sheet.isToday) {
      throw new BadRequestException(
        "Past day close reports are view-only. Only today’s report can be saved or updated."
      );
    }
    const inputByKind = new Map(dto.counters.map((c) => [c.kind, c]));

    for (const kind of [CashCounterKind.COUNTER_1, CashCounterKind.COUNTER_2]) {
      if (!inputByKind.has(kind)) {
        throw new BadRequestException(`Missing collection for ${this.counterMeta(kind).label}`);
      }
    }

    const counterData = sheet.counters.map((c) => {
      const input = inputByKind.get(c.kind)!;
      const collectedCash = money2(input.collectedCash);
      if (collectedCash < 0) throw new BadRequestException("Collected cash cannot be negative");
      const missCash = money2(Math.max(0, c.expectedCash - collectedCash));
      const missReason = (input.missReason || "").trim();
      if (missCash > 0 && missReason.length < 3) {
        throw new BadRequestException(
          `${c.label}: miss cash is ${missCash.toFixed(2)} — write a reason (why remaining?)`
        );
      }
      return {
        kind: c.kind,
        label: c.label,
        expectedCash: c.expectedCash,
        collectedCash,
        missCash,
        missReason: missCash > 0 ? missReason : missReason || null,
        billCount: c.billCount,
        paymentCount: c.paymentCount,
        tipTotal: c.tipTotal,
        paymentsJson: c.payments as unknown as Prisma.InputJsonValue,
      };
    });

    const expectedCash = money2(counterData.reduce((s, c) => s + c.expectedCash, 0));
    const collectedCash = money2(counterData.reduce((s, c) => s + c.collectedCash, 0));
    const missCash = money2(counterData.reduce((s, c) => s + c.missCash, 0));

    const saved = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.dayCashClose.findUnique({ where: { businessDate: sheet.businessDate } });
      if (existing) {
        await tx.dayCashCloseCounter.deleteMany({ where: { closeId: existing.id } });
        await tx.dayCashCloseSoldItem.deleteMany({ where: { closeId: existing.id } });
        return tx.dayCashClose.update({
          where: { id: existing.id },
          data: {
            note: dto.note?.trim() || null,
            expectedCash,
            collectedCash,
            missCash,
            pendingAmount: sheet.totals.pendingAmount,
            pendingCount: sheet.totals.pendingCount,
            paidBillsCount: sheet.totals.paidBillsCount,
            paidSalesTotal: sheet.totals.paidSalesTotal,
            totalSale: sheet.totals.totalSale,
            closedById: user.id,
            closedByName: user.name,
            counters: { create: counterData },
            soldItems: {
              create: sheet.soldItems.map((i) => ({
                name: i.name,
                qty: i.qty,
                amount: i.amount,
              })),
            },
          },
          include: { counters: true, soldItems: true },
        });
      }
      return tx.dayCashClose.create({
        data: {
          businessDate: sheet.businessDate,
          note: dto.note?.trim() || null,
          expectedCash,
          collectedCash,
          missCash,
          pendingAmount: sheet.totals.pendingAmount,
          pendingCount: sheet.totals.pendingCount,
          paidBillsCount: sheet.totals.paidBillsCount,
          paidSalesTotal: sheet.totals.paidSalesTotal,
          totalSale: sheet.totals.totalSale,
          closedById: user.id,
          closedByName: user.name,
          counters: { create: counterData },
          soldItems: {
            create: sheet.soldItems.map((i) => ({
              name: i.name,
              qty: i.qty,
              amount: i.amount,
            })),
          },
        },
        include: { counters: true, soldItems: true },
      });
    });

    return this.liveSheet(saved.businessDate);
  }

  async getSaved(businessDate: string) {
    if (!DATE_RE.test(businessDate)) throw new BadRequestException("Invalid business date");
    const row = await this.prisma.dayCashClose.findUnique({
      where: { businessDate },
      include: { counters: true, soldItems: { orderBy: { amount: "desc" } } },
    });
    if (!row) throw new NotFoundException("No close report for this date");
    return this.liveSheet(businessDate);
  }
}
