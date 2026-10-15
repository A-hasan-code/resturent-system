import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { ExpensesModule } from "../expenses/expenses.controller";
import { SystemModule } from "../system/system.module";
import { DashboardService } from "./dashboard.service";
import { DashboardController } from "./dashboard.controller";

@Module({
  imports: [CommonModule, ExpensesModule, SystemModule],
  providers: [DashboardService],
  controllers: [DashboardController],
})
export class DashboardModule {}
