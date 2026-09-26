import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { DashboardService } from "./dashboard.service";
import { DashboardController } from "./dashboard.controller";

@Module({
  imports: [CommonModule],
  providers: [DashboardService],
  controllers: [DashboardController],
})
export class DashboardModule {}
