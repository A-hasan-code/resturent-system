import { Module } from "@nestjs/common";
import { SystemModule } from "../system/system.module";
import { CreditController } from "./credit.controller";
import { CreditService } from "./credit.service";

@Module({
  imports: [SystemModule],
  controllers: [CreditController],
  providers: [CreditService],
})
export class CreditModule {}
