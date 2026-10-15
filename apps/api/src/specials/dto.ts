import {
  ArrayMinSize,
  IsArray,
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

const SELL_MODES = ["BOTH", "SERVING_ONLY", "RS_ONLY"] as const;

export class CreateSpecialProductDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @IsOptional()
  category?: string;

  /** Plate, Glass, Box, Bowl, Cup… */
  @IsString()
  @MinLength(1)
  @IsOptional()
  servingLabel?: string;

  @IsIn(SELL_MODES)
  @IsOptional()
  sellMode?: (typeof SELL_MODES)[number];

  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  platePrice!: number;

  /** Separate half-plate Rs. Omit / null = full only. */
  @IsNumber()
  @Min(0.01)
  @IsOptional()
  @Type(() => Number)
  halfPlatePrice?: number | null;

  @IsNumber()
  @Min(0.001)
  @Type(() => Number)
  plateGrams!: number;

  @IsString()
  @MinLength(1)
  cookRecipeId!: string;

  @IsString()
  @MinLength(1)
  @IsOptional()
  kitchenStation?: string;
}

export class UpdateSpecialProductDto {
  @IsString()
  @MinLength(1)
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @MinLength(1)
  @IsOptional()
  servingLabel?: string;

  @IsIn(SELL_MODES)
  @IsOptional()
  sellMode?: (typeof SELL_MODES)[number];

  @IsNumber()
  @Min(0.01)
  @IsOptional()
  platePrice?: number;

  @IsNumber()
  @Min(0.01)
  @IsOptional()
  @Type(() => Number)
  halfPlatePrice?: number | null;

  @IsNumber()
  @Min(0.001)
  @IsOptional()
  plateGrams?: number;

  @IsOptional()
  @IsString()
  cookRecipeId?: string | null;

  @IsString()
  @MinLength(1)
  @IsOptional()
  kitchenStation?: string;

  @IsOptional()
  active?: boolean;
}

export class CookIngredientLineDto {
  @IsString()
  @MinLength(1)
  storeItemId!: string;

  /** Amount put into the pot today (in `unit`). */
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsIn(["KG", "G", "L", "ML", "PCS"])
  unit!: "KG" | "G" | "L" | "ML" | "PCS";
}

export class CookBatchDto {
  @IsString()
  specialProductId!: string;

  /** Finished pot weight after cook, in grams. */
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  cookedGrams!: number;

  /** Actual ingredients put in today — kitchen stock deducts these (not recipe×cooked kg). */
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CookIngredientLineDto)
  ingredients!: CookIngredientLineDto[];

  /** Business day YYYY-MM-DD this cook belongs to (after day-start / post-close → new date). */
  @IsString()
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  businessDate?: string;

  /** Optional local cook timestamp ISO string (audit only). */
  @IsString()
  @IsOptional()
  cookedAt?: string;

  @IsString()
  @IsOptional()
  @MinLength(0)
  note?: string;
}

export class BatchCloseLineDto {
  @IsString()
  specialProductId!: string;

  @IsNumber()
  @Min(0)
  countedRemainingGrams!: number;

  @IsNumber()
  @Min(0)
  carryGrams!: number;

  @IsNumber()
  @Min(0)
  wasteGrams!: number;

  @IsString()
  @IsOptional()
  wasteNote?: string;
}

export class SaveBatchCloseDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BatchCloseLineDto)
  lines!: BatchCloseLineDto[];

  /** Edit leftover for this business day (default = current). Must not be cash-locked. */
  @IsString()
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  businessDate?: string;

  @IsString()
  @IsOptional()
  note?: string;
}
