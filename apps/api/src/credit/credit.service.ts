import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PaymentMethod, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../system/settings.service";
import { FinanceService } from "../finance/finance.service";
import { businessDateOf } from "../common/business-day";
import { toNumber } from "../common/units";
import { AuthUser } from "../common/decorators";
import { CreditCustomerDto } from "./dto";
import { RealtimeService } from "../realtime/realtime.service";

const openCredit: Prisma.OrderWhereInput = {
  status: { not: "CANCELLED" },
  paymentStatus: { in: ["UNPAID", "PARTIAL"] },
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
    private readonly finance: FinanceService,
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
        orders: {
          where: openCredit,
          select: { total: true, paidAmount: true, taxAmount: true, discountAmount: true, createdAt: true },
        },
      },
      orderBy: { name: "asc" },
      take: 100,
    });
    const taxCfg = await this.finance.taxSettings();
    return customers
      .map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        address: c.address,
        cnic: c.cnic,
        openInvoices: c.orders.length,
        outstanding: c.orders.reduce((sum, o) => sum + this.orderDue(o, taxCfg.percent), 0),
      }))
      .sort((a, b) => b.outstanding - a.outstanding || a.name.localeCompare(b.name));
  }

  /** Buckets: current (0–30), 31–60, 61–90, 90+ days by oldest open invoice. */
  async aging() {
    const taxCfg = await this.finance.taxSettings();
    const now = Date.now();
    const detailed = await this.prisma.creditCustomer.findMany({
      where: { active: true },
      include: {
        orders: {
          where: openCredit,
          select: {
            orderNo: true,
            createdAt: true,
            total: true,
            discountAmount: true,
            taxAmount: true,
            paidAmount: true,
          },
        },
      },
    });
    const rows = detailed
      .map((c) => {
        let outstanding = 0;
        let oldest: Date | null = null;
        for (const o of c.orders) {
          const due = this.orderDue(o, taxCfg.percent);
          if (due <= 0) continue;
          outstanding += due;
          if (!oldest || o.createdAt < oldest) oldest = o.createdAt;
        }
        if (!(outstanding > 0) || !oldest) return null;
        const days = Math.floor((now - oldest.getTime()) / 86400000);
        const bucket = days <= 30 ? "0-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";
        return {
          id: c.id,
          name: c.name,
          phone: c.phone,
          outstanding: Math.round(outstanding * 100) / 100,
          days,
          bucket,
          oldestInvoiceAt: oldest.toISOString(),
          openInvoices: c.orders.length,
        };
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => b.days - a.days || b.outstanding - a.outstanding);

    const summary = {
      "0-30": 0,
      "31-60": 0,
      "61-90": 0,
      "90+": 0,
      total: 0,
    };
    for (const r of rows) {
      summary[r.bucket as keyof typeof summary] += r.outstanding;
      summary.total += r.outstanding;
    }
    for (const k of Object.keys(summary) as (keyof typeof summary)[]) {
      summary[k] = Math.round(summary[k] * 100) / 100;
    }
    return { summary, rows };
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
    const taxCfg = await this.finance.taxSettings();
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
      const invoice = this.invoice(order, taxCfg.percent);
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

  /**
   * Cash against the credit account. Amount is applied oldest open invoice first.
   * Partial amounts leave PARTIAL invoices; remaining balance is returned on the slip.
   */
  async settle(user: AuthUser, id: string, amount: number) {
    if (!user.permissions.includes("cash.keep")) {
      throw new BadRequestException("Only a cashier with a drawer can clear a credit account");
    }
    const payIn = Math.round(Number(amount) * 100) / 100;
    if (!(payIn > 0)) throw new BadRequestException("Enter an amount to pay");

    const customer = await this.ensure(id);
    const orders = await this.prisma.order.findMany({
      where: { creditCustomerId: id, ...openCredit },
      include: { items: { orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "asc" },
    });
    if (!orders.length) throw new BadRequestException("Nothing left to pay");

    for (const order of orders) {
      await this.finance.assertNotLocked(order.createdAt);
    }

    const taxCfg = await this.finance.taxSettings();
    const outstanding = orders.reduce((sum, o) => sum + this.orderDue(o, taxCfg.percent), 0);
    if (outstanding <= 0) throw new BadRequestException("Nothing left to pay");
    let left = Math.min(payIn, outstanding);

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
          paid: number;
          dueAfter: number;
          items: { name: string; quantity: number; unit: string; amount: number }[];
        }[];
      }
    >();
    let total = 0;
    const touched: {
      id: string;
      orderNo: number;
      tableNo: string | null;
      status: string;
      paymentStatus: string;
      waiterId: string | null;
    }[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const order of orders) {
        if (left <= 0) break;
        const gross = toNumber(order.total);
        const discount = toNumber(order.discountAmount);
        const already = toNumber(order.paidAmount);
        const storedTax = toNumber(order.taxAmount);
        const computed = this.finance.computeTax(gross, discount, taxCfg.percent);
        const taxAmount = storedTax > 0 ? storedTax : computed.taxAmount;
        const taxPercent = storedTax > 0 ? toNumber(order.taxPercent) || computed.taxPercent : computed.taxPercent;
        const dueBase = Math.max(0, Math.round((gross - discount + taxAmount) * 100) / 100);
        const due = Math.max(0, Math.round((dueBase - already) * 100) / 100);
        if (due <= 0) continue;

        const pay = Math.min(due, left);
        const paidAmount = Math.round((already + pay) * 100) / 100;
        const paymentStatus = paidAmount + 0.001 >= dueBase ? "PAID" : "PARTIAL";
        // Mirror cash pay — never yank cooking tickets off the kitchen board.
        const status =
          paymentStatus === "PAID" && (order.status === "READY" || order.status === "SERVED")
            ? "COMPLETED"
            : order.status;

        await tx.payment.create({
          data: {
            orderId: order.id,
            amount: pay,
            tipAmount: 0,
            method: PaymentMethod.CASH,
            collectedById: user.id,
            confirmedAt: new Date(),
          },
        });
        await tx.order.update({
          where: { id: order.id },
          data: {
            paidAmount,
            paymentStatus,
            taxAmount,
            taxPercent,
            cashierId: order.cashierId ?? user.id,
            status,
          },
        });

        left = Math.round((left - pay) * 100) / 100;
        total = Math.round((total + pay) * 100) / 100;
        const dueAfter = Math.max(0, Math.round((dueBase - paidAmount) * 100) / 100);
        const date = businessDateOf(order.createdAt, day.h, day.m);
        const bucket = days.get(date) ?? { date, total: 0, invoices: [] };
        bucket.total = Math.round((bucket.total + pay) * 100) / 100;
        bucket.invoices.push({
          orderNo: order.orderNo,
          tableNo: order.tableNo,
          total: dueBase,
          paid: pay,
          dueAfter,
          items: order.items.map((item) => ({
            name: item.name,
            quantity: toNumber(item.quantity),
            unit: item.sellUnit,
            amount: toNumber(item.amount),
          })),
        });
        days.set(date, bucket);
        touched.push({
          id: order.id,
          orderNo: order.orderNo,
          tableNo: order.tableNo,
          status,
          paymentStatus,
          waiterId: order.waiterId,
        });
      }
    });

    const dayList = [...days.values()];
    if (!dayList.length || total <= 0) throw new BadRequestException("Nothing left to pay");
    const remaining = Math.round((outstanding - total) * 100) / 100;
    this.realtime.paymentsChanged();
    for (const order of touched) {
      this.realtime.orderChanged(
        {
          id: order.id,
          orderNo: order.orderNo,
          tableNo: order.tableNo,
          status: order.status,
          paymentStatus: order.paymentStatus,
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
      outstandingBefore: outstanding,
      remaining,
      cleared: remaining <= 0,
    };
  }

  private orderDue(
    o: {
      total: Prisma.Decimal | number;
      discountAmount?: Prisma.Decimal | number | null;
      taxAmount?: Prisma.Decimal | number | null;
      paidAmount: Prisma.Decimal | number;
    },
    taxPercent: number
  ) {
    const gross = toNumber(o.total);
    const discount = toNumber(o.discountAmount ?? 0);
    const storedTax = toNumber(o.taxAmount ?? 0);
    const tax = storedTax > 0 ? storedTax : this.finance.computeTax(gross, discount, taxPercent).taxAmount;
    return Math.max(0, Math.round((gross - discount + tax - toNumber(o.paidAmount)) * 100) / 100);
  }

  private invoice(
    order: {
      id: string;
      orderNo: number;
      tableNo: string | null;
      createdAt: Date;
      total: Prisma.Decimal;
      paidAmount: Prisma.Decimal;
      discountAmount?: Prisma.Decimal;
      taxAmount?: Prisma.Decimal;
      paymentStatus: string;
      status: string;
      items: { name: string; quantity: Prisma.Decimal; sellUnit: string; amount: Prisma.Decimal }[];
    },
    taxPercent = 0
  ) {
    const total = toNumber(order.total);
    const discount = toNumber(order.discountAmount ?? 0);
    const storedTax = toNumber(order.taxAmount ?? 0);
    const tax = storedTax > 0 ? storedTax : this.finance.computeTax(total, discount, taxPercent).taxAmount;
    const paidAmount = toNumber(order.paidAmount);
    const dueBase = Math.max(0, total - discount + tax);
    return {
      id: order.id,
      orderNo: order.orderNo,
      tableNo: order.tableNo,
      createdAt: order.createdAt.toISOString(),
      total,
      discountAmount: discount,
      taxAmount: tax,
      paidAmount,
      due: Math.max(0, dueBase - paidAmount),
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
