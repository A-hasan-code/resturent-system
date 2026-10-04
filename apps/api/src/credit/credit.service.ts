import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../system/settings.service";
import { businessDateOf } from "../common/business-day";
import { toNumber } from "../common/units";
import { AuthUser } from "../common/decorators";
import { CreditCustomerDto } from "./dto";
import { RealtimeService } from "../realtime/realtime.service";

const openCredit = {
  status: { not: "CANCELLED" as const },
  paymentStatus: { not: "PAID" as const },
};

function clean(value?: string | null) {
  const v = value?.trim() ?? "";
  return v.length ? v : null;
}

@Injectable()
export class CreditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly realtime: RealtimeService
  ) {}

  async list(q?: string) {
    const term = q?.trim();
    const customers = await this.prisma.creditCustomer.findMany({
      where: {
        active: true,
        ...(term
          ? {
              OR: [
                { name: { contains: term, mode: "insensitive" } },
                { phone: { contains: term } },
                { cnic: { contains: term } },
              ],
            }
          : {}),
      },
      include: {
        orders: { where: openCredit, select: { total: true, paidAmount: true } },
      },
      orderBy: { name: "asc" },
      take: 100,
    });
    return customers
      .map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        address: c.address,
        cnic: c.cnic,
        openInvoices: c.orders.length,
        outstanding: c.orders.reduce((sum, o) => sum + Math.max(0, toNumber(o.total) - toNumber(o.paidAmount)), 0),
      }))
      .sort((a, b) => b.outstanding - a.outstanding || a.name.localeCompare(b.name));
  }

  async get(id: string) {
    const customer = await this.prisma.creditCustomer.findUnique({
      where: { id },
      include: {
        orders: {
          where: { status: { not: "CANCELLED" } },
          include: { items: { orderBy: { createdAt: "asc" } } },
          orderBy: { createdAt: "desc" },
          take: 300,
        },
      },
    });
    if (!customer || !customer.active) throw new NotFoundException("Credit customer not found");
    const day = await this.settings.dayStart();
    const byDate = new Map<
      string,
      {
        date: string;
        invoices: ReturnType<CreditService["invoice"]>[];
        total: number;
        outstanding: number;
      }
    >();
    for (const order of customer.orders) {
      const date = businessDateOf(order.createdAt, day.h, day.m);
      const row = byDate.get(date) ?? { date, invoices: [], total: 0, outstanding: 0 };
      const invoice = this.invoice(order);
      row.invoices.push(invoice);
      row.total += invoice.total;
      if (invoice.paymentStatus !== "PAID") row.outstanding += invoice.due;
      byDate.set(date, row);
    }
    const days = [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
    const outstanding = days.reduce((sum, d) => sum + d.outstanding, 0);
    return {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      address: customer.address,
      cnic: customer.cnic,
      outstanding,
      days,
    };
  }

  async create(dto: CreditCustomerDto) {
    try {
      const created = await this.prisma.creditCustomer.create({
        data: {
          name: dto.name.trim(),
          phone: dto.phone.trim(),
          address: clean(dto.address),
          cnic: clean(dto.cnic),
        },
      });
      return { id: created.id, name: created.name, phone: created.phone, address: created.address, cnic: created.cnic };
    } catch (e) {
      this.rethrowUnique(e);
    }
  }

  async update(id: string, dto: CreditCustomerDto) {
    await this.ensure(id);
    try {
      const updated = await this.prisma.creditCustomer.update({
        where: { id },
        data: {
          name: dto.name.trim(),
          phone: dto.phone.trim(),
          address: clean(dto.address),
          cnic: clean(dto.cnic),
        },
      });
      return { id: updated.id, name: updated.name, phone: updated.phone, address: updated.address, cnic: updated.cnic };
    } catch (e) {
      this.rethrowUnique(e);
    }
  }

  /** One cash settlement for every open invoice. Food sale stays on each meal's business day. */
  async settle(user: AuthUser, id: string) {
    if (!user.permissions.includes("cash.keep")) {
      throw new BadRequestException("Only a cashier with a drawer can clear a credit account");
    }
    const customer = await this.ensure(id);
    const orders = await this.prisma.order.findMany({
      where: { creditCustomerId: id, ...openCredit },
      include: { items: { orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "asc" },
    });
    if (!orders.length) throw new BadRequestException("Nothing left to pay");

    const day = await this.settings.dayStart();
    const restaurant = await this.settings.restaurant();
    const paidAt = new Date();
    const days = new Map<
      string,
      {
        date: string;
        total: number;
        invoices: {
          orderNo: number;
          tableNo: string | null;
          total: number;
          items: { name: string; quantity: number; unit: string; amount: number }[];
        }[];
      }
    >();
    let total = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const order of orders) {
        const due = Math.max(0, toNumber(order.total) - toNumber(order.paidAmount));
        if (due <= 0) continue;
        await tx.payment.create({
          data: {
            orderId: order.id,
            amount: due,
            tipAmount: 0,
            collectedById: user.id,
          },
        });
        await tx.order.update({
          where: { id: order.id },
          data: {
            paidAmount: toNumber(order.total),
            paymentStatus: "PAID",
            cashierId: order.cashierId ?? user.id,
            status: order.status === "READY" || order.status === "PENDING" || order.status === "PREPARING" ? "COMPLETED" : order.status,
          },
        });
        const amount = toNumber(order.total);
        total += amount;
        const date = businessDateOf(order.createdAt, day.h, day.m);
        const bucket = days.get(date) ?? { date, total: 0, invoices: [] };
        bucket.total += amount;
        bucket.invoices.push({
          orderNo: order.orderNo,
          tableNo: order.tableNo,
          total: amount,
          items: order.items.map((item) => ({
            name: item.name,
            quantity: toNumber(item.quantity),
            unit: item.sellUnit,
            amount: toNumber(item.amount),
          })),
        });
        days.set(date, bucket);
      }
    });

    const dayList = [...days.values()];
    if (!dayList.length) throw new BadRequestException("Nothing left to pay");
    this.realtime.paymentsChanged();
    for (const order of orders) {
      this.realtime.orderChanged(
        {
          id: order.id,
          orderNo: order.orderNo,
          tableNo: order.tableNo,
          status: "COMPLETED",
          paymentStatus: "PAID",
          waiterId: order.waiterId,
        },
        "paid"
      );
    }

    return {
      restaurant: {
        name: restaurant.name,
        tagline: restaurant.tagline,
        address: restaurant.address,
        phone: restaurant.phone,
      },
      customer: {
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
        cnic: customer.cnic,
      },
      collectedBy: user.name,
      paidAt: paidAt.toISOString(),
      days: dayList,
      total,
    };
  }

  private invoice(order: {
    id: string;
    orderNo: number;
    tableNo: string | null;
    createdAt: Date;
    total: Prisma.Decimal;
    paidAmount: Prisma.Decimal;
    paymentStatus: string;
    status: string;
    items: { name: string; quantity: Prisma.Decimal; sellUnit: string; amount: Prisma.Decimal }[];
  }) {
    const total = toNumber(order.total);
    const paidAmount = toNumber(order.paidAmount);
    return {
      id: order.id,
      orderNo: order.orderNo,
      tableNo: order.tableNo,
      createdAt: order.createdAt.toISOString(),
      total,
      paidAmount,
      due: Math.max(0, total - paidAmount),
      paymentStatus: order.paymentStatus,
      status: order.status,
      items: order.items.map((i) => ({
        name: i.name,
        quantity: toNumber(i.quantity),
        unit: i.sellUnit,
        amount: toNumber(i.amount),
      })),
    };
  }

  private async ensure(id: string) {
    const customer = await this.prisma.creditCustomer.findUnique({ where: { id } });
    if (!customer || !customer.active) throw new NotFoundException("Credit customer not found");
    return customer;
  }

  private rethrowUnique(e: unknown): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new BadRequestException("A customer with this phone or CNIC already exists");
    }
    throw e;
  }
}
