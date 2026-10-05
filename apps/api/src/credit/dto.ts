import { IsNumber, IsOptional, IsString, Min, MinLength } from "class-validator";

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
