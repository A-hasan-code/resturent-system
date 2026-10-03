import { Module } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { OrdersController } from "./orders.controller";
import { SystemModule } from "../system/system.module";

@Module({
  imports: [SystemModule],
  providers: [OrdersService],
  controllers: [OrdersController],
})
export class OrdersModule {}
