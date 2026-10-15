import { Module } from "@nestjs/common";
import { StoreService } from "./store.service";
import { PurchasesService } from "./purchases.service";
import { DayUseService } from "./day-use.service";
import { KitchenService } from "./kitchen.service";
import { StoreController } from "./store.controller";
import { SystemModule } from "../system/system.module";
import { PrintModule } from "../print/print.module";

@Module({
  imports: [SystemModule, PrintModule],
  providers: [StoreService, PurchasesService, DayUseService, KitchenService],
  controllers: [StoreController],
})
export class StoreModule {}
