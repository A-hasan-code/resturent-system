import { Module } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { OrdersController } from "./orders.controller";
import { SystemModule } from "../system/system.module";
import { SpecialsModule } from "../specials/specials.module";
import { FinanceModule } from "../finance/finance.module";

@Module({
  imports: [SystemModule, SpecialsModule, FinanceModule],
  providers: [OrdersService],
  controllers: [OrdersController],
})
export class OrdersModule {}
