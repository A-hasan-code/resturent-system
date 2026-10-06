import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../common/permissions.guard";
import { AuthUser, CurrentUser, RequirePerms } from "../common/decorators";
import { RealtimeService } from "../realtime/realtime.service";
import { ServerIdentityService } from "./server-identity.service";
import { SettingsService } from "./settings.service";
import { BackupService } from "./backup.service";
import { TipService } from "./tip.service";
import { sampleBillPayload } from "../print/receipts";

class UpdateSettingsDto {
  @IsOptional() @IsString() @MaxLength(80) serverName?: string;
  @IsOptional() @IsString() @MaxLength(80) restaurantName?: string;
  @IsOptional() @IsString() @MaxLength(120) tagline?: string;
  @IsOptional() @IsString() @MaxLength(160) address?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @Matches(/^#[0-9a-fA-F]{6}$/) accent?: string;
  /** ORDER_TAKER | SERVER | SPLIT_50 | POOL */
  @IsOptional() @IsString() @Matches(/^(ORDER_TAKER|SERVER|SPLIT_50|POOL)$/i) tipSplit?: string;
  @IsOptional() @IsString() @Matches(/^[01]$/) billShowLogo?: string;
  @IsOptional() @IsString() @Matches(/^[01]$/) billShowName?: string;
  @IsOptional() @IsString() @Matches(/^[01]$/) billShowTagline?: string;
  @IsOptional() @IsString() @Matches(/^[01]$/) billShowAddress?: string;
  @IsOptional() @IsString() @Matches(/^[01]$/) billShowPhone?: string;
  @IsOptional() @IsString() @MaxLength(40) billTitle?: string;
  @IsOptional() @IsString() @Matches(/^[01]$/) billShowOrderBy?: string;
  @IsOptional() @IsString() @Matches(/^[01]$/) billShowServedBy?: string;
  @IsOptional() @IsString() @Matches(/^[01]$/) billShowCashier?: string;
  @IsOptional() @IsString() @Matches(/^[01]$/) billShowTip?: string;
  @IsOptional() @IsString() @Matches(/^[01]$/) billShowPaidStamp?: string;
  @IsOptional() @IsString() @MaxLength(40) billPaidStampText?: string;
  @IsOptional() @IsString() @Matches(/^[01]$/) billPaidStampBig?: string;
  @IsOptional() @IsString() @MaxLength(120) billFooter?: string;
  @IsOptional() @IsString() @Matches(/^[01]$/) kotShowOrderBy?: string;
  @IsOptional() @IsString() @MaxLength(120) kotFooter?: string;
  @IsOptional() @IsString() @Matches(/^[01]$/) perHeadEnabled?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) perHeadAmount?: number;
  @IsOptional() @IsString() @MaxLength(40) perHeadLabel?: string;
  /** Menu items included with per-head (kitchen lines at Rs 0). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => PerHeadPackageItemDto)
  perHeadPackage?: PerHeadPackageItemDto[];
  /** Business day starts at this server time, HH:mm. Runs until the same time next day. */
  @IsOptional() @IsString() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) dayStart?: string;
}

class PerHeadPackageItemDto {
  @IsString() menuItemId!: string;
  @Type(() => Number) @IsNumber() @Min(0.001) qty!: number;
  @IsBoolean() variable!: boolean;
}

class BillPreviewDto {
  @IsOptional() @IsString() @Matches(/^[01]$/) showLogo?: string;
  @IsOptional() @IsString() @Matches(/^[01]$/) showName?: string;
  @IsOptional() @IsString() @Matches(/^[01]$/) showTagline?: string;
  @IsOptional() @IsString() @Matches(/^[01]$/) showAddress?: string;
  @IsOptional() @IsString() @Matches(/^[01]$/) showPhone?: string;
  @IsOptional() @IsString() @MaxLength(40) title?: string;
  @IsOptional() @IsString() @Matches(/^[01]$/) showOrderBy?: string;
  @IsOptional() @IsString() @Matches(/^[01]$/) showServedBy?: string;
  @IsOptional() @IsString() @Matches(/^[01]$/) showCashier?: string;
  @IsOptional() @IsString() @Matches(/^[01]$/) showTip?: string;
  @IsOptional() @IsString() @Matches(/^[01]$/) showPaidStamp?: string;
  @IsOptional() @IsString() @MaxLength(40) paidStampText?: string;
  @IsOptional() @IsString() @Matches(/^[01]$/) paidStampBig?: string;
  @IsOptional() @IsString() @MaxLength(120) footer?: string;
  /** Thermal roll width in mm: 58 | 72 | 80 | 112 */
  @IsOptional() @Type(() => Number) @IsNumber() paperWidth?: number;
}

