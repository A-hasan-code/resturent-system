import { Module } from "@nestjs/common";
import { PrismaModule } from "./prisma/prisma.module";
import { CommonModule } from "./common/common.module";
import { SystemModule } from "./system/system.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { PrintModule } from "./print/print.module";
import { AuthModule } from "./auth/auth.module";
import { StoreModule } from "./store/store.module";
import { RecipesModule } from "./recipes/recipes.module";
import { MenuModule } from "./menu/menu.module";
import { TablesModule } from "./tables/tables.controller";
import { OrdersModule } from "./orders/orders.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { UsersModule } from "./users/users.controller";
import { PaymentsModule } from "./payments/payments.controller";
import { AuditModule } from "./audit/audit.controller";
import { ExpensesModule } from "./expenses/expenses.controller";
import { CloseModule } from "./close/close.controller";
import { CreditModule } from "./credit/credit.module";
import { SpecialsModule } from "./specials/specials.module";
import { FinanceModule } from "./finance/finance.module";

@Module({
  imports: [
    PrismaModule,
    CommonModule,
    SystemModule,
    RealtimeModule,
    PrintModule,
    AuthModule,
    StoreModule,
    RecipesModule,
    MenuModule,
    TablesModule,
    OrdersModule,
    DashboardModule,
    UsersModule,
    PaymentsModule,
    AuditModule,
    ExpensesModule,
    CloseModule,
    CreditModule,
    SpecialsModule,
    FinanceModule,
  ],
})
export class AppModule {}
