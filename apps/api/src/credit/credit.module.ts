import { Module } from "@nestjs/common";
import { SystemModule } from "../system/system.module";
import { FinanceModule } from "../finance/finance.module";
import { PrintModule } from "../print/print.module";
import { CreditController } from "./credit.controller";
import { CreditService } from "./credit.service";

@Module({
  imports: [SystemModule, FinanceModule, PrintModule],
  controllers: [CreditController],
  providers: [CreditService],
})
export class CreditModule {}
