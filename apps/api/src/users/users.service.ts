import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthUser } from "../common/decorators";
import { CreateUserDto, UpdateUserDto } from "./dto";

const ADMIN = "ADMIN";

function num(v: unknown) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "object" && v !== null && "toNumber" in v && typeof (v as { toNumber: () => number }).toNumber === "function") {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v) || 0;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null },
      include: { role: true, billPrinter: { select: { id: true, name: true, station: true } } },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });
    return users.map((u) => this.toDto(u));
  }

  roles() {
    return this.prisma.role.findMany({
      select: { code: true, name: true },
      orderBy: { name: "asc" },
    });
  }

  async get(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: { role: true, billPrinter: { select: { id: true, name: true, station: true } } },
    });
    if (!user) throw new NotFoundException("User not found");

    const [
      billHistory,
      billsAsCashier,
      billsAsWaiter,
      billsAssigned,
      billsCancelled,
      paymentsCollected,
      paymentsCollectedAgg,
      cashHandovers,
      tipSharesAgg,
      billEdits,
      recentBills,
    ] = await Promise.all([
      this.prisma.order.count({
        where: {
          OR: [{ cashierId: id }, { waiterId: id }, { assignedCashierId: id }],
        },
      }),
      this.prisma.order.count({ where: { cashierId: id } }),
      this.prisma.order.count({ where: { waiterId: id } }),
      this.prisma.order.count({ where: { assignedCashierId: id } }),
      this.prisma.order.count({ where: { cancelledById: id } }),
      this.prisma.payment.count({ where: { collectedById: id } }),
      this.prisma.payment.aggregate({
        where: { collectedById: id },
        _sum: { amount: true, tipAmount: true },
      }),
      this.prisma.payment.count({ where: { handedToId: id } }),
      this.prisma.tipShare.aggregate({
        where: { userId: id },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.orderBillEdit.count({ where: { editedById: id } }),
      this.prisma.order.findMany({
        where: {
          OR: [{ cashierId: id }, { waiterId: id }, { assignedCashierId: id }, { cancelledById: id }],
        },
        select: {
          id: true,
          orderNo: true,
          tableNo: true,
          status: true,
          paymentStatus: true,
          total: true,
          paidAmount: true,
          createdAt: true,
          cashierId: true,
          waiterId: true,
          assignedCashierId: true,
          cancelledById: true,
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ]);

    return {
      ...this.toDto(user),
      stats: {
        billHistory,
        billsAsCashier,
        billsAsWaiter,
        billsAssigned,
        billsCancelled,
        paymentsCollected,
        paymentsCollectedAmount: num(paymentsCollectedAgg._sum.amount),
        tipsCollectedOnPayments: num(paymentsCollectedAgg._sum.tipAmount),
        cashHandovers,
        tipShares: tipSharesAgg._count._all,
        tipSharesAmount: num(tipSharesAgg._sum.amount),
        billEdits,
      },
      recentBills: recentBills.map((o) => ({
        id: o.id,
        orderNo: o.orderNo,
        tableNo: o.tableNo,
        status: o.status,
        paymentStatus: o.paymentStatus,
        total: num(o.total),
        paidAmount: num(o.paidAmount),
        createdAt: o.createdAt,
        roles: [
          o.cashierId === id ? "cashier" : null,
          o.waiterId === id ? "waiter" : null,
          o.assignedCashierId === id ? "assigned" : null,
          o.cancelledById === id ? "cancelled" : null,
        ].filter(Boolean) as string[],
      })),
    };
  }

  async create(actor: AuthUser, dto: CreateUserDto) {
    const role = await this.role(dto.roleCode);
    this.assertCanAssign(actor, role.code);
    const username = dto.username.toLowerCase();
    if (await this.prisma.user.findFirst({ where: { username, deletedAt: null } })) {
      throw new ConflictException(`Username "${username}" is already taken`);
    }
    // Soft-deleted accounts may still hold the username — free it if so.
    await this.prisma.user.updateMany({
      where: { username, deletedAt: { not: null } },
      data: { username: `deleted.${randomBytes(8).toString("hex")}` },
    });
    const user = await this.prisma.user.create({
      data: {
        name: dto.name.trim(),
        username,
        passwordHash: await bcrypt.hash(dto.password, 10),
        pinHash: dto.pin ? await bcrypt.hash(dto.pin, 10) : null,
        roleId: role.id,
        billPrinterId: dto.billPrinterId ? await this.assertBillPrinter(dto.billPrinterId) : null,
      },
      include: { role: true, billPrinter: { select: { id: true, name: true, station: true } } },
    });
    return this.toDto(user);
  }

  async update(actor: AuthUser, id: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: { role: true },
    });
    if (!user) throw new NotFoundException("User not found");
    if (user.role.code === ADMIN && actor.roleCode !== ADMIN) {
      throw new ForbiddenException("Only an admin can change an admin account");
    }

    const data: Prisma.UserUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.username !== undefined && dto.username.toLowerCase() !== user.username) {
      const username = dto.username.toLowerCase();
      if (await this.prisma.user.findFirst({ where: { username, deletedAt: null, NOT: { id } } })) {
        throw new ConflictException(`Username "${username}" is already taken`);
      }
      await this.prisma.user.updateMany({
        where: { username, deletedAt: { not: null } },
        data: { username: `deleted.${randomBytes(8).toString("hex")}` },
      });
      data.username = username;
    }
    if (dto.password) data.passwordHash = await bcrypt.hash(dto.password, 10);
    if (dto.pin !== undefined) data.pinHash = dto.pin ? await bcrypt.hash(dto.pin, 10) : null;
    if (dto.billPrinterId !== undefined) {
      data.billPrinter = dto.billPrinterId
        ? { connect: { id: await this.assertBillPrinter(dto.billPrinterId) } }
        : { disconnect: true };
    }

    let newRoleCode = user.role.code;
    if (dto.roleCode !== undefined && dto.roleCode !== user.role.code) {
      if (id === actor.id) throw new BadRequestException("You cannot change your own role");
      const role = await this.role(dto.roleCode);
      this.assertCanAssign(actor, role.code);
      data.role = { connect: { id: role.id } };
      newRoleCode = role.code;
    }
    if (dto.active !== undefined && dto.active !== user.active) {
      if (id === actor.id && !dto.active) throw new BadRequestException("You cannot deactivate your own account");
      data.active = dto.active;
    }

    const losesAdmin = user.role.code === ADMIN && user.active && (newRoleCode !== ADMIN || dto.active === false);
    if (losesAdmin) {
      const admins = await this.prisma.user.count({
        where: { active: true, deletedAt: null, role: { code: ADMIN } },
      });
      if (admins <= 1) throw new BadRequestException("At least one active admin account is required");
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data,
      include: { role: true, billPrinter: { select: { id: true, name: true, station: true } } },
    });
    return this.toDto(updated);
  }

  /** Soft-delete: removes login and frees username; bill/payment history stays. */
  async remove(actor: AuthUser, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: { role: true },
    });
    if (!user) throw new NotFoundException("User not found");
    if (id === actor.id) throw new BadRequestException("You cannot delete your own account");
    if (user.role.code === ADMIN && actor.roleCode !== ADMIN) {
      throw new ForbiddenException("Only an admin can delete an admin account");
    }
    if (user.role.code === ADMIN && user.active) {
      const admins = await this.prisma.user.count({
        where: { active: true, deletedAt: null, role: { code: ADMIN } },
      });
      if (admins <= 1) throw new BadRequestException("At least one active admin account is required");
    }

    await this.prisma.user.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        active: false,
        pinHash: null,
        billPrinterId: null,
        username: `deleted.${id}`,
        passwordHash: await bcrypt.hash(randomBytes(32).toString("hex"), 10),
      },
    });

    return { ok: true };
  }

  private async assertBillPrinter(id: string) {
    const p = await this.prisma.printer.findFirst({ where: { id, active: true, printsBill: true } });
    if (!p) throw new BadRequestException("Choose an active bill printer");
    return p.id;
  }

  private assertCanAssign(actor: AuthUser, roleCode: string) {
    if (roleCode === ADMIN && actor.roleCode !== ADMIN) {
      throw new ForbiddenException("Only an admin can create or assign admin accounts");
    }
  }

  private async role(code: string) {
    const role = await this.prisma.role.findUnique({ where: { code } });
    if (!role) throw new BadRequestException(`Unknown role "${code}"`);
    return role;
  }

  private toDto(u: {
    id: string;
    name: string;
    username: string;
    active: boolean;
    pinHash: string | null;
    billPrinterId?: string | null;
    billPrinter?: { id: string; name: string; station: string } | null;
    createdAt: Date;
    role: { code: string; name: string };
  }) {
    return {
      id: u.id,
      name: u.name,
      username: u.username,
      active: u.active,
      hasPin: !!u.pinHash,
      billPrinterId: u.billPrinterId ?? null,
      billPrinterName: u.billPrinter
        ? u.billPrinter.station
          ? `${u.billPrinter.name} (${u.billPrinter.station})`
          : u.billPrinter.name
        : null,
      roleCode: u.role.code,
      roleName: u.role.name,
      createdAt: u.createdAt,
    };
  }
}
