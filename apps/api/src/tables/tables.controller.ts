import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";
import { Type } from "class-transformer";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../common/permissions.guard";
import { AuthUser, CurrentUser, RequirePerms } from "../common/decorators";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { toNumber } from "../common/units";
import { RealtimeModule } from "../realtime/realtime.module";
import { RealtimeService } from "../realtime/realtime.service";
import { SettingsService } from "../system/settings.service";
import { SystemModule } from "../system/system.module";

class PartitionDto {
  @IsString() @MaxLength(40) name!: string;
  @IsOptional() @IsInt() sortOrder?: number;
}

class UpdatePartitionDto {
  @IsOptional() @IsString() @MaxLength(40) name?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

class TableDto {
  @IsString() @MaxLength(30) name!: string;
  @IsString() partitionId!: string;
  @IsOptional() @IsString() @MaxLength(30) area?: string;
  @IsOptional() @IsInt() @Min(1) seats?: number;
  @IsOptional() @IsInt() sortOrder?: number;
}

class UpdateTableDto {
  @IsOptional() @IsString() @MaxLength(30) name?: string;
  @IsOptional() @IsString() partitionId?: string;
  @IsOptional() @IsString() @MaxLength(30) area?: string;
  @IsOptional() @IsInt() @Min(1) seats?: number;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

class ReserveTableDto {
  @IsString() @MaxLength(80) guestName!: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) partySize?: number;
  /** Expected arrival (ISO datetime or local `YYYY-MM-DDTHH:mm`). */
  @IsOptional() @IsString() reservedFor?: string;
  @IsOptional() @IsString() @MaxLength(200) notes?: string;
}

export const CLEAR_TABLE_RESERVATION = {
  reservedGuestName: null,
  reservedPhone: null,
  reservedPartySize: null,
  reservedFor: null,
  reservedNotes: null,
  reservedById: null,
  reservedAt: null,
} as const;

/** Supervisor / Cashier / Admin manage reservations — not Waiter. */
export function canManageReservation(u: AuthUser) {
  return (
    ["SUPERVISOR", "CASHIER", "MAIN_CASHIER", "ADMIN", "SYSTEM_MANAGER", "MANAGER"].includes(
      u.roleCode,
    ) || u.permissions.includes("users.manage")
  );
}

function parseReservedFor(raw?: string | null): Date | null {
  if (!raw?.trim()) return null;
  const s = raw.trim();
  const d = new Date(s.length === 16 ? `${s}:00` : s);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException("Invalid reservation time");
  }
  return d;
}

function reservationSummary(t: {
  reservedGuestName: string | null;
  reservedPhone: string | null;
  reservedPartySize: number | null;
  reservedFor: Date | null;
  reservedNotes: string | null;
  reservedById: string | null;
  reservedAt: Date | null;
}) {
  if (!t.reservedGuestName?.trim()) return null;
  return {
    guestName: t.reservedGuestName.trim(),
    phone: t.reservedPhone?.trim() || null,
    partySize: t.reservedPartySize,
    reservedFor: t.reservedFor,
    notes: t.reservedNotes?.trim() || null,
    reservedById: t.reservedById,
    reservedAt: t.reservedAt,
  };
}

/** Cash bills keep the table until paid (and kitchen done). Credit frees once guest has left (COMPLETED). */
export const OPEN_ORDER_WHERE: Prisma.OrderWhereInput = {
  status: { not: "CANCELLED" },
  OR: [
    {
      paymentStatus: { in: ["UNPAID", "PARTIAL"] },
      OR: [{ creditCustomerId: null }, { status: { not: "COMPLETED" } }],
    },
    // Cash paid early — still cooking: hold table so a new sitting cannot open on top.
    {
      creditCustomerId: null,
      paymentStatus: "PAID",
      status: { in: ["PENDING", "PREPARING", "READY"] },
    },
  ],
};

export function tableLabel(partitionName: string | null | undefined, tableName: string) {
  return partitionName ? `${partitionName} · ${tableName}` : tableName;
}

