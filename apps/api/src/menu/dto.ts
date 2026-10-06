import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";
import { KitchenStation, MenuItemKind, UnitType } from "@prisma/client";

export class CreateMenuItemDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsEnum(KitchenStation)
  @IsOptional()
  kitchenStation?: KitchenStation;

  @IsEnum(MenuItemKind)
  @IsOptional()
  kind?: MenuItemKind;

  @IsEnum(UnitType)
  sellUnit!: UnitType;

  @IsNumber()
  @Min(0)
  sellingPrice!: number;

  /** Qty in sellUnit for the listed menu price (e.g. 0.5 KG). */
  @IsNumber()
  @Min(0.001)
  @IsOptional()
  listPortionQty?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  minQty?: number;

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber()
  @Min(0)
  @IsOptional()
  maxQty?: number | null;

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber()
  @Min(0)
  @IsOptional()
  qtyStep?: number | null;

  @IsBoolean()
  @IsOptional()
  allowCustomQty?: boolean;

  @IsString()
  @IsOptional()
  recipeId?: string;

  @IsString()
  @IsOptional()
  specialProductId?: string;

  @IsNumber()
  @Min(0.001)
  @IsOptional()
  mixSpecialPlates?: number;
}

export class UpdateMenuItemDto {
  @IsString()
  @MinLength(1)
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  category?: string | null;

  @IsEnum(KitchenStation)
  @IsOptional()
  kitchenStation?: KitchenStation;

  @IsEnum(MenuItemKind)
  @IsOptional()
  kind?: MenuItemKind;

  @IsEnum(UnitType)
  @IsOptional()
  sellUnit?: UnitType;

  @IsNumber()
  @Min(0)
  @IsOptional()
  sellingPrice?: number;

  @IsNumber()
  @Min(0.001)
  @IsOptional()
  listPortionQty?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  minQty?: number;

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber()
  @Min(0)
  @IsOptional()
  maxQty?: number | null;

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber()
  @Min(0)
  @IsOptional()
  qtyStep?: number | null;

  @IsBoolean()
  @IsOptional()
  allowCustomQty?: boolean;

  @IsOptional()
  @IsString()
  recipeId?: string | null;

  @IsOptional()
  @IsString()
  specialProductId?: string | null;

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber()
  @Min(0.001)
  @IsOptional()
  mixSpecialPlates?: number | null;

  @IsOptional()
  active?: boolean;
}
