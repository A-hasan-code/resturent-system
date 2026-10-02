import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AuthService } from "./auth.service";
import { ChangePasswordDto, ChangePinDto, LoginDto, PinLoginDto } from "./dto";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { CurrentUser, AuthUser } from "../common/decorators";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("login")
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, req.ip ?? "");
  }

  @Get("staff")
  staff() {
    return this.auth.staff();
  }

  @Post("pin")
  @HttpCode(200)
  pin(@Body() dto: PinLoginDto, @Req() req: Request) {
    return this.auth.loginWithPin(dto, req.ip ?? "");
  }

  @UseGuards(JwtAuthGuard)
  @Get("me")
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post("password")
  @HttpCode(200)
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post("my-pin")
  @HttpCode(200)
  changePin(@CurrentUser() user: AuthUser, @Body() dto: ChangePinDto) {
    return this.auth.changePin(user.id, dto);
  }
}
