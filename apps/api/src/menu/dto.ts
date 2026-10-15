import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { MenuDealPartKind, MenuItemKind, UnitType } from "@prisma/client";

export class MenuDealPartInputDto {
  @IsEnum(MenuDealPartKind)
  kind!: MenuDealPartKind;

  @ValidateIf((o) => o.kind === "STORE")
  @IsString()
  @MinLength(1)
  recipeId?: string;

  @ValidateIf((o) => o.kind === "SPECIAL")
  @IsString()
  @MinLength(1)
  specialProductId?: string;

  /** Per 1 deal: recipe multiplier or pot plates. */
  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @IsOptional()
  @IsString()
  label?: string | null;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

export class CreateMenuItemDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @MinLength(1)
  @IsOptional()
  kitchenStation?: string;

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

  /** MIX deal parts (preferred). At least one STORE; SPECIAL optional. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MenuDealPartInputDto)
  parts?: MenuDealPartInputDto[];
}

export class UpdateMenuItemDto {
  @IsString()
  @MinLength(1)
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  category?: string | null;

  @IsString()
  @MinLength(1)
  @IsOptional()
  kitchenStation?: string;

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
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MenuDealPartInputDto)
  parts?: MenuDealPartInputDto[];

  @IsOptional()
  active?: boolean;
}

export class MenuModifierInputDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsNumber()
  priceDelta!: number;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

export class SetMenuModifiersDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MenuModifierInputDto)
  modifiers?: MenuModifierInputDto[];
}
