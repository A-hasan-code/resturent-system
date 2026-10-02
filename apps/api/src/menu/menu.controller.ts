import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { MenuService } from "./menu.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../common/permissions.guard";
import { AuthUser, CurrentUser, RequirePerms } from "../common/decorators";
import { CreateMenuItemDto, UpdateMenuItemDto } from "./dto";

@Controller("menu")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  @Get()
  @RequirePerms("menu.view", "order.create")
  list(@CurrentUser() user: AuthUser) {
    const showCost = ["menu.manage", "reports.view", "recipe.manage"].some((p) =>
      user.permissions.includes(p)
    );
    return this.menu.list(showCost);
  }

  @Post()
  @RequirePerms("menu.manage")
  create(@Body() dto: CreateMenuItemDto) {
    return this.menu.create(dto);
  }

  @Patch(":id")
  @RequirePerms("menu.manage")
  update(@Param("id") id: string, @Body() dto: UpdateMenuItemDto) {
    return this.menu.update(id, dto);
  }

  @Delete(":id")
  @RequirePerms("menu.manage")
  remove(@Param("id") id: string) {
    return this.menu.remove(id);
  }
}
