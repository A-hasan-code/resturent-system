import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

export class CreditCustomerDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(3)
  phone!: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  cnic?: string;
}

/** Cash collected against a credit account. Applied oldest invoice first. */
export class SettleCreditDto {
  @IsNumber()
  @Min(0.01)
  amount!: number;
}

class CreditSlipRestaurantDto {
  @IsString()
  name!: string;

  @IsString()
  tagline!: string;

  @IsString()
  address!: string;

  @IsString()
  phone!: string;
}

class CreditSlipCustomerDto {
  @IsString()
  name!: string;

  @IsString()
  phone!: string;

  @IsOptional()
  @IsString()
  address!: string | null;

  @IsOptional()
  @IsString()
  cnic!: string | null;
}

class CreditSlipItemDto {
  @IsString()
  name!: string;

  @IsNumber()
  quantity!: number;

  @IsString()
  unit!: string;

  @IsNumber()
  amount!: number;
}

class CreditSlipInvoiceDto {
  @IsNumber()
  orderNo!: number;

  @IsOptional()
  @IsString()
  tableNo!: string | null;

  @IsNumber()
  total!: number;

  @IsNumber()
  paid!: number;

  @IsNumber()
  dueAfter!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreditSlipItemDto)
  items!: CreditSlipItemDto[];
}

class CreditSlipDayDto {
  @IsString()
  date!: string;

  @IsNumber()
  total!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreditSlipInvoiceDto)
  invoices!: CreditSlipInvoiceDto[];
}

/** Body from the credit paid-slip modal — reprints on the cashier bill printer. */
export class PrintCreditSlipDto {
  @ValidateNested()
  @Type(() => CreditSlipRestaurantDto)
  restaurant!: CreditSlipRestaurantDto;

  @ValidateNested()
  @Type(() => CreditSlipCustomerDto)
  customer!: CreditSlipCustomerDto;

  @IsString()
  collectedBy!: string;

  @IsString()
  paidAt!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreditSlipDayDto)
  days!: CreditSlipDayDto[];

  @IsNumber()
  total!: number;

  @IsNumber()
  outstandingBefore!: number;

  @IsNumber()
  remaining!: number;

  @IsBoolean()
  cleared!: boolean;
}
