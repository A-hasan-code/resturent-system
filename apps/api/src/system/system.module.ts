import { Global, Module } from "@nestjs/common";
import { SettingsService } from "./settings.service";
import { ServerIdentityService } from "./server-identity.service";
import { DiscoveryService } from "./discovery.service";
import { BackupService } from "./backup.service";
import { TipService } from "./tip.service";
import { SchemaHealService } from "./schema-heal.service";
import { HealthController, SystemController } from "./system.controller";

@Global()
@Module({
  providers: [SettingsService, ServerIdentityService, DiscoveryService, BackupService, TipService, SchemaHealService],
  controllers: [HealthController, SystemController],
  exports: [SettingsService, ServerIdentityService, TipService],
})
export class SystemModule {}
