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
import {
  AddItemsDto,
  CancelOrderDto,
  CreateOrderDto,
  EditOrderDto,
  PayOrderDto,
  PrintKotDto,
  PutOnCreditDto,
  ReassignCreditDto,
  UpdateOrderDto,
  UpdateStatusDto,
} from "./dto";

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
    @Query("view") view?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("includeCredit") includeCredit?: string
  ) {
    return this.orders.list(user, paymentStatus, status, view === "billing", {
      from,
      to,
      includeCredit: includeCredit === "1" || includeCredit === "true",
    });
  }

  /** Active kitchen tickets (PENDING / PREPARING / READY) — not capped by general list take:100. */
  @Get("kitchen")
  @RequirePerms("kitchen.view")
  listKitchen(@CurrentUser() user: AuthUser) {
    return this.orders.listKitchen(user);
  }

  @Get("per-head")
  @RequirePerms("order.create")
  perHead() {
    return this.orders.perHeadConfig();
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

  /** Guest arrived — release kitchen hold, start timers, print KOT. */
  @Post(":id/start-reserved")
  @RequirePerms("order.create", "order.addItems", "order.edit")
  startReserved(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.orders.startReserved(user, id);
  }

  @Post(":id/edit")
  @RequirePerms("order.edit")
  editItems(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: EditOrderDto) {
    return this.orders.editItems(user, id, dto);
  }

  @Post(":id/cancel")
  @RequirePerms("order.edit")
  cancel(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: CancelOrderDto) {
    return this.orders.cancel(user, id, dto);
  }

  @Post(":id/reverse")
  @RequirePerms("order.edit")
  reverse(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: CancelOrderDto) {
    return this.orders.reverse(user, id, dto);
  }

  @Post(":id/print-cancel-kot")
  @RequirePerms("order.edit", "print.kot")
  printCancelKot(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.orders.printCancelKot(user, id);
  }

  @Patch(":id")
  @RequirePerms("order.create", "order.addItems", "order.pay")
  updateMeta(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: UpdateOrderDto) {
    return this.orders.updateMeta(user, id, dto);
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

  @Get(":id/bill-preview")
  @RequirePerms("print.bill", "order.pay")
  billPreview(@Param("id") id: string) {
    return this.orders.billPreview(id);
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

  @Post(":id/put-on-credit")
  @RequirePerms("order.pay")
  putOnCredit(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: PutOnCreditDto) {
    return this.orders.putOnCredit(user, id, dto);
  }

  @Patch(":id/credit-customer")
  @RequirePerms("order.pay")
  reassignCredit(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: ReassignCreditDto
  ) {
    return this.orders.reassignCredit(user, id, dto.creditCustomerId);
  }

  @Post(":id/release-credit")
  @RequirePerms("order.pay")
  releaseCredit(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.orders.releaseCredit(user, id);
  }

  @Patch(":id/status")
  @RequirePerms("kitchen.update")
  updateStatus(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: UpdateStatusDto) {
    return this.orders.updateStatus(user, id, dto);
  }
}
