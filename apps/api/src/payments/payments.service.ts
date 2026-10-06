import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeService } from "../realtime/realtime.service";
import { AuthUser } from "../common/decorators";
import { toNumber } from "../common/units";

export type PaymentFilter = {
  from?: string;
  to?: string;
  status?: "direct" | "pending" | "received";
  staffId?: string;
};

const paymentInclude = {
  order: {
    select: {
      id: true,
      orderNo: true,
      tableNo: true,
      total: true,
      tipAmount: true,
      waiter: { select: { name: true, role: { select: { name: true, code: true } } } },
      servedByName: true,
    },
  },
  collectedBy: { select: { id: true, name: true, role: { select: { name: true } } } },
  handedTo: { select: { id: true, name: true } },
} satisfies Prisma.PaymentInclude;

type FullPayment = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function dayStart(d: string) {
  if (!DATE.test(d)) throw new BadRequestException("Dates must be YYYY-MM-DD");
  return new Date(`${d}T00:00:00`);
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService
  ) {}

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
      where: { handedToId: user.id, confirmedAt: null },
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
    this.realtime.paymentsChanged();
    this.realtime.cashConfirmed(updated.collectedById, {
      id: updated.id,
      amount: toNumber(updated.amount),
      orderNo: updated.order.orderNo,
      by: user.name,
    });
    return this.toDto(updated);
  }

  async list(f: PaymentFilter) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (f.from) createdAt.gte = dayStart(f.from);
    if (f.to) {
      const end = dayStart(f.to);
      end.setDate(end.getDate() + 1);
      createdAt.lt = end;
    }
    const where: Prisma.PaymentWhereInput = {
      ...(f.from || f.to ? { createdAt } : {}),
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
    const sum = (xs: typeof list) => xs.reduce((s, p) => s + p.amount, 0);
    const tipSum = (xs: typeof list) => xs.reduce((s, p) => s + p.tipAmount, 0);
    const handed = list.filter((p) => p.handedTo);
    return {
      rows: list,
      summary: {
        count: list.length,
        bills: new Set(list.map((p) => p.orderId)).size,
        total: sum(list),
        tips: tipSum(list),
        direct: sum(list.filter((p) => !p.handedTo)),
        handedOver: sum(handed),
        pending: sum(handed.filter((p) => !p.confirmedAt)),
        pendingCount: handed.filter((p) => !p.confirmedAt).length,
      },
    };
  }

  private toDto(p: FullPayment) {
    const waiter = p.order.waiter;
    return {
      id: p.id,
      amount: toNumber(p.amount),
      tipAmount: toNumber(p.tipAmount),
      createdAt: p.createdAt,
      confirmedAt: p.confirmedAt,
      orderId: p.order.id,
      orderNo: p.order.orderNo,
      tableNo: p.order.tableNo,
      orderTotal: toNumber(p.order.total),
      orderTip: toNumber(p.order.tipAmount),
      orderedBy: waiter ? `${waiter.name} (${waiter.role.name})` : null,
      orderedByRole: waiter?.role.code ?? null,
      servedBy: p.order.servedByName || null,
      collectedBy: { id: p.collectedBy.id, name: p.collectedBy.name, roleName: p.collectedBy.role.name },
      handedTo: p.handedTo ? { id: p.handedTo.id, name: p.handedTo.name } : null,
    };
  }
}
