import { HotelExpensePeriod } from "@prisma/client";
import { Type } from "class-transformer";
import { IsEnum, IsNumber, IsOptional, IsString, Matches, Min, MinLength } from "class-validator";

export class CreateHotelExpenseDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  spentOn!: string;

  /** Optional free-text label — not limited to saved categories. */
  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @MinLength(1)
  title!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsEnum(HotelExpensePeriod)
  period!: HotelExpensePeriod;

  @IsString()
  @IsOptional()
  note?: string;
}

export class UpdateHotelExpenseDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsOptional()
  spentOn?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @MinLength(1)
  @IsOptional()
  title?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  @IsOptional()
  amount?: number;

  @IsEnum(HotelExpensePeriod)
  @IsOptional()
  period?: HotelExpensePeriod;

  @IsString()
  @IsOptional()
  note?: string;
}

export class CreateExpenseCategoryDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
