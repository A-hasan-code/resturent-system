import { Global, Module } from "@nestjs/common";
import { SettingsService } from "./settings.service";
import { ServerIdentityService } from "./server-identity.service";
import { DiscoveryService } from "./discovery.service";
import { BackupService } from "./backup.service";
import { HealthController, SystemController } from "./system.controller";

@Global()
@Module({
  providers: [SettingsService, ServerIdentityService, DiscoveryService, BackupService],
  controllers: [HealthController, SystemController],
  exports: [SettingsService, ServerIdentityService],
})
export class SystemModule {}
