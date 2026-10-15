import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { IsOptional, IsString, Matches } from "class-validator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../common/permissions.guard";
import { RequirePerms } from "../common/decorators";
import { FinanceService } from "./finance.service";

class UnlockDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  businessDate!: string;
}

class DateRangeQuery {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;
}

@Controller("finance")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get("tax")
  @RequirePerms("bill.view", "order.pay", "payments.view", "system.manage")
  tax() {
    return this.finance.taxSettings();
  }

  @Get("day-pnl")
  @RequirePerms("payments.view", "close.view", "reports.view")
  dayPnl(@Query() q: DateRangeQuery) {
    return this.finance.dayPnl(q.date);
  }

  @Get("exceptions")
  @RequirePerms("payments.view", "reports.view")
  exceptions(@Query() q: DateRangeQuery) {
    const to = q.to || new Date().toISOString().slice(0, 10);
    const from = q.from || to.slice(0, 8) + "01";
    return this.finance.exceptions(from, to);
  }

  @Post("unlock-day")
  @RequirePerms("system.manage")
  unlock(@Body() dto: UnlockDto) {
    return this.finance.unlockDay(dto.businessDate);
  }
}
