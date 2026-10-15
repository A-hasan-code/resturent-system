import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
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
import { ExtraExpensePaidBy, PackUnit, UnitType } from "@prisma/client";

export class CreateStoreItemDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  categoryId!: string;

  @IsEnum(UnitType)
  unit!: UnitType;

  @IsEnum(PackUnit)
  @IsOptional()
  packUnit?: PackUnit;

  /** Stock units inside one pack (e.g. 30 eggs / tray). */
  @IsNumber()
  @Min(1)
  @IsOptional()
  unitsPerPack?: number;

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

  @IsEnum(PackUnit)
  @IsOptional()
  packUnit?: PackUnit;

  @IsNumber()
  @Min(1)
  @IsOptional()
  unitsPerPack?: number;

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

  /** When true, quantity/rate are in pack units (tray/box…); converted to stock units. */
  @IsBoolean()
  @IsOptional()
  inPacks?: boolean;
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

  /**
   * Total used for this line (manual closing).
   * Kitchen: includes recipe auto + manual. Store: store-side used (not kitchen transfer).
   * Falls back to extraQty for older clients.
   */
  @IsNumber()
  @Min(0)
  @IsOptional()
  usedQty?: number;

  /** Physical count remaining at close. */
  @IsNumber()
  @Min(0)
  @IsOptional()
  leftoverQty?: number;

  /** Legacy: extra beyond recipe/transfer. Prefer usedQty. */
  @IsNumber()
  @Min(0)
  @IsOptional()
  extraQty?: number;

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

export class KitchenTransferLineDto {
  @IsString()
  storeItemId!: string;

  @IsNumber()
  @Min(0.001)
  quantity!: number;
}

export class KitchenTransferDto {
  @IsString()
  @MinLength(1)
  station!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => KitchenTransferLineDto)
  lines!: KitchenTransferLineDto[];

  @IsString()
  @IsOptional()
  note?: string;
}

export class KitchenReturnDto {
  @IsString()
  @MinLength(1)
  station!: string;

  @IsString()
  storeItemId!: string;

  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @IsString()
  @IsOptional()
  note?: string;
}

export class SaveKitchenDayUseDto {
  @IsString()
  @MinLength(1)
  station!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsOptional()
  businessDate?: string;

  @IsString()
  @IsOptional()
  editReason?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DayUseLineDto)
  lines!: DayUseLineDto[];
}

export class CreateKitchenStationDto {
  @IsString()
  @MinLength(1)
  name!: string;

  /** Optional; auto from name if omitted (e.g. Tandoor → TANDOOR). */
  @IsString()
  @IsOptional()
  @Matches(/^[A-Z][A-Z0-9_]{0,39}$/)
  code?: string;
}

export class UpdateKitchenStationDto {
  @IsString()
  @MinLength(1)
  @IsOptional()
  name?: string;

  @IsNumber()
  @IsOptional()
  sortOrder?: number;

  @IsBoolean()
  @IsOptional()
  active?: boolean;
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
