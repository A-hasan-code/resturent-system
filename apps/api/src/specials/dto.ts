import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

const SELL_MODES = ["BOTH", "SERVING_ONLY", "RS_ONLY"] as const;
const STATIONS = ["BEVERAGES", "COOKING", "BBQ"] as const;

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

  @IsNumber()
  @Min(0.001)
  @Type(() => Number)
  plateGrams!: number;

  @IsString()
  @MinLength(1)
  cookRecipeId!: string;

  @IsIn(STATIONS)
  @IsOptional()
  kitchenStation?: (typeof STATIONS)[number];
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
  @Min(0.001)
  @IsOptional()
  plateGrams?: number;

  @IsOptional()
  @IsString()
  cookRecipeId?: string | null;

  @IsIn(STATIONS)
  @IsOptional()
  kitchenStation?: (typeof STATIONS)[number];

  @IsOptional()
  active?: boolean;
}

export class CookBatchDto {
  @IsString()
  specialProductId!: string;

  /** Newly cooked today, in grams. */
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  cookedGrams!: number;

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

  @IsString()
  @IsOptional()
  note?: string;
}
