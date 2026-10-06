import { CashCounterKind } from "@prisma/client";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

export class CloseCounterInputDto {
  @IsEnum(CashCounterKind)
  kind!: CashCounterKind;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  collectedCash!: number;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  missReason?: string;
}

export class SaveDayCashCloseDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  businessDate!: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  note?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  openingFloat?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CloseCounterInputDto)
  counters!: CloseCounterInputDto[];
}
