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
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { OrderStatus } from "@prisma/client";

export class PerHeadPackageLineDto {
  @IsString()
  menuItemId!: string;

  @IsNumber()
  @Min(0.001)
  quantity!: number;
}

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

  /** SPECIAL: PLATE (default) or RS. MIX uses MIX / MIX_SOLO_STORE server-side. */
  @IsOptional()
  @IsIn(["PLATE", "RS", "MIX"])
  saleMode?: "PLATE" | "RS" | "MIX";

  /** SPECIAL RS mode: rupees to convert into grams. */
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amountRs?: number;

  /** MIX: if special pot is out, sell store part only (e.g. sirf Rosh). */
  @IsOptional()
  @IsBoolean()
  soloStoreFallback?: boolean;

  /**
   * With PER_HEAD: kitchen package lines (included, Rs 0).
   * menuItemId must be in Settings per-head package.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PerHeadPackageLineDto)
  packageLines?: PerHeadPackageLineDto[];

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

  /** Seated credit account. The order is the invoice; cash is collected later. */
  @IsOptional()
  @IsString()
  creditCustomerId?: string;
}

export class EditLineDto {
  @IsString()
  id!: string;

  @IsNumber()
  @Min(0)
  quantity!: number;
}

/** New menu lines added during bill edit (paid or unpaid). */
export class EditAddLineDto {
  @IsString()
  menuItemId!: string;

  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @IsOptional()
  @IsIn(["PLATE", "RS", "MIX"])
  saleMode?: "PLATE" | "RS" | "MIX";

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amountRs?: number;

  @IsOptional()
  @IsBoolean()
  soloStoreFallback?: boolean;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class EditOrderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EditLineDto)
  items!: EditLineDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EditAddLineDto)
  addItems?: EditAddLineDto[];

  /** Required when editing a PAID bill (Main Cashier audit reason). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;

  /** Move the open bill onto this table. The previous table is released. */
  @IsOptional()
  @IsString()
  tableId?: string;

  @IsOptional()
  @IsString()
  assignedCashierId?: string;

  /** Order taker. Must be a supervisor when changed. */
  @IsOptional()
  @IsString()
  waiterId?: string;

  @IsOptional()
  @IsString()
  servedByName?: string;
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

  @IsOptional()
  @IsString()
  creditCustomerId?: string;
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
  /** Cash the guest handed over (may be more than the amount due; change is returned). */
  @IsNumber()
  @Min(0)
  @IsOptional()
  amount?: number;

  /** Discount to apply on the bill (gross − discount = net due). */
  @IsNumber()
  @Min(0)
  @IsOptional()
  discount?: number;

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

export class CancelOrderDto {
  @IsString()
  @MaxLength(200)
  reason!: string;
}
