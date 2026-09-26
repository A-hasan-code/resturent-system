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
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../common/permissions.guard";
import { RequirePerms } from "../common/decorators";
import {
  CreateStoreItemDto,
  StockAdjustDto,
  StockInDto,
  StockOutDto,
  UpdateStoreItemDto,
} from "./dto";

@Controller("store")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class StoreController {
  constructor(private readonly store: StoreService) {}

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
