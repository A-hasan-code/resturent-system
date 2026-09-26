import { Module } from "@nestjs/common";
import { PrismaModule } from "./prisma/prisma.module";
import { CommonModule } from "./common/common.module";
import { AuthModule } from "./auth/auth.module";
import { StoreModule } from "./store/store.module";
import { RecipesModule } from "./recipes/recipes.module";
import { MenuModule } from "./menu/menu.module";
import { OrdersModule } from "./orders/orders.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [
    PrismaModule,
    CommonModule,
    AuthModule,
    StoreModule,
    RecipesModule,
    MenuModule,
    OrdersModule,
    DashboardModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
