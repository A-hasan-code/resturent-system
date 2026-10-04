import { Body, Controller, Get, Module, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../common/permissions.guard";
import { AuthUser, CurrentUser, RequirePerms } from "../common/decorators";
import { SaveDayCashCloseDto } from "./close.dto";
import { CloseService } from "./close.service";

@Controller("close")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CloseController {
  constructor(private readonly close: CloseService) {}

  @Get("preview")
  @RequirePerms("close.view", "close.manage")
  preview(@Query("date") date?: string) {
    return this.close.preview(date);
  }

  @Get("history")
  @RequirePerms("close.view", "close.manage")
  history(@Query("limit") limit?: string) {
    return this.close.history(limit ? Number(limit) : 60);
  }

  @Post()
  @RequirePerms("close.manage")
  save(@Body() dto: SaveDayCashCloseDto, @CurrentUser() user: AuthUser) {
    return this.close.save(dto, user);
  }
}

@Module({
  providers: [CloseService],
  controllers: [CloseController],
})
export class CloseModule {}
