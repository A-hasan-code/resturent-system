import { Global, Module } from "@nestjs/common";
import { PrintService } from "./print.service";
import { PrintersController, PrintJobsController } from "./printers.controller";

@Global()
@Module({
  providers: [PrintService],
  controllers: [PrintersController, PrintJobsController],
  exports: [PrintService],
})
export class PrintModule {}
