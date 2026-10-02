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
import { AddItemsDto, CreateOrderDto, PayOrderDto, PrintKotDto, UpdateStatusDto } from "./dto";

@Controller("orders")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @RequirePerms("order.create", "bill.view", "kitchen.view")
  list(
    @CurrentUser() user: AuthUser,
    @Query("paymentStatus") paymentStatus?: string,
    @Query("status") status?: string,
    @Query("view") view?: string
  ) {
    return this.orders.list(user, paymentStatus, status, view === "billing");
  }

  @Get(":id")
  @RequirePerms("order.create", "bill.view", "kitchen.view")
  get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.orders.get(user, id);
  }

  @Post()
  @RequirePerms("order.create")
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.orders.create(user, dto);
  }

  @Post(":id/items")
  @RequirePerms("order.addItems")
  addItems(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: AddItemsDto) {
    return this.orders.addItems(user, id, dto);
  }

  @Post(":id/request-bill")
  @RequirePerms("bill.request")
  requestBill(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.orders.requestBill(user, id);
  }

  @Post(":id/print-kot")
  @RequirePerms("print.kot")
  printKot(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: PrintKotDto) {
    return this.orders.printKot(user, id, dto.round, dto.reprint ?? true);
  }

  @Get(":id/kot-preview")
  @RequirePerms("order.create", "print.kot")
  kotPreview(@Param("id") id: string, @Query("round") round?: string) {
    const r = round ? Number.parseInt(round, 10) : undefined;
    return this.orders.kotPreview(id, r && r > 0 ? r : undefined);
  }

  @Post(":id/print-bill")
  @RequirePerms("print.bill")
  printBill(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.orders.printBill(user, id);
  }

  @Post(":id/pay")
  @RequirePerms("order.pay")
  pay(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: PayOrderDto) {
    return this.orders.pay(user, id, dto);
  }

  @Patch(":id/status")
  @RequirePerms("kitchen.update")
  updateStatus(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: UpdateStatusDto) {
    return this.orders.updateStatus(user, id, dto);
  }
}
