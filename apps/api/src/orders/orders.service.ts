import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { OrderStatus, PaymentStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CostingService } from "../common/costing.service";
import { toNumber } from "../common/units";
import { AuthUser } from "../common/decorators";
import { PrintService } from "../print/print.service";
import { RealtimeService } from "../realtime/realtime.service";
import { OPEN_ORDER_WHERE } from "../tables/tables.controller";
import { AddItemsDto, CreateOrderDto, OrderLineDto, PayOrderDto, UpdateStatusDto } from "./dto";

const orderInclude = {
  items: { orderBy: { createdAt: "asc" }, include: { addedBy: { select: { name: true } } } },
  cashier: { select: { name: true } },
  waiter: { select: { id: true, name: true } },
  payments: {
    orderBy: { createdAt: "asc" },
    include: { collectedBy: { select: { name: true } }, handedTo: { select: { name: true } } },
  },
} satisfies Prisma.OrderInclude;

type FullOrder = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

type Line = {
  menuItemId: string;
  name: string;
  sellUnit: Prisma.OrderItemCreateWithoutOrderInput["sellUnit"];
  quantity: number;
  ratePerUnit: number;
  amount: number;
  unitCost: number;
  costAmount: number;
  notes?: string;
  recipeId: string | null;
};

const canSeeCost = (u: AuthUser) => u.permissions.includes("reports.view");
// Paid bills are private to whoever took the money (or received it in a handover); only admins see all.
const paidBillsScope = (u: AuthUser): Prisma.OrderWhereInput =>
  u.permissions.includes("payments.view")
    ? {}
    : {
        OR: [
          { paymentStatus: { not: "PAID" } },
          { payments: { some: { OR: [{ collectedById: u.id }, { handedToId: u.id }] } } },
        ],
      };
const seesAllOrders = (u: AuthUser) =>
  ["bill.view", "kitchen.view", "order.pay"].some((p) => u.permissions.includes(p));

@Injectable()
export class OrdersService {
  private readonly log = new Logger("Orders");

  constructor(
    private readonly prisma: PrismaService,
    private readonly costing: CostingService,
    private readonly print: PrintService,
    private readonly realtime: RealtimeService
  ) {}

  async list(user: AuthUser, paymentStatus?: string, status?: string, billing = false) {
    const orders = await this.prisma.order.findMany({
      where: {
        ...(paymentStatus ? { paymentStatus: paymentStatus as PaymentStatus } : {}),
        ...(status ? { status: status as OrderStatus } : {}),
        ...(seesAllOrders(user) ? (billing ? paidBillsScope(user) : {}) : { waiterId: user.id }),
      },
      include: orderInclude,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return orders.map((o) => this.toDto(o, canSeeCost(user)));
  }

  async get(user: AuthUser, id: string) {
    const o = await this.prisma.order.findUnique({ where: { id }, include: orderInclude });
    if (!o) throw new NotFoundException("Order not found");
    return this.toDto(o, canSeeCost(user));
  }

  async create(user: AuthUser, dto: CreateOrderDto) {
    const tableNo = dto.tableNo?.trim() || undefined;
    if (tableNo) {
      const isTable = await this.prisma.restaurantTable.findFirst({ where: { name: tableNo, active: true } });
      const open = isTable
        ? await this.prisma.order.findFirst({ where: { ...OPEN_ORDER_WHERE, tableNo }, orderBy: { createdAt: "desc" } })
        : null;
      if (open) return this.addItems(user, open.id, { items: dto.items, printKot: dto.printKot });
    }

    const { lines, subtotal, costTotal } = await this.buildLines(dto.items);
    // waiterId is whoever took the order (waiter, cashier or manager); cashierId is set when it is paid.
    const order = await this.prisma.order.create({
      data: {
        tableNo,
        notes: dto.notes,
        status: "PENDING",
        paymentStatus: "UNPAID",
        subtotal,
        total: subtotal,
        costTotal,
        waiterId: user.id,
        kotRounds: 1,
        items: { create: lines.map(({ recipeId: _r, ...rest }) => ({ ...rest, kotRound: 1, addedById: user.id })) },
      },
    });

    await this.deductStock(lines, order.orderNo, order.tableNo, order.id);
    if (dto.printKot !== false) await this.queueKot(order.id, 1, user.id);
    const full = await this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: orderInclude });
    this.realtime.orderChanged(this.event(full), "created");
    return this.toDto(full, canSeeCost(user));
  }

