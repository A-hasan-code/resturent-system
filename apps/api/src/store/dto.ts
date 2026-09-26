import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from "class-validator";
import { UnitType } from "@prisma/client";

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
