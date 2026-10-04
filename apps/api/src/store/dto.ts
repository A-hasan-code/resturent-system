import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { ExtraExpensePaidBy, UnitType } from "@prisma/client";

export class CreateStoreItemDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  categoryId!: string;

  @IsEnum(UnitType)
  unit!: UnitType;

  @IsNumber()
  @Min(0)
  @IsOptional()
  quantityOnHand?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  ratePerUnit?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  reorderLevel?: number;
}

export class UpdateStoreItemDto {
  @IsString()
  @MinLength(1)
  @IsOptional()
  name?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  ratePerUnit?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  reorderLevel?: number;

  @IsOptional()
  active?: boolean;
}

export class StockInDto {
  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  ratePerUnit?: number;

  @IsString()
  @IsOptional()
  note?: string;
}

export class StockOutDto {
  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @IsString()
  @IsOptional()
  note?: string;
}

export class StockAdjustDto {
  @IsNumber()
  @Min(0)
  newQuantity!: number;

  @IsString()
  @IsOptional()
  note?: string;
}

export class CreateSupplierDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  supplyOf?: string;

  @IsString()
  @IsOptional()
  brand?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateSupplierDto {
  @IsString()
  @MinLength(1)
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  supplyOf?: string;

  @IsString()
  @IsOptional()
  brand?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsOptional()
  active?: boolean;
}

export class PurchaseLineDto {
  @IsString()
  storeItemId!: string;

  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @IsNumber()
  @Min(0)
  ratePerUnit!: number;
}

export class CreatePurchaseDto {
  @IsString()
  supplierId!: string;

  /** Business day YYYY-MM-DD. */
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  purchasedOn!: string;

  @IsIn(["CASH", "CREDIT"])
  payKind!: "CASH" | "CREDIT";

  /** Amount paid to the supplier on this invoice. Cash = full supplier due. */
  @IsNumber()
  @Min(0)
  @IsOptional()
  paidAmount?: number;

  /** Travel / loading / other (not inventory). */
  @IsNumber()
  @Min(0)
  @IsOptional()
  extraExpense?: number;

  @IsString()
  @IsOptional()
  extraExpenseNote?: string;

  @IsEnum(ExtraExpensePaidBy)
  @IsOptional()
  extraExpensePaidBy?: ExtraExpensePaidBy;

  @IsString()
  @IsOptional()
  note?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineDto)
  lines!: PurchaseLineDto[];
}

export class DayUseLineDto {
  @IsString()
  storeItemId!: string;

  /** Extra used today, on top of what bills already deducted. */
  @IsNumber()
  @Min(0)
  extraQty!: number;

  @IsString()
  @IsOptional()
  reason?: string;
}

export class SaveDayUseDto {
  /** Business day YYYY-MM-DD. Defaults to today’s business day. */
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsOptional()
  businessDate?: string;

  /** Kept for older clients; past-day edits are no longer allowed. */
  @IsString()
  @IsOptional()
  editReason?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DayUseLineDto)
  lines!: DayUseLineDto[];
}

export class SupplierPaymentDto {
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsOptional()
  paidOn?: string;

  @IsString()
  @IsOptional()
  note?: string;
}
