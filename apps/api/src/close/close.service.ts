import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ExtraExpensePaidBy, CashCounterKind, PaymentStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../system/settings.service";
import { toNumber } from "../common/units";
import { businessDateOf, businessQueryWindow } from "../common/business-day";
import { AuthUser } from "../common/decorators";
import { SaveDayCashCloseDto } from "./close.dto";
import { renderClosePdf } from "./close-pdf";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const money2 = (n: number) => Math.round(n * 100) / 100;

type PayRow = {
  id: string;
  amount: number;
  tipAmount: number;
  method: string;
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
    // Exact from/to for sheet labels; gte/lt TZ-padded for payment/order queries (same as Bills).
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

  private counterMeta(kind: CashCounterKind) {
    if (kind === CashCounterKind.COUNTER_1) {
      return { kind, label: "Cash counter 1", roleCode: "MAIN_CASHIER" };
    }
    return { kind, label: "Cash counter 2", roleCode: "CASHIER" };
  }

  private kindForRole(code: string): CashCounterKind | null {
    // Admin / System Manager cash stays in the main drawer (Counter 1), same as Main Cashier.
    if (code === "MAIN_CASHIER" || code === "ADMIN" || code === "SYSTEM_MANAGER") {
      return CashCounterKind.COUNTER_1;
    }
    if (code === "CASHIER") return CashCounterKind.COUNTER_2;
    return null;
  }

  private async liveSheet(businessDate?: string) {
    const clock = await this.clock(businessDate);
    const { from, to, gte, lt } = clock;

    const orderStaffInclude = {
      cashier: { select: { name: true } },
      assignedCashier: { select: { name: true } },
      creditCustomer: { select: { name: true } },
    } as const;

    const [payments, orders, openCreditOrders, cashiers, saved, hotelExpAgg, supplierPayAgg, selfExtraPurchases] =
      await Promise.all([
      this.prisma.payment.findMany({
        where: { createdAt: { gte, lt } },
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
        where: { createdAt: { gte, lt }, status: { not: "CANCELLED" } },
        include: {
          items: {
            where: { lineKind: "MENU" },
            select: { name: true, quantity: true, amount: true },
          },
          ...orderStaffInclude,
        },
        orderBy: { createdAt: "asc" },
      }),
      // All open credit invoices (any day) — receivables, never part of drawer expected cash.
      this.prisma.order.findMany({
        where: {
          creditCustomerId: { not: null },
          status: { not: "CANCELLED" },
          paymentStatus: { in: [PaymentStatus.UNPAID, PaymentStatus.PARTIAL] },
        },
        include: orderStaffInclude,
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
      this.prisma.hotelExpense.aggregate({
        where: { spentAt: { gte, lt } },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.supplierPayment.aggregate({
        where: { paidAt: { gte, lt } },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.purchase.findMany({
        where: {
          purchasedAt: { gte, lt },
          voidedAt: null,
          extraExpense: { gt: 0 },
          extraExpensePaidBy: ExtraExpensePaidBy.SELF,
        },
        select: { extraExpense: true },
      }),
    ]);

    const payRows: PayRow[] = payments.map((p) => {
      const drawer = p.handedTo ?? p.collectedBy;
      const drawerRole = drawer.role.code;
      const isCredit = !!p.order.creditCustomerId;
      const method = (p as { method?: string }).method || "CASH";
      return {
        id: p.id,
        amount: toNumber(p.amount),
        tipAmount: toNumber(p.tipAmount),
        method,
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
        // Only cash goes in the physical drawer counters
        counterKind: method === "CASH" ? this.kindForRole(drawerRole) : null,
        pendingHandover: method === "CASH" && !!p.handedToId && !p.confirmedAt,
      };
    });

    const cardTotal = money2(payRows.filter((p) => p.method === "CARD").reduce((s, p) => s + p.amount, 0));
    const walletTotal = money2(payRows.filter((p) => p.method === "WALLET").reduce((s, p) => s + p.amount, 0));
    const bankTotal = money2(payRows.filter((p) => p.method === "BANK").reduce((s, p) => s + p.amount, 0));
    const nonCashPayments = payRows.filter((p) => p.method !== "CASH");

    const paidOrders = orders.filter((o) => o.paymentStatus === PaymentStatus.PAID);
    // Table / walk-in unpaid only — credit receivables are tracked separately and never feed expected cash.
    const pendingOrders = orders.filter(
      (o) =>
        !o.creditCustomerId &&
        (o.paymentStatus === PaymentStatus.UNPAID || o.paymentStatus === PaymentStatus.PARTIAL)
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

    const invoiceNet = (o: { total: unknown; discountAmount?: unknown; taxAmount?: unknown }) =>
      money2(Math.max(0, toNumber(o.total) - toNumber(o.discountAmount ?? 0) + toNumber(o.taxAmount ?? 0)));

    const toPendingBill = (o: (typeof orders)[number] | (typeof openCreditOrders)[number]) => {
      const total = toNumber(o.total);
      const paid = toNumber(o.paidAmount);
      const net = invoiceNet(o);
      const isCredit = !!o.creditCustomerId;
      return {
        orderNo: o.orderNo,
        tableNo: o.tableNo,
        total,
        paidAmount: paid,
        balance: money2(Math.max(0, net - paid)),
        paymentStatus: o.paymentStatus,
        isCredit,
        creditCustomerName: o.creditCustomer?.name ?? null,
        cashier: o.cashier?.name || o.assignedCashier?.name || null,
        createdAt: o.createdAt.toISOString(),
      };
    };

    const pendingBills = pendingOrders.map(toPendingBill);
    const creditUnpaidBills = openCreditOrders.map(toPendingBill);
    const creditUnpaidAmount = money2(creditUnpaidBills.reduce((s, b) => s + b.balance, 0));
    const creditUnpaidCount = creditUnpaidBills.length;

    // Today's new credit invoices (opened / put on credit this business day).
    const creditTodayOrders = orders.filter((o) => !!o.creditCustomerId);
    const creditTodayBills = creditTodayOrders.map((o) => {
      const net = invoiceNet(o);
      return {
        orderNo: o.orderNo,
        tableNo: o.tableNo,
        total: toNumber(o.total),
        amount: net,
        paidAmount: toNumber(o.paidAmount),
        balance: money2(Math.max(0, net - toNumber(o.paidAmount))),
        paymentStatus: o.paymentStatus,
        creditCustomerName: o.creditCustomer?.name ?? null,
        cashier: o.cashier?.name || o.assignedCashier?.name || null,
        createdAt: o.createdAt.toISOString(),
      };
    });
    const creditTodayAmount = money2(creditTodayBills.reduce((s, b) => s + b.amount, 0));
    const creditTodayCount = creditTodayBills.length;

    // Cash collected today against credit accounts (settlements) — in drawer, listed separately.
    const creditPayments = payRows.filter((p) => p.isCredit);
    const creditPaidBills = creditPayments.map((p) => ({
      id: p.id,
      orderNo: p.orderNo,
      tableNo: p.tableNo,
      amount: p.amount,
      creditCustomerName: p.creditCustomerName,
      cashier: p.drawerName,
      createdAt: p.createdAt,
      paymentStatus: "PAID" as const,
    }));
    const creditPaidAmount = money2(creditPaidBills.reduce((s, p) => s + p.amount, 0));
    const creditPaidCount = creditPaidBills.length;
    const pendingAmount = money2(pendingBills.reduce((s, b) => s + b.balance, 0));
    const paidSalesTotal = money2(paidOrders.reduce((s, o) => s + toNumber(o.total), 0));

    const savedByKind = new Map(saved?.counters.map((c) => [c.kind, c]) ?? []);

    const billRowsFrom = (rows: PayRow[]) => {
      const billIds = [...new Set(rows.map((p) => p.orderId))];
      return billIds.map((id) => {
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
      });
    };

    const counters = [CashCounterKind.COUNTER_1, CashCounterKind.COUNTER_2].map((kind) => {
      const meta = this.counterMeta(kind);
      // All physical cash on this drawer (walk-in + credit settlements).
      const rows = payRows.filter((p) => p.counterKind === kind);
      const walkInRows = rows.filter((p) => !p.isCredit);
      const creditRows = rows.filter((p) => p.isCredit);
      const walkInCash = money2(walkInRows.reduce((s, p) => s + p.amount, 0));
      const creditCash = money2(creditRows.reduce((s, p) => s + p.amount, 0));
      const cashSales = money2(walkInCash + creditCash);
      const tipTotal = money2(rows.reduce((s, p) => s + p.tipAmount, 0));
      const savedC = savedByKind.get(kind);
      const staff = cashiers
        .filter((u) => u.role.code === meta.roleCode)
        .map((u) => ({ id: u.id, name: u.name }));

      // Base expected = all drawer cash + tips (+ float on C1).
      let expectedCash = money2(cashSales + tipTotal);
      if (kind === CashCounterKind.COUNTER_1) {
        const float = saved ? toNumber(saved.openingFloat) : 0;
        expectedCash = money2(expectedCash + float);
      }

      const collectedCash = savedC ? toNumber(savedC.collectedCash) : expectedCash;
      const missCash = money2(Math.max(0, expectedCash - collectedCash));
      const surplusCash = money2(Math.max(0, collectedCash - expectedCash));
      const bills = billRowsFrom(walkInRows);
      const creditBills = billRowsFrom(creditRows);

      return {
        kind,
        label: meta.label,
        roleCode: meta.roleCode,
        cashiers: staff,
        cashSales,
        walkInCash,
        creditCash,
        tipTotal,
        expectedCash,
        collectedCash,
        missCash,
        surplusCash,
        missReason: savedC?.missReason ?? "",
        billCount: bills.length,
        creditBillCount: creditBills.length,
        paymentCount: walkInRows.length,
        creditPaymentCount: creditRows.length,
        pendingHandoverCash: money2(rows.filter((p) => p.pendingHandover).reduce((s, p) => s + p.amount, 0)),
        /** Walk-in / table cash only — credit collections listed separately. */
        payments: walkInRows,
        bills,
        creditPayments: creditRows,
        creditBills,
      };
    });

    const hotelExpenses = money2(toNumber(hotelExpAgg._sum.amount ?? 0));
    const supplierPaid = money2(toNumber(supplierPayAgg._sum.amount ?? 0));
    const selfExtra = money2(selfExtraPurchases.reduce((s, p) => s + toNumber(p.extraExpense), 0));
    const cashOutTotal = money2(hotelExpenses + supplierPaid + selfExtra);

    // Apply cash-out to counter 1 expected (live days). Frozen past days use saved expected.
    const c1 = counters.find((c) => c.kind === CashCounterKind.COUNTER_1);
    if (c1 && !(saved && !clock.isToday)) {
      c1.expectedCash = money2(Math.max(0, c1.expectedCash - cashOutTotal));
      c1.missCash = money2(Math.max(0, c1.expectedCash - c1.collectedCash));
      c1.surplusCash = money2(Math.max(0, c1.collectedCash - c1.expectedCash));
    }

    // Past closed day: freeze counter expected/collected/miss from snapshot.
    if (saved && !clock.isToday) {
      for (const c of counters) {
        const savedC = savedByKind.get(c.kind);
        if (!savedC) continue;
        c.expectedCash = toNumber(savedC.expectedCash);
        c.collectedCash = toNumber(savedC.collectedCash);
        c.missCash = toNumber(savedC.missCash);
        c.surplusCash = money2(Math.max(0, c.collectedCash - c.expectedCash));
        c.missReason = savedC.missReason ?? "";
        c.tipTotal = toNumber(savedC.tipTotal);
        if (Array.isArray(savedC.paymentsJson)) {
          const snap = savedC.paymentsJson as PayRow[];
          const walkIn = snap.filter((p) => !p.isCredit);
          const credit = snap.filter((p) => p.isCredit);
          // Older snapshots mixed credit into payments — always re-split by isCredit.
          c.payments = walkIn.length || credit.length ? walkIn : snap;
          c.creditPayments = credit;
          c.bills = billRowsFrom(c.payments);
          c.creditBills = billRowsFrom(credit);
          c.walkInCash = money2(c.payments.reduce((s, p) => s + p.amount, 0));
          c.creditCash = money2(credit.reduce((s, p) => s + p.amount, 0));
          c.billCount = c.bills.length;
          c.creditBillCount = c.creditBills.length;
          c.paymentCount = c.payments.length;
          c.creditPaymentCount = credit.length;
        }
      }
    }

    const otherPayments = payRows.filter((p) => p.method === "CASH" && !p.counterKind);
    const tipTotalAll = money2(counters.reduce((s, c) => s + c.tipTotal, 0));
    const cashSalesAll = money2(counters.reduce((s, c) => s + c.cashSales, 0));
    const openingFloat = saved ? toNumber(saved.openingFloat) : 0;
    const expectedCash = money2(counters.reduce((s, c) => s + c.expectedCash, 0));
    const collectedCash = money2(counters.reduce((s, c) => s + c.collectedCash, 0));
    const missCash = money2(Math.max(0, expectedCash - collectedCash));
    const surplusCash = money2(Math.max(0, collectedCash - expectedCash));
    const frozenSold =
      saved && !clock.isToday && saved.soldItems?.length
        ? saved.soldItems.map((i) => ({
            name: i.name,
            qty: toNumber(i.qty),
            amount: toNumber(i.amount),
          }))
        : soldItems;

    const locked = !!saved?.lockedAt;

    const batchClose = await this.prisma.dayBatchClose.findUnique({
      where: { businessDate: clock.businessDate },
      include: {
        lines: {
          include: { specialProduct: { select: { name: true } } },
          orderBy: { specialProductId: "asc" },
        },
      },
    });
    const specialsClose = batchClose
      ? {
          businessDate: batchClose.businessDate,
          closedByName: batchClose.closedByName,
          lines: batchClose.lines.map((l) => ({
            name: l.specialProduct.name,
            systemRemainingGrams: toNumber(l.systemRemainingGrams),
            countedRemainingGrams: toNumber(l.countedRemainingGrams),
            carryGrams: toNumber(l.carryGrams),
            wasteGrams: toNumber(l.wasteGrams),
            lossCost: toNumber(l.lossCost),
            wasteNote: l.wasteNote,
          })),
          wasteGrams: money2(batchClose.lines.reduce((s, l) => s + toNumber(l.wasteGrams), 0)),
          carryGrams: money2(batchClose.lines.reduce((s, l) => s + toNumber(l.carryGrams), 0)),
          lossCost: money2(batchClose.lines.reduce((s, l) => s + toNumber(l.lossCost), 0)),
        }
      : null;

    return {
      businessDate: clock.businessDate,
      today: clock.today,
      isToday: clock.isToday,
      dayStart: clock.label,
      canEdit: !locked && clock.isToday,
      /** Frontend + save(): Admin may edit unlocked past days. */
      canAdminEditPast: !locked && !clock.isToday,
      locked,
      frozen: !!(saved && !clock.isToday),
      from: clock.from.toISOString(),
      to: clock.to.toISOString(),
      saved: !!saved,
      closeId: saved?.id ?? null,
      note: saved?.note ?? "",
      closedByName: saved?.closedByName ?? null,
      closedAt: saved?.updatedAt?.toISOString() ?? null,
      counters,
      otherPayments,
      nonCashPayments,
      soldItems: frozenSold,
      specialsClose,
      pendingBills,
      creditTodayBills,
      creditPaidBills,
      creditUnpaidBills,
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
        cashSales: cashSalesAll,
        tipTotal: tipTotalAll,
        openingFloat,
        expectedCash,
        collectedCash,
        missCash,
        surplusCash,
        cardTotal: saved && !clock.isToday ? toNumber(saved.cardTotal) : cardTotal,
        walletTotal: saved && !clock.isToday ? toNumber(saved.walletTotal) : walletTotal,
        bankTotal: saved && !clock.isToday ? toNumber(saved.bankTotal) : bankTotal,
        pendingAmount,
        pendingCount: pendingBills.length,
        paidBillsCount: paidOrders.length,
        paidSalesTotal,
        totalSale: paidSalesTotal,
        // Expected + open table unpaid only — credit receivables stay out of this figure.
        cashPlusPending: money2(expectedCash + pendingAmount),
        creditTodayAmount,
        creditTodayCount,
        creditPaidAmount,
        creditPaidCount,
        creditUnpaidAmount,
        creditUnpaidCount,
        hotelExpenses,
        hotelExpenseCount: hotelExpAgg._count,
        supplierPaid,
        supplierPaymentCount: supplierPayAgg._count,
        selfExtra,
        cashOutTotal,
        drawerFormula: "float + cash sales + tips − cash out",
      },
    };
  }

  async preview(date?: string, user?: AuthUser) {
    const sheet = await this.liveSheet(date);
    const isAdmin = user?.roleCode === "ADMIN";
    return {
      ...sheet,
      canEdit:
        !sheet.locked && (sheet.isToday || (isAdmin && !!sheet.canAdminEditPast)),
      adminPastEdit: isAdmin && !sheet.isToday && !sheet.locked,
    };
  }

  async toPdf(date?: string) {
    const sheet = await this.liveSheet(date);
    return renderClosePdf(sheet, await this.settings.restaurant());
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
    const isAdmin = user.roleCode === "ADMIN";
    const sheet = await this.liveSheet(dto.businessDate);
    // Past-day Admin edits may run after hotel close; today still requires hotel open.
    if (sheet.isToday || !isAdmin) {
      await this.settings.assertHotelOpen();
    }
    if (!sheet.isToday && !isAdmin) {
      throw new BadRequestException(
        "Past day close reports are view-only. Only Admin can edit a previous day’s close."
      );
    }
    if (sheet.locked) {
      throw new BadRequestException(
        "This day is locked. Unlock from Close/Finance (Admin) before editing the close report."
      );
    }
    const inputByKind = new Map(dto.counters.map((c) => [c.kind, c]));

    for (const kind of [CashCounterKind.COUNTER_1, CashCounterKind.COUNTER_2]) {
      if (!inputByKind.has(kind)) {
        throw new BadRequestException(`Missing collection for ${this.counterMeta(kind).label}`);
      }
    }

    const openingFloat = money2(Math.max(0, dto.openingFloat ?? 0));
    const cashOut = sheet.totals.cashOutTotal;

    const counterData = sheet.counters.map((c) => {
      const input = inputByKind.get(c.kind)!;
      const collectedCash = money2(input.collectedCash);
      if (collectedCash < 0) throw new BadRequestException("Collected cash cannot be negative");
      // Rebuild expected with the float the cashier entered (cash-out on C1).
      let expectedCash = money2(c.cashSales + c.tipTotal);
      if (c.kind === CashCounterKind.COUNTER_1) {
        expectedCash = money2(Math.max(0, expectedCash + openingFloat - cashOut));
      }
      const missCash = money2(Math.max(0, expectedCash - collectedCash));
      const missReason = (input.missReason || "").trim();
      if (missCash > 0 && missReason.length < 3) {
        throw new BadRequestException(
          `${c.label}: miss cash is ${missCash.toFixed(2)} — write a reason (why remaining?)`
        );
      }
      return {
        kind: c.kind,
        label: c.label,
        expectedCash,
        collectedCash,
        missCash,
        missReason: missCash > 0 ? missReason : missReason || null,
        billCount: c.billCount + (c.creditBillCount ?? 0),
        paymentCount: c.paymentCount + (c.creditPaymentCount ?? 0),
        tipTotal: c.tipTotal,
        // Snapshot both walk-in and credit rows; preview re-splits by isCredit.
        paymentsJson: [...c.payments, ...(c.creditPayments ?? [])] as unknown as Prisma.InputJsonValue,
      };
    });

    const expectedCash = money2(counterData.reduce((s, c) => s + c.expectedCash, 0));
    const collectedCash = money2(counterData.reduce((s, c) => s + c.collectedCash, 0));
    const missCash = money2(Math.max(0, expectedCash - collectedCash));
    const now = new Date();

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
            cardTotal: sheet.totals.cardTotal,
            walletTotal: sheet.totals.walletTotal,
            bankTotal: sheet.totals.bankTotal,
            openingFloat,
            lockedAt: now,
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
          cardTotal: sheet.totals.cardTotal,
          walletTotal: sheet.totals.walletTotal,
          bankTotal: sheet.totals.bankTotal,
          openingFloat,
          lockedAt: now,
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
