import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../common/permissions.guard";
import { AuthUser, CurrentUser, RequirePerms } from "../common/decorators";
import { CreditService } from "./credit.service";
import { CreditCustomerDto, SettleCreditDto } from "./dto";

@Controller("credit-customers")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CreditController {
  constructor(private readonly credit: CreditService) {}

  @Get()
  @RequirePerms("bill.view", "order.pay")
  list(@Query("q") q?: string) {
    return this.credit.list(q);
  }

  @Get(":id")
  @RequirePerms("bill.view", "order.pay")
  get(@Param("id") id: string) {
    return this.credit.get(id);
  }

  @Post()
  @RequirePerms("order.pay")
  create(@Body() dto: CreditCustomerDto) {
    return this.credit.create(dto);
  }

  @Patch(":id")
  @RequirePerms("order.pay")
  update(@Param("id") id: string, @Body() dto: CreditCustomerDto) {
    return this.credit.update(id, dto);
  }

  @Post(":id/settle")
  @RequirePerms("order.pay")
  settle(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: SettleCreditDto) {
    return this.credit.settle(user, id, dto.amount);
  }
}
