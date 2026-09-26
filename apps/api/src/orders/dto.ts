import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { OrderStatus } from "@prisma/client";

class OrderLineDto {
  @IsString()
  menuItemId!: string;

  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class CreateOrderDto {
  @IsString()
  @IsOptional()
  tableNo?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  items!: OrderLineDto[];
}

export class PayOrderDto {
  @IsNumber()
  @Min(0.01)
  @IsOptional()
  amount?: number;
}

export class UpdateStatusDto {
  @IsEnum(OrderStatus)
  status!: OrderStatus;
}
