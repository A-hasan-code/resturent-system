import { Global, Module } from "@nestjs/common";
import { SettingsService } from "./settings.service";
import { ServerIdentityService } from "./server-identity.service";
import { DiscoveryService } from "./discovery.service";
import { BackupService } from "./backup.service";
import { SeedService } from "./seed.service";
import { DeveloperShellService } from "./developer-shell.service";
import { TipService } from "./tip.service";
import { SchemaHealService } from "./schema-heal.service";
import { MachineLogService } from "./machine-log.service";
import { NetworkHealthService } from "./network-health.service";
import { HealthController, SystemController } from "./system.controller";

@Global()
@Module({
  providers: [
    SettingsService,
    ServerIdentityService,
    DiscoveryService,
    BackupService,
    SeedService,
    DeveloperShellService,
    TipService,
    SchemaHealService,
    MachineLogService,
    NetworkHealthService,
  ],
  controllers: [HealthController, SystemController],
  exports: [SettingsService, ServerIdentityService, TipService, MachineLogService],
})
export class SystemModule {}
