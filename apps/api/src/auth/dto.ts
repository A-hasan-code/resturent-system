import { IsString, Matches, MaxLength, MinLength } from "class-validator";

export const PIN_PATTERN = /^\d{4,6}$/;

export class LoginDto {
  @IsString()
  @MinLength(1)
  username!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

export class PinLoginDto {
  @IsString()
  @MinLength(1)
  userId!: string;

  @Matches(PIN_PATTERN, { message: "PIN must be 4 to 6 digits" })
  pin!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(6, { message: "New password must be at least 6 characters" })
  @MaxLength(72)
  newPassword!: string;
}

export class ChangePinDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @Matches(PIN_PATTERN, { message: "PIN must be 4 to 6 digits" })
  pin!: string;
}
