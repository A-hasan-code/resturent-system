import { Body, Controller, Get, Module, Post, Query, StreamableFile, UseGuards } from "@nestjs/common";
import { IsOptional, IsString } from "class-validator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../common/permissions.guard";
import { AuthUser, CurrentUser, RequirePerms } from "../common/decorators";
import { PrintModule } from "../print/print.module";
import { PrintService } from "../print/print.service";
import { SaveDayCashCloseDto } from "./close.dto";
import { CloseService } from "./close.service";

class PrintReportDto {
  @IsOptional() @IsString() printerId?: string;
}

@Controller("close")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CloseController {
  constructor(
    private readonly close: CloseService,
    private readonly print: PrintService
  ) {}

  @Get("preview")
  @RequirePerms("close.view", "close.manage")
  preview(@Query("date") date?: string, @CurrentUser() user?: AuthUser) {
    return this.close.preview(date, user);
  }

  @Get("history")
  @RequirePerms("close.view", "close.manage")
  history(@Query("limit") limit?: string) {
    return this.close.history(limit ? Number(limit) : 60);
  }

  @Get("export")
  @RequirePerms("close.view", "close.manage")
  async export(@Query("date") date?: string) {
    const sheet = await this.close.preview(date);
    const pdf = await this.close.toPdf(date);
    return new StreamableFile(pdf, {
      type: "application/pdf",
      disposition: `attachment; filename="close-${sheet.businessDate}.pdf"`,
    });
  }

  @Post("print")
  @RequirePerms("close.view", "close.manage")
  async printPdf(
    @Query("date") date: string | undefined,
    @Body() dto: PrintReportDto,
    @CurrentUser() user: AuthUser
  ) {
    const sheet = await this.close.preview(date);
    const pdf = await this.close.toPdf(date);
    return this.print.printPdfReport({
      title: `Close ${sheet.businessDate}`,
      pdf,
      printerId: dto.printerId,
      requestedById: user.id,
    });
  }

  @Post()
  @RequirePerms("close.manage")
  save(@Body() dto: SaveDayCashCloseDto, @CurrentUser() user: AuthUser) {
    return this.close.save(dto, user);
  }
}

@Module({
  imports: [PrintModule],
  providers: [CloseService],
  controllers: [CloseController],
})
export class CloseModule {}
