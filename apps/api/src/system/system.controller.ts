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
import { IsOptional, IsString, Matches, MaxLength } from "class-validator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../common/permissions.guard";
import { RequirePerms } from "../common/decorators";
import { ServerIdentityService } from "./server-identity.service";
import { SettingsService } from "./settings.service";
import { BackupService } from "./backup.service";

class UpdateSettingsDto {
  @IsOptional() @IsString() @MaxLength(80) serverName?: string;
  @IsOptional() @IsString() @MaxLength(80) restaurantName?: string;
  @IsOptional() @IsString() @MaxLength(120) tagline?: string;
  @IsOptional() @IsString() @MaxLength(160) address?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @Matches(/^#[0-9a-fA-F]{6}$/) accent?: string;
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
    private readonly backups: BackupService
  ) {}

  @Get("settings")
  async getSettings() {
    return { serverName: this.identity.name, restaurant: await this.settings.restaurant() };
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
    ];
    for (const [field, key] of map) {
      const v = dto[field];
      if (v != null) await this.settings.set(key, String(v).trim());
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
