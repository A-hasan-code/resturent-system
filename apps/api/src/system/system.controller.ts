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
import { hostname, platform, release, arch, cpus, totalmem } from "os";
import { dataDir } from "../config/env";
import { BackupService } from "./backup.service";
import { SeedService } from "./seed.service";
import { DeveloperShellService, SHELL_CONFIRM } from "./developer-shell.service";
import { TipService } from "./tip.service";
import { sampleBillPayload } from "../print/receipts";
import { normalizeBillBlockOrder } from "../print/bill-blocks";
import {
  BILL_TEMPLATE_FIELDS,
  DEFAULT_BILL_TEMPLATE,
  normalizeBillTemplate,
} from "../print/bill-template";

class RunSeedDto {
  @IsString()
  @MaxLength(120)
  scriptId!: string;

  @IsString()
  @MaxLength(40)
  confirm!: string;

  @IsOptional()
  @IsBoolean()
  backupFirst?: boolean;
}

class RunShellDto {
  @IsString()
  @MaxLength(4000)
  command!: string;

  @IsString()
  @MaxLength(40)
  confirm!: string;
}

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
  /** JSON array of bill block ids, e.g. ["logo","name",...]. */
  @IsOptional() @IsString() @MaxLength(400) billBlockOrder?: string;
  /** Mail-merge bill template body. */
  @IsOptional() @IsString() @MaxLength(20000) billTemplate?: string;
  /** GrapesJS project JSON (visual builder). */
  @IsOptional() @IsString() @MaxLength(800000) billGrapesProject?: string;
  /** Extra CSS for the bill builder canvas / print-style overrides. */
  @IsOptional() @IsString() @MaxLength(50000) billCustomCss?: string;
  @IsOptional() @IsString() @Matches(/^[01]$/) kotShowOrderBy?: string;
  @IsOptional() @IsString() @MaxLength(120) kotFooter?: string;
  @IsOptional() @IsString() @Matches(/^[01]$/) perHeadEnabled?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) perHeadAmount?: number;
  @IsOptional() @IsString() @MaxLength(40) perHeadLabel?: string;
  @IsOptional() @IsString() @Matches(/^[01]$/) taxEnabled?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) taxPercent?: number;
  @IsOptional() @IsString() @MaxLength(40) ntn?: string;
  @IsOptional() @IsString() @MaxLength(40) strn?: string;
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
  @IsOptional() @IsString() @MaxLength(400) blockOrder?: string;
  @IsOptional() @IsString() @MaxLength(20000) template?: string;
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
    private readonly seeds: SeedService,
    private readonly shell: DeveloperShellService,
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
    const [tipSplit, bill, kot, perHead, taxS, legal] = await Promise.all([
      this.tips.tipSplit(),
      this.tips.printBillOpts(),
      this.tips.printKotOpts(),
      this.settings.perHead(),
      this.settings.getMany("billing."),
      this.settings.getMany("restaurant."),
    ]);
    const taxPercent = Math.max(0, Number(taxS["billing.taxPercent"] ?? "0") || 0);
    return {
      serverName: this.identity.name,
      restaurant: await this.settings.restaurant(),
      tip: { split: tipSplit },
      billing: {
        perHead,
        taxEnabled: (taxS["billing.taxEnabled"] ?? (taxPercent > 0 ? "1" : "0")) !== "0",
        taxPercent,
      },
      legal: {
        ntn: (legal["restaurant.ntn"] || "").trim(),
        strn: (legal["restaurant.strn"] || "").trim(),
      },
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
          blockOrder: bill.blockOrder,
          template: bill.template || DEFAULT_BILL_TEMPLATE,
          grapesProject: bill.grapesProject,
          customCss: bill.customCss || "",
        },
        kot: { showOrderBy: kot.showOrderBy, footer: kot.footer },
        billFields: BILL_TEMPLATE_FIELDS,
        billDefaultTemplate: DEFAULT_BILL_TEMPLATE,
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
        blockOrder: dto.blockOrder != null ? normalizeBillBlockOrder(dto.blockOrder) : saved.blockOrder,
        // Settings live preview: prefer explicit dto template, else code DEFAULT (not a stale grapes dump)
        template:
          dto.template != null && String(dto.template).trim()
            ? normalizeBillTemplate(dto.template)
            : DEFAULT_BILL_TEMPLATE,
        logoPath: this.settings.logoFilePath(),
        paidStampPath: this.settings.paidStampFilePath(),
        unpaidStampPath: this.settings.unpaidStampFilePath(),
      },
      paperWidth
    );
    return {
      text,
      paperWidth,
      logoUrl: this.settings.logoPublicUrl(),
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
      ["billBlockOrder", "print.bill.blockOrder"],
      ["billTemplate", "print.bill.template"],
      ["billGrapesProject", "print.bill.grapesProject"],
      ["billCustomCss", "print.bill.customCss"],
      ["kotShowOrderBy", "print.kot.showOrderBy"],
      ["kotFooter", "print.kot.footer"],
      ["perHeadEnabled", "billing.perHeadEnabled"],
      ["perHeadLabel", "billing.perHeadLabel"],
      ["taxEnabled", "billing.taxEnabled"],
      ["ntn", "restaurant.ntn"],
      ["strn", "restaurant.strn"],
      ["dayStart", "restaurant.dayStart"],
    ];
    for (const [field, key] of map) {
      const v = dto[field];
      if (v != null) {
        let raw = String(v).trim();
        if (field === "tipSplit") raw = raw.toUpperCase();
        if (field === "billBlockOrder") raw = JSON.stringify(normalizeBillBlockOrder(raw));
        if (field === "billTemplate") raw = normalizeBillTemplate(raw);
        await this.settings.set(key, raw);
      }
    }
    if (dto.perHeadAmount != null) {
      await this.settings.set("billing.perHeadAmount", String(dto.perHeadAmount));
    }
    if (dto.taxPercent != null) {
      await this.settings.set("billing.taxPercent", String(dto.taxPercent));
      if (dto.taxPercent > 0 && dto.taxEnabled == null) {
        await this.settings.set("billing.taxEnabled", "1");
      }
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

  @Get("seed")
  @RequirePerms("system.manage")
  listSeedScripts() {
    return this.seeds.list();
  }

  @Post("seed")
  @RequirePerms("system.manage")
  runSeed(@Body() dto: RunSeedDto) {
    return this.seeds.run({
      scriptId: dto.scriptId,
      confirm: dto.confirm,
      backupFirst: dto.backupFirst,
    });
  }

  /** Developer setup page: about + paths + safe CLI cheat-sheet (no arbitrary shell). */
  @Get("developer")
  @RequirePerms("system.manage")
  developer() {
    const info = this.identity.info();
    const dataRoot = dataDir();
    const backupsDir = this.backups.dir();
    const dbUrl = process.env.DATABASE_URL || "";
    let dbHost = "";
    let dbPort = "";
    let dbName = "";
    try {
      const u = new URL(dbUrl.split("?")[0]);
      dbHost = u.hostname;
      dbPort = u.port || "5432";
      dbName = decodeURIComponent(u.pathname.replace(/^\//, ""));
    } catch {
      /* ignore */
    }
    const root = this.shell.workspaceRoot();
    const esc = (p: string) => p.replace(/'/g, "''");
    const commands = [
      { id: "list", title: "List seed scripts", cmd: "pnpm run hotel:dev -- list" },
      { id: "seed", title: "Run full catalog seed", cmd: "pnpm run hotel:dev -- seed" },
      {
        id: "seedFile",
        title: "Run inventory import seed",
        cmd: "pnpm run hotel:dev -- seed -File prisma\\import-pdf-inventory.ts",
      },
      { id: "backups", title: "Open backups folder", cmd: "pnpm run hotel:dev -- backups" },
      { id: "data", title: "Open data folder", cmd: "pnpm run hotel:dev -- data" },
      { id: "db", title: "Show database URL / psql hint", cmd: "pnpm run hotel:dev -- db" },
      { id: "info", title: "Paths + DB summary", cmd: "pnpm run hotel:dev -- info" },
      { id: "dbStatus", title: "Dev DB status", cmd: "pnpm run db:status" },
      {
        id: "services",
        title: "Hotel Windows services",
        cmd: "Get-Service | Where-Object { $_.Name -like '*Hotel*' } | Format-Table -AutoSize | Out-String",
      },
      {
        id: "explorerData",
        title: "Explorer: data directory",
        cmd: `Start-Process explorer.exe -ArgumentList '${esc(dataRoot)}'`,
      },
      {
        id: "explorerBackups",
        title: "Explorer: backups",
        cmd: `Start-Process explorer.exe -ArgumentList '${esc(backupsDir)}'`,
      },
    ];
    return {
      about: {
        app: info.app,
        name: info.name,
        version: info.version,
        hostname: info.hostname || hostname(),
        port: info.port,
        time: info.time,
        urls: info.urls,
        mdnsUrl: info.mdnsUrl,
        platform: platform(),
        release: release(),
        arch: arch(),
        cpus: cpus()?.length ?? 0,
        memoryGb: Math.round((totalmem() / (1024 * 1024 * 1024)) * 10) / 10,
        node: process.version,
      },
      paths: {
        dataDir: dataRoot,
        backupsDir,
        workspaceRoot: root,
        pgDataHint: process.env.HOTEL_DATA_DIR
          ? `${process.env.HOTEL_DATA_DIR}\\pgdata`
          : "(see HOTEL_DATA_DIR / .dev\\pgdata)",
        envFileHint: process.env.HOTEL_ENV_FILE || "apps/api/.env (dev) or ProgramData\\HotelSystem\\hotel.env",
      },
      database: {
        host: dbHost,
        port: dbPort,
        name: dbName,
        // Never return password — only connection shape for operators.
      },
      commands,
      seeds: this.seeds.list(),
      shellConfirmPhrase: SHELL_CONFIRM,
    };
  }

  @Post("developer/shell")
  @RequirePerms("system.manage")
  runShell(@Body() dto: RunShellDto) {
    return this.shell.run({ command: dto.command, confirm: dto.confirm });
  }
}

/** Nest defaults POST to 201; keep logo upload at 200 like the rest of the API. */
function HttpCodeSafe(): MethodDecorator {
  const { HttpCode } = require("@nestjs/common") as typeof import("@nestjs/common");
  return HttpCode(200);
}