@Controller()
export class HealthController {
  constructor(
    private readonly identity: ServerIdentityService,
    private readonly settings: SettingsService
  ) {}

  /** Used by tablets / desktop app to find and verify this server on the LAN. */
  @Get("health")
  health() {
    return this.identity.identity();
  }

  @Get("system/info")
  async info() {
    return { ...this.identity.info(), restaurant: await this.settings.restaurant() };
  }
}

@Controller("system")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SystemController {
  constructor(
    private readonly identity: ServerIdentityService,
    private readonly settings: SettingsService,
    private readonly backups: BackupService,
    private readonly tips: TipService,
    private readonly realtime: RealtimeService
  ) {}

  /** Any signed-in user can see whether new orders are allowed. */
  @Get("hotel")
  hotelStatus() {
    return this.settings.hotelStatus();
  }

  @Post("hotel/close")
  async closeHotel(@CurrentUser() user: AuthUser) {
    const status = await this.settings.closeHotel(user);
    this.realtime.hotelStatus(status);
    return status;
  }

  @Post("hotel/open")
  async openHotel(@CurrentUser() user: AuthUser) {
    const status = await this.settings.openHotel(user);
    this.realtime.hotelStatus(status);
    return status;
  }

  @Get("settings")
  async getSettings() {
    const [tipSplit, bill, kot, perHead] = await Promise.all([
      this.tips.tipSplit(),
      this.tips.printBillOpts(),
      this.tips.printKotOpts(),
      this.settings.perHead(),
    ]);
    return {
      serverName: this.identity.name,
      restaurant: await this.settings.restaurant(),
      tip: { split: tipSplit },
      billing: { perHead },
      print: {
        bill: {
          showLogo: bill.showLogo,
          showName: bill.showName,
          showTagline: bill.showTagline,
          showAddress: bill.showAddress,
          showPhone: bill.showPhone,
          title: bill.title,
          showOrderBy: bill.showOrderBy,
          showServedBy: bill.showServedBy,
          showCashier: bill.showCashier,
          showTip: bill.showTip,
          showPaidStamp: bill.showPaidStamp,
          paidStampText: bill.paidStampText,
          paidStampBig: bill.paidStampBig,
          footer: bill.footer,
        },
        kot: { showOrderBy: kot.showOrderBy, footer: kot.footer },
      },
    };
  }

  @Post("bill-preview")
  @HttpCodeSafe()
  @RequirePerms("system.manage")
  async billPreview(@Body() dto: BillPreviewDto) {
    const saved = await this.tips.printBillOpts();
    const restaurant = await this.settings.restaurant();
    const on = (v: string | undefined, fallback: boolean) => (v == null ? fallback : v !== "0");
    const paperWidth = [58, 72, 80, 112].includes(Number(dto.paperWidth))
      ? Number(dto.paperWidth)
      : 80;
    const text = sampleBillPayload(
      {
        name: restaurant.name,
        tagline: restaurant.tagline,
        address: restaurant.address,
        phone: restaurant.phone,
      },
      {
        showLogo: on(dto.showLogo, saved.showLogo),
        showName: on(dto.showName, saved.showName),
        showTagline: on(dto.showTagline, saved.showTagline),
        showAddress: on(dto.showAddress, saved.showAddress),
        showPhone: on(dto.showPhone, saved.showPhone),
        title: dto.title?.trim() || saved.title,
        showOrderBy: on(dto.showOrderBy, saved.showOrderBy),
        showServedBy: on(dto.showServedBy, saved.showServedBy),
        showCashier: on(dto.showCashier, saved.showCashier),
        showTip: on(dto.showTip, saved.showTip),
        showPaidStamp: on(dto.showPaidStamp, saved.showPaidStamp),
        paidStampText: dto.paidStampText?.trim() || saved.paidStampText,
        paidStampBig: on(dto.paidStampBig, saved.paidStampBig),
        footer: dto.footer?.trim() ?? saved.footer,
        logoPath: this.settings.logoFilePath(),
        paidStampPath: this.settings.paidStampFilePath(),
        unpaidStampPath: this.settings.unpaidStampFilePath(),
      },
      paperWidth
    );
    return {
      text,
      paperWidth,
      logoUrl: this.settings.logoFilePath()
        ? `/branding/${this.settings.logoFilePath()!.split(/[/\\]/).pop()}`
        : null,
      paidStampUrl: "/branding/paid-stamp.png",
      unpaidStampUrl: "/branding/unpaid-stamp.png",
    };
  }

  @Patch("settings")
  @RequirePerms("system.manage")
  async updateSettings(@Body() dto: UpdateSettingsDto) {
    if (dto.serverName != null) await this.identity.rename(dto.serverName);
    const map: Array<[keyof UpdateSettingsDto, string]> = [
      ["restaurantName", "restaurant.name"],
      ["tagline", "restaurant.tagline"],
      ["address", "restaurant.address"],
      ["phone", "restaurant.phone"],
      ["accent", "restaurant.accent"],
      ["tipSplit", "tip.split"],
      ["billShowLogo", "print.bill.showLogo"],
      ["billShowName", "print.bill.showName"],
      ["billShowTagline", "print.bill.showTagline"],
      ["billShowAddress", "print.bill.showAddress"],
      ["billShowPhone", "print.bill.showPhone"],
      ["billTitle", "print.bill.title"],
      ["billShowOrderBy", "print.bill.showOrderBy"],
      ["billShowServedBy", "print.bill.showServedBy"],
      ["billShowCashier", "print.bill.showCashier"],
      ["billShowTip", "print.bill.showTip"],
      ["billShowPaidStamp", "print.bill.showPaidStamp"],
      ["billPaidStampText", "print.bill.paidStampText"],
      ["billPaidStampBig", "print.bill.paidStampBig"],
      ["billFooter", "print.bill.footer"],
      ["kotShowOrderBy", "print.kot.showOrderBy"],
      ["kotFooter", "print.kot.footer"],
      ["perHeadEnabled", "billing.perHeadEnabled"],
      ["perHeadLabel", "billing.perHeadLabel"],
      ["dayStart", "restaurant.dayStart"],
    ];
    for (const [field, key] of map) {
      const v = dto[field];
      if (v != null) {
        const raw = String(v).trim();
        await this.settings.set(key, field === "tipSplit" ? raw.toUpperCase() : raw);
      }
    }
    if (dto.perHeadAmount != null) {
      await this.settings.set("billing.perHeadAmount", String(dto.perHeadAmount));
    }
    if (dto.perHeadPackage != null) {
      await this.settings.savePerHeadPackage(
        dto.perHeadPackage.map((p) => ({
          menuItemId: p.menuItemId,
          qty: p.qty,
          variable: p.variable,
        }))
      );
    }
    return this.getSettings();
  }

  @Post("logo")
  @HttpCodeSafe()
  @RequirePerms("system.manage")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024 },
    })
  )
  async uploadLogo(@UploadedFile() file: Express.Multer.File) {
    const restaurant = await this.settings.saveLogo(file);
    return { restaurant };
  }

  @Delete("logo")
  @RequirePerms("system.manage")
  async removeLogo() {
    return { restaurant: await this.settings.clearLogo() };
  }

  @Get("backups")
  @RequirePerms("system.manage")
  listBackups() {
    return { dir: this.backups.dir(), files: this.backups.list() };
  }

  @Post("backups")
  @RequirePerms("system.manage")
  createBackup() {
    return this.backups.create("manual");
  }

  @Post("backups/:file/restore")
  @RequirePerms("system.manage")
  restore(@Param("file") file: string) {
    return this.backups.restore(file);
  }
}

/** Nest defaults POST to 201; keep logo upload at 200 like the rest of the API. */
function HttpCodeSafe(): MethodDecorator {
  const { HttpCode } = require("@nestjs/common") as typeof import("@nestjs/common");
  return HttpCode(200);
}