  async addItems(user: AuthUser, id: string, dto: AddItemsDto) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException("Order not found");
    if (order.paymentStatus === "PAID") throw new BadRequestException("Bill already paid — start a new order");
    if (order.status === "CANCELLED") throw new BadRequestException("Order is cancelled");

    const round = order.kotRounds + 1;
    const { lines, subtotal, costTotal } = await this.buildLines(dto.items);
    await this.prisma.order.update({
      where: { id },
      data: {
        kotRounds: round,
        subtotal: { increment: subtotal },
        total: { increment: subtotal },
        costTotal: { increment: costTotal },
        billRequestedAt: null,
        status: order.status === "READY" || order.status === "COMPLETED" ? "PENDING" : order.status,
        paymentStatus: toNumber(order.paidAmount) > 0 ? "PARTIAL" : order.paymentStatus,
        ...(order.waiterId ? {} : { waiterId: user.id }),
        items: { create: lines.map(({ recipeId: _r, ...rest }) => ({ ...rest, kotRound: round, addedById: user.id })) },
      },
    });

    await this.deductStock(lines, order.orderNo, order.tableNo, order.id);
    if (dto.printKot !== false) await this.queueKot(id, round, user.id);
    const full = await this.prisma.order.findUniqueOrThrow({ where: { id }, include: orderInclude });
    this.realtime.orderChanged(this.event(full), "items-added");
    return this.toDto(full, canSeeCost(user));
  }

  async requestBill(user: AuthUser, id: string) {
    const o = await this.prisma.order.update({
      where: { id },
      data: { billRequestedAt: new Date() },
      include: orderInclude,
    });
    const ev = { ...this.event(o), waiter: o.waiter?.name ?? null };
    this.realtime.billRequested(ev);
    this.realtime.orderChanged(this.event(o), "bill-requested");
    return this.toDto(o, canSeeCost(user));
  }

  async printKot(user: AuthUser, id: string, round?: number, reprint = true) {
    const jobs = await this.print.enqueueKot(id, { round, reprint, requestedById: user.id });
    return { queued: jobs.length, jobs: jobs.map((j) => ({ id: j.id, status: j.status, error: j.lastError })) };
  }

  kotPreview(id: string, round?: number) {
    return this.print.previewKot(id, round);
  }

  async printBill(user: AuthUser, id: string) {
    const jobs = await this.print.enqueueBill(id, user.id);
    return { queued: jobs.length, jobs: jobs.map((j) => ({ id: j.id, status: j.status, error: j.lastError })) };
  }

  async pay(user: AuthUser, id: string, dto: PayOrderDto) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException("Order not found");
    if (order.paymentStatus === "PAID") throw new BadRequestException("Bill is already paid");
    if (order.status === "CANCELLED") throw new BadRequestException("Order is cancelled");

    const total = toNumber(order.total);
    const due = total - toNumber(order.paidAmount);
    const pay = Math.min(dto.amount ?? due, due);
    if (pay <= 0) throw new BadRequestException("Nothing left to pay");
    const paidAmount = toNumber(order.paidAmount) + pay;
    const paymentStatus: PaymentStatus = paidAmount >= total ? "PAID" : "PARTIAL";

    // Staff without a cash drawer (e.g. the floor manager) must say which cashier received the money.
    let handedTo: { id: string; name: string } | null = null;
    if (!user.permissions.includes("cash.keep")) {
      if (!dto.handedToId) throw new BadRequestException("Select the cashier you handed the cash to");
      handedTo = await this.prisma.user.findFirst({
        where: {
          id: dto.handedToId,
          active: true,
          role: { permissions: { some: { permission: { code: "cash.keep" } } } },
        },
        select: { id: true, name: true },
      });
      if (!handedTo) throw new BadRequestException("That person cannot receive cash");
    }

    const [updated, payment] = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: { orderId: id, amount: pay, collectedById: user.id, handedToId: handedTo?.id ?? null },
      });
      const updated = await tx.order.update({
        where: { id },
        data: {
          paidAmount,
          paymentStatus,
          cashierId: order.cashierId ?? handedTo?.id ?? user.id,
          status: paymentStatus === "PAID" && order.status === "READY" ? "COMPLETED" : order.status,
        },
        include: orderInclude,
      });
      return [updated, payment] as const;
    });

    this.realtime.orderChanged(this.event(updated), "paid");
    this.realtime.paymentsChanged();
    if (handedTo) {
      this.realtime.cashHandover(handedTo.id, {
        id: payment.id,
        amount: pay,
        orderNo: updated.orderNo,
        tableNo: updated.tableNo,
        from: user.name,
      });
    }
    return this.toDto(updated, canSeeCost(user));
  }

  async updateStatus(user: AuthUser, id: string, dto: UpdateStatusDto) {
    const updated = await this.prisma.order.update({
      where: { id },
      data: { status: dto.status },
      include: orderInclude,
    });
    this.realtime.orderChanged(this.event(updated), "status");
    return this.toDto(updated, canSeeCost(user));
  }

  // ---------- helpers ----------

  private async queueKot(orderId: string, round: number, userId: string) {
    try {
      await this.print.enqueueKot(orderId, { round, requestedById: userId });
    } catch (e) {
      this.log.warn(`KOT queue failed for ${orderId}: ${(e as Error).message}`);
    }
  }

  private async buildLines(items: OrderLineDto[]) {
    const lines: Line[] = [];
    let subtotal = 0;
    let costTotal = 0;
    for (const line of items) {
      const menu = await this.prisma.menuItem.findUnique({ where: { id: line.menuItemId } });
      if (!menu || !menu.active) throw new BadRequestException("Menu item not available");
      const rate = toNumber(menu.sellingPrice);
      const amount = rate * line.quantity;
      const unitCost = menu.recipeId ? (await this.costing.recipeUnitCost(menu.recipeId)).costPerBase : 0;
      const costAmount = unitCost * line.quantity;
      subtotal += amount;
      costTotal += costAmount;
      lines.push({
        menuItemId: menu.id,
        name: menu.name,
        sellUnit: menu.sellUnit,
        quantity: line.quantity,
        ratePerUnit: rate,
        amount,
        unitCost,
        costAmount,
        notes: line.notes?.trim() || undefined,
        recipeId: menu.recipeId,
      });
    }
    return { lines, subtotal, costTotal };
  }

  private async deductStock(lines: Line[], orderNo: number, tableNo: string | null, orderId: string) {
    for (const line of lines) {
      if (!line.recipeId) continue;
      await this.costing.deductRecipeStock(
        line.recipeId,
        line.quantity,
        `Order #${orderNo}${tableNo ? ` · Table ${tableNo}` : ""} · auto sale`,
        orderId
      );
    }
  }

  private event(o: FullOrder) {
    return {
      id: o.id,
      orderNo: o.orderNo,
      tableNo: o.tableNo,
      status: o.status,
      paymentStatus: o.paymentStatus,
      waiterId: o.waiterId,
    };
  }

  private toDto(o: FullOrder, showCost: boolean) {
    return {
      id: o.id,
      orderNo: o.orderNo,
      tableNo: o.tableNo,
      notes: o.notes,
      status: o.status,
      paymentStatus: o.paymentStatus,
      subtotal: toNumber(o.subtotal),
      total: toNumber(o.total),
      paidAmount: toNumber(o.paidAmount),
      ...(showCost
        ? { costTotal: toNumber(o.costTotal), profit: toNumber(o.total) - toNumber(o.costTotal) }
        : {}),
      cashier: o.cashier?.name ?? null,
      waiter: o.waiter?.name ?? null,
      waiterId: o.waiterId,
      kotRounds: o.kotRounds,
      billRequestedAt: o.billRequestedAt,
      createdAt: o.createdAt,
      items: o.items.map((i) => ({
        id: i.id,
        name: i.name,
        sellUnit: i.sellUnit,
        quantity: toNumber(i.quantity),
        ratePerUnit: toNumber(i.ratePerUnit),
        amount: toNumber(i.amount),
        notes: i.notes,
        kotRound: i.kotRound,
        addedBy: i.addedBy?.name ?? null,
      })),
      payments: o.payments.map((p) => ({
        id: p.id,
        amount: toNumber(p.amount),
        collectedBy: p.collectedBy.name,
        handedTo: p.handedTo?.name ?? null,
        confirmedAt: p.confirmedAt,
        createdAt: p.createdAt,
      })),
    };
  }
}
