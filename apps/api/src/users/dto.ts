import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from "class-validator";
import { PIN_PATTERN } from "../auth/dto";

const USERNAME = /^[a-z0-9._-]{3,32}$/;
const USERNAME_MSG = "Username must be 3-32 characters: lowercase letters, numbers, dot, dash or underscore";

export class CreateUserDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @Matches(USERNAME, { message: USERNAME_MSG })
  username!: string;

  @IsString()
  @MinLength(6, { message: "Password must be at least 6 characters" })
  @MaxLength(72)
  password!: string;

  @IsString()
  roleCode!: string;

  @IsOptional()
  @Matches(PIN_PATTERN, { message: "PIN must be 4 to 6 digits" })
  pin?: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @Matches(USERNAME, { message: USERNAME_MSG })
  username?: string;

  @IsOptional()
  @IsString()
  @MinLength(6, { message: "Password must be at least 6 characters" })
  @MaxLength(72)
  password?: string;

  @IsOptional()
  @IsString()
  roleCode?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /** A new PIN, or null to remove the PIN. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(PIN_PATTERN, { message: "PIN must be 4 to 6 digits" })
  pin?: string | null;
}
