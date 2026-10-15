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
import { FinanceModule } from "../finance/finance.module";
import {
  CreateLedgerEntryDto,
  CreateSalaryPaymentDto,
  CreateWorkerDto,
  GiveAdvanceDto,
  UpdateLedgerEntryDto,
  UpdateSalaryPaymentDto,
  UpdateWorkerDto,
} from "./dto";
import { WorkersService } from "./workers.service";

@Controller("workers")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class WorkersController {
  constructor(private readonly workers: WorkersService) {}

  @Get()
  @RequirePerms("expense.view", "expense.manage")
  list(@Query("all") all?: string) {
    return this.workers.listWorkers(all === "1" || all === "true");
  }

  @Get("payments/list")
  @RequirePerms("expense.view", "expense.manage")
  listPayments(
    @Query("from") from: string,
    @Query("to") to: string,
    @Query("workerId") workerId?: string
  ) {
    return this.workers.listPayments(from, to, workerId);
  }

  @Get(":id/ledger")
  @RequirePerms("expense.view", "expense.manage")
  ledger(@Param("id") id: string) {
    return this.workers.listLedger(id);
  }

  @Post(":id/ledger")
  @RequirePerms("expense.manage")
  addEntry(
    @Param("id") id: string,
    @Body() dto: CreateLedgerEntryDto,
    @CurrentUser() user: AuthUser
  ) {
    return this.workers.addLedgerEntry(id, dto, user.id);
  }

  @Patch("ledger/:entryId")
  @RequirePerms("expense.manage")
  updateEntry(@Param("entryId") entryId: string, @Body() dto: UpdateLedgerEntryDto) {
    return this.workers.updateLedgerEntry(entryId, dto);
  }

  @Delete("ledger/:entryId")
  @RequirePerms("expense.manage")
  deleteEntry(@Param("entryId") entryId: string) {
    return this.workers.deleteLedgerEntry(entryId);
  }

  @Post("payments")
  @RequirePerms("expense.manage")
  pay(@Body() dto: CreateSalaryPaymentDto, @CurrentUser() user: AuthUser) {
    return this.workers.paySalary(dto, user.id);
  }

  @Patch("payments/:id")
  @RequirePerms("expense.manage")
  updatePayment(@Param("id") id: string, @Body() dto: UpdateSalaryPaymentDto) {
    return this.workers.updatePayment(id, dto);
  }

  @Post("advances")
  @RequirePerms("expense.manage")
  giveAdvance(@Body() dto: GiveAdvanceDto, @CurrentUser() user: AuthUser) {
    return this.workers.giveAdvance(dto, user.id);
  }

  @Post()
  @RequirePerms("expense.manage")
  create(@Body() dto: CreateWorkerDto, @CurrentUser() user: AuthUser) {
    return this.workers.createWorker(dto, user.id);
  }

  @Patch(":id")
  @RequirePerms("expense.manage")
  update(@Param("id") id: string, @Body() dto: UpdateWorkerDto, @CurrentUser() user: AuthUser) {
    return this.workers.updateWorker(id, dto, user.id);
  }

  @Delete(":id")
  @RequirePerms("expense.manage")
  remove(@Param("id") id: string) {
    return this.workers.removeWorker(id);
  }
}

@Module({
  imports: [FinanceModule],
  providers: [WorkersService],
  controllers: [WorkersController],
  exports: [WorkersService],
})
export class WorkersModule {}
