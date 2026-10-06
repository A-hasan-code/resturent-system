import { Controller, Get, HttpCode, Module, Param, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../common/permissions.guard";
import { AuthUser, CurrentUser, RequirePerms } from "../common/decorators";
import { PaymentFilter, PaymentsService } from "./payments.service";

@Controller("payments")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @RequirePerms("payments.view")
  list(
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("status") status?: PaymentFilter["status"],
    @Query("method") method?: PaymentFilter["method"],
    @Query("staffId") staffId?: string
  ) {
    return this.payments.list({ from, to, status, method, staffId });
  }

  @Get("cashiers")
  @RequirePerms("order.pay", "order.create", "order.addItems")
  cashiers() {
    return this.payments.cashiers();
  }

  @Get("servers")
  @RequirePerms("order.create", "order.pay", "bill.view")
  servers() {
    return this.payments.servers();
  }

  /** The cash keeper's own record: payments they took plus cash handed to them. */
  @Get("mine")
  @RequirePerms("cash.keep")
  mine(@CurrentUser() user: AuthUser, @Query("from") from?: string, @Query("to") to?: string) {
    return this.payments.list({ from, to, staffId: user.id });
  }

  @Get("handovers")
  @RequirePerms("cash.keep")
  handovers(@CurrentUser() user: AuthUser) {
    return this.payments.myHandovers(user);
  }

  @Post(":id/confirm")
  @HttpCode(200)
  @RequirePerms("cash.keep")
  confirm(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.payments.confirm(user, id);
  }
}

@Module({
  providers: [PaymentsService],
  controllers: [PaymentsController],
})
export class PaymentsModule {}
