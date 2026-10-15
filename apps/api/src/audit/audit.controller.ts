import { Body, Controller, Get, Module, Param, Post, Query, StreamableFile, UseGuards } from "@nestjs/common";
import { IsOptional, IsString } from "class-validator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../common/permissions.guard";
import { AuthUser, CurrentUser, RequirePerms } from "../common/decorators";
import { PrintModule } from "../print/print.module";
import { PrintService } from "../print/print.service";
import { AuditService } from "./audit.service";

class PrintReportDto {
  @IsOptional() @IsString() printerId?: string;
}

@Controller("audit")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePerms("payments.view")
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly print: PrintService
  ) {}

  @Get("meta")
  async meta() {
    return { firstSaleDate: await this.audit.firstSaleDate() };
  }

  @Get()
  report(@Query("from") from: string, @Query("to") to: string, @Query("staff") staff?: string) {
    return this.audit.report(from, to, staff);
  }

  @Get("export")
  async export(@Query("from") from: string, @Query("to") to: string, @Query("staff") staff?: string) {
    const report = await this.audit.report(from, to, staff);
    const pdf = await this.audit.toPdf(report);
    return file(`sales-report-${from}-to-${to}.pdf`, pdf);
  }

  @Post("export/print")
  async printExport(
    @Query("from") from: string,
    @Query("to") to: string,
    @Query("staff") staff: string | undefined,
    @Body() dto: PrintReportDto,
    @CurrentUser() user: AuthUser
  ) {
    const report = await this.audit.report(from, to, staff);
    const pdf = await this.audit.toPdf(report);
    return this.print.printPdfReport({
      title: `Sales report ${from} to ${to}`,
      pdf,
      printerId: dto.printerId,
      requestedById: user.id,
    });
  }

  @Get("files")
  files() {
    return { dir: this.audit.dir(), files: this.audit.listStored() };
  }

  @Get("files/:file")
  stored(@Param("file") fileName: string) {
    const found = this.audit.readStored(fileName);
    return file(found.file, found.body);
  }
}

function file(filename: string, body: Buffer) {
  return new StreamableFile(body, {
    type: "application/pdf",
    disposition: `attachment; filename="${filename}"`,
  });
}

@Module({
  imports: [PrintModule],
  providers: [AuditService],
  controllers: [AuditController],
})
export class AuditModule {}
