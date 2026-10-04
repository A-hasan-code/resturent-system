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
import { StoreService } from "./store.service";
import { PurchasesService } from "./purchases.service";
import { DayUseService } from "./day-use.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../common/permissions.guard";
import { AuthUser, CurrentUser, RequirePerms } from "../common/decorators";
import {
  CreatePurchaseDto,
  CreateStoreItemDto,
  CreateSupplierDto,
  SaveDayUseDto,
  StockAdjustDto,
  StockInDto,
  StockOutDto,
  SupplierPaymentDto,
  UpdateStoreItemDto,
  UpdateSupplierDto,
} from "./dto";

@Controller("store")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class StoreController {
  constructor(
    private readonly store: StoreService,
    private readonly purchases: PurchasesService,
    private readonly dayUse: DayUseService
  ) {}

  @Get("day-use/history")
  @RequirePerms("store.view", "store.manage", "reports.view")
  dayUseHistory(@Query("limit") limit?: string) {
    return this.dayUse.history(limit ? Number(limit) : 90);
  }

  @Get("day-use")
  @RequirePerms("store.view", "store.manage", "reports.view")
  dayUseSheet(
    @Query("date") date: string | undefined,
    @CurrentUser() user: AuthUser
  ) {
    return this.dayUse.sheet(date, user);
  }

  @Post("day-use")
  @RequirePerms("store.manage", "users.manage")
  saveDayUse(@CurrentUser() user: AuthUser, @Body() dto: SaveDayUseDto) {
    return this.dayUse.save(user, dto);
  }

  @Get("suppliers")
  @RequirePerms("store.view", "store.manage")
  suppliers() {
    return this.purchases.listSuppliers();
  }

  @Post("suppliers")
  @RequirePerms("store.manage")
  createSupplier(@Body() dto: CreateSupplierDto) {
    return this.purchases.createSupplier(dto);
  }

  @Patch("suppliers/:id")
  @RequirePerms("store.manage")
  updateSupplier(@Param("id") id: string, @Body() dto: UpdateSupplierDto) {
    return this.purchases.updateSupplier(id, dto);
  }

  @Get("suppliers/:id/ledger")
  @RequirePerms("store.view", "store.manage")
  supplierLedger(@Param("id") id: string) {
    return this.purchases.ledger(id);
  }

  @Post("suppliers/:id/payments")
  @RequirePerms("store.manage")
  paySupplier(@Param("id") id: string, @Body() dto: SupplierPaymentDto) {
    return this.purchases.paySupplier(id, dto);
  }

  @Get("purchases/dates")
  @RequirePerms("store.view", "store.manage")
  purchaseDates() {
    return this.purchases.recentDates();
  }

  @Get("purchases/recent")
  @RequirePerms("store.view", "store.manage")
  recentPurchases() {
    return this.purchases.recentPurchases();
  }

  @Get("purchases")
  @RequirePerms("store.view", "store.manage")
  dailyPurchases(@Query("date") date?: string) {
    const today = new Date();
    const fallback = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    return this.purchases.daily(date || fallback);
  }

  @Post("purchases")
  @RequirePerms("store.manage")
  createPurchase(@Body() dto: CreatePurchaseDto) {
    return this.purchases.createPurchase(dto);
  }

  @Get("categories")
  @RequirePerms("store.view", "store.manage", "recipe.manage", "menu.manage")
  categories() {
    return this.store.categories();
  }

  @Get("summary")
  @RequirePerms("store.view", "store.manage")
  summary() {
    return this.store.summary();
  }

  @Get("movements")
  @RequirePerms("store.view", "store.manage")
  movements(@Query("limit") limit?: string) {
    return this.store.movements(limit ? Number(limit) : 200);
  }

  @Get("usage")
  @RequirePerms("store.view", "store.manage", "reports.view")
  usage() {
    return this.store.usageByItem();
  }

  @Get("low-stock")
  @RequirePerms("store.view", "store.manage")
  lowStock() {
    return this.store.lowStock();
  }

  @Post("items")
  @RequirePerms("store.manage")
  createItem(@Body() dto: CreateStoreItemDto) {
    return this.store.createItem(dto);
  }

  @Patch("items/:id")
  @RequirePerms("store.manage")
  updateItem(@Param("id") id: string, @Body() dto: UpdateStoreItemDto) {
    return this.store.updateItem(id, dto);
  }

  @Post("items/:id/stock-in")
  @RequirePerms("store.manage")
  stockIn(@Param("id") id: string, @Body() dto: StockInDto) {
    return this.store.stockIn(id, dto);
  }

  @Post("items/:id/stock-out")
  @RequirePerms("store.manage")
  stockOut(@Param("id") id: string, @Body() dto: StockOutDto) {
    return this.store.stockOut(id, dto);
  }

  @Post("items/:id/adjust")
  @RequirePerms("store.manage")
  adjust(@Param("id") id: string, @Body() dto: StockAdjustDto) {
    return this.store.adjust(id, dto);
  }
}
