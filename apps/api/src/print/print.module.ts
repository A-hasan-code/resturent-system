import { Global, Module } from "@nestjs/common";
import { FinanceModule } from "../finance/finance.module";
import { PrintService } from "./print.service";
import { PrintAgentsService } from "./print-agents.service";
import { PrintAgentsController } from "./print-agents.controller";
import { PrintersController, PrintJobsController } from "./printers.controller";

@Global()
@Module({
  imports: [FinanceModule],
  providers: [PrintService, PrintAgentsService],
  controllers: [PrintersController, PrintJobsController, PrintAgentsController],
  exports: [PrintService, PrintAgentsService],
})
export class PrintModule {}
