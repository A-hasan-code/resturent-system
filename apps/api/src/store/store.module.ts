import { Module } from "@nestjs/common";
import { StoreService } from "./store.service";
import { PurchasesService } from "./purchases.service";
import { DayUseService } from "./day-use.service";
import { StoreController } from "./store.controller";
import { SystemModule } from "../system/system.module";

@Module({
  imports: [SystemModule],
  providers: [StoreService, PurchasesService, DayUseService],
  controllers: [StoreController],
})
export class StoreModule {}
