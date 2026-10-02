import {
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

class PrinterDto {
  @IsString() @MaxLength(60) name!: string;
  @IsEnum(PrinterKind) kind!: PrinterKind;
  @IsString() @MaxLength(200) target!: string;
  @IsOptional() @IsIn([58, 80]) paperWidth?: number;
  @IsOptional() @IsBoolean() printsKot?: boolean;
  @IsOptional() @IsBoolean() printsBill?: boolean;
  @IsOptional() @IsString() @MaxLength(300) categories?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

class UpdatePrinterDto {
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  @IsOptional() @IsEnum(PrinterKind) kind?: PrinterKind;
  @IsOptional() @IsString() @MaxLength(200) target?: string;
  @IsOptional() @IsIn([58, 80]) paperWidth?: number;
  @IsOptional() @IsBoolean() printsKot?: boolean;
  @IsOptional() @IsBoolean() printsBill?: boolean;
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
  list() {
    return this.prisma.printer.findMany({ orderBy: { createdAt: "asc" } });
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
    return this.prisma.printer.create({ data: dto });
  }

  @Patch(":id")
  @RequirePerms("printers.manage")
  async update(@Param("id") id: string, @Body() dto: UpdatePrinterDto) {
    const exists = await this.prisma.printer.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException("Printer not found");
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
