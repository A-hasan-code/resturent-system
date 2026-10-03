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
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../common/permissions.guard";
import { RequirePerms } from "../common/decorators";
import { PrismaService } from "../prisma/prisma.service";
import { toNumber } from "../common/units";

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

/** An order keeps its table busy until it is paid or cancelled. */
export const OPEN_ORDER_WHERE = {
  status: { not: "CANCELLED" as const },
  paymentStatus: { not: "PAID" as const },
};

export function tableLabel(partitionName: string | null | undefined, tableName: string) {
  return partitionName ? `${partitionName} · ${tableName}` : tableName;
}

@Injectable()
export class TablesService {
  constructor(private readonly prisma: PrismaService) {}

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
  providers: [TablesService],
  controllers: [TablesController],
  exports: [TablesService],
})
export class TablesModule {}
