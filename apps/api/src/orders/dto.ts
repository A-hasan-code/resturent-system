import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { OrderStatus } from "@prisma/client";

export class OrderLineDto {
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

  /** Send the kitchen slip to the printer right away (default). False = the client previews it first. */
  @IsOptional()
  @IsBoolean()
  printKot?: boolean;
}

export class AddItemsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  items!: OrderLineDto[];

  @IsOptional()
  @IsBoolean()
  printKot?: boolean;
}

export class PrintKotDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  round?: number;

  /** Marks the slip "REPRINT" (default). False for the first print of a previewed slip. */
  @IsOptional()
  @IsBoolean()
  reprint?: boolean;
}

export class PayOrderDto {
  @IsNumber()
  @Min(0.01)
  @IsOptional()
  amount?: number;

  /** Cashier the collected cash was handed to. Required when the payer does not keep a cash drawer. */
  @IsString()
  @IsOptional()
  handedToId?: string;
}

export class UpdateStatusDto {
  @IsEnum(OrderStatus)
  status!: OrderStatus;
}
