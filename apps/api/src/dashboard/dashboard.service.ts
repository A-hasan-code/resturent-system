import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CostingService } from "../common/costing.service";
import { businessDateOf, businessWindow } from "../common/business-day";
import { toNumber } from "../common/units";
import { AuthUser } from "../common/decorators";
import { TipService } from "../system/tip.service";
import { SettingsService } from "../system/settings.service";
import { ExpensesService } from "../expenses/expenses.service";
import { OPEN_UNPAID_CASH } from "../orders/order-scopes";

const STALE_MINUTES = 10;

type DashOrder = {
  id: string;
  orderNo: number;
  tableNo: string | null;
  status: string;
  paymentStatus: string;
  total: number;
  paidAmount: number;
  due: number;
  createdAt: Date;
  waitMinutes: number;
  stale: boolean;
  items: { name: string; quantity: number; sellUnit: string }[];
  cancelReason?: string | null;
  cancelledAt?: Date | null;
  cancelledBy?: string | null;
};

function isoDay(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly costing: CostingService,
    private readonly tips: TipService,
    private readonly expenses: ExpensesService,
    private readonly settings: SettingsService
  ) {}

  private async netProfitWindows() {
    const now = new Date();
    const today = isoDay(now);
    const monthFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const monthTo = isoDay(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    const yearFrom = `${now.getFullYear()}-01-01`;
    const yearTo = `${now.getFullYear()}-12-31`;
    const [daily, monthly, yearly] = await Promise.all([
      this.expenses.periodTotals(today, today),
      this.expenses.periodTotals(monthFrom, monthTo),
      this.expenses.periodTotals(yearFrom, yearTo),
    ]);
    return {
      daily: {
        from: daily.from,
        to: daily.to,
        sales: daily.sales,
        totalExpense: daily.totalExpense,
        manualExpenses: daily.manualExpenses,
        supplierPaid: daily.supplierPaid,
        netProfit: daily.netProfit,
      },
      monthly: {
        from: monthly.from,
        to: monthly.to,
        sales: monthly.sales,
        totalExpense: monthly.totalExpense,
        manualExpenses: monthly.manualExpenses,
        supplierPaid: monthly.supplierPaid,
        netProfit: monthly.netProfit,
      },
      yearly: {
        from: yearly.from,
        to: yearly.to,
        sales: yearly.sales,
        totalExpense: yearly.totalExpense,
        manualExpenses: yearly.manualExpenses,
        supplierPaid: yearly.supplierPaid,
        netProfit: yearly.netProfit,
      },
    };
  }

  async stats(user: AuthUser) {
    const role = (user.roleCode || "UNKNOWN").toUpperCase();
    const day = await this.settings.dayStart();
    const now = new Date();
    const bizDate = businessDateOf(now, day.h, day.m);
    const { from: start, to: dayEnd } = businessWindow(bizDate, day.h, day.m);
    const inBizDay = { gte: start, lt: dayEnd };
    const staleBefore = new Date(Date.now() - STALE_MINUTES * 60 * 1000);

    // Older/demo orders often saved costTotal=0 — fill from recipes first
    await this.costing.repairMissingOrderCosts();

    const [
      pendingKitchen,
      preparing,
      ready,
      served,
      completed,
      unpaidCount,
      unpaidAgg,
      paidCount,
      paidTodayCount,
      cashCollectedTodayAgg,
      paidOrdersTodayAgg,
      revenueAllAgg,
      ordersTodayAgg,
      ordersToday,
      totalOrdersAll,
      kitchenActive,
      staleCount,
      staleOrdersRaw,
      unpaidList,
      lowRaw,
      storeItems,
      recentUsageRaw,
      stockUsedTodayAgg,
      tipTotalToday,
      myTip,
      tipBoard,
      myOrdersToday,
      myServedToday,
      waiterOrderCounts,
      creditOpenAgg,
      creditPaidTodayAgg,
      cancelledToday,
      cancelledCount,
      cancelledList,
    ] = await Promise.all([
      this.prisma.order.count({ where: { status: "PENDING" } }),
      this.prisma.order.count({ where: { status: "PREPARING" } }),
      this.prisma.order.count({ where: { status: "READY" } }),
      this.prisma.order.count({ where: { status: "SERVED" } }),
      this.prisma.order.count({
        where: { status: "COMPLETED", updatedAt: inBizDay },
      }),
      this.prisma.order.count({ where: OPEN_UNPAID_CASH }),
      this.prisma.order.aggregate({
        where: OPEN_UNPAID_CASH,
        _sum: { total: true, discountAmount: true, paidAmount: true, taxAmount: true },
      }),
      this.prisma.order.count({
        where: { paymentStatus: "PAID", status: { not: "CANCELLED" } },
      }),
      this.prisma.order.count({
        where: {
          creditCustomerId: null,
          status: { not: "CANCELLED" },
          payments: { some: { createdAt: inBizDay } },
        },
      }),
      this.prisma.payment.aggregate({
        where: {
          createdAt: inBizDay,
          order: { creditCustomerId: null, status: { not: "CANCELLED" } },
        },
        _sum: { amount: true, tipAmount: true },
      }),
      this.prisma.order.aggregate({
        where: {
          paymentStatus: "PAID",
          status: { not: "CANCELLED" },
          creditCustomerId: null,
          updatedAt: inBizDay,
        },
        _sum: { costTotal: true },
      }),
      this.prisma.order.aggregate({
        where: { paymentStatus: "PAID", status: { not: "CANCELLED" } },
        _sum: { total: true, discountAmount: true, costTotal: true },
      }),
      this.prisma.order.aggregate({
        where: { createdAt: inBizDay, status: { not: "CANCELLED" } },
        _sum: { total: true, discountAmount: true, costTotal: true },
      }),
      this.prisma.order.count({
        where: { createdAt: inBizDay, status: { not: "CANCELLED" } },
      }),
      this.prisma.order.count({
        where: { status: { not: "CANCELLED" } },
      }),
      this.prisma.order.findMany({
        where: { status: { in: ["PENDING", "PREPARING", "READY"] } },
        include: { items: true },
        orderBy: { createdAt: "asc" },
        take: 25,
      }),
      this.prisma.order.count({
        where: {
          status: { in: ["PENDING", "PREPARING"] },
          createdAt: { lte: staleBefore },
        },
      }),
      this.prisma.order.findMany({
        where: {
          status: { in: ["PENDING", "PREPARING"] },
          createdAt: { lte: staleBefore },
        },
        include: { items: true },
        orderBy: { createdAt: "asc" },
        take: 15,
      }),
      this.prisma.order.findMany({
        where: OPEN_UNPAID_CASH,
        include: { items: true },
        orderBy: { createdAt: "asc" },
        take: 12,
      }),
      this.prisma.storeItem.findMany({
        where: { active: true },
        include: { category: true },
        orderBy: { name: "asc" },
      }),
      this.prisma.storeItem.findMany({
        where: { active: true },
        select: { quantityOnHand: true, ratePerUnit: true },
      }),
      this.prisma.stockMovement.findMany({
        where: { type: "SALE" },
        include: { storeItem: { include: { category: true } }, order: true },
        orderBy: { createdAt: "desc" },
        take: 12,
      }),
      this.prisma.stockMovement.findMany({
        where: { type: "SALE", createdAt: inBizDay },
        select: { quantity: true, ratePerUnit: true },
      }),
      this.tips.tipsTodayTotal(start),
      this.tips.tipsTodayForUser(user.id, start),
      this.tips.tipBoard(start),
      this.prisma.order.count({
        where: { waiterId: user.id, createdAt: inBizDay, status: { not: "CANCELLED" } },
      }),
      this.prisma.order.count({
        where: {
          waiterId: user.id,
          status: { in: ["SERVED", "COMPLETED"] },
          updatedAt: inBizDay,
        },
      }),
      this.prisma.order.groupBy({
        by: ["waiterId"],
        where: { createdAt: inBizDay, status: { not: "CANCELLED" }, waiterId: { not: null } },
        _count: true,
        _sum: { total: true },
      }),
      this.prisma.order.aggregate({
        where: {
          creditCustomerId: { not: null },
          status: { not: "CANCELLED" },
          paymentStatus: { in: ["UNPAID", "PARTIAL"] },
        },
        _sum: { total: true, discountAmount: true, paidAmount: true, taxAmount: true },
        _count: true,
      }),
      this.prisma.payment.aggregate({
        where: {
          createdAt: inBizDay,
          order: { creditCustomerId: { not: null } },
        },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.order.count({
        where: {
          status: "CANCELLED",
          OR: [{ cancelledAt: inBizDay }, { AND: [{ cancelledAt: null }, { updatedAt: inBizDay }] }],
        },
      }),
      this.prisma.order.count({ where: { status: "CANCELLED" } }),
      this.prisma.order.findMany({
        where: {
          status: "CANCELLED",
          OR: [{ cancelledAt: inBizDay }, { AND: [{ cancelledAt: null }, { updatedAt: inBizDay }] }],
        },
        include: {
          items: true,
          cancelledBy: { select: { name: true } },
        },
        orderBy: [{ cancelledAt: "desc" }, { updatedAt: "desc" }],
        take: 12,
      }),
    ]);

    const mapOrder = (
      o: (typeof kitchenActive)[0] & {
        cancelReason?: string | null;
        cancelledAt?: Date | null;
        cancelledBy?: { name: string } | null;
      },
    ): DashOrder => {
      const waitMinutes = Math.max(
        0,
        Math.floor((Date.now() - new Date(o.createdAt).getTime()) / 60000)
      );
      const total = toNumber(o.total);
      const discount = toNumber(o.discountAmount);
      const tax = toNumber(o.taxAmount);
      const paidAmount = toNumber(o.paidAmount);
      const due = Math.max(0, Math.round((total - discount + tax - paidAmount) * 100) / 100);
      return {
        id: o.id,
        orderNo: o.orderNo,
        tableNo: o.tableNo,
        status: o.status,
        paymentStatus: o.paymentStatus,
        total,
        paidAmount,
        due,
        createdAt: o.createdAt,
        waitMinutes,
        stale:
          waitMinutes >= STALE_MINUTES &&
          ["PENDING", "PREPARING"].includes(o.status),
        items: o.items.map((i) => ({
          name: i.name,
          quantity: toNumber(i.quantity),
          sellUnit: i.sellUnit,
        })),
        cancelReason: o.cancelReason ?? null,
        cancelledAt: o.cancelledAt ?? null,
        cancelledBy: o.cancelledBy?.name ?? null,
      };
    };

    const kitchenQueue = kitchenActive.map(mapOrder);
    const newOrders = kitchenQueue.filter((o) => o.status === "PENDING");
    const staleOrders = staleOrdersRaw.map(mapOrder);
    const unpaidOrders = unpaidList.map(mapOrder);
    const cancelledOrders = cancelledList.map(mapOrder);

    const lowStock = lowRaw
      .filter((i) => toNumber(i.quantityOnHand) <= toNumber(i.reorderLevel))
      .map((i) => ({
        name: i.name,
        category: i.category.name,
        quantityOnHand: toNumber(i.quantityOnHand),
        reorderLevel: toNumber(i.reorderLevel),
        unit: i.unit,
      }));

    let stockValue = 0;
    for (const i of storeItems) {
      stockValue += toNumber(i.quantityOnHand) * toNumber(i.ratePerUnit);
    }

    const recentUsage = recentUsageRaw.map((m) => ({
      id: m.id,
      itemName: m.storeItem.name,
      category: m.storeItem.category.name,
      quantity: Math.abs(toNumber(m.quantity)),
      unit: m.storeItem.unit,
      orderNo: m.order?.orderNo ?? null,
      createdAt: m.createdAt,
    }));

    const salesToday = Math.max(
      0,
      toNumber(ordersTodayAgg._sum.total ?? 0) - toNumber(ordersTodayAgg._sum.discountAmount ?? 0),
    );
    let costToday = toNumber(ordersTodayAgg._sum.costTotal ?? 0);

    let stockMoveCostToday = 0;
    for (const m of stockUsedTodayAgg) {
      stockMoveCostToday += Math.abs(toNumber(m.quantity)) * toNumber(m.ratePerUnit);
    }
    if (costToday <= 0 && stockMoveCostToday > 0) {
      costToday = stockMoveCostToday;
    }

    const profitToday = salesToday - costToday;
    const paidRevenueToday = Math.max(0, toNumber(cashCollectedTodayAgg._sum.amount ?? 0));
    const paidCostToday = toNumber(paidOrdersTodayAgg._sum.costTotal ?? 0);
    const tipsCollectedToday = toNumber(cashCollectedTodayAgg._sum.tipAmount ?? 0);
    const revenueAll = Math.max(
      0,
      toNumber(revenueAllAgg._sum.total ?? 0) - toNumber(revenueAllAgg._sum.discountAmount ?? 0),
    );
    const costPaidAll = toNumber(revenueAllAgg._sum.costTotal ?? 0);
    const unpaidAmount = Math.max(
      0,
      toNumber(unpaidAgg._sum.total ?? 0) -
        toNumber(unpaidAgg._sum.discountAmount ?? 0) +
        toNumber(unpaidAgg._sum.taxAmount ?? 0) -
        toNumber(unpaidAgg._sum.paidAmount ?? 0),
    );
    const creditOutstanding = Math.max(
      0,
      toNumber(creditOpenAgg._sum.total ?? 0) -
        toNumber(creditOpenAgg._sum.discountAmount ?? 0) +
        toNumber(creditOpenAgg._sum.taxAmount ?? 0) -
        toNumber(creditOpenAgg._sum.paidAmount ?? 0),
    );
    const creditOutstandingCount = creditOpenAgg._count;
    const creditPaidToday = Math.max(0, toNumber(creditPaidTodayAgg._sum.amount ?? 0));
    const creditPaidTodayCount = creditPaidTodayAgg._count;

    const showNet =
      role === "ADMIN" ||
      role === "SYSTEM_MANAGER" ||
      role === "MAIN_CASHIER" ||
      user.permissions?.includes("expense.view") ||
      user.permissions?.includes("expense.manage");
    const netProfit = showNet ? await this.netProfitWindows() : null;

    const waiterIds = waiterOrderCounts.map((r) => r.waiterId!).filter(Boolean);
    const waiterUsers = waiterIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: waiterIds } },
          select: { id: true, name: true, role: { select: { code: true, name: true } } },
        })
      : [];
    const waiterMap = new Map(waiterUsers.map((u) => [u.id, u]));
    const staffOrdersToday = waiterOrderCounts
      .map((r) => {
        const u = waiterMap.get(r.waiterId!);
        return {
          userId: r.waiterId!,
          name: u?.name ?? "—",
          roleCode: u?.role.code ?? "",
          roleName: u?.role.name ?? "",
          orders: r._count,
          amount: toNumber(r._sum.total ?? 0),
        };
      })
      .sort((a, b) => b.orders - a.orders);

    const emptyOrders: DashOrder[] = [];
    const emptyLow: typeof lowStock = [];
    const emptyUsage: typeof recentUsage = [];

    const tipStats = {
      tipsToday: tipTotalToday,
      tipsCollectedToday,
      myTipToday: myTip.amount,
      myOrdersToday,
      myServedToday,
      tipBoard,
      staffOrdersToday,
    };

    const common = {
      role,
      staleMinutes: STALE_MINUTES,
      pendingKitchen,
      preparing,
      ready,
      served,
      completed,
      staleCount,
      totalOrders: totalOrdersAll,
      unpaidCount,
      unpaidAmount,
      cancelledToday: cancelledToday ?? 0,
      cancelledCount: cancelledCount ?? 0,
      cancelledOrders,
      creditOutstanding,
      creditOutstandingCount,
      creditPaidToday,
      creditPaidTodayCount,
      paidCount,
      paidTodayCount: paidTodayCount ?? 0,
      ordersToday,
      orderAmountToday: salesToday,
      salesToday,
      costToday,
      stockUsedToday: costToday,
      profitToday,
      revenueToday: paidRevenueToday,
      paidToday: paidRevenueToday,
      paidProfitToday: paidRevenueToday - paidCostToday,
      revenueAll,
      profitAll: revenueAll - costPaidAll,
      lowStockCount: lowStock.length,
      lowStock,
      stockValue,
      itemCount: storeItems.length,
      recentUsage,
      staleOrders,
      kitchenQueue,
      newOrders,
      unpaidOrders,
      pending: pendingKitchen + preparing,
      unpaid: unpaidCount,
      netProfit,
      ...tipStats,
    };

    if (role === "WAITER") {
      return {
        ...common,
        revenueToday: 0,
        revenueAll: 0,
        profitToday: 0,
        profitAll: 0,
        costToday: 0,
        stockUsedToday: 0,
        salesToday: 0,
        orderAmountToday: 0,
        unpaidCount: 0,
        unpaidAmount: 0,
        creditOutstanding: 0,
        creditOutstandingCount: 0,
        creditPaidToday: 0,
        creditPaidTodayCount: 0,
        paidCount: 0,
        unpaidOrders: emptyOrders,
        lowStockCount: 0,
        lowStock: emptyLow,
        stockValue: 0,
        itemCount: 0,
        recentUsage: emptyUsage,
        unpaid: 0,
        paidToday: 0,
        tipsToday: myTip.amount,
        tipBoard: tipBoard.filter((t) => t.userId === user.id),
        staffOrdersToday: staffOrdersToday.filter((s) => s.userId === user.id),
      };
    }

    if (role === "KITCHEN") {
      return {
        ...common,
        revenueToday: 0,
        revenueAll: 0,
        profitToday: 0,
        profitAll: 0,
        costToday: 0,
        stockUsedToday: 0,
        salesToday: 0,
        orderAmountToday: 0,
        unpaidCount: 0,
        unpaidAmount: 0,
        creditOutstanding: 0,
        creditOutstandingCount: 0,
        creditPaidToday: 0,
        creditPaidTodayCount: 0,
        paidCount: 0,
        unpaidOrders: emptyOrders,
        lowStockCount: 0,
        lowStock: emptyLow,
        stockValue: 0,
        itemCount: 0,
        recentUsage: emptyUsage,
        unpaid: 0,
        paidToday: 0,
        tipsToday: 0,
        myTipToday: 0,
        tipBoard: [],
        staffOrdersToday: [],
      };
    }

    if (role === "STORE") {
      return {
        ...common,
        pendingKitchen: 0,
        preparing: 0,
        ready: 0,
        served: 0,
        completed: 0,
        staleCount: 0,
        totalOrders: 0,
        unpaidCount: 0,
        unpaidAmount: 0,
        creditOutstanding: 0,
        creditOutstandingCount: 0,
        creditPaidToday: 0,
        creditPaidTodayCount: 0,
        paidCount: 0,
        ordersToday: 0,
        revenueToday: 0,
        revenueAll: 0,
        profitToday: 0,
        profitAll: 0,
        costToday: 0,
        stockUsedToday: 0,
        salesToday: 0,
        orderAmountToday: 0,
        staleOrders: emptyOrders,
        kitchenQueue: emptyOrders,
        newOrders: emptyOrders,
        unpaidOrders: emptyOrders,
        pending: 0,
        unpaid: 0,
        paidToday: 0,
        tipsToday: 0,
        myTipToday: 0,
        tipBoard: [],
        staffOrdersToday: [],
      };
    }

    if (role === "SUPERVISOR" || role === "MANAGER") {
      return {
        ...common,
        revenueToday: 0,
        paidToday: 0,
        paidProfitToday: 0,
        revenueAll: 0,
        profitToday: 0,
        profitAll: 0,
        costToday: 0,
        stockUsedToday: 0,
        salesToday,
        orderAmountToday: salesToday,
        lowStockCount: 0,
        lowStock: emptyLow,
        stockValue: 0,
        itemCount: 0,
        recentUsage: emptyUsage,
      };
    }

    if (role === "CASHIER") {
      return {
        ...common,
        revenueAll: 0,
        profitToday: 0,
        profitAll: 0,
        costToday: 0,
        stockUsedToday: 0,
        lowStockCount: 0,
        lowStock: emptyLow,
        stockValue: 0,
        itemCount: 0,
        recentUsage: emptyUsage,
        kitchenQueue: emptyOrders,
        newOrders: emptyOrders,
        staleOrders,
        unpaidOrders,
      };
    }

    return common;
  }
}
