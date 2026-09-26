import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from "class-validator";
import { UnitType } from "@prisma/client";

export class CreateMenuItemDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsEnum(UnitType)
  sellUnit!: UnitType;

  @IsNumber()
  @Min(0)
  sellingPrice!: number;

  @IsString()
  @IsOptional()
  recipeId?: string;
}

export class UpdateMenuItemDto {
  @IsString()
  @MinLength(1)
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  category?: string | null;

  @IsEnum(UnitType)
  @IsOptional()
  sellUnit?: UnitType;

  @IsNumber()
  @Min(0)
  @IsOptional()
  sellingPrice?: number;

  @IsOptional()
  @IsString()
  recipeId?: string | null;

  @IsOptional()
  active?: boolean;
}