@Injectable()
export class TablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly realtime: RealtimeService,
  ) {}

  private async assertAcceptingOrders() {
    const gate = await this.settings.hotelStatus();
    if (gate.acceptingOrders) return;
    throw new BadRequestException({
      code: "HOTEL_CLOSED",
      message: gate.manuallyClosed
        ? "Hotel is closed — shift ended. No new reservations."
        : "Outside hotel hours. No new reservations.",
    });
  }

  private pingBoard() {
    this.realtime.orderChanged(
      {
        id: "tables",
        orderNo: 0,
        tableNo: null,
        tableId: null,
        status: "PENDING",
      },
      "reservation",
    );
  }

  async board() {
    const [partitions, tables, open] = await Promise.all([
      this.prisma.tablePartition.findMany({
        where: { active: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
      this.prisma.restaurantTable.findMany({
        where: { active: true },
        include: { partition: { select: { id: true, name: true, sortOrder: true } } },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
      this.prisma.order.findMany({
        where: OPEN_ORDER_WHERE,
        include: {
          waiter: { select: { id: true, name: true } },
          assignedCashier: { select: { id: true, name: true, role: { select: { code: true, name: true } } } },
        },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    const orderSummary = (o: (typeof open)[number]) => ({
      id: o.id,
      orderNo: o.orderNo,
      status: o.status,
      paymentStatus: o.paymentStatus,
      total: toNumber(o.total),
      billRequested: !!o.billRequestedAt,
      waiterId: o.waiter?.id ?? null,
      waiter: o.waiter?.name ?? null,
      assignedCashierId: o.assignedCashier?.id ?? null,
      assignedCashier: o.assignedCashier
        ? { id: o.assignedCashier.id, name: o.assignedCashier.name, roleCode: o.assignedCashier.role.code }
        : null,
      since: o.createdAt,
      label: o.tableNo || "Takeaway",
      guestName: o.guestName ?? null,
      partySize: o.partySize ?? null,
      reservedFor: o.reservedFor ?? null,
      kitchenHold: o.kitchenHold ?? false,
    });

    const byTableId = new Map(open.filter((o) => o.tableId).map((o) => [o.tableId!, o]));
    const byLabel = new Map(open.filter((o) => o.tableNo).map((o) => [o.tableNo!, o]));
    const usedOrderIds = new Set<string>();

    const cards = tables.map((t) => {
      const label = tableLabel(t.partition.name, t.name);
      const o = byTableId.get(t.id) ?? byLabel.get(label) ?? byLabel.get(t.name);
      if (o) usedOrderIds.add(o.id);
      return {
        id: t.id,
        name: t.name,
        label,
        area: t.partition.name,
        partitionId: t.partitionId,
        partitionName: t.partition.name,
        seats: t.seats,
        order: o ? orderSummary(o) : null,
        // Soft hold only matters when the table has no open sitting.
        reservation: o ? null : reservationSummary(t),
      };
    });

    // Walk-in / parcel: open orders not tied to a restaurant table.
    const takeaway = open.filter((o) => !usedOrderIds.has(o.id) && !o.tableId).map(orderSummary);

    return {
      partitions: partitions.map((p) => ({
        id: p.id,
        name: p.name,
        sortOrder: p.sortOrder,
        tables: cards.filter((c) => c.partitionId === p.id),
      })),
      tables: cards,
      takeaway,
    };
  }

  async reserve(user: AuthUser, id: string, dto: ReserveTableDto) {
    if (!canManageReservation(user)) {
      throw new BadRequestException("Only supervisor, cashier, or admin can reserve tables");
    }
    await this.assertAcceptingOrders();
    const name = dto.guestName?.trim();
    if (!name) throw new BadRequestException("Guest name required");
    const table = await this.prisma.restaurantTable.findUnique({
      where: { id },
      include: { partition: { select: { name: true } } },
    });
    if (!table || !table.active) throw new NotFoundException("Table not found");

    const open = await this.prisma.order.findFirst({
      where: {
        AND: [
          OPEN_ORDER_WHERE,
          {
            OR: [
              { tableId: table.id },
              { tableNo: tableLabel(table.partition.name, table.name) },
              { tableNo: table.name },
            ],
          },
        ],
      },
    });
    if (open) throw new BadRequestException("Table already has an open order");

    const reservedFor = parseReservedFor(dto.reservedFor);
    const updated = await this.prisma.restaurantTable.update({
      where: { id },
      data: {
        reservedGuestName: name,
        reservedPhone: dto.phone?.trim() || null,
        reservedPartySize: dto.partySize ?? null,
        reservedFor,
        reservedNotes: dto.notes?.trim() || null,
        reservedById: user.id,
        reservedAt: new Date(),
      },
    });
    this.pingBoard();
    return {
      id: updated.id,
      reservation: reservationSummary(updated),
    };
  }

  async clearReservation(user: AuthUser, id: string) {
    if (!canManageReservation(user)) {
      throw new BadRequestException("Only supervisor, cashier, or admin can cancel reservations");
    }
    const table = await this.prisma.restaurantTable.findUnique({ where: { id } });
    if (!table) throw new NotFoundException("Table not found");
    if (!table.reservedGuestName) return { ok: true, reservation: null };
    const updated = await this.prisma.restaurantTable.update({
      where: { id },
      data: { ...CLEAR_TABLE_RESERVATION },
    });
    this.pingBoard();
    return { ok: true, reservation: reservationSummary(updated) };
  }
}

@Controller("tables")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TablesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tables: TablesService
  ) {}

  @Get()
  @RequirePerms("order.create", "bill.view", "tables.manage", "order.viewOwn", "order.addItems")
  board() {
    return this.tables.board();
  }

  @Post(":id/reserve")
  @RequirePerms("order.create", "order.addItems", "tables.manage")
  reserve(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: ReserveTableDto) {
    return this.tables.reserve(user, id, dto);
  }

  @Delete(":id/reserve")
  @RequirePerms("order.create", "order.addItems", "tables.manage")
  clearReserve(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.tables.clearReservation(user, id);
  }

  @Get("partitions")
  @RequirePerms("tables.manage", "order.create", "order.viewOwn", "order.addItems")
  partitions() {
    return this.prisma.tablePartition.findMany({
      where: { active: true },
      include: {
        tables: {
          where: { active: true },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  @Get("all")
  @RequirePerms("tables.manage")
  all() {
    return this.prisma.restaurantTable.findMany({
      include: { partition: { select: { id: true, name: true } } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  @Post("partitions")
  @RequirePerms("tables.manage")
  async createPartition(@Body() dto: PartitionDto) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException("Partition name required");
    return this.prisma.tablePartition.upsert({
      where: { name },
      update: { active: true, ...(dto.sortOrder != null ? { sortOrder: dto.sortOrder } : {}) },
      create: { name, sortOrder: dto.sortOrder ?? 0 },
    });
  }

  @Patch("partitions/:id")
  @RequirePerms("tables.manage")
  async updatePartition(@Param("id") id: string, @Body() dto: UpdatePartitionDto) {
    const p = await this.prisma.tablePartition.findUnique({ where: { id } });
    if (!p) throw new NotFoundException("Partition not found");
    return this.prisma.tablePartition.update({
      where: { id },
      data: {
        ...(dto.name != null ? { name: dto.name.trim() } : {}),
        ...(dto.sortOrder != null ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.active != null ? { active: dto.active } : {}),
      },
    });
  }

  @Post()
  @RequirePerms("tables.manage")
  async create(@Body() dto: TableDto) {
    const partition = await this.prisma.tablePartition.findUnique({ where: { id: dto.partitionId } });
    if (!partition || !partition.active) throw new BadRequestException("Partition not found");
    const name = dto.name.trim();
    const existing = await this.prisma.restaurantTable.findUnique({
      where: { partitionId_name: { partitionId: dto.partitionId, name } },
    });
    if (existing) {
      return this.prisma.restaurantTable.update({
        where: { id: existing.id },
        data: {
          active: true,
          seats: dto.seats ?? existing.seats,
          sortOrder: dto.sortOrder ?? existing.sortOrder,
          area: dto.area?.trim() || partition.name,
        },
      });
    }
    return this.prisma.restaurantTable.create({
      data: {
        name,
        partitionId: dto.partitionId,
        area: dto.area?.trim() || partition.name,
        seats: dto.seats ?? 4,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  @Patch(":id")
  @RequirePerms("tables.manage")
  async update(@Param("id") id: string, @Body() dto: UpdateTableDto) {
    const t = await this.prisma.restaurantTable.findUnique({ where: { id } });
    if (!t) throw new NotFoundException("Table not found");
    if (dto.partitionId) {
      const p = await this.prisma.tablePartition.findUnique({ where: { id: dto.partitionId } });
      if (!p) throw new BadRequestException("Partition not found");
    }
    return this.prisma.restaurantTable.update({
      where: { id },
      data: {
        ...(dto.name != null ? { name: dto.name.trim() } : {}),
        ...(dto.partitionId != null ? { partitionId: dto.partitionId } : {}),
        ...(dto.area !== undefined ? { area: dto.area } : {}),
        ...(dto.seats != null ? { seats: dto.seats } : {}),
        ...(dto.sortOrder != null ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.active != null ? { active: dto.active } : {}),
      },
    });
  }

  @Delete(":id")
  @RequirePerms("tables.manage")
  async remove(@Param("id") id: string) {
    const t = await this.prisma.restaurantTable.findUnique({ where: { id } });
    if (!t) throw new NotFoundException("Table not found");
    await this.prisma.restaurantTable.update({ where: { id }, data: { active: false } });
    return { ok: true };
  }
}

@Module({
  imports: [SystemModule, RealtimeModule],
  providers: [TablesService],
  controllers: [TablesController],
  exports: [TablesService],
})
export class TablesModule {}
