import { Global, Module } from "@nestjs/common";
import { CostingService } from "./costing.service";

@Global()
@Module({
  providers: [CostingService],
  exports: [CostingService],
})
export class CommonModule {}
