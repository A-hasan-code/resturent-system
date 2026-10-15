import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { OrderStatus, PaymentStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CostingService } from "../common/costing.service";
import { assertMenuQty } from "../common/menu-qty";
import { toNumber } from "../common/units";
import { AuthUser } from "../common/decorators";
import { PrintService } from "../print/print.service";
import { RealtimeService } from "../realtime/realtime.service";
import {
  CLEAR_TABLE_RESERVATION,
  OPEN_ORDER_WHERE,
  canManageReservation,
  tableLabel,
} from "../tables/tables.controller";
import {
  AddItemsDto,
  CancelOrderDto,
  CreateOrderDto,
  EditOrderDto,
  OrderLineDto,
  PayOrderDto,
  PutOnCreditDto,
  UpdateOrderDto,
  UpdateStatusDto,
} from "./dto";
import { TipService } from "../system/tip.service";
import { SettingsService } from "../system/settings.service";
import { SpecialsService } from "../specials/specials.service";
import { FinanceService } from "../finance/finance.service";
import { PaymentMethod } from "@prisma/client";
import { businessQueryRange } from "../common/business-day";
import { itemPrepMinutes, targetPrepMinutes } from "./kitchen-timing";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function parseOrderReservedFor(raw?: string | null): Date | null {
  if (!raw?.trim()) return null;
  const s = raw.trim();
  const d = new Date(s.length === 16 ? `${s}:00` : s);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException("Invalid reservation time");
  }
  return d;
}

const staffSelect = { id: true, name: true, role: { select: { code: true, name: true } } } as const;

/** Reset kitchen clock when a ticket goes back to PENDING. */
const kitchenPendingReset = () => ({
  status: "PENDING" as const,
  pendingAt: new Date(),
  preparingAt: null,
  readyAt: null,
  pendingAlertedAt: null,
  lateAlertedAt: null,
});

const canChargePerHead = (u: AuthUser) =>
  u.roleCode === "SUPERVISOR" ||
  u.roleCode === "ADMIN" ||
  u.roleCode === "MANAGER" || // legacy cached sessions
  u.roleCode === "MAIN_CASHIER" ||
  u.roleCode === "CASHIER" ||
  u.permissions.includes("users.manage");

const orderInclude = {
  items: {
    orderBy: { createdAt: "asc" },
    include: {
      addedBy: { select: { name: true } },
      menuItem: {
        select: {
          category: true,
          kitchenStation: true,
          recipe: { select: { prepMinutes: true } },
        },
      },
    },
  },
  cashier: { select: { name: true } },
  waiter: { select: staffSelect },
  assignedCashier: { select: staffSelect },
  cancelledBy: { select: staffSelect },
  table: { include: { partition: { select: { id: true, name: true } } } },
  tipShares: {
    include: { user: { select: { id: true, name: true } } },
  },
  payments: {
    orderBy: { createdAt: "asc" },
    include: { collectedBy: { select: { name: true } }, handedTo: { select: { name: true } } },
  },
  creditCustomer: { select: { id: true, name: true, phone: true } },
} satisfies Prisma.OrderInclude;

type FullOrder = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

type DealTakes = {
  recipes: { recipeId: string; quantity: number }[];
  specials: { specialProductId: string; grams: number }[];
};

type Line = {
  lineKind: "MENU" | "PER_HEAD";
  menuItemId: string | null;
  name: string;
  sellUnit: Prisma.OrderItemCreateWithoutOrderInput["sellUnit"];
  quantity: number;
  ratePerUnit: number;
  amount: number;
  unitCost: number;
  costAmount: number;
  notes?: string;
  recipeId: string | null;
  batchGrams: number;
  specialProductId: string | null;
  saleMode: "PLATE" | "RS" | "MIX" | "MIX_SOLO_STORE" | null;
  modifiersJson?: { id?: string; name: string; priceDelta: number }[] | null;
  /** MIX multi-part stock snapshot (also persisted on OrderItem.dealTakesJson). */
  dealTakes?: DealTakes | null;
  /** Kitchen station that holds recipe stock for this line. */
  kitchenStation?: string | null;
};

const canSeeCost = (u: AuthUser) => u.permissions.includes("reports.view");
/** Full paid history: payments.view, bill editors (Main Cashier), or Admin. */
const paidBillsScope = (u: AuthUser): Prisma.OrderWhereInput =>
  u.permissions.includes("payments.view") ||
  u.permissions.includes("order.edit") ||
  u.roleCode === "ADMIN" ||
  u.roleCode === "SYSTEM_MANAGER"
    ? {}
    : {
        OR: [
          { paymentStatus: { in: ["UNPAID", "PARTIAL"] } },
          { status: "CANCELLED" },
          { payments: { some: { OR: [{ collectedById: u.id }, { handedToId: u.id }] } } },
        ],
      };
const seesAllOrders = (u: AuthUser) =>
  ["bill.view", "kitchen.view", "order.pay"].some((p) => u.permissions.includes(p));

/** Floor roles: own orders only on general list — kitchen.update staff see the full queue. */
const floorOwnOrdersOnly = (u: AuthUser, billing: boolean) =>
  !billing &&
  (u.roleCode === "SUPERVISOR" || u.roleCode === "WAITER") &&
  !u.permissions.includes("kitchen.update");

const KITCHEN_ACTIVE: OrderStatus[] = ["PENDING", "PREPARING", "READY"];
const KITCHEN_NEXT: Record<string, OrderStatus[]> = {
  PENDING: ["PREPARING", "READY"],
  PREPARING: ["READY"],
  READY: ["SERVED"],
};

@Injectable()
export class OrdersService {
  private readonly log = new Logger("Orders");

  constructor(
    private readonly prisma: PrismaService,
    private readonly costing: CostingService,
    private readonly print: PrintService,
    private readonly realtime: RealtimeService,
    private readonly tips: TipService,
    private readonly settings: SettingsService,
    private readonly specials: SpecialsService,
    private readonly finance: FinanceService
  ) {}

  perHeadConfig() {
    return this.settings.perHead();
  }

  private async assertAcceptingOrders() {
    const gate = await this.settings.hotelStatus();
    if (gate.acceptingOrders) return;
    throw new BadRequestException({
      code: "HOTEL_CLOSED",
      message: gate.manuallyClosed
        ? "Hotel is closed — shift ended. No new orders."
        : "Outside hotel hours. No new orders.",
    });
  }

  async list(
    user: AuthUser,
    paymentStatus?: string,
    status?: string,
    billing = false,
    opts?: { from?: string; to?: string; includeCredit?: boolean }
  ) {
    const cashierScope = this.cashierBillingScope(user, billing);
    const ownOnly = floorOwnOrdersOnly(user, billing);
    const from = opts?.from?.trim();
    const to = opts?.to?.trim();
    if (from && !ISO_DAY.test(from)) throw new BadRequestException("Invalid from date");
    if (to && !ISO_DAY.test(to)) throw new BadRequestException("Invalid to date");

    const hasDate = !!(from || to);
    let range: { gte: Date; lt: Date } | undefined;
    if (hasDate) {
      const day = await this.settings.dayStart();
      const fromDay = from || to!;
      const toDay = to || from!;
      // TZ-padded (same helper as Dashboard / Close / Payments)
      const q = businessQueryRange(fromDay, toDay, day.h, day.m);
      range = { gte: q.gte, lt: q.lt };
    }

    const includeCredit = !!opts?.includeCredit;
    const where: Prisma.OrderWhereInput = {
      ...(paymentStatus ? { paymentStatus: paymentStatus as PaymentStatus } : {}),
      ...(billing && !includeCredit ? { creditCustomerId: null } : {}),
      ...(ownOnly
        ? { waiterId: user.id }
        : seesAllOrders(user)
          ? {
              ...(billing ? paidBillsScope(user) : {}),
              ...cashierScope,
            }
          : { waiterId: user.id }),
    };
    // Unpaid/Paid tabs hide cancelled. Cancelled tab filters by status. All includes everything.
    // Cancelled orders use paymentStatus=VOID so they never match UNPAID/PARTIAL.
    if (status) where.status = status as OrderStatus;
    else if (paymentStatus === "UNPAID" || paymentStatus === "PARTIAL" || paymentStatus === "PAID") {
      where.status = { not: "CANCELLED" };
    }

    /**
     * Business-day history (aligned with Close, TZ-padded for installed servers):
     * - PAID → orders that have a payment in the (padded) window — lookup like Close
     * - CANCELLED → cancelledAt in window (fallback updatedAt)
     * - UNPAID/PARTIAL → order opened that day
     * - ALL → opened, paid, or cancelled that day
     */
    if (range) {
      const wide = range;
      if (paymentStatus === "PAID") {
        // Same source as Close cash: Payment rows, then resolve orders (avoids nested-filter TZ misses).
        const payRows = await this.prisma.payment.findMany({
          where: { createdAt: { gte: wide.gte, lt: wide.lt } },
          select: { orderId: true },
          take: 3000,
        });
        const ids = [...new Set(payRows.map((p) => p.orderId))];
        where.AND = [
          ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
          ids.length
            ? { id: { in: ids } }
            : {
                // Fallback: PAID bills touched in window (legacy rows / clock skew)
                OR: [
                  { payments: { some: { createdAt: { gte: wide.gte, lt: wide.lt } } } },
                  { updatedAt: { gte: wide.gte, lt: wide.lt } },
                ],
              },
        ];
      } else if (status === "CANCELLED") {
        where.AND = [
          ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
          {
            OR: [
              { cancelledAt: { gte: wide.gte, lt: wide.lt } },
              { updatedAt: { gte: wide.gte, lt: wide.lt } },
            ],
          },
        ];
      } else if (paymentStatus === "UNPAID" || paymentStatus === "PARTIAL") {
        where.AND = [
          ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
          { createdAt: { gte: wide.gte, lt: wide.lt } },
        ];
      } else {
        const payRows = await this.prisma.payment.findMany({
          where: { createdAt: { gte: wide.gte, lt: wide.lt } },
          select: { orderId: true },
          take: 3000,
        });
        const paidIds = [...new Set(payRows.map((p) => p.orderId))];
        where.AND = [
          ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
          {
            OR: [
              { createdAt: { gte: wide.gte, lt: wide.lt } },
              { cancelledAt: { gte: wide.gte, lt: wide.lt } },
              ...(paidIds.length ? [{ id: { in: paidIds } }] : []),
              { payments: { some: { createdAt: { gte: wide.gte, lt: wide.lt } } } },
            ],
          },
        ];
      }
    }

    const orders = await this.prisma.order.findMany({
      where,
      include: orderInclude,
      orderBy: { createdAt: "desc" },
      // Dated history needs more than the live queue; unpaid live work stays capped.
      take: hasDate ? 500 : 100,
    });
    return orders.map((o) => this.toDto(o, canSeeCost(user)));
  }

  /** Full kitchen board — table tickets only (takeaway stays with Main Cashier). */
  async listKitchen(user: AuthUser) {
    if (!user.permissions.includes("kitchen.view")) {
      throw new ForbiddenException("Kitchen view required");
    }
    const orders = await this.prisma.order.findMany({
      where: {
        status: { in: KITCHEN_ACTIVE },
        tableId: { not: null },
        kitchenHold: false,
      },
      include: orderInclude,
      orderBy: { createdAt: "asc" },
      take: 500,
    });
    return orders.map((o) => this.toDto(o, false));
  }

  async get(user: AuthUser, id: string) {
    const o = await this.prisma.order.findUnique({ where: { id }, include: orderInclude });
    if (!o) throw new NotFoundException("Order not found");
    return this.toDto(o, canSeeCost(user));
  }

