import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { PrinterKind } from "@prisma/client";
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../common/permissions.guard";
import { AuthUser, CurrentUser, RequirePerms } from "../common/decorators";
import { PrismaService } from "../prisma/prisma.service";
import { PrintService } from "./print.service";
import { listWindowsPrinters } from "./drivers";

const MANUAL_KINDS = [PrinterKind.WINDOWS, PrinterKind.NETWORK, PrinterKind.FILE] as const;

class PrinterDto {
  @IsString() @MaxLength(60) name!: string;
  @IsEnum(PrinterKind) kind!: PrinterKind;
  @IsString() @MaxLength(200) target!: string;
  @IsOptional() @IsIn([58, 72, 80, 112]) paperWidth?: number;
  @IsOptional() @IsBoolean() printsKot?: boolean;
  @IsOptional() @IsBoolean() printsBill?: boolean;
  @IsOptional() @IsString() @MaxLength(60) station?: string;
  @IsOptional() @IsString() @MaxLength(300) categories?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

class UpdatePrinterDto {
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  @IsOptional() @IsEnum(PrinterKind) kind?: PrinterKind;
  @IsOptional() @IsString() @MaxLength(200) target?: string;
  @IsOptional() @IsIn([58, 72, 80, 112]) paperWidth?: number;
  @IsOptional() @IsBoolean() printsKot?: boolean;
  @IsOptional() @IsBoolean() printsBill?: boolean;
  @IsOptional() @IsString() @MaxLength(60) station?: string;
  @IsOptional() @IsString() @MaxLength(300) categories?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

@Controller("printers")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PrintersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly print: PrintService
  ) {}

  @Get()
  @RequirePerms("printers.manage", "print.bill", "print.kot")
  async list() {
    const rows = await this.prisma.printer.findMany({
      include: {
        agent: { select: { id: true, hostname: true, displayName: true, lastSeenAt: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    const onlineMs = 45_000;
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      target: p.target,
      paperWidth: p.paperWidth,
      printsKot: p.printsKot,
      printsBill: p.printsBill,
      station: p.station,
      categories: p.categories,
      active: p.active,
      agentId: p.agentId,
      agent: p.agent
        ? {
            id: p.agent.id,
            hostname: p.agent.hostname,
            displayName: p.agent.displayName || p.agent.hostname,
            lastSeenAt: p.agent.lastSeenAt,
            online: Date.now() - p.agent.lastSeenAt.getTime() < onlineMs,
          }
        : null,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));
  }

  /** Printers installed in Windows on the server PC (USB / shared). */
  @Get("system")
  @RequirePerms("printers.manage")
  async system() {
    try {
      return await listWindowsPrinters();
    } catch {
      return [];
    }
  }

  @Post()
  @RequirePerms("printers.manage")
  create(@Body() dto: PrinterDto) {
    if (!MANUAL_KINDS.includes(dto.kind as (typeof MANUAL_KINDS)[number])) {
      throw new BadRequestException(
        "Additional PC USB printers appear automatically when the desktop app is running — do not add them manually",
      );
    }
    return this.prisma.printer.create({ data: dto });
  }

  @Patch(":id")
  @RequirePerms("printers.manage")
  async update(@Param("id") id: string, @Body() dto: UpdatePrinterDto) {
    const exists = await this.prisma.printer.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException("Printer not found");
    if (exists.kind === "AGENT") {
      // Agent owns connection/target; admin only configures role + paper.
      const { name, paperWidth, printsKot, printsBill, station, categories, active } = dto;
      return this.prisma.printer.update({
        where: { id },
        data: { name, paperWidth, printsKot, printsBill, station, categories, active },
      });
    }
    if (dto.kind === "AGENT") {
      throw new BadRequestException("Cannot convert a printer to Additional PC USB manually");
    }
    return this.prisma.printer.update({ where: { id }, data: dto });
  }

  @Delete(":id")
  @RequirePerms("printers.manage")
  async remove(@Param("id") id: string) {
    await this.prisma.printer.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("Printer not found");
    });
    return { ok: true };
  }

  @Post(":id/test")
  @RequirePerms("printers.manage")
  test(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.print.enqueueTest(id, user.id);
  }
}

@Controller("print")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PrintJobsController {
  constructor(private readonly print: PrintService) {}

  @Get("jobs")
  @RequirePerms("printers.manage", "print.bill")
  jobs(@Query("status") status?: string) {
    return this.print.listJobs(status);
  }

  @Get("jobs/:id/preview")
  @RequirePerms("printers.manage", "print.bill", "print.kot")
  preview(@Param("id") id: string) {
    return this.print.preview(id);
  }

  @Post("jobs/:id/retry")
  @RequirePerms("printers.manage", "print.bill", "print.kot")
  retry(@Param("id") id: string) {
    return this.print.retry(id);
  }
}
