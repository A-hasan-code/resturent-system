import { Global, Module } from "@nestjs/common";
import { PrintService } from "./print.service";
import { PrintAgentsService } from "./print-agents.service";
import { PrintAgentsController } from "./print-agents.controller";
import { PrintersController, PrintJobsController } from "./printers.controller";

@Global()
@Module({
  providers: [PrintService, PrintAgentsService],
  controllers: [PrintersController, PrintJobsController, PrintAgentsController],
  exports: [PrintService, PrintAgentsService],
})
export class PrintModule {}
