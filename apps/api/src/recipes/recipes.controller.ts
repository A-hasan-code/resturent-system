import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { RecipesService } from "./recipes.service";
import { SettingsService } from "../system/settings.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../common/permissions.guard";
import { RequirePerms } from "../common/decorators";
import {
  CreateRecipeCategoryDto,
  CreateRecipeDto,
  EnforceRecipeStockDto,
  UpdateRecipeDto,
} from "./dto";

@Controller("recipes")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RecipesController {
  constructor(
    private readonly recipes: RecipesService,
    private readonly settings: SettingsService
  ) {}

  @Get("categories")
  @RequirePerms("recipe.view", "recipe.manage", "menu.view", "menu.manage")
  listCategories() {
    return this.recipes.listCategories();
  }

  @Post("categories")
  @RequirePerms("recipe.manage", "menu.manage")
  createCategory(@Body() dto: CreateRecipeCategoryDto) {
    return this.recipes.createCategory(dto);
  }

  @Get("stock-enforce")
  @RequirePerms("recipe.view", "recipe.manage", "menu.view")
  async getStockEnforce() {
    return { enforceRecipeStock: await this.settings.enforceRecipeStock() };
  }

  @Patch("stock-enforce")
  @RequirePerms("recipe.manage")
  setStockEnforce(@Body() dto: EnforceRecipeStockDto) {
    return this.settings.setEnforceRecipeStock(!!dto.enabled);
  }

  @Get()
  @RequirePerms("recipe.view", "recipe.manage", "menu.view")
  list() {
    return this.recipes.list();
  }

  @Post()
  @RequirePerms("recipe.manage")
  create(@Body() dto: CreateRecipeDto) {
    return this.recipes.create(dto);
  }

  @Patch(":id")
  @RequirePerms("recipe.manage")
  update(@Param("id") id: string, @Body() dto: UpdateRecipeDto) {
    return this.recipes.update(id, dto);
  }

  @Delete(":id")
  @RequirePerms("recipe.manage")
  remove(@Param("id") id: string) {
    return this.recipes.remove(id);
  }
}
