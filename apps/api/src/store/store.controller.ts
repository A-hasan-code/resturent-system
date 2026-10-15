import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { IsOptional, IsString } from "class-validator";
import { createReadStream } from "fs";
import { memoryStorage } from "multer";
import { StoreService } from "./store.service";
import { PurchasesService } from "./purchases.service";
import { DayUseService } from "./day-use.service";
import { KitchenService } from "./kitchen.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../common/permissions.guard";
import { AuthUser, CurrentUser, RequirePerms } from "../common/decorators";
import { PrintService } from "../print/print.service";

class PrintReportDto {
  @IsOptional() @IsString() printerId?: string;
}
import {
  CreateKitchenStationDto,
  CreatePurchaseDto,
  CreateStoreItemDto,
  CreateSupplierDto,
  KitchenReturnDto,
  KitchenTransferDto,
  SaveDayUseDto,
  SaveKitchenDayUseDto,
  StockAdjustDto,
  StockInDto,
  StockOutDto,
  SupplierPaymentDto,
  UpdateKitchenStationDto,
  UpdateStoreItemDto,
  UpdateSupplierDto,
} from "./dto";

@Controller("store")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class StoreController {
  constructor(
    private readonly store: StoreService,
    private readonly purchases: PurchasesService,
    private readonly dayUse: DayUseService,
    private readonly kitchen: KitchenService,
    private readonly print: PrintService
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
  @RequirePerms("store.manage")
  saveDayUse(@CurrentUser() user: AuthUser, @Body() dto: SaveDayUseDto) {
    return this.dayUse.save(user, dto);
  }

  @Get("kitchen/stations")
  @RequirePerms("store.view", "store.manage", "reports.view", "menu.manage", "kitchen.view")
  kitchenStations(@Query("all") all?: string) {
    return this.kitchen.stations({ all: all === "1" || all === "true" });
  }

  @Post("kitchen/stations")
  @RequirePerms("store.manage")
  createKitchenStation(@Body() dto: CreateKitchenStationDto) {
    return this.kitchen.createStation(dto);
  }

  @Patch("kitchen/stations/:id")
  @RequirePerms("store.manage")
  updateKitchenStation(@Param("id") id: string, @Body() dto: UpdateKitchenStationDto) {
    return this.kitchen.updateStation(id, dto);
  }

  @Delete("kitchen/stations/:id")
  @RequirePerms("store.manage")
  deleteKitchenStation(@Param("id") id: string) {
    return this.kitchen.deleteStation(id);
  }

  @Get("kitchen/stock")
  @RequirePerms("store.view", "store.manage", "reports.view")
  kitchenStock(@Query("station") station?: string) {
    return this.kitchen.stockList(station);
  }

  @Post("kitchen/transfer")
  @RequirePerms("store.manage")
  kitchenTransfer(@Body() dto: KitchenTransferDto) {
    return this.kitchen.transfer(dto);
  }

  @Post("kitchen/return")
  @RequirePerms("store.manage")
  kitchenReturn(@Body() dto: KitchenReturnDto) {
    return this.kitchen.returnToStore(dto);
  }

  @Get("kitchen/day-use/history")
  @RequirePerms("store.view", "store.manage", "reports.view")
  kitchenDayUseHistory(
    @Query("limit") limit?: string,
    @Query("station") station?: string
  ) {
    return this.kitchen.dayUseHistory(limit ? Number(limit) : 90, station);
  }

  @Get("kitchen/day-use")
  @RequirePerms("store.view", "store.manage", "reports.view")
  kitchenDayUseSheet(
    @Query("date") date: string | undefined,
    @Query("station") station: string | undefined,
    @CurrentUser() user: AuthUser
  ) {
    return this.kitchen.dayUseSheet(date, user, station);
  }

  @Get("kitchen/day-use/export")
  @RequirePerms("store.view", "store.manage", "reports.view")
  async kitchenDayUsePdf(
    @Query("date") date: string | undefined,
    @Query("station") station: string | undefined,
    @CurrentUser() user: AuthUser
  ) {
    const { filename, body } = await this.kitchen.exportDayUsePdf(date, user, station);
    return new StreamableFile(body, {
      type: "application/pdf",
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Post("kitchen/day-use/print")
  @RequirePerms("store.view", "store.manage", "reports.view")
  async kitchenDayUsePrint(
    @Query("date") date: string | undefined,
    @Query("station") station: string | undefined,
    @Body() dto: PrintReportDto,
    @CurrentUser() user: AuthUser
  ) {
    const { filename, body } = await this.kitchen.exportDayUsePdf(date, user, station);
    return this.print.printPdfReport({
      title: filename.replace(/\.pdf$/i, ""),
      pdf: body,
      printerId: dto.printerId,
      requestedById: user.id,
    });
  }

  @Post("kitchen/day-use")
  @RequirePerms("store.manage")
  saveKitchenDayUse(@CurrentUser() user: AuthUser, @Body() dto: SaveKitchenDayUseDto) {
    return this.kitchen.saveDayUse(user, dto);
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

  @Delete("suppliers/:id")
  @RequirePerms("store.manage")
  deleteSupplier(@Param("id") id: string) {
    return this.purchases.deleteSupplier(id);
  }

  @Get("suppliers/:id/ledger")
  @RequirePerms("store.view", "store.manage")
  supplierLedger(@Param("id") id: string) {
    return this.purchases.ledger(id);
  }

  @Get("suppliers/:id/ledger.pdf")
  @RequirePerms("store.view", "store.manage")
  async supplierLedgerPdf(@Param("id") id: string) {
    const { filename, body } = await this.purchases.ledgerPdf(id);
    return new StreamableFile(body, {
      type: "application/pdf",
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Post("suppliers/:id/ledger/print")
  @RequirePerms("store.view", "store.manage")
  async supplierLedgerPrint(
    @Param("id") id: string,
    @Body() dto: PrintReportDto,
    @CurrentUser() user: AuthUser
  ) {
    const { filename, body } = await this.purchases.ledgerPdf(id);
    return this.print.printPdfReport({
      title: filename.replace(/\.pdf$/i, ""),
      pdf: body,
      printerId: dto.printerId,
      requestedById: user.id,
    });
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

  @Post("purchases/:id/void")
  @RequirePerms("store.manage")
  voidPurchase(@Param("id") id: string, @Body() body?: { note?: string }) {
    return this.purchases.voidPurchase(id, body?.note);
  }

  @Post("purchases/:id/bill")
  @RequirePerms("store.manage")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    })
  )
  savePurchaseBill(@Param("id") id: string, @UploadedFile() file: Express.Multer.File) {
    return this.purchases.saveBillImage(id, file);
  }

  @Get("purchases/:id/bill")
  @RequirePerms("store.view", "store.manage")
  async purchaseBill(@Param("id") id: string) {
    const img = await this.purchases.billImage(id);
    return new StreamableFile(createReadStream(img.path), {
      type: img.contentType,
      disposition: `inline; filename="${img.filename}"`,
    });
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

  @Delete("items/:id")
  @RequirePerms("store.manage")
  deleteItem(@Param("id") id: string) {
    return this.store.deleteItem(id);
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
