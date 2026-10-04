import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { OrderStatus } from "@prisma/client";

export class OrderLineDto {
  /** MENU (default) or PER_HEAD cover charge. */
  @IsOptional()
  @IsIn(["MENU", "PER_HEAD"])
  kind?: "MENU" | "PER_HEAD";

  @ValidateIf((o: OrderLineDto) => (o.kind ?? "MENU") !== "PER_HEAD")
  @IsString()
  menuItemId?: string;

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

  /** Preferred: restaurant table id (partition-safe). */
  @IsString()
  @IsOptional()
  tableId?: string;

  /** Cashier who will bill this order (MAIN_CASHIER or CASHIER). */
  @IsString()
  @IsOptional()
  assignedCashierId?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  /** Free-text name of who is serving the table (asked before kitchen slip). */
  @IsString()
  @IsOptional()
  servedByName?: string;

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

export class EditLineDto {
  @IsString()
  id!: string;

  @IsNumber()
  @Min(0)
  quantity!: number;
}

export class EditOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => EditLineDto)
  items!: EditLineDto[];
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

  /** Free-text name of who is serving when sending more items to the kitchen. */
  @IsString()
  @IsOptional()
  servedByName?: string;
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

  /** Guest tip collected with this payment (separate from food total). */
  @IsNumber()
  @Min(0)
  @IsOptional()
  tip?: number;

  /** Free-text name of who served the table. */
  @IsString()
  @IsOptional()
  servedByName?: string;

  /** Cashier the collected cash was handed to. Required when the payer does not keep a cash drawer. */
  @IsString()
  @IsOptional()
  handedToId?: string;
}

export class UpdateOrderDto {
  /** Free-text name of who is serving the table. */
  @IsString()
  @IsOptional()
  servedByName?: string | null;
}

export class UpdateStatusDto {
  @IsEnum(OrderStatus)
  status!: OrderStatus;
}
