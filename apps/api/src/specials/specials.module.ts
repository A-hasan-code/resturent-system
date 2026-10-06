import {
  Body,
  Controller,
  Delete,
  Get,
  Module,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../common/permissions.guard";
import { AuthUser, CurrentUser, RequirePerms } from "../common/decorators";
import {
  CookBatchDto,
  CreateSpecialProductDto,
  SaveBatchCloseDto,
  UpdateSpecialProductDto,
} from "./dto";
import { SpecialsService } from "./specials.service";

@Controller("specials")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SpecialsController {
  constructor(private readonly specials: SpecialsService) {}

  @Get("products")
  @RequirePerms("menu.view", "menu.manage", "close.view", "order.create")
  listProducts() {
    return this.specials.listProducts();
  }

  @Post("products")
  @RequirePerms("menu.manage")
  createProduct(@Body() dto: CreateSpecialProductDto) {
    return this.specials.createProduct(dto);
  }

  @Patch("products/:id")
  @RequirePerms("menu.manage")
  updateProduct(@Param("id") id: string, @Body() dto: UpdateSpecialProductDto) {
    return this.specials.updateProduct(id, dto);
  }

  /** Soft-remove pot — Admin only, after hotel is closed. */
  @Post("products/:id/deactivate")
  @RequirePerms("menu.manage")
  deactivateProduct(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.specials.deactivateProduct(id, user);
  }

  /** Alias — same as POST …/deactivate. */
  @Delete("products/:id")
  @RequirePerms("menu.manage")
  deactivateProductDelete(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.specials.deactivateProduct(id, user);
  }

  @Get("today")
  @RequirePerms("menu.view", "order.create", "close.view", "close.manage")
  today() {
    return this.specials.todayBatches();
  }

  @Post("reopen-today")
  @RequirePerms("close.manage", "menu.manage")
  reopenToday() {
    return this.specials.forceReopenToday();
  }

  @Post("cook")
  @RequirePerms("close.manage", "menu.manage", "store.manage")
  cook(@Body() dto: CookBatchDto, @CurrentUser() user: AuthUser) {
    return this.specials.cook(dto, user);
  }

  @Get("close-preview")
  @RequirePerms("close.view", "close.manage")
  closePreview() {
    return this.specials.closePreview();
  }

  @Post("close")
  @RequirePerms("close.manage")
  saveClose(@Body() dto: SaveBatchCloseDto, @CurrentUser() user: AuthUser) {
    return this.specials.saveClose(dto, user);
  }

  @Get("loss")
  @RequirePerms("close.view", "reports.view", "menu.manage")
  loss(@Query("from") from?: string, @Query("to") to?: string) {
    return this.specials.lossReport(from, to);
  }
}

@Module({
  providers: [SpecialsService],
  controllers: [SpecialsController],
  exports: [SpecialsService],
})
export class SpecialsModule {}
