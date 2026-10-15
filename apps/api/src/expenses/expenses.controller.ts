import { Body, Controller, Delete, Get, Module, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../common/permissions.guard";
import { AuthUser, CurrentUser, RequirePerms } from "../common/decorators";
import { CreateExpenseCategoryDto, CreateHotelExpenseDto, UpdateHotelExpenseDto } from "./expenses.dto";
import { ExpensesService } from "./expenses.service";
import { FinanceModule } from "../finance/finance.module";

@Controller("expenses")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  @RequirePerms("expense.view", "expense.manage")
  list(@Query("from") from: string, @Query("to") to: string, @Query("category") category?: string) {
    return this.expenses.list(from, to, category);
  }

  @Get("categories")
  @RequirePerms("expense.view", "expense.manage")
  listCategories() {
    return this.expenses.listCategories();
  }

  @Post("categories")
  @RequirePerms("expense.manage")
  createCategory(@Body() dto: CreateExpenseCategoryDto) {
    return this.expenses.createCategory(dto);
  }

  @Delete("categories/:id")
  @RequirePerms("expense.manage")
  removeCategory(@Param("id") id: string) {
    return this.expenses.removeCategory(id);
  }

  @Post()
  @RequirePerms("expense.manage")
  create(@Body() dto: CreateHotelExpenseDto, @CurrentUser() user: AuthUser) {
    return this.expenses.create(dto, user.id);
  }

  @Patch(":id")
  @RequirePerms("expense.manage")
  update(@Param("id") id: string, @Body() dto: UpdateHotelExpenseDto) {
    return this.expenses.update(id, dto);
  }

  @Delete(":id")
  @RequirePerms("expense.manage")
  remove(@Param("id") id: string) {
    return this.expenses.remove(id);
  }
}

@Module({
  imports: [FinanceModule],
  providers: [ExpensesService],
  controllers: [ExpensesController],
  exports: [ExpensesService],
})
export class ExpensesModule {}
