import { HotelExpensePeriod, WorkerLedgerKind, WorkerPayType } from "@prisma/client";
import { Type } from "class-transformer";
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  MinLength,
} from "class-validator";

export class CreateWorkerDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @IsOptional()
  jobTitle?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsEnum(WorkerPayType)
  payType!: WorkerPayType;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  rate!: number;

  @IsString()
  @IsOptional()
  note?: string;

  @IsBoolean()
  @IsOptional()
  active?: boolean;

  /** Opening بنام (worker owes hotel). */
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  openingAdvance?: number;

  /** Opening جمع (hotel owes worker). */
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  openingPayable?: number;
}

export class UpdateWorkerDto {
  @IsString()
  @MinLength(1)
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  jobTitle?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsEnum(WorkerPayType)
  @IsOptional()
  payType?: WorkerPayType;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  rate?: number;

  @IsString()
  @IsOptional()
  note?: string;

  @IsBoolean()
  @IsOptional()
  active?: boolean;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  openingAdvance?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  openingPayable?: number;
}

/** Manual party-ledger line (Excel style). SALARY_CASH = credit + cash out in one step. */
export class CreateLedgerEntryDto {
  @IsIn([
    "SALARY_CREDIT",
    "ADVANCE",
    "OTHER_DEBIT",
    "OPENING_PAYABLE",
    "OPENING_ADVANCE",
    "SALARY_CASH",
  ])
  kind!: WorkerLedgerKind | "SALARY_CASH";

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  entryOn!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  /** Detail column (e.g. "Salary credit Month Of June", "Net Cash", "Food bill"). */
  @IsString()
  @IsOptional()
  note?: string;
}

export class UpdateLedgerEntryDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsOptional()
  entryOn?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  @IsOptional()
  amount?: number;

  @IsString()
  @IsOptional()
  note?: string;
}

/** @deprecated Prefer ledger entries (salary jama + net cash). Kept for API compat. */
export class CreateSalaryPaymentDto {
  @IsString()
  @MinLength(1)
  workerId!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  paidOn!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount!: number;

  @IsEnum(HotelExpensePeriod)
  period!: HotelExpensePeriod;

  @IsString()
  @IsOptional()
  note?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  advanceRecovered?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  payableSettled?: number;
}

export class UpdateSalaryPaymentDto {
  @IsString()
  @MinLength(1)
  @IsOptional()
  workerId?: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsOptional()
  paidOn?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  amount?: number;

  @IsEnum(HotelExpensePeriod)
  @IsOptional()
  period?: HotelExpensePeriod;

  @IsString()
  @IsOptional()
  note?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  advanceRecovered?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  payableSettled?: number;
}

export class GiveAdvanceDto {
  @IsString()
  @MinLength(1)
  workerId!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  paidOn!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsString()
  @IsOptional()
  note?: string;
}
