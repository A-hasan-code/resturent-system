import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PaymentMethod, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeService } from "../realtime/realtime.service";
import { SettingsService } from "../system/settings.service";
import { AuthUser } from "../common/decorators";
import { businessQueryRange } from "../common/business-day";
import { toNumber } from "../common/units";

export type PaymentFilter = {
  from?: string;
  to?: string;
  status?: "direct" | "pending" | "received";
  method?: PaymentMethod | "ALL";
  staffId?: string;
};

const paymentInclude = {
  order: {
    select: {
      id: true,
      orderNo: true,
      tableNo: true,
      total: true,
      discountAmount: true,
      taxAmount: true,
      paidAmount: true,
      tipAmount: true,
      waiter: { select: { name: true, role: { select: { name: true, code: true } } } },
      servedByName: true,
      creditCustomer: { select: { id: true, name: true } },
    },
  },
  collectedBy: { select: { id: true, name: true, role: { select: { name: true } } } },
  handedTo: { select: { id: true, name: true } },
} satisfies Prisma.PaymentInclude;

type FullPayment = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const METHODS = new Set<string>(["CASH", "CARD", "WALLET", "BANK"]);

function money2(n: number) {
  return Math.round(n * 100) / 100;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly settings: SettingsService
  ) {}

  /** Inclusive business-day range → [from, to) using restaurant day-start (same as Close / Bills pad). */
  private async businessRange(fromStr?: string, toStr?: string) {
    if (!fromStr && !toStr) return null;
    if (fromStr && !DATE.test(fromStr)) throw new BadRequestException("Dates must be YYYY-MM-DD");
    if (toStr && !DATE.test(toStr)) throw new BadRequestException("Dates must be YYYY-MM-DD");
    const start = await this.settings.dayStart();
    const fromDay = fromStr || toStr!;
    const toDay = toStr || fromStr!;
    const range = businessQueryRange(fromDay, toDay, start.h, start.m);
    return { gte: range.gte, lt: range.lt, dayStart: start.label };
  }

  /** People a manager can hand collected cash to. */
  async cashiers() {
    const users = await this.prisma.user.findMany({
      where: {
        active: true,
        deletedAt: null,
        role: {
          OR: [
            { code: { in: ["MAIN_CASHIER", "CASHIER"] } },
            { permissions: { some: { permission: { code: "cash.keep" } } } },
          ],
        },
      },
      select: { id: true, name: true, role: { select: { code: true, name: true } } },
      orderBy: { name: "asc" },
    });
    const rank = (code: string) => (code === "MAIN_CASHIER" ? 0 : code === "CASHIER" ? 1 : 2);
    return users
      .filter((u) => u.role.code !== "ADMIN")
      .sort((a, b) => rank(a.role.code) - rank(b.role.code) || a.name.localeCompare(b.name))
      .map((u) => ({ id: u.id, name: u.name, roleCode: u.role.code, roleName: u.role.name }));
  }

  /** Floor staff who can be marked as table servers. */
  async servers() {
    const users = await this.prisma.user.findMany({
      where: {
        active: true,
        deletedAt: null,
        role: { code: { in: ["WAITER", "SUPERVISOR", "CASHIER", "MAIN_CASHIER"] } },
      },
      select: { id: true, name: true, role: { select: { code: true, name: true } } },
      orderBy: { name: "asc" },
    });
    return users.map((u) => ({ id: u.id, name: u.name, roleCode: u.role.code, roleName: u.role.name }));
  }

  /** Cash handed to me that I have not confirmed yet. */
  async myHandovers(user: AuthUser) {
    const rows = await this.prisma.payment.findMany({
      where: { handedToId: user.id, confirmedAt: null, method: PaymentMethod.CASH },
      include: paymentInclude,
      orderBy: { createdAt: "asc" },
    });
    return rows.map((p) => this.toDto(p));
  }

  async confirm(user: AuthUser, id: string) {
    const p = await this.prisma.payment.findUnique({ where: { id }, include: paymentInclude });
    if (!p) throw new NotFoundException("Payment not found");
    if (p.handedToId !== user.id) throw new ForbiddenException("This cash was handed to someone else");
    if (p.confirmedAt) return this.toDto(p);

    const updated = await this.prisma.payment.update({
      where: { id },
      data: { confirmedAt: new Date() },
      include: paymentInclude,
    });
    const cash = money2(toNumber(updated.amount) + toNumber(updated.tipAmount));
    this.realtime.paymentsChanged();
    this.realtime.cashConfirmed(updated.collectedById, {
      id: updated.id,
      amount: cash,
      orderNo: updated.order.orderNo,
      by: user.name,
    });
    return this.toDto(updated);
  }

  async list(f: PaymentFilter) {
    const range = await this.businessRange(f.from, f.to);
    const createdAt: Prisma.DateTimeFilter | undefined = range
      ? { gte: range.gte, lt: range.lt }
      : undefined;

    const method =
      f.method && f.method !== "ALL" && METHODS.has(f.method) ? (f.method as PaymentMethod) : undefined;
    // Handover status only applies to physical cash.
    const statusImpliesCash = !!f.status;

    const where: Prisma.PaymentWhereInput = {
      ...(createdAt ? { createdAt } : {}),
      ...(method ? { method } : statusImpliesCash ? { method: PaymentMethod.CASH } : {}),
      ...(f.status === "direct" ? { handedToId: null } : {}),
      ...(f.status === "pending" ? { handedToId: { not: null }, confirmedAt: null } : {}),
      ...(f.status === "received" ? { handedToId: { not: null }, confirmedAt: { not: null } } : {}),
      ...(f.staffId ? { OR: [{ collectedById: f.staffId }, { handedToId: f.staffId }] } : {}),
    };

    const rows = await this.prisma.payment.findMany({
      where,
      include: paymentInclude,
      orderBy: { createdAt: "desc" },
      take: 1000,
    });
    const list = rows.map((p) => this.toDto(p));
    const sumAmt = (xs: typeof list) => money2(xs.reduce((s, p) => s + p.amount, 0));
    const sumTip = (xs: typeof list) => money2(xs.reduce((s, p) => s + p.tipAmount, 0));
    const sumCash = (xs: typeof list) => money2(xs.reduce((s, p) => s + p.cashTotal, 0));

    const cashRows = list.filter((p) => p.method === "CASH");
    const handed = cashRows.filter((p) => p.handedTo);
    const byMethod = {
      CASH: sumAmt(list.filter((p) => p.method === "CASH")),
      CARD: sumAmt(list.filter((p) => p.method === "CARD")),
      WALLET: sumAmt(list.filter((p) => p.method === "WALLET")),
      BANK: sumAmt(list.filter((p) => p.method === "BANK")),
    };

    const day = await this.settings.dayStart();
    return {
      rows: list,
      summary: {
        count: list.length,
        bills: new Set(list.map((p) => p.orderId)).size,
        total: sumAmt(list),
        tips: sumTip(list),
        cashInDrawer: sumCash(cashRows),
        byMethod,
        // Cash-control buckets (amount + tip), not card/wallet/bank.
        direct: sumCash(cashRows.filter((p) => !p.handedTo)),
        handedOver: sumCash(handed),
        pending: sumCash(handed.filter((p) => !p.confirmedAt)),
        pendingCount: handed.filter((p) => !p.confirmedAt).length,
        creditSettlements: sumAmt(list.filter((p) => p.isCredit)),
      },
      /** Same clock as Close report — UI should label pickers as business day. */
      dayStart: day.label,
      from: f.from ?? null,
      to: f.to ?? null,
    };
  }

  private toDto(p: FullPayment) {
    const waiter = p.order.waiter;
    const method = ((p as { method?: PaymentMethod }).method || PaymentMethod.CASH) as PaymentMethod;
    const amount = toNumber(p.amount);
    const tipAmount = toNumber(p.tipAmount);
    const orderTotal = toNumber(p.order.total);
    const discountAmount = toNumber(p.order.discountAmount);
    const taxAmount = toNumber(p.order.taxAmount);
    const orderDue = money2(Math.max(0, orderTotal - discountAmount + taxAmount));
    const credit = p.order.creditCustomer;
    return {
      id: p.id,
      amount,
      tipAmount,
      cashTotal: method === PaymentMethod.CASH ? money2(amount + tipAmount) : 0,
      method,
      createdAt: p.createdAt,
      confirmedAt: p.confirmedAt,
      orderId: p.order.id,
      orderNo: p.order.orderNo,
      tableNo: p.order.tableNo,
      orderTotal,
      orderDue,
      orderTax: taxAmount,
      orderDiscount: discountAmount,
      orderTip: toNumber(p.order.tipAmount),
      orderedBy: waiter ? `${waiter.name} (${waiter.role.name})` : null,
      orderedByRole: waiter?.role.code ?? null,
      servedBy: p.order.servedByName || null,
      isCredit: !!credit,
      creditCustomerName: credit?.name ?? null,
      collectedBy: { id: p.collectedBy.id, name: p.collectedBy.name, roleName: p.collectedBy.role.name },
      handedTo: p.handedTo ? { id: p.handedTo.id, name: p.handedTo.name } : null,
    };
  }
}