  async create(user: AuthUser, dto: CreateOrderDto) {
    await this.assertAcceptingOrders();
    const table = await this.resolveTable(dto.tableId, dto.tableNo);
    const walkInLabel = !table && dto.tableNo?.trim() ? dto.tableNo.trim() : null;
    if (table) {
      const open = await this.prisma.order.findFirst({
        where: {
          AND: [
            OPEN_ORDER_WHERE,
            { OR: [{ tableId: table.id }, { tableNo: table.label }, { tableNo: table.name }] },
          ],
        },
        include: { waiter: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      });
      if (open) {
        this.assertCanModify(user, open);
        if (dto.creditCustomerId && open.creditCustomerId && dto.creditCustomerId !== open.creditCustomerId) {
          throw new BadRequestException("This table is already on another credit account");
        }
        if (dto.creditCustomerId && !open.creditCustomerId) {
          if (toNumber(open.paidAmount) > 0 || open.paymentStatus === "PARTIAL") {
            throw new BadRequestException("Cannot put a partially paid bill on credit — reverse payment first");
          }
          const customerId = await this.resolveCreditCustomer(user, dto.creditCustomerId);
          await this.prisma.order.update({ where: { id: open.id }, data: { creditCustomerId: customerId } });
        }
        return this.addItems(user, open.id, {
          items: dto.items,
          printKot: dto.printKot,
          servedByName: dto.servedByName,
        });
      }
    }

    const { lines, subtotal, costTotal } = await this.buildLines(user, dto.items);
    await this.ensureStock(lines);
    const isTakeaway = !table;
    const assignedCashierId = await this.resolveAssignedCashier(user, dto.assignedCashierId, {
      preferMainCashier: isTakeaway,
    });
    const creditCustomerId = dto.creditCustomerId
      ? await this.resolveCreditCustomer(user, dto.creditCustomerId)
      : null;
    const servedByName = cleanName(dto.servedByName);
    // Takeaway is counter work for Main Cashier — no kitchen board / KOT.
    const hasKitchen = !isTakeaway && lines.some((l) => l.lineKind === "MENU");
    const now = new Date();

    // Soft table hold → copy guest onto the order, then clear the hold.
    let hold: {
      reservedGuestName: string | null;
      reservedPhone: string | null;
      reservedPartySize: number | null;
      reservedFor: Date | null;
      reservedNotes: string | null;
    } | null = null;
    if (table) {
      hold = await this.prisma.restaurantTable.findUnique({
        where: { id: table.id },
        select: {
          reservedGuestName: true,
          reservedPhone: true,
          reservedPartySize: true,
          reservedFor: true,
          reservedNotes: true,
        },
      });
    }
    const guestName =
      cleanName(dto.guestName) || cleanName(hold?.reservedGuestName) || null;
    const guestPhone =
      (dto.guestPhone?.trim() || hold?.reservedPhone?.trim() || "") || null;
    const partySize = dto.partySize ?? hold?.reservedPartySize ?? null;
    const reservedFor = parseOrderReservedFor(dto.reservedFor) ?? hold?.reservedFor ?? null;
    const noteBits = [dto.notes?.trim(), hold?.reservedNotes?.trim()].filter(Boolean);
    if (guestName && reservedFor) {
      noteBits.unshift(`Reserved for ${guestName}`);
    } else if (guestName && !dto.notes?.trim() && !hold?.reservedNotes?.trim()) {
      noteBits.unshift(`Guest: ${guestName}`);
    }
    const notes = noteBits.length ? noteBits.join(" · ") : dto.notes;

    // Reserved / advance pre-order: kitchen + timers wait until guest is seated.
    const kitchenHold =
      !isTakeaway && (dto.kitchenHold === true || !!hold?.reservedGuestName);

    if (kitchenHold && !canManageReservation(user)) {
      throw new ForbiddenException(
        "Only supervisor, cashier, or admin can place a reserved / advance order",
      );
    }

    const order = await this.prisma.order.create({
      data: {
        tableNo: table?.label ?? walkInLabel ?? undefined,
        tableId: table?.id ?? null,
        notes,
        guestName,
        guestPhone,
        partySize,
        reservedFor,
        kitchenHold,
        status: isTakeaway ? "READY" : "PENDING",
        paymentStatus: "UNPAID",
        subtotal,
        total: subtotal,
        costTotal,
        waiterId: user.id,
        assignedCashierId,
        servedByName,
        creditCustomerId,
        kotRounds: hasKitchen ? 1 : 0,
        ...(isTakeaway ? { readyAt: now, preparingAt: now } : {}),
        items: {
          create: lines.map(({ recipeId: _r, dealTakes, ...rest }) => ({
            lineKind: rest.lineKind,
            ...(rest.menuItemId ? { menuItemId: rest.menuItemId } : {}),
            name: rest.name,
            sellUnit: rest.sellUnit,
            quantity: rest.quantity,
            ratePerUnit: rest.ratePerUnit,
            amount: rest.amount,
            unitCost: rest.unitCost,
            costAmount: rest.costAmount,
            batchGrams: rest.batchGrams,
            specialProductId: rest.specialProductId,
            saleMode: rest.saleMode,
            notes: rest.notes,
            modifiersJson: rest.modifiersJson ?? undefined,
            dealTakesJson: dealTakes ?? undefined,
            kotRound: hasKitchen && rest.lineKind === "MENU" ? 1 : 0,
            addedById: user.id,
          })),
        },
      },
    });

    try {
      await this.deductStock(
        lines.filter((l) => l.lineKind === "MENU"),
        order.orderNo,
        order.tableNo,
        order.id
      );
    } catch (e) {
      await this.rollbackFailedCreate(order.id, order.orderNo);
      throw e;
    }
    if (table && hold?.reservedGuestName) {
      await this.prisma.restaurantTable.update({
        where: { id: table.id },
        data: { ...CLEAR_TABLE_RESERVATION },
      });
    }
    // Held pre-orders: no KOT / kitchen ping until guest arrives (startReserved).
    if (!kitchenHold && dto.printKot !== false && hasKitchen) {
      await this.queueKot(order.id, 1, user.id);
    }
    const full = await this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: orderInclude });
    this.realtime.orderChanged(this.event(full), kitchenHold ? "reservation-hold" : "created");
    return this.toDto(full, canSeeCost(user));
  }

  /** Guest arrived — release kitchen hold, start timers, send KOT. */
  async startReserved(user: AuthUser, id: string) {
    if (!canManageReservation(user)) {
      throw new ForbiddenException("Only supervisor, cashier, or admin can start a reserved order");
    }
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: { select: { lineKind: true, kotRound: true } } },
    });
    if (!order) throw new NotFoundException("Order not found");
    if (order.status === "CANCELLED") throw new BadRequestException("Order is cancelled");
    if (!order.kitchenHold) throw new BadRequestException("This order is already started");
    if (!order.tableId) throw new BadRequestException("Only table orders can be held for a guest");

    const menuRounds = [
      ...new Set(
        order.items
          .filter((i) => i.lineKind === "MENU" && i.kotRound > 0)
          .map((i) => i.kotRound),
      ),
    ].sort((a, b) => a - b);

    const updated = await this.prisma.order.update({
      where: { id },
      data: {
        kitchenHold: false,
        pendingAt: new Date(),
        pendingAlertedAt: null,
        lateAlertedAt: null,
        preparingAt: null,
        readyAt: null,
        status: "PENDING",
      },
      include: orderInclude,
    });

    for (const round of menuRounds) {
      await this.queueKot(id, round, user.id);
    }
    this.realtime.orderChanged(this.event(updated), "created");
    return this.toDto(updated, canSeeCost(user));
  }

  async addItems(user: AuthUser, id: string, dto: AddItemsDto) {
    await this.assertAcceptingOrders();
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { waiter: { select: { id: true, name: true } } },
    });
    if (!order) throw new NotFoundException("Order not found");
    if (order.paymentStatus === "PAID") throw new BadRequestException("Bill already paid — start a new order");
    if (order.status === "CANCELLED") throw new BadRequestException("Order is cancelled");
    if (order.creditCustomerId && order.status === "COMPLETED") {
      throw new BadRequestException("This credit visit is closed. Place a new order for the next sitting");
    }
    this.assertCanModify(user, order);
    if (order.kitchenHold && !canManageReservation(user)) {
      throw new ForbiddenException(
        "Reserved order — wait for supervisor/cashier to start when the guest arrives",
      );
    }
    if (dto.creditCustomerId && order.creditCustomerId && dto.creditCustomerId !== order.creditCustomerId) {
      throw new BadRequestException("This table is already on another credit account");
    }
    if (dto.creditCustomerId && !order.creditCustomerId) {
      if (toNumber(order.paidAmount) > 0 || order.paymentStatus === "PARTIAL") {
        throw new BadRequestException("Cannot put a partially paid bill on credit — reverse payment first");
      }
      const customerId = await this.resolveCreditCustomer(user, dto.creditCustomerId);
      await this.prisma.order.update({ where: { id }, data: { creditCustomerId: customerId } });
    }

    const { lines } = await this.buildLines(user, dto.items);
    const menuLines = lines.filter((l) => l.lineKind === "MENU");
    const perHeadLines = lines.filter((l) => l.lineKind === "PER_HEAD");
    await this.ensureStock(menuLines);
    const servedByName = dto.servedByName !== undefined ? cleanName(dto.servedByName) : undefined;
    const isTakeaway = !order.tableId;
    // First kitchen send on an order that only had per-head: kotRounds was 0 → become 1
    // Takeaway never goes to kitchen — no KOT rounds.
    const nextRound =
      !isTakeaway && menuLines.length ? (order.kotRounds < 1 ? 1 : order.kotRounds + 1) : order.kotRounds;

    if (perHeadLines.length) {
      const addQty = perHeadLines.reduce((s, l) => s + l.quantity, 0);
      const rate = perHeadLines[0]!.ratePerUnit;
      const name = perHeadLines[0]!.name;
      const existing = await this.prisma.orderItem.findFirst({
        where: { orderId: id, lineKind: "PER_HEAD" },
      });
      if (existing) {
        const newQty = toNumber(existing.quantity) + addQty;
        await this.prisma.orderItem.update({
          where: { id: existing.id },
          data: { quantity: newQty, amount: rate * newQty, ratePerUnit: rate, name },
        });
      } else {
        await this.prisma.orderItem.create({
          data: {
            orderId: id,
            lineKind: "PER_HEAD",
            menuItemId: null,
            name,
            sellUnit: "PCS",
            quantity: addQty,
            ratePerUnit: rate,
            amount: rate * addQty,
            kotRound: 0,
            addedById: user.id,
          },
        });
      }
    }

      if (menuLines.length) {
      await this.prisma.orderItem.createMany({
        data: menuLines.map((rest) => ({
          orderId: id,
          lineKind: "MENU" as const,
          menuItemId: rest.menuItemId!,
          name: rest.name,
          sellUnit: rest.sellUnit,
          quantity: rest.quantity,
          ratePerUnit: rest.ratePerUnit,
          amount: rest.amount,
          unitCost: rest.unitCost,
          costAmount: rest.costAmount,
          batchGrams: rest.batchGrams,
          specialProductId: rest.specialProductId,
          saleMode: rest.saleMode,
          notes: rest.notes ?? null,
          modifiersJson: rest.modifiersJson ?? undefined,
          dealTakesJson: rest.dealTakes ?? undefined,
          kotRound: isTakeaway ? 0 : nextRound,
          addedById: user.id,
        })),
      });
    }

    const allItems = await this.prisma.orderItem.findMany({ where: { orderId: id } });
    const sum = allItems.reduce((s, i) => s + toNumber(i.amount), 0);
    const costSum = allItems.reduce((s, i) => s + toNumber(i.costAmount), 0);

    await this.prisma.order.update({
      where: { id },
      data: {
        ...(!isTakeaway && menuLines.length ? { kotRounds: nextRound } : {}),
        subtotal: sum,
        total: sum,
        costTotal: costSum,
        discountAmount: Math.min(toNumber(order.discountAmount), Math.max(0, sum - toNumber(order.paidAmount))),
        billRequestedAt: null,
        // Takeaway stays READY with cashier — never bounce back to kitchen PENDING.
        // Held pre-orders: do not touch kitchen timers until guest is seated.
        ...(isTakeaway
          ? order.status === "READY" || order.status === "SERVED" || order.status === "COMPLETED"
            ? {}
            : { status: "READY" as const, readyAt: new Date(), preparingAt: new Date() }
          : order.kitchenHold
            ? {}
            : order.status === "READY" || order.status === "SERVED" || order.status === "COMPLETED"
              ? kitchenPendingReset()
              : menuLines.length && order.status === "PENDING"
                ? { pendingAt: new Date(), pendingAlertedAt: null }
                : menuLines.length && order.status === "PREPARING"
                  ? { lateAlertedAt: null }
                  : {}),
        paymentStatus: toNumber(order.paidAmount) > 0 ? "PARTIAL" : order.paymentStatus,
        ...(order.waiterId ? {} : { waiterId: user.id }),
        ...(servedByName !== undefined ? { servedByName } : {}),
      },
    });

    try {
      await this.deductStock(menuLines, order.orderNo, order.tableNo, order.id);
    } catch (e) {
      // deductStock already restored any partial takes — drop this round's menu lines only.
      if (menuLines.length) {
        await this.prisma.orderItem.deleteMany({
          where: { orderId: id, kotRound: nextRound, lineKind: "MENU" },
        });
        const left = await this.prisma.orderItem.findMany({ where: { orderId: id } });
        const leftSum = left.reduce((s, i) => s + toNumber(i.amount), 0);
        const leftCost = left.reduce((s, i) => s + toNumber(i.costAmount), 0);
        await this.prisma.order.update({
          where: { id },
          data: {
            kotRounds: order.kotRounds,
            subtotal: leftSum,
            total: leftSum,
            costTotal: leftCost,
            status: order.status,
            paymentStatus: order.paymentStatus,
            billRequestedAt: order.billRequestedAt,
          },
        });
      }
      throw e;
    }
    if (!order.kitchenHold && !isTakeaway && dto.printKot !== false && menuLines.length) {
      await this.queueKot(id, nextRound, user.id);
    }
    const full = await this.prisma.order.findUniqueOrThrow({ where: { id }, include: orderInclude });
    this.realtime.orderChanged(
      this.event(full),
      order.kitchenHold ? "reservation-hold" : "items-added",
    );
    return this.toDto(full, canSeeCost(user));
  }

  /**
   * Main cashier: cancel an unpaid order, restore stock, free the table,
   * and print a CANCELLED kitchen slip so staff stop preparing.
   */
  async cancel(user: AuthUser, id: string, dto: CancelOrderDto) {
    const existing = await this.prisma.order.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Order not found");
    await this.finance.assertNotLocked(existing.createdAt);
    if (!user.permissions.includes("order.edit")) {
      throw new ForbiddenException("Only the Main Cashier can cancel orders");
    }
    const reason = (dto.reason || "").trim();
    if (reason.length < 2) throw new BadRequestException("Enter a cancel reason");
    if (reason.length > 200) throw new BadRequestException("Cancel reason is too long");

    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: { include: { menuItem: { select: { id: true } } } },
      },
    });
    if (!order) throw new NotFoundException("Order not found");
    if (order.status === "CANCELLED") throw new BadRequestException("Order is already cancelled");
    if (order.paymentStatus === "PAID") throw new BadRequestException("Paid bills cannot be cancelled");
    if (toNumber(order.paidAmount) > 0) {
      throw new BadRequestException("Clear partial payment before cancelling");
    }

    await this.restoreStockForOrder(order.id, order.orderNo);

    const updated = await this.prisma.order.update({
      where: { id },
      data: {
        status: "CANCELLED",
        // VOID so unpaid/partial queries never treat this as money due.
        paymentStatus: "VOID",
        billRequestedAt: null,
        cancelReason: reason,
        cancelledAt: new Date(),
        cancelledById: user.id,
      },
      include: orderInclude,
    });

    let printQueued = 0;
    let printError: string | null = null;
    // Takeaway never hits kitchen — skip cancel KOT.
    const hasKitchen = !!order.tableId && order.items.some((i) => i.lineKind !== "PER_HEAD");
    if (hasKitchen) {
      try {
        const jobs = await this.print.enqueueKot(id, {
          cancelled: true,
          cancelReason: reason,
          requestedById: user.id,
        });
        printQueued = jobs.length;
        const failed = jobs.find((j) => j.status === "FAILED" || j.lastError);
        if (failed?.lastError) printError = failed.lastError;
        if (!printQueued) printError = printError || "No kitchen printer received the cancel slip";
      } catch (e) {
        printError = e instanceof Error ? e.message : "Cancel kitchen slip failed";
        this.log.warn(`Cancel KOT for #${order.orderNo} failed: ${printError}`);
      }
    }

    this.realtime.orderChanged(this.event(updated), "cancelled");
    return { ...this.toDto(updated, canSeeCost(user)), printQueued, printError };
  }

  /**
   * Main cashier: reverse a paid (or partially paid) bill — wipe payments/tips,
   * restore stock, mark VOID/CANCELLED. No kitchen cancel slip.
   */
  async reverse(user: AuthUser, id: string, dto: CancelOrderDto) {
    if (!user.permissions.includes("order.edit")) {
      throw new ForbiddenException("Only the Main Cashier can reverse payments");
    }
    const reason = (dto.reason || "").trim();
    if (reason.length < 2) throw new BadRequestException("Enter a reverse reason");
    if (reason.length > 200) throw new BadRequestException("Reverse reason is too long");

    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: true,
        payments: { select: { id: true } },
      },
    });
    if (!order) throw new NotFoundException("Order not found");
    await this.finance.assertNotLocked(order.createdAt);
    if (order.status === "CANCELLED" || order.paymentStatus === "VOID") {
      throw new BadRequestException("Order is already cancelled");
    }
    if (order.paymentStatus !== "PAID" && toNumber(order.paidAmount) <= 0 && toNumber(order.tipAmount) <= 0) {
      throw new BadRequestException("Nothing to reverse — bill has no payment");
    }

    await this.restoreStockForOrder(order.id, order.orderNo);

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.deleteMany({ where: { orderId: id } });
      await tx.tipShare.deleteMany({ where: { orderId: id } });
      await tx.order.update({
        where: { id },
        data: {
          status: "CANCELLED",
          paymentStatus: "VOID",
          paidAmount: 0,
          tenderedAmount: 0,
          tipAmount: 0,
          billRequestedAt: null,
          cancelReason: reason,
          cancelledAt: new Date(),
          cancelledById: user.id,
        },
      });
    });

    const updated = await this.prisma.order.findUniqueOrThrow({
      where: { id },
      include: orderInclude,
    });

    this.realtime.orderChanged(this.event(updated), "reversed");
    this.realtime.paymentsChanged();
    return this.toDto(updated, canSeeCost(user));
  }

  /** Reprint CANCELLED kitchen slip for an already-cancelled order. */
  async printCancelKot(user: AuthUser, id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!order) throw new NotFoundException("Order not found");
    if (order.status !== "CANCELLED") {
      throw new BadRequestException("Only cancelled orders can print a cancel kitchen slip");
    }
    if (!order.tableId) {
      throw new BadRequestException("Takeaway orders have no kitchen slip");
    }
    const hasKitchen = order.items.some((i) => i.lineKind !== "PER_HEAD");
    if (!hasKitchen) throw new BadRequestException("No kitchen items on this order");
    const jobs = await this.print.enqueueKot(id, {
      cancelled: true,
      cancelReason: order.cancelReason,
      requestedById: user.id,
    });
    return {
      queued: jobs.length,
      jobs: jobs.map((j) => ({ id: j.id, status: j.status, error: j.lastError })),
    };
  }

  /**
   * Main cashier: change quantities (0 = remove).
   * Unpaid / partial bills only — paid bills cannot be edited.
   */
  async editItems(user: AuthUser, id: string, dto: EditOrderDto) {
    if (!user.permissions.includes("order.edit")) {
      throw new ForbiddenException("Only the Main Cashier can edit order items");
    }
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true, payments: { orderBy: { createdAt: "desc" } } },
    });
    if (!order) throw new NotFoundException("Order not found");
    await this.finance.assertNotLocked(order.createdAt);
    if (order.status === "CANCELLED") throw new BadRequestException("Order is cancelled");
    if (order.paymentStatus === "PAID") {
      throw new BadRequestException("Paid bills cannot be edited");
    }
    if (order.creditCustomerId && order.status === "COMPLETED") {
      throw new BadRequestException("This credit visit is closed. Place a new order for the next sitting");
    }

    if (!(dto.items?.length) && !(dto.addItems?.length)) {
      throw new BadRequestException("Nothing to edit");
    }

    const growing =
      (dto.addItems?.length ?? 0) > 0 ||
      (dto.items ?? []).some((change) => {
        const line = order.items.find((i) => i.id === change.id);
        return !!line && change.quantity > toNumber(line.quantity) + 0.0001;
      });
    if (growing) await this.assertAcceptingOrders();

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const beforeTotal = toNumber(order.total);
    const beforeDiscount = toNumber(order.discountAmount);
    const beforePaidAmount = toNumber(order.paidAmount);

    let subDelta = 0;
    let costDelta = 0;
    const increases: { menuItemId: string; quantity: number; name: string }[] = [];
    const addLines = dto.addItems ?? [];

    for (const change of dto.items) {
      const line = order.items.find((i) => i.id === change.id);
      if (!line?.menuItemId) continue;
      const qtyDiff = Math.max(0, change.quantity) - toNumber(line.quantity);
      if (qtyDiff > 0) increases.push({ menuItemId: line.menuItemId, quantity: qtyDiff, name: line.name });
    }
    for (const add of addLines) {
      increases.push({ menuItemId: add.menuItemId, quantity: add.quantity, name: add.menuItemId });
    }

    const billMeta = await this.resolveBillEdit(order, dto);

    if (increases.length) {
      const menus = await this.prisma.menuItem.findMany({
        where: { id: { in: [...new Set(increases.map((i) => i.menuItemId))] } },
        select: {
          id: true,
          recipeId: true,
          name: true,
          kind: true,
          specialProductId: true,
          mixSpecialPlates: true,
          dealParts: { select: { kind: true, recipeId: true, quantity: true } },
        },
      });
      const byId = new Map(menus.map((m) => [m.id, m]));
      await this.ensureStock(
        increases.flatMap((i) => {
          const menu = byId.get(i.menuItemId);
          const name = menu?.name ?? i.name;
          if (!menu) return [];
          if (menu.kind === "MIX") {
            const storeParts = menu.dealParts.filter((p) => p.kind === "STORE" && p.recipeId);
            if (storeParts.length) {
              return storeParts.map((p) => ({
                recipeId: p.recipeId!,
                quantity: i.quantity * (toNumber(p.quantity) || 1),
                name,
              }));
            }
          }
          return menu.recipeId
            ? [{ recipeId: menu.recipeId, quantity: i.quantity, name }]
            : [];
        })
      );
    }

    const trackStock = await this.settings.enforceRecipeStock();
    for (const change of dto.items) {
      const line = order.items.find((i) => i.id === change.id);
      if (!line) throw new BadRequestException(`Item not found: ${change.id}`);
      const oldQty = toNumber(line.quantity);
      const newQty = Math.max(0, change.quantity);
      if (newQty === oldQty) continue;
      if (newQty > 0 && line.menuItemId) {
        const menuRules = await this.prisma.menuItem.findUnique({ where: { id: line.menuItemId } });
        if (menuRules) assertMenuQty(menuRules, newQty);
      }
      const rate = toNumber(line.ratePerUnit);
      const unitCost = toNumber(line.unitCost);
      const qtyDiff = newQty - oldQty;
      subDelta += rate * qtyDiff;
      costDelta += unitCost * qtyDiff;

      if (trackStock && line.menuItemId && qtyDiff > 0) {
        const menu = await this.prisma.menuItem.findUnique({ where: { id: line.menuItemId } });
        if (menu?.recipeId) {
          await this.costing.deductRecipeStock(
            menu.recipeId,
            qtyDiff,
            `Order #${order.orderNo} · edit add`,
            order.id,
            "SALE",
            menu.kitchenStation || "COOKING"
          );
        }
      }
      if (trackStock && line.menuItemId && qtyDiff < 0) {
        const menu = await this.prisma.menuItem.findUnique({ where: { id: line.menuItemId } });
        if (menu?.recipeId) {
          await this.costing.restoreRecipeStock(
            menu.recipeId,
            -qtyDiff,
            `Order #${order.orderNo} · edit remove`,
            order.id,
            menu.kitchenStation || "COOKING"
          );
        }
      }

      const oldGrams = toNumber(line.batchGrams);
      let nextBatchGrams = oldGrams;
      if (trackStock && line.specialProductId && oldQty > 0 && oldGrams > 0 && qtyDiff !== 0) {
        if (qtyDiff > 0) {
          const addGrams = (oldGrams / oldQty) * qtyDiff;
          await this.specials.assertAndTake(line.specialProductId, addGrams);
          nextBatchGrams = oldGrams + addGrams;
        } else {
          const remGrams = newQty <= 0 ? oldGrams : (oldGrams / oldQty) * -qtyDiff;
          await this.specials.restoreGrams(line.specialProductId, remGrams);
          nextBatchGrams = newQty <= 0 ? 0 : Math.max(0, oldGrams - remGrams);
        }
      }

      if (newQty <= 0) {
        await this.prisma.orderItem.delete({ where: { id: line.id } });
      } else {
        await this.prisma.orderItem.update({
          where: { id: line.id },
          data: {
            quantity: newQty,
            amount: rate * newQty,
            costAmount: unitCost * newQty,
            batchGrams: nextBatchGrams,
          },
        });
      }
    }

    if (addLines.length) {
      const built = await this.buildLines(
        user,
        addLines.map((a) => ({
          menuItemId: a.menuItemId,
          quantity: a.quantity,
          notes: a.notes,
          saleMode: a.saleMode,
          amountRs: a.amountRs,
          soloStoreFallback: a.soloStoreFallback,
        }))
      );
      await this.ensureStock(built.lines);
      for (const line of built.lines) {
        await this.prisma.orderItem.create({
          data: {
            orderId: id,
            lineKind: line.lineKind,
            menuItemId: line.menuItemId,
            name: line.name,
            sellUnit: line.sellUnit,
            quantity: line.quantity,
            ratePerUnit: line.ratePerUnit,
            amount: line.amount,
            unitCost: line.unitCost,
            costAmount: line.costAmount,
            batchGrams: line.batchGrams,
            specialProductId: line.specialProductId,
            saleMode: line.saleMode,
            notes: line.notes,
            modifiersJson: line.modifiersJson ?? undefined,
            dealTakesJson: line.dealTakes ?? undefined,
            kotRound: order.kotRounds,
            addedById: user.id,
          },
        });
        if (trackStock) {
          const editTakes = this.lineStoreTakes(line);
          for (const t of editTakes) {
            await this.costing.deductRecipeStock(
              t.recipeId,
              t.quantity,
              `Order #${order.orderNo} · edit new item`,
              order.id,
              "SALE",
              t.station
            );
          }
          for (const s of this.lineSpecialTakes(line)) {
            await this.specials.assertAndTake(s.specialProductId, s.grams);
          }
        }
        subDelta += line.amount;
        costDelta += line.costAmount;
      }
    }

    const remaining = await this.prisma.orderItem.count({ where: { orderId: id } });
    if (!remaining) throw new BadRequestException("Order must keep at least one item — cancel instead");

    const nextTotal = Math.max(0, round2(beforeTotal + subDelta));
    let nextPaid = beforePaidAmount;
    let nextDiscount = Math.min(beforeDiscount, Math.max(0, nextTotal));
    let nextPaymentStatus: PaymentStatus = order.paymentStatus;

    if (beforePaidAmount > 0) {
      // Keep discount within remaining due headroom after payment.
      nextDiscount = Math.min(beforeDiscount, Math.max(0, round2(nextTotal)));
      const nextNet = Math.max(0, round2(nextTotal - nextDiscount));
      if (nextNet < nextPaid - 0.001) {
        let refund = round2(nextPaid - nextNet);
        for (const pay of order.payments) {
          if (refund <= 0) break;
          const amt = toNumber(pay.amount);
          if (amt <= 0) continue;
          const cut = Math.min(amt, refund);
          const newAmt = round2(amt - cut);
          await this.prisma.payment.update({
            where: { id: pay.id },
            data: {
              amount: newAmt,
              tenderedAmount: Math.min(toNumber(pay.tenderedAmount), newAmt + toNumber(pay.tipAmount)),
            },
          });
          refund = round2(refund - cut);
        }
        nextPaid = nextNet;
      }
      nextPaymentStatus =
        nextPaid + 0.001 >= nextNet ? "PAID" : nextPaid > 0 ? "PARTIAL" : "UNPAID";
    } else {
      nextDiscount = Math.min(beforeDiscount, Math.max(0, nextTotal - beforePaidAmount));
    }

    const isTakeaway = !order.tableId;
    const updated = await this.prisma.order.update({
      where: { id },
      data: {
        subtotal: { increment: subDelta },
        total: nextTotal,
        costTotal: { increment: costDelta },
        discountAmount: nextDiscount,
        paidAmount: nextPaid,
        paymentStatus: nextPaymentStatus,
        // Takeaway stays with cashier (READY) — never bounce back to kitchen PENDING.
        ...(isTakeaway
          ? growing && order.status !== "READY" && order.status !== "SERVED" && order.status !== "COMPLETED"
            ? { status: "READY" as const, readyAt: order.readyAt ?? new Date() }
            : {}
          : growing &&
              (order.status === "READY" || order.status === "SERVED" || order.status === "COMPLETED")
            ? kitchenPendingReset()
            : {}),
        ...billMeta,
      },
      include: orderInclude,
    });

    this.realtime.orderChanged(this.event(updated), "edited");
    // Qty-down / remove: reprint cancel-style KOT so kitchen stops wrong lines (tables only).
    const shrunkKitchen = (dto.items ?? []).some((change) => {
      const line = order.items.find((i) => i.id === change.id);
      return !!line?.menuItemId && change.quantity + 0.0001 < toNumber(line.quantity);
    });
    if (!isTakeaway && shrunkKitchen) {
      void this.print.enqueueKot(id, {
        cancelled: true,
        cancelReason: "Bill edited — check quantities",
        requestedById: user.id,
      });
    } else if (!isTakeaway && growing) {
      void this.print.enqueueKot(id, { reprint: true, requestedById: user.id });
    }
    return this.toDto(updated, canSeeCost(user));
  }

  async requestBill(user: AuthUser, id: string) {
    const existing = await this.prisma.order.findUnique({
      where: { id },
      include: {
        waiter: { select: { id: true, name: true } },
        assignedCashier: { select: { id: true, name: true } },
      },
    });
    if (!existing) throw new NotFoundException("Order not found");
    this.assertCanModify(user, existing, true);
    if (existing.paymentStatus === "PAID") throw new BadRequestException("Bill is already paid");
    if (existing.status === "CANCELLED" || existing.paymentStatus === "VOID") {
      throw new BadRequestException("Cancelled orders cannot request a bill");
    }
    if (existing.creditCustomerId) {
      throw new BadRequestException("Credit bills are cleared from Credit Customers, not Billing");
    }
    if (!existing.assignedCashierId) {
      throw new BadRequestException("Assign a cashier first, then request the bill");
    }
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
    const order = await this.prisma.order.findUnique({ where: { id }, select: { tableId: true } });
    if (!order) throw new NotFoundException("Order not found");
    if (!order.tableId) {
      throw new BadRequestException("Takeaway orders have no kitchen slip");
    }
    const jobs = await this.print.enqueueKot(id, { round, reprint, requestedById: user.id });
    return { queued: jobs.length, jobs: jobs.map((j) => ({ id: j.id, status: j.status, error: j.lastError })) };
  }

  kotPreview(id: string, round?: number) {
    return this.print.previewKot(id, round);
  }

  billPreview(id: string) {
    return this.print.previewBill(id);
  }

  async printBill(user: AuthUser, id: string) {
    const jobs = await this.print.enqueueBill(id, user.id);
    return { queued: jobs.length, jobs: jobs.map((j) => ({ id: j.id, status: j.status, error: j.lastError })) };
  }

  async pay(user: AuthUser, id: string, dto: PayOrderDto) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException("Order not found");
    await this.finance.assertNotLocked(order.createdAt);
    if (order.status === "CANCELLED" || order.paymentStatus === "VOID") {
      throw new BadRequestException("Cancelled orders cannot be paid");
    }
    if (order.paymentStatus === "PAID") throw new BadRequestException("Bill is already paid");
    if (order.creditCustomerId) {
      throw new BadRequestException("This bill is on a credit account. Clear it from Credit Customers");
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const method = (dto.method || "CASH") as PaymentMethod;
    const taxCfg = await this.finance.taxSettings();
    const gross = toNumber(order.total);
    const prevPaid = toNumber(order.paidAmount);
    const maxDiscount = Math.max(0, round2(gross - Math.max(0, prevPaid - toNumber(order.taxAmount))));
    const discount =
      dto.discount !== undefined
        ? Math.min(maxDiscount, Math.max(0, round2(dto.discount)))
        : Math.min(maxDiscount, Math.max(0, round2(toNumber(order.discountAmount))));
    const { taxAmount, taxPercent, dueBase } = this.finance.computeTax(gross, discount, taxCfg.percent);
    const due = Math.max(0, round2(dueBase - prevPaid));
    const tendered = Math.max(0, round2(dto.amount ?? due));
    const tip = Math.max(0, round2(dto.tip ?? 0));
    const pay = Math.min(tendered, due);

    if (due > 0 && pay <= 0 && tip <= 0) throw new BadRequestException("Enter the amount received");
    if (pay <= 0 && tip > 0 && due > 0) throw new BadRequestException("Pay the bill before collecting tip only");

    const paidAmount = round2(prevPaid + pay);
    const fullyPaid = paidAmount + 0.001 >= dueBase || due <= 0;
    const paymentStatus: PaymentStatus = fullyPaid ? "PAID" : pay > 0 ? "PARTIAL" : order.paymentStatus;
    const tipAmount = round2(toNumber(order.tipAmount) + tip);
    const tenderedAmount = round2(toNumber(order.tenderedAmount) + tendered);

    let servedByName = order.servedByName;
    if (dto.servedByName !== undefined) {
      servedByName = cleanName(dto.servedByName);
    }

    let handedTo: { id: string; name: string } | null = null;
    const needsCashHandover =
      method === "CASH" && !user.permissions.includes("cash.keep") && (pay > 0 || tip > 0);
    if (needsCashHandover) {
      if (!dto.handedToId) throw new BadRequestException("Select the cashier you handed the cash to");
      handedTo = await this.prisma.user.findFirst({
        where: {
          id: dto.handedToId,
          active: true,
          deletedAt: null,
          role: { permissions: { some: { permission: { code: "cash.keep" } } } },
        },
        select: { id: true, name: true },
      });
      if (!handedTo) throw new BadRequestException("That person cannot receive cash");
    }

    const [updated, payment] = await this.prisma.$transaction(async (tx) => {
      const payment =
        pay > 0 || tip > 0
          ? await tx.payment.create({
              data: {
                orderId: id,
                amount: pay,
                tenderedAmount: method === "CASH" ? tendered : pay,
                tipAmount: tip,
                method,
                collectedById: user.id,
                handedToId: handedTo?.id ?? null,
                confirmedAt: method !== "CASH" || !handedTo ? new Date() : null,
              },
            })
          : null;
      const updated = await tx.order.update({
        where: { id },
        data: {
          discountAmount: discount,
          taxAmount,
          taxPercent,
          paidAmount,
          tenderedAmount,
          tipAmount,
          paymentStatus,
          servedByName,
          cashierId: order.cashierId ?? handedTo?.id ?? user.id,
          status:
            fullyPaid &&
            (!order.tableId || order.status === "READY" || order.status === "SERVED")
              ? "COMPLETED"
              : order.status,
        },
        include: orderInclude,
      });
      if (tip > 0) {
        await this.tips.allocate(tx, {
          orderId: id,
          tip: tipAmount,
          orderTakerId: updated.waiterId,
        });
      }
      return [updated, payment] as const;
    });

    this.realtime.orderChanged(this.event(updated), "paid");
    this.realtime.paymentsChanged();
    if (handedTo && payment) {
      this.realtime.cashHandover(handedTo.id, {
        id: payment.id,
        amount: pay + tip,
        orderNo: updated.orderNo,
        tableNo: updated.tableNo,
        from: user.name,
      });
    }
    return this.toDto(updated, canSeeCost(user));
  }

  /**
   * Move an open credit invoice to another credit person (wrong account selected).
   * Allowed while unpaid/partial and the business day is unlocked.
   */
  async reassignCredit(user: AuthUser, id: string, creditCustomerId: string) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException("Order not found");
    await this.finance.assertNotLocked(order.createdAt);
    if (order.status === "CANCELLED" || order.paymentStatus === "VOID") {
      throw new BadRequestException("Cancelled orders cannot change credit person");
    }
    if (!order.creditCustomerId) {
      throw new BadRequestException("This bill is not on credit — use put on credit first");
    }
    if (order.paymentStatus === "PAID") {
      throw new BadRequestException("Fully paid credit bills cannot change person");
    }
    if (order.creditCustomerId === creditCustomerId) {
      return this.get(user, id);
    }
    const customerId = await this.resolveCreditCustomer(user, creditCustomerId);
    const updated = await this.prisma.order.update({
      where: { id },
      data: { creditCustomerId: customerId },
      include: orderInclude,
    });
    this.realtime.orderChanged(this.event(updated), "credit");
    return this.toDto(updated, canSeeCost(user));
  }

  /** Attach an unpaid table or takeaway bill to a credit customer — no cash now; settle later from Credit Customers. */
  async putOnCredit(user: AuthUser, id: string, dto: PutOnCreditDto) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException("Order not found");
    await this.finance.assertNotLocked(order.createdAt);
    if (order.status === "CANCELLED" || order.paymentStatus === "VOID") {
      throw new BadRequestException("Cancelled orders cannot go on credit");
    }
    if (order.paymentStatus === "PAID") throw new BadRequestException("Bill is already paid");
    if (order.creditCustomerId) {
      throw new BadRequestException("This bill is already on a credit account");
    }
    if (toNumber(order.paidAmount) > 0 || order.paymentStatus === "PARTIAL") {
      throw new BadRequestException("Cannot put a partially paid bill on credit — reverse payment first");
    }

    const customerId = await this.resolveCreditCustomer(user, dto.creditCustomerId);
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const taxCfg = await this.finance.taxSettings();
    const gross = toNumber(order.total);
    const maxDiscount = Math.max(0, round2(gross));
    const discount =
      dto.discount !== undefined
        ? Math.min(maxDiscount, Math.max(0, round2(dto.discount)))
        : Math.min(maxDiscount, Math.max(0, round2(toNumber(order.discountAmount))));
    const { taxAmount, taxPercent } = this.finance.computeTax(gross, discount, taxCfg.percent);

    let servedByName = order.servedByName;
    if (dto.servedByName !== undefined) {
      servedByName = cleanName(dto.servedByName);
    }

    const releaseTable = !!dto.releaseTable;
    // Takeaway has no kitchen step — cashier may close anytime. Tables still need READY/SERVED.
    if (releaseTable && order.tableId && order.status !== "READY" && order.status !== "SERVED") {
      throw new BadRequestException(
        "Wait until kitchen marks Ready (or Served) before freeing the table for the next guest"
      );
    }

    const updated = await this.prisma.order.update({
      where: { id },
      data: {
        creditCustomerId: customerId,
        discountAmount: discount,
        taxAmount,
        taxPercent,
        servedByName,
        ...(releaseTable ? { status: "COMPLETED" as const } : {}),
      },
      include: orderInclude,
    });
    this.realtime.orderChanged(this.event(updated), releaseTable ? "status" : "credit");
    return this.toDto(updated, canSeeCost(user));
  }

  /** Guest has left. The table frees; the invoice stays on the credit account until they pay. */
  async releaseCredit(user: AuthUser, id: string) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: orderInclude });
    if (!order) throw new NotFoundException("Order not found");
    if (!order.creditCustomerId) throw new BadRequestException("This order is not on credit");
    if (order.status === "CANCELLED") throw new BadRequestException("Order is cancelled");
    if (order.status === "COMPLETED" || order.paymentStatus === "PAID") {
      return this.toDto(order, canSeeCost(user));
    }
    await this.finance.assertNotLocked(order.createdAt);
    // Tables: wait for kitchen. Takeaway is cashier counter — close anytime.
    if (order.tableId && order.status !== "READY" && order.status !== "SERVED") {
      throw new BadRequestException(
        "Wait until kitchen marks Ready (or Served) before freeing the table for the next guest"
      );
    }
    const updated = await this.prisma.order.update({
      where: { id },
      data: { status: "COMPLETED" },
      include: orderInclude,
    });
    this.realtime.orderChanged(this.event(updated), "status");
    return this.toDto(updated, canSeeCost(user));
  }

  async updateMeta(user: AuthUser, id: string, dto: UpdateOrderDto) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { waiter: { select: { id: true, name: true } } },
    });
    if (!order) throw new NotFoundException("Order not found");
    if (order.paymentStatus === "PAID") throw new BadRequestException("Bill already paid");
    this.assertCanModify(user, order, true);
    const servedByName =
      dto.servedByName === null
        ? null
        : dto.servedByName !== undefined
          ? cleanName(dto.servedByName)
          : undefined;
    const updated = await this.prisma.order.update({
      where: { id },
      data: { ...(servedByName !== undefined ? { servedByName } : {}) },
      include: orderInclude,
    });
    this.realtime.orderChanged(this.event(updated), "updated");
    return this.toDto(updated, canSeeCost(user));
  }

  async updateStatus(user: AuthUser, id: string, dto: UpdateStatusDto) {
    if (!user.permissions.includes("kitchen.update")) {
      throw new ForbiddenException("Kitchen update required");
    }
    const existing = await this.prisma.order.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Order not found");
    if (existing.status === "CANCELLED") {
      throw new BadRequestException("Order is cancelled");
    }
    if (existing.kitchenHold) {
      throw new BadRequestException("Guest not seated yet — supervisor/cashier must start this order first");
    }

    const allowed = KITCHEN_NEXT[existing.status] ?? [];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Kitchen cannot set ${dto.status} from ${existing.status}. Use cancel/pay flows for those.`
      );
    }

    // Already paid: still allow kitchen flow; SERVED closes the ticket as COMPLETED.
    const nextStatus: OrderStatus =
      dto.status === "SERVED" && existing.paymentStatus === "PAID" ? "COMPLETED" : dto.status;

    const now = new Date();
    const timing: Prisma.OrderUpdateInput = { status: nextStatus };
    if (nextStatus === "PREPARING") {
      timing.preparingAt = existing.preparingAt ?? now;
      timing.lateAlertedAt = null;
    } else if (nextStatus === "READY") {
      // PENDING → READY skip: still stamp prep start so late math stays valid.
      timing.preparingAt = existing.preparingAt ?? now;
      timing.readyAt = now;
    } else if (nextStatus === "SERVED" || nextStatus === "COMPLETED") {
      if (!existing.readyAt) timing.readyAt = now;
    }

    const updated = await this.prisma.order.update({
      where: { id },
      data: timing,
      include: orderInclude,
    });
    this.realtime.orderChanged(this.event(updated), "status");
    return this.toDto(updated, canSeeCost(user));
  }

  // ---------- helpers ----------

  /** Regular cashiers only see bills assigned to them; Main Cashier (order.edit) sees all. */
  private cashierBillingScope(user: AuthUser, billing: boolean): Prisma.OrderWhereInput {
    if (!billing) return {};
    if (user.permissions.includes("payments.view") || user.permissions.includes("order.edit")) return {};
    if (!user.permissions.includes("order.pay")) return {};
    return {
      OR: [{ assignedCashierId: user.id }, { assignedCashierId: null }, { waiterId: user.id }, { cashierId: user.id }],
    };
  }

  private assertCanModify(
    user: AuthUser,
    order: { waiterId: string | null; waiter?: { id: string; name: string } | null },
    allowBillRequest = false
  ) {
    if (user.permissions.includes("users.manage") || user.permissions.includes("order.edit")) return;
    if (!order.waiterId || order.waiterId === user.id) return;
    // Floor staff with bill.request may ping the assigned cashier on any open table.
    if (allowBillRequest && user.permissions.includes("bill.request")) return;
    const who = order.waiter?.name ?? "another staff member";
    throw new BadRequestException(`Table already booked by ${who}`);
  }

  private async resolveTable(tableId?: string, tableNo?: string) {
    if (tableId) {
      const t = await this.prisma.restaurantTable.findFirst({
        where: { id: tableId, active: true },
        include: { partition: { select: { name: true } } },
      });
      if (!t) throw new BadRequestException("Table not found");
      return { id: t.id, name: t.name, label: tableLabel(t.partition.name, t.name) };
    }
    const raw = tableNo?.trim();
    if (!raw) return null;
    // Match "Hall · T-1" or plain "T-1"
    const parts = raw.split("·").map((s) => s.trim());
    if (parts.length === 2) {
      const t = await this.prisma.restaurantTable.findFirst({
        where: {
          active: true,
          name: parts[1],
          partition: { name: parts[0], active: true },
        },
        include: { partition: { select: { name: true } } },
      });
      if (t) return { id: t.id, name: t.name, label: tableLabel(t.partition.name, t.name) };
    }
    const matches = await this.prisma.restaurantTable.findMany({
      where: { active: true, name: raw },
      include: { partition: { select: { name: true } } },
      take: 2,
    });
    if (matches.length === 1) {
      const t = matches[0];
      return { id: t.id, name: t.name, label: tableLabel(t.partition.name, t.name) };
    }
    // Walk-in / free-text label (no restaurant table row)
    return null;
  }

  private async resolveBillEdit(
    order: { id: string; tableId: string | null; assignedCashierId: string | null; waiterId: string | null },
    dto: EditOrderDto
  ) {
    const data: Prisma.OrderUpdateInput = {};
    if (dto.tableId && dto.tableId !== order.tableId) {
      const table = await this.prisma.restaurantTable.findFirst({
        where: { id: dto.tableId, active: true },
        include: { partition: { select: { name: true } } },
      });
      if (!table) throw new BadRequestException("Table not found");
      const label = tableLabel(table.partition.name, table.name);
      const occupied = await this.prisma.order.findFirst({
        where: {
          id: { not: order.id },
          AND: [OPEN_ORDER_WHERE, { OR: [{ tableId: table.id }, { tableNo: label }, { tableNo: table.name }] }],
        },
        select: { id: true },
      });
      if (occupied) throw new BadRequestException("That table already has an open bill");
      data.table = { connect: { id: table.id } };
      data.tableNo = label;
    }
    if (dto.assignedCashierId && dto.assignedCashierId !== order.assignedCashierId) {
      const cashier = await this.prisma.user.findFirst({
        where: {
          id: dto.assignedCashierId,
          active: true,
          deletedAt: null,
          role: { code: { in: ["MAIN_CASHIER", "CASHIER"] } },
        },
        select: { id: true },
      });
      if (!cashier) throw new BadRequestException("Select Main Cashier or Cashier for this bill");
      data.assignedCashier = { connect: { id: cashier.id } };
    }
    if (dto.waiterId && dto.waiterId !== order.waiterId) {
      const supervisor = await this.prisma.user.findFirst({
        where: { id: dto.waiterId, active: true, deletedAt: null, role: { code: "SUPERVISOR" } },
        select: { id: true },
      });
      if (!supervisor) throw new BadRequestException("Select a supervisor");
      data.waiter = { connect: { id: supervisor.id } };
    }
    if (dto.servedByName !== undefined) data.servedByName = cleanName(dto.servedByName);
    return data;
  }

  private async resolveAssignedCashier(
    user: AuthUser,
    assignedCashierId?: string,
    opts?: { preferMainCashier?: boolean }
  ) {
    if (assignedCashierId) {
      const c = await this.prisma.user.findFirst({
        where: {
          id: assignedCashierId,
          active: true,
          deletedAt: null,
          role: { code: { in: ["MAIN_CASHIER", "CASHIER"] } },
        },
        select: { id: true },
      });
      if (!c) throw new BadRequestException("Select Main Cashier or Cashier for this bill");
      return c.id;
    }
    // Cashier placing their own order → assign to self
    if (user.permissions.includes("cash.keep") && user.permissions.includes("order.pay")) {
      return user.id;
    }
    // Takeaway → Main Cashier counter (not kitchen)
    if (opts?.preferMainCashier) {
      const main = await this.prisma.user.findFirst({
        where: { active: true, deletedAt: null, role: { code: "MAIN_CASHIER" } },
        select: { id: true },
        orderBy: { name: "asc" },
      });
      if (main) return main.id;
    }
    // Supervisor / floor: require explicit pick
    if (user.permissions.includes("order.create") && !user.permissions.includes("order.pay")) {
      throw new BadRequestException("Select which cashier will take this bill");
    }
    return null;
  }

  private staffDto(u: { id: string; name: string; role: { code: string; name: string } } | null | undefined) {
    if (!u) return null;
    return { id: u.id, name: u.name, roleCode: u.role.code, roleName: u.role.name };
  }

  private staffLabel(u: { name: string; role: { name: string } } | null | undefined) {
    if (!u) return null;
    return `${u.name} (${u.role.name})`;
  }

  private async queueKot(orderId: string, round: number, userId: string) {
    try {
      await this.print.enqueueKot(orderId, { round, requestedById: userId });
    } catch (e) {
      this.log.warn(`KOT queue failed for ${orderId}: ${(e as Error).message}`);
    }
  }

  /**
   * Soft recipe cost for billing lines. Never throws — missing/inactive recipe or
   * inactive store ingredients become cost 0 so the order can still be taken.
   */
  private async safeRecipeUnitCost(recipeId: string | null | undefined) {
    if (!recipeId) return null;
    try {
      return await this.costing.recipeUnitCost(recipeId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.warn(`Recipe cost skipped (${recipeId}): ${msg}`);
      return null;
    }
  }

  private async buildLines(user: AuthUser, items: OrderLineDto[]) {
    const lines: Line[] = [];
    let subtotal = 0;
    let costTotal = 0;
    let perHeadCfg: Awaited<ReturnType<SettingsService["perHead"]>> | null = null;
    /** When off: pure billing — no recipe cost, inactive checks, kitchen/pot stock, or auto deduct. */
    const trackStock = await this.settings.enforceRecipeStock();
    /** Accumulate planned batch takes so multiple cart lines don't oversell. */
    const plannedTake = new Map<string, number>();

    for (const line of items) {
      const kind = line.kind === "PER_HEAD" ? "PER_HEAD" : "MENU";
      if (kind === "PER_HEAD") {
        if (!canChargePerHead(user)) {
          throw new ForbiddenException("Only Supervisor or Cashier can add per-head charges");
        }
        perHeadCfg ??= await this.settings.perHead();
        if (!perHeadCfg.enabled) throw new BadRequestException("Per-head charge is disabled in Settings");
        if (perHeadCfg.amount <= 0) throw new BadRequestException("Per-head amount is not set in Settings");
        const rate = perHeadCfg.amount;
        const amount = rate * line.quantity;
        subtotal += amount;
        lines.push({
          lineKind: "PER_HEAD",
          menuItemId: null,
          name: perHeadCfg.label,
          sellUnit: "PCS",
          quantity: line.quantity,
          ratePerUnit: rate,
          amount,
          unitCost: 0,
          costAmount: 0,
          notes: line.notes?.trim() || undefined,
          recipeId: null,
          batchGrams: 0,
          specialProductId: null,
          saleMode: null,
        });

        const pkgReq = line.packageLines ?? [];
        if (pkgReq.length) {
          const allowed = new Map(perHeadCfg.items.map((p) => [p.menuItemId, p]));
          for (const pkg of pkgReq) {
            const cfg = allowed.get(pkg.menuItemId);
            if (!cfg) throw new BadRequestException("Package item is not in per-head settings");
            const menu = await this.prisma.menuItem.findUnique({
              where: { id: pkg.menuItemId },
              include: { specialProduct: true },
            });
            if (!menu || !menu.active) {
              throw new BadRequestException(`${cfg.name} is not available for per-head package`);
            }
            assertMenuQty(menu, pkg.quantity);

            if (menu.kind === "SPECIAL") {
              const sp = menu.specialProduct;
              if (!sp) throw new BadRequestException(`${menu.name} is not linked to a special pot`);
              const plateGrams = toNumber(sp.plateGrams) || 1;
              const plates = pkg.quantity;
              const grams = plates * plateGrams;
              if (trackStock) {
                const planned = plannedTake.get(sp.id) ?? 0;
                await this.specials.assertAvailable(sp.id, grams + planned);
                plannedTake.set(sp.id, planned + grams);
              }
              let unitCost = 0;
              let costAmount = 0;
              // Recipes Off = skip; On = soft cost via safeRecipeUnitCost (logs + cost 0 on error).
              if (trackStock && sp.cookRecipeId) {
                const priced = await this.safeRecipeUnitCost(sp.cookRecipeId);
                if (priced) {
                  const cookQty = this.costing.cookedGramsToRecipeQty({
                    baseUnit: priced.recipe.baseUnit,
                    cookedGrams: grams,
                    plateGrams,
                  });
                  unitCost = plateGrams > 0 ? (priced.costPerBase * cookQty) / plates : priced.costPerBase;
                  costAmount = priced.costPerBase * cookQty;
                }
              }
              costTotal += costAmount;
              lines.push({
                lineKind: "MENU",
                menuItemId: menu.id,
                name: menu.name,
                sellUnit: menu.sellUnit,
                quantity: plates,
                ratePerUnit: 0,
                amount: 0,
                unitCost,
                costAmount,
                notes: "Per head",
                recipeId: null,
                batchGrams: trackStock ? grams : 0,
                specialProductId: sp.id,
                saleMode: "PLATE",
                kitchenStation: menu.kitchenStation || "COOKING",
              });
              continue;
            }

            if (menu.kind === "MIX") {
              const built = await this.buildMixLine({
                menu,
                quantity: pkg.quantity,
                rate: 0,
                amount: 0,
                notes: "Per head",
                soloStoreFallback: false,
                plannedTake,
                trackStock,
                modifiersJson: null,
              });
              costTotal += built.costAmount;
              lines.push(built);
              continue;
            }

            // NORMAL (store recipe) — Off = skip; On = soft cost (error → 0 + log)
            const pricedPkg =
              trackStock && menu.recipeId ? await this.safeRecipeUnitCost(menu.recipeId) : null;
            const unitCost = pricedPkg?.costPerBase ?? 0;
            const costAmount = unitCost * pkg.quantity;
            costTotal += costAmount;
            lines.push({
              lineKind: "MENU",
              menuItemId: menu.id,
              name: menu.name,
              sellUnit: menu.sellUnit,
              quantity: pkg.quantity,
              ratePerUnit: 0,
              amount: 0,
              unitCost,
              costAmount,
              notes: "Per head",
              recipeId: trackStock ? menu.recipeId : null,
              batchGrams: 0,
              specialProductId: null,
              saleMode: null,
              kitchenStation: menu.kitchenStation || "COOKING",
            });
          }
        }
        continue;
      }

      if (!line.menuItemId) throw new BadRequestException("Menu item required");
      const menu = await this.prisma.menuItem.findUnique({
        where: { id: line.menuItemId },
        include: { specialProduct: true },
      });
      if (!menu || !menu.active) throw new BadRequestException("Menu item not available");

      if (menu.kind === "SPECIAL") {
        const sp = menu.specialProduct;
        if (!sp) throw new BadRequestException(`${menu.name} is not linked to a special pot`);
        const platePrice = toNumber(sp.platePrice);
        const plateGrams = toNumber(sp.plateGrams) || 1;
        const mode = line.saleMode === "RS" || (line.amountRs != null && line.amountRs > 0) ? "RS" : "PLATE";
        if (mode === "RS" && sp.sellMode === "SERVING_ONLY") {
          throw new BadRequestException(
            `${menu.name} is selling by ${sp.servingLabel || "serving"} only — not by Rs`
          );
        }
        if (mode === "PLATE" && sp.sellMode === "RS_ONLY") {
          throw new BadRequestException(`${menu.name} is selling by Rs only`);
        }

        let plates: number;
        let amount: number;
        let rate: number;
        let qty: number;
        /** Half/Full menu rows: mixSpecialPlates = share of one full pot serving (e.g. 0.5). */
        const portion =
          toNumber(menu.mixSpecialPlates) > 0 ? toNumber(menu.mixSpecialPlates) : 1;
        if (mode === "RS") {
          const rs = line.amountRs ?? line.quantity * platePrice;
          if (rs < 0.01) throw new BadRequestException("Enter rupees for special sale");
          plates = rs / platePrice;
          amount = Math.round(rs * 100) / 100;
          rate = platePrice;
          qty = Math.round(plates * 1000) / 1000;
        } else {
          assertMenuQty(menu, line.quantity);
          const menuRate = toNumber(menu.sellingPrice);
          rate = menuRate > 0 ? menuRate : platePrice > 0 ? platePrice : 0;
          plates = line.quantity * portion;
          amount = Math.round(rate * line.quantity * 100) / 100;
          qty = line.quantity;
        }
        const grams = plates * plateGrams;
        if (trackStock) {
          const planned = plannedTake.get(sp.id) ?? 0;
          await this.specials.assertAvailable(sp.id, grams + planned);
          plannedTake.set(sp.id, planned + grams);
        }

        let unitCost = 0;
        let costAmount = 0;
        if (trackStock && sp.cookRecipeId) {
          const priced = await this.safeRecipeUnitCost(sp.cookRecipeId);
          if (priced) {
            const cookQty = this.costing.cookedGramsToRecipeQty({
              baseUnit: priced.recipe.baseUnit,
              cookedGrams: grams,
              plateGrams,
            });
            unitCost = plateGrams > 0 ? (priced.costPerBase * cookQty) / plates : priced.costPerBase;
            costAmount = priced.costPerBase * cookQty;
          }
        }
        subtotal += amount;
        costTotal += costAmount;
        lines.push({
          lineKind: "MENU",
          menuItemId: menu.id,
          name: menu.name,
          sellUnit: menu.sellUnit,
          quantity: qty,
          ratePerUnit: rate,
          amount,
          unitCost,
          costAmount,
          notes: line.notes?.trim() || undefined,
          recipeId: null,
          batchGrams: trackStock ? grams : 0,
          specialProductId: sp.id,
          saleMode: mode,
          kitchenStation: menu.kitchenStation || "COOKING",
        });
        continue;
      }

      if (menu.kind === "MIX") {
        assertMenuQty(menu, line.quantity);
        const mods = await this.resolveModifiers(menu.id, line.modifiers);
        const modExtra = mods.reduce((s, m) => s + m.priceDelta, 0);
        const rate = Math.round((toNumber(menu.sellingPrice) + modExtra) * 100) / 100;
        const amount = rate * line.quantity;
        const built = await this.buildMixLine({
          menu,
          quantity: line.quantity,
          rate,
          amount,
          notes: line.notes?.trim() || undefined,
          soloStoreFallback: !!line.soloStoreFallback,
          plannedTake,
          trackStock,
          modifiersJson: mods.length ? mods : null,
        });
        subtotal += amount;
        costTotal += built.costAmount;
        lines.push(built);
        continue;
      }

      assertMenuQty(menu, line.quantity);
      const mods = await this.resolveModifiers(menu.id, line.modifiers);
      const modExtra = mods.reduce((s, m) => s + m.priceDelta, 0);
      const baseRate = toNumber(menu.sellingPrice);
      const rate = Math.round((baseRate + modExtra) * 100) / 100;
      const amount = rate * line.quantity;
      // Recipes Off: skip cost. On: soft cost (error → 0 + log) — never block order.
      const pricedLine =
        trackStock && menu.recipeId ? await this.safeRecipeUnitCost(menu.recipeId) : null;
      const unitCost = pricedLine?.costPerBase ?? 0;
      const costAmount = unitCost * line.quantity;
      subtotal += amount;
      costTotal += costAmount;
      const displayName =
        mods.length > 0 ? `${menu.name} (+${mods.map((m) => m.name).join(", ")})` : menu.name;
      lines.push({
        lineKind: "MENU",
        menuItemId: menu.id,
        name: displayName,
        sellUnit: menu.sellUnit,
        quantity: line.quantity,
        ratePerUnit: rate,
        amount,
        unitCost,
        costAmount,
        notes: line.notes?.trim() || undefined,
        recipeId: trackStock ? menu.recipeId : null,
        batchGrams: 0,
        specialProductId: null,
        saleMode: null,
        modifiersJson: mods.length ? mods : null,
        kitchenStation: menu.kitchenStation || "COOKING",
      });
    }
    return { lines, subtotal, costTotal };
  }

  /** Resolve modifier name/price from DB — never trust client priceDelta. */
  private async resolveModifiers(
    menuItemId: string,
    raw: { id?: string; name?: string; priceDelta?: number }[] | undefined
  ): Promise<{ id: string; name: string; priceDelta: number }[]> {
    const ids = [...new Set((raw ?? []).map((m) => (m.id || "").trim()).filter(Boolean))];
    if (!ids.length) {
      if ((raw ?? []).length) {
        throw new BadRequestException("Modifiers must include id");
      }
      return [];
    }
    const rows = await this.prisma.menuModifier.findMany({
      where: { menuItemId, active: true, id: { in: ids } },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const out: { id: string; name: string; priceDelta: number }[] = [];
    for (const id of ids) {
      const db = byId.get(id);
      if (!db) throw new BadRequestException("Modifier not available on this menu item");
      out.push({
        id: db.id,
        name: db.name,
        priceDelta: Math.round(toNumber(db.priceDelta) * 100) / 100,
      });
    }
    return out;
  }

  private lineStation(line: { kitchenStation?: string | null }) {
    return line.kitchenStation || "COOKING";
  }

  private lineStoreTakes(line: {
    recipeId: string | null;
    quantity: number;
    dealTakes?: DealTakes | null;
    kitchenStation?: string | null;
  }) {
    const station = this.lineStation(line);
    if (line.dealTakes?.recipes?.length) {
      return line.dealTakes.recipes.map((r) => ({ ...r, station }));
    }
    return line.recipeId
      ? [{ recipeId: line.recipeId, quantity: line.quantity, station }]
      : [];
  }

  private lineSpecialTakes(line: {
    specialProductId: string | null;
    batchGrams: number;
    dealTakes?: DealTakes | null;
  }) {
    if (line.dealTakes?.specials?.length) return line.dealTakes.specials;
    return line.specialProductId && line.batchGrams > 0
      ? [{ specialProductId: line.specialProductId, grams: line.batchGrams }]
      : [];
  }

  private parseDealTakesJson(raw: unknown): DealTakes | null {
    if (!raw || typeof raw !== "object") return null;
    const o = raw as { recipes?: unknown; specials?: unknown };
    const recipes = Array.isArray(o.recipes)
      ? o.recipes
          .map((r) => {
            const x = r as { recipeId?: string; quantity?: number };
            return x.recipeId && Number(x.quantity) > 0
              ? { recipeId: x.recipeId, quantity: Number(x.quantity) }
              : null;
          })
          .filter((x): x is { recipeId: string; quantity: number } => !!x)
      : [];
    const specials = Array.isArray(o.specials)
      ? o.specials
          .map((s) => {
            const x = s as { specialProductId?: string; grams?: number };
            return x.specialProductId && Number(x.grams) > 0
              ? { specialProductId: x.specialProductId, grams: Number(x.grams) }
              : null;
          })
          .filter((x): x is { specialProductId: string; grams: number } => !!x)
      : [];
    if (!recipes.length && !specials.length) return null;
    return { recipes, specials };
  }

  /** Resolve MIX deal parts (DB) with legacy MenuItem fields as fallback. */
  private async resolveMixParts(menu: {
    id: string;
    name: string;
    recipeId: string | null;
    specialProductId: string | null;
    mixSpecialPlates: Parameters<typeof toNumber>[0];
  }) {
    const rows = await this.prisma.menuDealPart.findMany({
      where: { menuItemId: menu.id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: {
        recipe: { select: { id: true, name: true } },
        specialProduct: {
          select: { id: true, name: true, plateGrams: true, cookRecipeId: true },
        },
      },
    });
    if (rows.length) return rows;

    const legacy: {
      kind: "STORE" | "SPECIAL";
      recipeId: string | null;
      specialProductId: string | null;
      quantity: number;
      recipe: { id: string; name: string } | null;
      specialProduct: {
        id: string;
        name: string;
        plateGrams: Parameters<typeof toNumber>[0];
        cookRecipeId: string | null;
      } | null;
    }[] = [];

    if (menu.recipeId) {
      const recipe = await this.prisma.recipe.findUnique({
        where: { id: menu.recipeId },
        select: { id: true, name: true },
      });
      if (recipe) {
        legacy.push({
          kind: "STORE",
          recipeId: recipe.id,
          specialProductId: null,
          quantity: 1,
          recipe,
          specialProduct: null,
        });
      }
    }
    if (menu.specialProductId) {
      const sp = await this.prisma.specialProduct.findUnique({
        where: { id: menu.specialProductId },
        select: { id: true, name: true, plateGrams: true, cookRecipeId: true },
      });
      if (sp) {
        legacy.push({
          kind: "SPECIAL",
          recipeId: null,
          specialProductId: sp.id,
          quantity: toNumber(menu.mixSpecialPlates) || 1,
          recipe: null,
          specialProduct: sp,
        });
      }
    }
    if (!legacy.some((p) => p.kind === "STORE")) {
      throw new BadRequestException(`${menu.name}: deal needs at least one store recipe`);
    }
    return legacy;
  }

  private async buildMixLine(opts: {
    menu: {
      id: string;
      name: string;
      sellUnit: Line["sellUnit"];
      recipeId: string | null;
      specialProductId: string | null;
      mixSpecialPlates: Parameters<typeof toNumber>[0];
      kitchenStation?: string | null;
      specialProduct: {
        id: string;
        plateGrams: Parameters<typeof toNumber>[0];
        cookRecipeId: string | null;
      } | null;
    };
    quantity: number;
    rate: number;
    amount: number;
    notes?: string;
    soloStoreFallback: boolean;
    plannedTake: Map<string, number>;
    /** When false, skip pot availability — billing-only mode. */
    trackStock: boolean;
    modifiersJson: { id?: string; name: string; priceDelta: number }[] | null;
  }): Promise<Line> {
    const { menu, quantity, rate, amount, notes, soloStoreFallback, plannedTake, trackStock, modifiersJson } =
      opts;
    const parts = await this.resolveMixParts(menu);
    const storeParts = parts.filter((p) => p.kind === "STORE" && p.recipeId);
    const specialParts = parts.filter((p) => p.kind === "SPECIAL" && p.specialProduct);

    const plannedSpecials: { specialProductId: string; grams: number; plateGrams: number; cookRecipeId: string | null }[] =
      [];
    for (const p of specialParts) {
      const sp = p.specialProduct!;
      const plateGrams = toNumber(sp.plateGrams) || 1;
      const plates = quantity * (toNumber(p.quantity) || 1);
      const grams = plates * plateGrams;
      plannedSpecials.push({
        specialProductId: sp.id,
        grams,
        plateGrams,
        cookRecipeId: sp.cookRecipeId,
      });
    }

    let saleMode: "MIX" | "MIX_SOLO_STORE" = "MIX";
    let useBatch = trackStock && plannedSpecials.length > 0;
    if (useBatch) {
      try {
        for (const s of plannedSpecials) {
          const planned = plannedTake.get(s.specialProductId) ?? 0;
          await this.specials.assertAvailable(s.specialProductId, s.grams + planned);
        }
      } catch (e) {
        if (soloStoreFallback) {
          saleMode = "MIX_SOLO_STORE";
          useBatch = false;
        } else {
          throw e;
        }
      }
    }

    if (useBatch) {
      for (const s of plannedSpecials) {
        const planned = plannedTake.get(s.specialProductId) ?? 0;
        plannedTake.set(s.specialProductId, planned + s.grams);
      }
    }

    let unitCost = 0;
    const recipes: { recipeId: string; quantity: number }[] = [];
    // Recipes Off = billing only — do not resolve or cost any recipe / store ingredient.
    if (trackStock) {
      for (const p of storeParts) {
        const perDeal = toNumber(p.quantity) || 1;
        const takeQty = quantity * perDeal;
        recipes.push({ recipeId: p.recipeId!, quantity: takeQty });
        const c = await this.safeRecipeUnitCost(p.recipeId!);
        if (c) unitCost += c.costPerBase * perDeal;
      }

      if (useBatch) {
        for (const s of plannedSpecials) {
          if (!s.cookRecipeId) continue;
          const priced = await this.safeRecipeUnitCost(s.cookRecipeId);
          if (!priced) continue;
          const specialCost =
            priced.costPerBase *
            this.costing.cookedGramsToRecipeQty({
              baseUnit: priced.recipe.baseUnit,
              cookedGrams: s.grams,
              plateGrams: s.plateGrams,
            });
          unitCost += specialCost / Math.max(quantity, 1e-9);
        }
      }
    }

    const costAmount = unitCost * quantity;
    const specials = useBatch
      ? plannedSpecials.map((s) => ({ specialProductId: s.specialProductId, grams: s.grams }))
      : [];
    const primarySpecial = specials[0];
    const baseName = saleMode === "MIX_SOLO_STORE" ? `${menu.name} (store only)` : menu.name;
    const displayName =
      modifiersJson && modifiersJson.length
        ? `${baseName} (+${modifiersJson.map((m) => m.name).join(", ")})`
        : baseName;

    return {
      lineKind: "MENU",
      menuItemId: menu.id,
      name: displayName,
      sellUnit: menu.sellUnit,
      quantity,
      ratePerUnit: rate,
      amount,
      unitCost,
      costAmount,
      notes,
      recipeId: trackStock ? recipes[0]?.recipeId ?? menu.recipeId : null,
      batchGrams: primarySpecial?.grams ?? 0,
      specialProductId: primarySpecial?.specialProductId ?? null,
      saleMode: specials.length || saleMode === "MIX_SOLO_STORE" ? saleMode : "MIX",
      modifiersJson,
      dealTakes: trackStock ? { recipes, specials } : { recipes: [], specials: [] },
      kitchenStation: menu.kitchenStation || "COOKING",
    };
  }

  private async ensureStock(
    lines: {
      recipeId: string | null;
      quantity: number;
      name: string;
      dealTakes?: DealTakes | null;
      kitchenStation?: string | null;
    }[]
  ) {
    if (!(await this.settings.enforceRecipeStock())) return;
    return this.costing.assertCanSell(
      lines.flatMap((l) => {
        const takes = this.lineStoreTakes(l);
        return takes.map((t) => ({
          recipeId: t.recipeId,
          quantity: t.quantity,
          name: l.name,
          station: t.station,
        }));
      })
    );
  }

  private async deductStock(lines: Line[], orderNo: number, tableNo: string | null, orderId: string) {
    if (!(await this.settings.enforceRecipeStock())) return;
    const note = `Order #${orderNo}${tableNo ? ` · Table ${tableNo}` : ""} · auto sale`;
    const startedAt = new Date();
    const doneSpecials: { id: string; grams: number }[] = [];
    try {
      for (const line of lines) {
        for (const t of this.lineStoreTakes(line)) {
          await this.costing.deductRecipeStock(
            t.recipeId,
            t.quantity,
            note,
            orderId,
            "SALE",
            t.station
          );
        }
      }
      for (const line of lines) {
        for (const s of this.lineSpecialTakes(line)) {
          await this.specials.assertAndTake(s.specialProductId, s.grams);
          doneSpecials.push({ id: s.specialProductId, grams: s.grams });
        }
      }
    } catch (e) {
      for (const s of [...doneSpecials].reverse()) {
        await this.specials.restoreGrams(s.id, s.grams).catch(() => undefined);
      }
      // Undo SALE rows from this attempt only (no ADJUST offsets — cancel stays correct).
      const moves = await this.prisma.stockMovement.findMany({
        where: { orderId, type: "SALE", createdAt: { gte: startedAt } },
      });
      for (const m of moves) {
        const qty = toNumber(m.quantity);
        if (qty >= 0) continue;
        const station = m.kitchenStation || "COOKING";
        await this.prisma.kitchenStock.upsert({
          where: {
            storeItemId_station: { storeItemId: m.storeItemId, station },
          },
          create: {
            storeItemId: m.storeItemId,
            station,
            quantityOnHand: -qty,
          },
          update: { quantityOnHand: { increment: -qty } },
        });
        await this.prisma.stockMovement.delete({ where: { id: m.id } });
      }
      throw e;
    }
  }

  /** Create failed after insert — deductStock already rolled stock; drop orphan order. */
  private async rollbackFailedCreate(orderId: string, _orderNo: number) {
    await this.prisma.orderItem.deleteMany({ where: { orderId } });
    await this.prisma.order.delete({ where: { id: orderId } }).catch(() => undefined);
  }

  /** Put back ingredients deducted as SALE when the whole order is cancelled. */
  private async restoreStockForOrder(orderId: string, orderNo: number) {
    const moves = await this.prisma.stockMovement.findMany({
      where: { orderId, type: "SALE" },
    });
    for (const m of moves) {
      const qty = toNumber(m.quantity);
      if (qty >= 0) continue; // SALE rows are negative
      const restore = -qty;
      const station = m.kitchenStation || "COOKING";
      await this.prisma.kitchenStock.upsert({
        where: {
          storeItemId_station: { storeItemId: m.storeItemId, station },
        },
        create: {
          storeItemId: m.storeItemId,
          station,
          quantityOnHand: restore,
        },
        update: { quantityOnHand: { increment: restore } },
      });
      await this.prisma.stockMovement.create({
        data: {
          storeItemId: m.storeItemId,
          type: "RESTORE",
          quantity: restore,
          ratePerUnit: m.ratePerUnit,
          note: `Order #${orderNo} · cancelled`,
          orderId,
          kitchenStation: station,
        },
      });
    }
    const items = await this.prisma.orderItem.findMany({ where: { orderId } });
    for (const it of items) {
      const takes =
        this.parseDealTakesJson(it.dealTakesJson) ||
        (it.specialProductId && toNumber(it.batchGrams) > 0
          ? {
              recipes: [] as { recipeId: string; quantity: number }[],
              specials: [{ specialProductId: it.specialProductId, grams: toNumber(it.batchGrams) }],
            }
          : null);
      if (!takes) continue;
      for (const s of takes.specials) {
        await this.specials.restoreGrams(s.specialProductId, s.grams);
      }
    }
  }

  private async resolveCreditCustomer(user: AuthUser, id: string) {
    if (!user.permissions.includes("order.pay")) {
      throw new ForbiddenException("Only a cashier can put a bill on credit");
    }
    const customer = await this.prisma.creditCustomer.findFirst({ where: { id, active: true } });
    if (!customer) throw new BadRequestException("Credit customer not found");
    return customer.id;
  }

  private event(o: FullOrder) {
    return {
      id: o.id,
      orderNo: o.orderNo,
      tableNo: o.tableNo,
      tableId: o.tableId,
      status: o.status,
      paymentStatus: o.paymentStatus,
      waiterId: o.waiterId,
      assignedCashierId: o.assignedCashierId,
      kitchenHold: o.kitchenHold ?? false,
    };
  }

  private toDto(o: FullOrder, showCost: boolean) {
    const tipAmount = toNumber(o.tipAmount);
    const kitchenLines = o.items.filter((i) => i.lineKind !== "PER_HEAD");
    const prepTargetMinutes = targetPrepMinutes(
      kitchenLines.map((i) => ({
        kitchenStation: i.menuItem?.kitchenStation ?? null,
        prepMinutes: i.menuItem?.recipe?.prepMinutes ?? null,
      }))
    );
    return {
      id: o.id,
      orderNo: o.orderNo,
      billNo: o.orderNo,
      tableNo: o.tableNo,
      tableId: o.tableId,
      tableName: o.table?.name ?? null,
      partitionName: o.table?.partition?.name ?? null,
      notes: o.notes,
      guestName: o.guestName ?? null,
      guestPhone: o.guestPhone ?? null,
      partySize: o.partySize ?? null,
      reservedFor: o.reservedFor ?? null,
      kitchenHold: o.kitchenHold ?? false,
      status: o.status,
      paymentStatus: o.paymentStatus,
      pendingAt: o.pendingAt,
      preparingAt: o.preparingAt,
      readyAt: o.readyAt,
      prepTargetMinutes,
      subtotal: toNumber(o.subtotal),
      total: toNumber(o.total),
      discountAmount: toNumber(o.discountAmount),
      taxAmount: toNumber(o.taxAmount),
      taxPercent: toNumber(o.taxPercent),
      paidAmount: toNumber(o.paidAmount),
      tenderedAmount: toNumber(o.tenderedAmount),
      tipAmount,
      netTotal: Math.max(0, toNumber(o.total) - toNumber(o.discountAmount)),
      dueTotal: Math.max(
        0,
        toNumber(o.total) - toNumber(o.discountAmount) + toNumber(o.taxAmount)
      ),
      changeAmount: Math.max(
        0,
        toNumber(o.tenderedAmount) - toNumber(o.paidAmount) - tipAmount,
      ),
      grandTotal:
        Math.max(0, toNumber(o.total) - toNumber(o.discountAmount) + toNumber(o.taxAmount)) +
        tipAmount,
      ...(showCost
        ? {
            costTotal: toNumber(o.costTotal),
            profit: Math.max(0, toNumber(o.total) - toNumber(o.discountAmount)) - toNumber(o.costTotal),
          }
        : {}),
      cashier: o.cashier?.name ?? null,
      waiter: this.staffLabel(o.waiter),
      waiterId: o.waiterId,
      orderedBy: this.staffDto(o.waiter),
      assignedCashierId: o.assignedCashierId,
      assignedCashier: this.staffDto(o.assignedCashier),
      servedBy: o.servedByName,
      servedByName: o.servedByName,
      cancelReason: o.cancelReason,
      cancelledAt: o.cancelledAt,
      cancelledBy: this.staffDto(o.cancelledBy),
      creditCustomer: o.creditCustomer
        ? { id: o.creditCustomer.id, name: o.creditCustomer.name, phone: o.creditCustomer.phone }
        : null,
      kotRounds: o.kotRounds,
      billRequestedAt: o.billRequestedAt,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
      tipShares: o.tipShares.map((s) => ({
        userId: s.userId,
        name: s.user.name,
        amount: toNumber(s.amount),
        kind: s.kind,
      })),
      items: o.items.map((i) => ({
        id: i.id,
        lineKind: i.lineKind,
        menuItemId: i.menuItemId,
        name: i.name,
        sellUnit: i.sellUnit,
        quantity: toNumber(i.quantity),
        ratePerUnit: toNumber(i.ratePerUnit),
        amount: toNumber(i.amount),
        batchGrams: toNumber(i.batchGrams),
        specialProductId: i.specialProductId,
        saleMode: i.saleMode,
        notes: i.notes,
        modifiers: (i as { modifiersJson?: unknown }).modifiersJson ?? null,
        kotRound: i.kotRound,
        addedBy: i.addedBy?.name ?? null,
        category: i.menuItem?.category ?? (i.lineKind === "PER_HEAD" ? "Per head" : null),
        kitchenStation: i.menuItem?.kitchenStation ?? null,
        prepMinutes:
          i.lineKind === "PER_HEAD"
            ? null
            : itemPrepMinutes({
                kitchenStation: i.menuItem?.kitchenStation ?? null,
                prepMinutes: i.menuItem?.recipe?.prepMinutes ?? null,
              }),
      })),
      payments: o.payments.map((p) => ({
        id: p.id,
        amount: toNumber(p.amount),
        tenderedAmount: toNumber(p.tenderedAmount),
        tipAmount: toNumber(p.tipAmount),
        method: p.method ?? "CASH",
        changeAmount: Math.max(0, toNumber(p.tenderedAmount) - toNumber(p.amount) - toNumber(p.tipAmount)),
        collectedBy: p.collectedBy.name,
        handedTo: p.handedTo?.name ?? null,
        confirmedAt: p.confirmedAt,
        createdAt: p.createdAt,
      })),
    };
  }
}

function cleanName(v: string | null | undefined) {
  const n = (v ?? "").trim().replace(/\s+/g, " ");
  return n ? n.slice(0, 80) : null;
}
