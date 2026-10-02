import {
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

class TableDto {
  @IsString() @MaxLength(30) name!: string;
  @IsOptional() @IsString() @MaxLength(30) area?: string;
  @IsOptional() @IsInt() @Min(1) seats?: number;
  @IsOptional() @IsInt() sortOrder?: number;
}

class UpdateTableDto {
  @IsOptional() @IsString() @MaxLength(30) name?: string;
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

@Injectable()
export class TablesService {
  constructor(private readonly prisma: PrismaService) {}

  async board() {
    const [tables, open] = await Promise.all([
      this.prisma.restaurantTable.findMany({
        where: { active: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
      this.prisma.order.findMany({
        where: { ...OPEN_ORDER_WHERE, tableNo: { not: null } },
        include: { waiter: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    const byTable = new Map(open.map((o) => [o.tableNo!, o]));
    return tables.map((t) => {
      const o = byTable.get(t.name);
      return {
        id: t.id,
        name: t.name,
        area: t.area,
        seats: t.seats,
        order: o
          ? {
              id: o.id,
              orderNo: o.orderNo,
              status: o.status,
              paymentStatus: o.paymentStatus,
              total: toNumber(o.total),
              billRequested: !!o.billRequestedAt,
              waiterId: o.waiter?.id ?? null,
              waiter: o.waiter?.name ?? null,
              since: o.createdAt,
            }
          : null,
      };
    });
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
  @RequirePerms("order.create", "bill.view", "tables.manage")
  board() {
    return this.tables.board();
  }

  @Get("all")
  @RequirePerms("tables.manage")
  all() {
    return this.prisma.restaurantTable.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  }

  @Post()
  @RequirePerms("tables.manage")
  create(@Body() dto: TableDto) {
    return this.prisma.restaurantTable.upsert({
      where: { name: dto.name.trim() },
      update: { ...dto, name: dto.name.trim(), active: true },
      create: { ...dto, name: dto.name.trim() },
    });
  }

  @Patch(":id")
  @RequirePerms("tables.manage")
  async update(@Param("id") id: string, @Body() dto: UpdateTableDto) {
    const t = await this.prisma.restaurantTable.findUnique({ where: { id } });
    if (!t) throw new NotFoundException("Table not found");
    return this.prisma.restaurantTable.update({ where: { id }, data: dto });
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
