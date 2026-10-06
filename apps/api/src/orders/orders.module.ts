import { Module } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { OrdersController } from "./orders.controller";
import { SystemModule } from "../system/system.module";
import { SpecialsModule } from "../specials/specials.module";

@Module({
  imports: [SystemModule, SpecialsModule],
  providers: [OrdersService],
  controllers: [OrdersController],
})
export class OrdersModule {}
