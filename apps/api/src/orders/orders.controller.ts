import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../common/permissions.guard";
import { AuthUser, CurrentUser, RequirePerms } from "../common/decorators";
import { CreateOrderDto, PayOrderDto, UpdateStatusDto } from "./dto";

@Controller("orders")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @RequirePerms("order.create", "bill.view", "kitchen.view")
  list(
    @Query("paymentStatus") paymentStatus?: string,
    @Query("status") status?: string
  ) {
    return this.orders.list(paymentStatus, status);
  }

  @Post()
  @RequirePerms("order.create")
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.orders.create(user.id, dto);
  }

  @Post(":id/pay")
  @RequirePerms("order.pay")
  pay(@Param("id") id: string, @Body() dto: PayOrderDto) {
    return this.orders.pay(id, dto);
  }

  @Patch(":id/status")
  @RequirePerms("kitchen.update")
  updateStatus(@Param("id") id: string, @Body() dto: UpdateStatusDto) {
    return this.orders.updateStatus(id, dto);
  }
}
