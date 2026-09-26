import { Injectable } from "@nestjs/common";
import { PaymentStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CostingService } from "../common/costing.service";
import { toNumber } from "../common/units";
import { CreateOrderDto, PayOrderDto, UpdateStatusDto } from "./dto";

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly costing: CostingService
  ) {}

  async list(paymentStatus?: string, status?: string) {
    const orders = await this.prisma.order.findMany({
      where: {
        ...(paymentStatus
          ? { paymentStatus: paymentStatus as PaymentStatus }
          : {}),
        ...(status ? { status: status as never } : {}),
      },
      include: { items: true, cashier: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return orders.map((o) => ({
      id: o.id,
      orderNo: o.orderNo,
      tableNo: o.tableNo,
      notes: o.notes,
      status: o.status,
      paymentStatus: o.paymentStatus,
      subtotal: toNumber(o.subtotal),
      total: toNumber(o.total),
      paidAmount: toNumber(o.paidAmount),
      costTotal: toNumber(o.costTotal),
      profit: toNumber(o.total) - toNumber(o.costTotal),
      cashier: o.cashier?.name,
      createdAt: o.createdAt,
      items: o.items.map((i) => ({
        id: i.id,
        name: i.name,
        sellUnit: i.sellUnit,
        quantity: toNumber(i.quantity),
        ratePerUnit: toNumber(i.ratePerUnit),
        amount: toNumber(i.amount),
        notes: i.notes,
      })),
    }));
  }

  async create(cashierId: string, dto: CreateOrderDto) {
    const lines: Array<{
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
    }> = [];

    let subtotal = 0;
    let costTotal = 0;

    for (const line of dto.items) {
      const menu = await this.prisma.menuItem.findUniqueOrThrow({
        where: { id: line.menuItemId },
      });
      const rate = toNumber(menu.sellingPrice);
      const amount = rate * line.quantity;
      let unitCost = 0;
      if (menu.recipeId) {
        const c = await this.costing.recipeUnitCost(menu.recipeId);
        unitCost = c.costPerBase;
      }
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
        notes: line.notes,
        recipeId: menu.recipeId,
      });
    }

    const order = await this.prisma.order.create({
      data: {
        tableNo: dto.tableNo,
        notes: dto.notes,
        status: "PENDING",
        paymentStatus: "UNPAID",
        subtotal,
        total: subtotal,
        costTotal,
        cashierId,
        items: {
          create: lines.map(({ recipeId: _r, ...rest }) => rest),
        },
      },
      include: { items: true },
    });

    for (const line of lines) {
      if (line.recipeId) {
        await this.costing.deductRecipeStock(
          line.recipeId,
          line.quantity,
          `Order #${order.orderNo}${order.tableNo ? ` · Table ${order.tableNo}` : ""} · auto sale`,
          order.id
        );
      }
    }

    const full = await this.prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: true },
    });

    return {
      id: full.id,
      orderNo: full.orderNo,
      tableNo: full.tableNo,
      notes: full.notes,
      status: full.status,
      paymentStatus: full.paymentStatus,
      total: toNumber(full.total),
      createdAt: full.createdAt,
      items: full.items.map((i) => ({
        id: i.id,
        name: i.name,
        sellUnit: i.sellUnit,
        quantity: toNumber(i.quantity),
        ratePerUnit: toNumber(i.ratePerUnit),
        amount: toNumber(i.amount),
        notes: i.notes,
      })),
    };
  }

  async pay(id: string, dto: PayOrderDto) {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id } });
    const pay = dto.amount ?? toNumber(order.total);
    const paidAmount = toNumber(order.paidAmount) + pay;
    const total = toNumber(order.total);
    const paymentStatus: PaymentStatus =
      paidAmount >= total ? "PAID" : paidAmount > 0 ? "PARTIAL" : "UNPAID";

    return this.prisma.order.update({
      where: { id },
      data: {
        paidAmount,
        paymentStatus,
        status:
          paymentStatus === "PAID" && order.status === "READY"
            ? "COMPLETED"
            : order.status,
      },
    });
  }

  updateStatus(id: string, dto: UpdateStatusDto) {
    return this.prisma.order.update({
      where: { id },
      data: { status: dto.status },
      include: { items: true },
    });
  }
}
