import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CostingService } from "../common/costing.service";
import { toNumber } from "../common/units";
import { AuthUser } from "../common/decorators";

const STALE_MINUTES = 10;

type DashOrder = {
  id: string;
  orderNo: number;
  tableNo: string | null;
  status: string;
  paymentStatus: string;
  total: number;
  createdAt: Date;
  waitMinutes: number;
  stale: boolean;
  items: { name: string; quantity: number; sellUnit: string }[];
};

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly costing: CostingService
  ) {}

  async stats(user: AuthUser) {
    const role = (user.roleCode || "UNKNOWN").toUpperCase();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const staleBefore = new Date(Date.now() - STALE_MINUTES * 60 * 1000);

    // Older/demo orders often saved costTotal=0 — fill from recipes first
    await this.costing.repairMissingOrderCosts();

    const [
      pendingKitchen,
      preparing,
      ready,
      completed,
      unpaidCount,
      unpaidAgg,
      paidCount,
      revenueTodayAgg,
      revenueAllAgg,
      ordersTodayAgg,
      ordersToday,
      totalOrdersAll,
      kitchenActive,
      staleOrdersRaw,
      unpaidList,
      lowRaw,
      storeItems,
      recentUsageRaw,
      stockUsedTodayAgg,
    ] = await Promise.all([
      this.prisma.order.count({ where: { status: "PENDING" } }),
      this.prisma.order.count({ where: { status: "PREPARING" } }),
      this.prisma.order.count({ where: { status: "READY" } }),
      this.prisma.order.count({ where: { status: "COMPLETED" } }),
      this.prisma.order.count({
        where: { paymentStatus: { in: ["UNPAID", "PARTIAL"] } },
      }),
      this.prisma.order.aggregate({
        where: { paymentStatus: { in: ["UNPAID", "PARTIAL"] } },
        _sum: { total: true },
      }),
      this.prisma.order.count({ where: { paymentStatus: "PAID" } }),
      this.prisma.order.aggregate({
        where: { paymentStatus: "PAID", updatedAt: { gte: start } },
        _sum: { total: true, costTotal: true },
      }),
      this.prisma.order.aggregate({
        where: { paymentStatus: "PAID" },
        _sum: { total: true, costTotal: true },
      }),
      this.prisma.order.aggregate({
        where: { createdAt: { gte: start }, status: { not: "CANCELLED" } },
        _sum: { total: true, costTotal: true },
      }),
      this.prisma.order.count({
        where: { createdAt: { gte: start }, status: { not: "CANCELLED" } },
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
        where: { paymentStatus: { in: ["UNPAID", "PARTIAL"] } },
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
        where: { type: "SALE", createdAt: { gte: start } },
        select: { quantity: true, ratePerUnit: true },
      }),
    ]);

    const mapOrder = (o: (typeof kitchenActive)[0]): DashOrder => {
      const waitMinutes = Math.max(
        0,
        Math.floor((Date.now() - new Date(o.createdAt).getTime()) / 60000)
      );
      return {
        id: o.id,
        orderNo: o.orderNo,
        tableNo: o.tableNo,
        status: o.status,
        paymentStatus: o.paymentStatus,
        total: toNumber(o.total),
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
      };
    };

    const kitchenQueue = kitchenActive.map(mapOrder);
    const newOrders = kitchenQueue.filter((o) => o.status === "PENDING");
    const staleOrders = staleOrdersRaw.map(mapOrder);
    const unpaidOrders = unpaidList.map(mapOrder);

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

    const salesToday = toNumber(ordersTodayAgg._sum.total ?? 0);
    let costToday = toNumber(ordersTodayAgg._sum.costTotal ?? 0);

    // Fallback: stock SALE movements today (qty × rate)
    let stockMoveCostToday = 0;
    for (const m of stockUsedTodayAgg) {
      stockMoveCostToday +=
        Math.abs(toNumber(m.quantity)) * toNumber(m.ratePerUnit);
    }
    if (costToday <= 0 && stockMoveCostToday > 0) {
      costToday = stockMoveCostToday;
    }

    const profitToday = salesToday - costToday;

    const paidRevenueToday = toNumber(revenueTodayAgg._sum.total ?? 0);
    const paidCostToday = toNumber(revenueTodayAgg._sum.costTotal ?? 0);
    const revenueAll = toNumber(revenueAllAgg._sum.total ?? 0);
    const costPaidAll = toNumber(revenueAllAgg._sum.costTotal ?? 0);
    const unpaidAmount = toNumber(unpaidAgg._sum.total ?? 0);

    const emptyOrders: DashOrder[] = [];
    const emptyLow: typeof lowStock = [];
    const emptyUsage: typeof recentUsage = [];

    const common = {
      role,
      staleMinutes: STALE_MINUTES,
      pendingKitchen,
      preparing,
      ready,
      completed,
      totalOrders: totalOrdersAll,
      unpaidCount,
      unpaidAmount,
      paidCount,
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
    };

    if (role === "KITCHEN" || role === "WAITER") {
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
        paidCount: 0,
        unpaidOrders: emptyOrders,
        lowStockCount: 0,
        lowStock: emptyLow,
        stockValue: 0,
        itemCount: 0,
        recentUsage: emptyUsage,
        unpaid: 0,
        paidToday: 0,
      };
    }

    if (role === "STORE") {
      return {
        ...common,
        pendingKitchen: 0,
        preparing: 0,
        ready: 0,
        completed: 0,
        totalOrders: 0,
        unpaidCount: 0,
        unpaidAmount: 0,
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
      };
    }

    if (role === "MANAGER") {
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
        salesToday: 0,
        orderAmountToday: 0,
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
