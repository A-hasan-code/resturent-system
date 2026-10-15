import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
  ArrayMinSize,
} from "class-validator";
import { Type } from "class-transformer";
import { UnitType } from "@prisma/client";

export class EnforceRecipeStockDto {
  @IsBoolean()
  enabled!: boolean;
}

class IngredientDto {
  @IsString()
  storeItemId!: string;

  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @IsEnum(UnitType)
  unit!: UnitType;
}

export class CreateRecipeDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsEnum(UnitType)
  baseUnit?: UnitType;

  @IsOptional()
  @IsNumber()
  @Min(0.001)
  baseQty?: number;

  /** Target kitchen cook/prep time in minutes. */
  @IsOptional()
  @IsNumber()
  @Min(1)
  prepMinutes?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => IngredientDto)
  ingredients!: IngredientDto[];
}

export class UpdateRecipeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsEnum(UnitType)
  baseUnit?: UnitType;

  @IsOptional()
  @IsNumber()
  @Min(0.001)
  baseQty?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  prepMinutes?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => IngredientDto)
  ingredients?: IngredientDto[];
}

export class CreateRecipeCategoryDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}
