import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { OrderStatus, PaymentStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CostingService } from "../common/costing.service";
import { assertMenuQty } from "../common/menu-qty";
import { toNumber } from "../common/units";
import { AuthUser } from "../common/decorators";
import { PrintService } from "../print/print.service";
import { RealtimeService } from "../realtime/realtime.service";
import { OPEN_ORDER_WHERE, tableLabel } from "../tables/tables.controller";
import {
  AddItemsDto,
  CancelOrderDto,
  CreateOrderDto,
  EditOrderDto,
  OrderLineDto,
  PayOrderDto,
  UpdateOrderDto,
  UpdateStatusDto,
} from "./dto";
import { TipService } from "../system/tip.service";
import { SettingsService } from "../system/settings.service";
import { SpecialsService } from "../specials/specials.service";

const staffSelect = { id: true, name: true, role: { select: { code: true, name: true } } } as const;

const canChargePerHead = (u: AuthUser) =>
  u.roleCode === "SUPERVISOR" ||
  u.roleCode === "ADMIN" ||
  u.roleCode === "MANAGER" || // legacy cached sessions
  u.permissions.includes("users.manage");

const orderInclude = {
  items: {
    orderBy: { createdAt: "asc" },
    include: {
      addedBy: { select: { name: true } },
      menuItem: { select: { category: true, kitchenStation: true } },
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
};

const canSeeCost = (u: AuthUser) => u.permissions.includes("reports.view");
const paidBillsScope = (u: AuthUser): Prisma.OrderWhereInput =>
  u.permissions.includes("payments.view")
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

/** Floor roles: kitchen/list shows only orders they placed (not the whole kitchen queue). */
const floorOwnOrdersOnly = (u: AuthUser, billing: boolean) =>
  !billing && (u.roleCode === "SUPERVISOR" || u.roleCode === "WAITER");

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
    private readonly specials: SpecialsService
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
        ? "Hotel is closed. No new orders."
        : "Outside hotel hours. No new orders.",
    });
  }

  async list(user: AuthUser, paymentStatus?: string, status?: string, billing = false) {
    const cashierScope = this.cashierBillingScope(user, billing);
    const ownOnly = floorOwnOrdersOnly(user, billing);
    const where: Prisma.OrderWhereInput = {
      ...(paymentStatus ? { paymentStatus: paymentStatus as PaymentStatus } : {}),
      ...(billing ? { creditCustomerId: null } : {}),
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
    const orders = await this.prisma.order.findMany({
      where,
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
    const assignedCashierId = await this.resolveAssignedCashier(user, dto.assignedCashierId);
    const creditCustomerId = dto.creditCustomerId
      ? await this.resolveCreditCustomer(user, dto.creditCustomerId, !table)
      : null;
    const servedByName = cleanName(dto.servedByName);
    const hasKitchen = lines.some((l) => l.lineKind === "MENU");
    const order = await this.prisma.order.create({
      data: {
        tableNo: table?.label ?? walkInLabel ?? undefined,
        tableId: table?.id ?? null,
        notes: dto.notes,
        status: "PENDING",
        paymentStatus: "UNPAID",
        subtotal,
        total: subtotal,
        costTotal,
        waiterId: user.id,
        assignedCashierId,
        servedByName,
        creditCustomerId,
        kotRounds: hasKitchen ? 1 : 0,
        items: {
          create: lines.map(({ recipeId: _r, ...rest }) => ({
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
            kotRound: rest.lineKind === "MENU" ? 1 : 0,
            addedById: user.id,
          })),
        },
      },
    });

    await this.deductStock(
      lines.filter((l) => l.lineKind === "MENU"),
      order.orderNo,
      order.tableNo,
      order.id
    );
    if (dto.printKot !== false && hasKitchen) await this.queueKot(order.id, 1, user.id);
    const full = await this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: orderInclude });
    this.realtime.orderChanged(this.event(full), "created");
    return this.toDto(full, canSeeCost(user));
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
    if (dto.creditCustomerId && order.creditCustomerId && dto.creditCustomerId !== order.creditCustomerId) {
      throw new BadRequestException("This table is already on another credit account");
    }
    if (dto.creditCustomerId && !order.creditCustomerId) {
      const customerId = await this.resolveCreditCustomer(user, dto.creditCustomerId, !order.tableId);
      await this.prisma.order.update({ where: { id }, data: { creditCustomerId: customerId } });
    }

    const { lines } = await this.buildLines(user, dto.items);
    const menuLines = lines.filter((l) => l.lineKind === "MENU");
    const perHeadLines = lines.filter((l) => l.lineKind === "PER_HEAD");
    await this.ensureStock(menuLines);
    const servedByName = dto.servedByName !== undefined ? cleanName(dto.servedByName) : undefined;
    // First kitchen send on an order that only had per-head: kotRounds was 0 → become 1
    const nextRound = menuLines.length ? (order.kotRounds < 1 ? 1 : order.kotRounds + 1) : order.kotRounds;

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
          kotRound: nextRound,
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
        ...(menuLines.length ? { kotRounds: nextRound } : {}),
        subtotal: sum,
        total: sum,
        costTotal: costSum,
        discountAmount: Math.min(toNumber(order.discountAmount), Math.max(0, sum - toNumber(order.paidAmount))),
        billRequestedAt: null,
        status: order.status === "READY" || order.status === "COMPLETED" ? "PENDING" : order.status,
        paymentStatus: toNumber(order.paidAmount) > 0 ? "PARTIAL" : order.paymentStatus,
        ...(order.waiterId ? {} : { waiterId: user.id }),
        ...(servedByName !== undefined ? { servedByName } : {}),
      },
    });

    await this.deductStock(menuLines, order.orderNo, order.tableNo, order.id);
    if (dto.printKot !== false && menuLines.length) await this.queueKot(id, nextRound, user.id);
    const full = await this.prisma.order.findUniqueOrThrow({ where: { id }, include: orderInclude });
    this.realtime.orderChanged(this.event(full), "items-added");
    return this.toDto(full, canSeeCost(user));
  }

  /**
   * Main cashier: cancel an unpaid order, restore stock, free the table,
   * and print a CANCELLED kitchen slip so staff stop preparing.
   */
  async cancel(user: AuthUser, id: string, dto: CancelOrderDto) {
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
    const hasKitchen = order.items.some((i) => i.lineKind !== "PER_HEAD");
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
    if (order.status === "CANCELLED") throw new BadRequestException("Order is cancelled");
    if (order.paymentStatus === "PAID") {
      throw new BadRequestException("Paid bills cannot be edited");
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
        select: { id: true, recipeId: true, name: true },
      });
      const recipeOf = new Map(menus.map((m) => [m.id, m.recipeId]));
      const nameOf = new Map(menus.map((m) => [m.id, m.name]));
      await this.ensureStock(
        increases.flatMap((i) => {
          const recipeId = recipeOf.get(i.menuItemId);
          const name = nameOf.get(i.menuItemId) ?? i.name;
          return recipeId ? [{ recipeId, quantity: i.quantity, name }] : [];
        })
      );
    }

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

      if (line.menuItemId && qtyDiff > 0) {
        const menu = await this.prisma.menuItem.findUnique({ where: { id: line.menuItemId } });
        if (menu?.recipeId) {
          await this.costing.deductRecipeStock(
            menu.recipeId,
            qtyDiff,
            `Order #${order.orderNo} · edit add`,
            order.id
          );
        }
      }
      if (line.menuItemId && qtyDiff < 0) {
        const menu = await this.prisma.menuItem.findUnique({ where: { id: line.menuItemId } });
        if (menu?.recipeId) {
          await this.costing.restoreRecipeStock(
            menu.recipeId,
            -qtyDiff,
            `Order #${order.orderNo} · edit remove`,
            order.id
          );
        }
      }

      const oldGrams = toNumber(line.batchGrams);
      let nextBatchGrams = oldGrams;
      if (line.specialProductId && oldQty > 0 && oldGrams > 0 && qtyDiff !== 0) {
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
            kotRound: order.kotRounds,
            addedById: user.id,
          },
        });
        if (line.recipeId) {
          await this.costing.deductRecipeStock(
            line.recipeId,
            line.quantity,
            `Order #${order.orderNo} · edit new item`,
            order.id
          );
        }
        if (line.specialProductId && line.batchGrams > 0) {
          await this.specials.assertAndTake(line.specialProductId, line.batchGrams);
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

    const updated = await this.prisma.order.update({
      where: { id },
      data: {
        subtotal: { increment: subDelta },
        total: nextTotal,
        costTotal: { increment: costDelta },
        discountAmount: nextDiscount,
        paidAmount: nextPaid,
        paymentStatus: nextPaymentStatus,
        ...billMeta,
      },
      include: orderInclude,
    });

    this.realtime.orderChanged(this.event(updated), "edited");
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
    if (order.status === "CANCELLED" || order.paymentStatus === "VOID") {
      throw new BadRequestException("Cancelled orders cannot be paid");
    }
    if (order.paymentStatus === "PAID") throw new BadRequestException("Bill is already paid");
    if (order.creditCustomerId) {
      throw new BadRequestException("This bill is on a credit account. Clear it from Credit Customers");
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const gross = toNumber(order.total);
    const prevPaid = toNumber(order.paidAmount);
    const prevTendered = toNumber(order.tenderedAmount);
    const maxDiscount = Math.max(0, round2(gross - prevPaid));
    const discount =
      dto.discount !== undefined
        ? Math.min(maxDiscount, Math.max(0, round2(dto.discount)))
        : Math.min(maxDiscount, Math.max(0, round2(toNumber(order.discountAmount))));
    const net = Math.max(0, round2(gross - discount));
    const due = Math.max(0, round2(net - prevPaid));
    const tendered = Math.max(0, round2(dto.amount ?? due));
    const tip = Math.max(0, round2(dto.tip ?? 0));
    const pay = Math.min(tendered, due);

    if (due > 0 && pay <= 0 && tip <= 0) throw new BadRequestException("Enter the amount received");
    if (pay <= 0 && tip > 0 && due > 0) throw new BadRequestException("Pay the bill before collecting tip only");

    const paidAmount = round2(prevPaid + pay);
    const fullyPaid = paidAmount + 0.001 >= net || due <= 0;
    const paymentStatus: PaymentStatus = fullyPaid ? "PAID" : pay > 0 ? "PARTIAL" : order.paymentStatus;
    const tipAmount = round2(toNumber(order.tipAmount) + tip);
    const tenderedAmount = round2(prevTendered + tendered);

    let servedByName = order.servedByName;
    if (dto.servedByName !== undefined) {
      servedByName = cleanName(dto.servedByName);
    }

    let handedTo: { id: string; name: string } | null = null;
    const needsCashHandover = !user.permissions.includes("cash.keep") && (pay > 0 || tip > 0);
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
                tenderedAmount: tendered,
                tipAmount: tip,
                collectedById: user.id,
                handedToId: handedTo?.id ?? null,
              },
            })
          : null;
      const updated = await tx.order.update({
        where: { id },
        data: {
          discountAmount: discount,
          paidAmount,
          tenderedAmount,
          tipAmount,
          paymentStatus,
          servedByName,
          cashierId: order.cashierId ?? handedTo?.id ?? user.id,
          status: fullyPaid && order.status === "READY" ? "COMPLETED" : order.status,
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

  /** Guest has left. The table frees; the invoice stays on the credit account until they pay. */
  async releaseCredit(user: AuthUser, id: string) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: orderInclude });
    if (!order) throw new NotFoundException("Order not found");
    if (!order.creditCustomerId) throw new BadRequestException("This order is not on credit");
    if (order.status === "CANCELLED") throw new BadRequestException("Order is cancelled");
    if (order.status === "COMPLETED" || order.paymentStatus === "PAID") {
      return this.toDto(order, canSeeCost(user));
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
    const updated = await this.prisma.order.update({
      where: { id },
      data: { status: dto.status },
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

  private async resolveAssignedCashier(user: AuthUser, assignedCashierId?: string) {
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

  private async buildLines(user: AuthUser, items: OrderLineDto[]) {
    const lines: Line[] = [];
    let subtotal = 0;
    let costTotal = 0;
    let perHeadCfg: Awaited<ReturnType<SettingsService["perHead"]>> | null = null;
    /** Accumulate planned batch takes so multiple cart lines don't oversell. */
    const plannedTake = new Map<string, number>();

    for (const line of items) {
      const kind = line.kind === "PER_HEAD" ? "PER_HEAD" : "MENU";
      if (kind === "PER_HEAD") {
        if (!canChargePerHead(user)) {
          throw new ForbiddenException("Only Supervisor can add per-head charges");
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
              const planned = plannedTake.get(sp.id) ?? 0;
              await this.specials.assertAvailable(sp.id, grams + planned);
              plannedTake.set(sp.id, planned + grams);
              let unitCost = 0;
              let costAmount = 0;
              if (sp.cookRecipeId) {
                const { costPerBase, recipe } = await this.costing.recipeUnitCost(sp.cookRecipeId);
                const cookQty = this.costing.cookedGramsToRecipeQty({
                  baseUnit: recipe.baseUnit,
                  cookedGrams: grams,
                  plateGrams,
                });
                unitCost = plateGrams > 0 ? (costPerBase * cookQty) / plates : costPerBase;
                costAmount = costPerBase * cookQty;
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
                batchGrams: grams,
                specialProductId: sp.id,
                saleMode: "PLATE",
              });
              continue;
            }

            if (menu.kind === "MIX") {
              const sp = menu.specialProduct;
              if (!sp) throw new BadRequestException(`${menu.name} is not linked to a special pot`);
              const plateGrams = toNumber(sp.plateGrams) || 1;
              const mixPlates = toNumber(menu.mixSpecialPlates) || 1;
              const plates = pkg.quantity * mixPlates;
              const grams = plates * plateGrams;
              const planned = plannedTake.get(sp.id) ?? 0;
              await this.specials.assertAvailable(sp.id, grams + planned);
              plannedTake.set(sp.id, planned + grams);
              let unitCost = 0;
              if (menu.recipeId) {
                unitCost = (await this.costing.recipeUnitCost(menu.recipeId)).costPerBase;
              }
              if (sp.cookRecipeId) {
                const { costPerBase, recipe } = await this.costing.recipeUnitCost(sp.cookRecipeId);
                const specialCost =
                  costPerBase *
                  this.costing.cookedGramsToRecipeQty({
                    baseUnit: recipe.baseUnit,
                    cookedGrams: grams,
                    plateGrams,
                  });
                unitCost += specialCost / Math.max(pkg.quantity, 1e-9);
              }
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
                recipeId: menu.recipeId,
                batchGrams: grams,
                specialProductId: sp.id,
                saleMode: "MIX",
              });
              continue;
            }

            // NORMAL (store recipe)
            const unitCost = menu.recipeId ? (await this.costing.recipeUnitCost(menu.recipeId)).costPerBase : 0;
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
              recipeId: menu.recipeId,
              batchGrams: 0,
              specialProductId: null,
              saleMode: null,
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
        if (mode === "RS") {
          const rs = line.amountRs ?? line.quantity * platePrice;
          if (rs < 0.01) throw new BadRequestException("Enter rupees for special sale");
          plates = rs / platePrice;
          amount = Math.round(rs * 100) / 100;
          rate = platePrice;
          qty = Math.round(plates * 1000) / 1000;
        } else {
          assertMenuQty(menu, line.quantity);
          plates = line.quantity;
          rate = platePrice > 0 ? platePrice : toNumber(menu.sellingPrice);
          amount = Math.round(rate * plates * 100) / 100;
          qty = plates;
        }
        const grams = plates * plateGrams;
        const planned = plannedTake.get(sp.id) ?? 0;
        await this.specials.assertAvailable(sp.id, grams + planned);
        plannedTake.set(sp.id, planned + grams);

        let unitCost = 0;
        let costAmount = 0;
        if (sp.cookRecipeId) {
          const { costPerBase, recipe } = await this.costing.recipeUnitCost(sp.cookRecipeId);
          const cookQty = this.costing.cookedGramsToRecipeQty({
            baseUnit: recipe.baseUnit,
            cookedGrams: grams,
            plateGrams,
          });
          unitCost = plateGrams > 0 ? (costPerBase * cookQty) / plates : costPerBase;
          costAmount = costPerBase * cookQty;
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
          batchGrams: grams,
          specialProductId: sp.id,
          saleMode: mode,
        });
        continue;
      }

      if (menu.kind === "MIX") {
        const sp = menu.specialProduct;
        if (!sp) throw new BadRequestException(`${menu.name} is not linked to a special pot`);
        assertMenuQty(menu, line.quantity);
        const plateGrams = toNumber(sp.plateGrams) || 1;
        const mixPlates = toNumber(menu.mixSpecialPlates) || 1;
        const plates = line.quantity * mixPlates;
        const grams = plates * plateGrams;
        const planned = plannedTake.get(sp.id) ?? 0;
        let saleMode: "MIX" | "MIX_SOLO_STORE" = "MIX";
        let batchGrams = grams;
        let useBatch = true;
        try {
          await this.specials.assertAvailable(sp.id, grams + planned);
        } catch (e) {
          if (line.soloStoreFallback) {
            saleMode = "MIX_SOLO_STORE";
            batchGrams = 0;
            useBatch = false;
          } else {
            throw e;
          }
        }
        if (useBatch) plannedTake.set(sp.id, planned + grams);

        const rate = toNumber(menu.sellingPrice);
        const amount = rate * line.quantity;
        let unitCost = 0;
        if (menu.recipeId) {
          unitCost = (await this.costing.recipeUnitCost(menu.recipeId)).costPerBase;
        }
        let specialCost = 0;
        if (useBatch && sp.cookRecipeId) {
          const { costPerBase, recipe } = await this.costing.recipeUnitCost(sp.cookRecipeId);
          specialCost =
            costPerBase *
            this.costing.cookedGramsToRecipeQty({
              baseUnit: recipe.baseUnit,
              cookedGrams: grams,
              plateGrams,
            });
          unitCost += specialCost / Math.max(line.quantity, 1e-9);
        }
        const costAmount = unitCost * line.quantity;
        subtotal += amount;
        costTotal += costAmount;
        lines.push({
          lineKind: "MENU",
          menuItemId: menu.id,
          name: saleMode === "MIX_SOLO_STORE" ? `${menu.name} (store only)` : menu.name,
          sellUnit: menu.sellUnit,
          quantity: line.quantity,
          ratePerUnit: rate,
          amount,
          unitCost,
          costAmount,
          notes: line.notes?.trim() || undefined,
          recipeId: menu.recipeId,
          batchGrams,
          specialProductId: sp.id,
          saleMode,
        });
        continue;
      }

      assertMenuQty(menu, line.quantity);
      const rate = toNumber(menu.sellingPrice);
      const amount = rate * line.quantity;
      const unitCost = menu.recipeId ? (await this.costing.recipeUnitCost(menu.recipeId)).costPerBase : 0;
      const costAmount = unitCost * line.quantity;
      subtotal += amount;
      costTotal += costAmount;
      lines.push({
        lineKind: "MENU",
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
        batchGrams: 0,
        specialProductId: null,
        saleMode: null,
      });
    }
    return { lines, subtotal, costTotal };
  }

  private ensureStock(lines: { recipeId: string | null; quantity: number; name: string }[]) {
    return this.costing.assertCanSell(
      lines.flatMap((l) => (l.recipeId ? [{ recipeId: l.recipeId, quantity: l.quantity, name: l.name }] : []))
    );
  }

  private async deductStock(lines: Line[], orderNo: number, tableNo: string | null, orderId: string) {
    for (const line of lines) {
      if (line.recipeId) {
        await this.costing.deductRecipeStock(
          line.recipeId,
          line.quantity,
          `Order #${orderNo}${tableNo ? ` · Table ${tableNo}` : ""} · auto sale`,
          orderId
        );
      }
      if (line.specialProductId && line.batchGrams > 0) {
        await this.specials.assertAndTake(line.specialProductId, line.batchGrams);
      }
    }
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
      await this.prisma.storeItem.update({
        where: { id: m.storeItemId },
        data: { quantityOnHand: { increment: restore } },
      });
      await this.prisma.stockMovement.create({
        data: {
          storeItemId: m.storeItemId,
          type: "ADJUST",
          quantity: restore,
          ratePerUnit: m.ratePerUnit,
          note: `Order #${orderNo} · cancelled`,
          orderId,
        },
      });
    }
    const items = await this.prisma.orderItem.findMany({ where: { orderId } });
    for (const it of items) {
      if (it.specialProductId && toNumber(it.batchGrams) > 0) {
        await this.specials.restoreGrams(it.specialProductId, toNumber(it.batchGrams));
      }
    }
  }

  private async resolveCreditCustomer(user: AuthUser, id: string, takeaway = false) {
    if (!user.permissions.includes("order.pay")) {
      throw new ForbiddenException("Only a cashier can put a table on credit");
    }
    if (takeaway) throw new BadRequestException("Credit is only for a seated table");
    const customer = await this.prisma.creditCustomer.findFirst({ where: { id, active: true } });
    if (!customer) throw new BadRequestException("Credit customer not found");
    return customer.id;
  }

  private event(o: FullOrder) {
    return {
      id: o.id,
      orderNo: o.orderNo,
      tableNo: o.tableNo,
      status: o.status,
      paymentStatus: o.paymentStatus,
      waiterId: o.waiterId,
      assignedCashierId: o.assignedCashierId,
    };
  }

  private toDto(o: FullOrder, showCost: boolean) {
    const tipAmount = toNumber(o.tipAmount);
    return {
      id: o.id,
      orderNo: o.orderNo,
      billNo: o.orderNo,
      tableNo: o.tableNo,
      tableId: o.tableId,
      tableName: o.table?.name ?? null,
      partitionName: o.table?.partition?.name ?? null,
      notes: o.notes,
      status: o.status,
      paymentStatus: o.paymentStatus,
      subtotal: toNumber(o.subtotal),
      total: toNumber(o.total),
      discountAmount: toNumber(o.discountAmount),
      paidAmount: toNumber(o.paidAmount),
      tenderedAmount: toNumber(o.tenderedAmount),
      tipAmount,
      netTotal: Math.max(0, toNumber(o.total) - toNumber(o.discountAmount)),
      changeAmount: Math.max(
        0,
        toNumber(o.tenderedAmount) - toNumber(o.paidAmount) - tipAmount,
      ),
      grandTotal: Math.max(0, toNumber(o.total) - toNumber(o.discountAmount)) + tipAmount,
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
        kotRound: i.kotRound,
        addedBy: i.addedBy?.name ?? null,
        category: i.menuItem?.category ?? (i.lineKind === "PER_HEAD" ? "Per head" : null),
        kitchenStation: i.menuItem?.kitchenStation ?? null,
      })),
      payments: o.payments.map((p) => ({
        id: p.id,
        amount: toNumber(p.amount),
        tenderedAmount: toNumber(p.tenderedAmount),
        tipAmount: toNumber(p.tipAmount),
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
