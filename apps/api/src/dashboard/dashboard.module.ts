import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { ExpensesModule } from "../expenses/expenses.controller";
import { DashboardService } from "./dashboard.service";
import { DashboardController } from "./dashboard.controller";

@Module({
  imports: [CommonModule, ExpensesModule],
  providers: [DashboardService],
  controllers: [DashboardController],
})
export class DashboardModule {}
