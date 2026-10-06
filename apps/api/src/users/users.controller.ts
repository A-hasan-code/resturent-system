import { Body, Controller, Delete, Get, Module, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../common/permissions.guard";
import { AuthUser, CurrentUser, RequirePerms } from "../common/decorators";
import { UsersService } from "./users.service";
import { CreateUserDto, UpdateUserDto } from "./dto";

@Controller("users")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePerms("users.manage")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.list();
  }

  @Get("roles")
  roles() {
    return this.users.roles();
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.users.get(id);
  }

  @Post()
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateUserDto) {
    return this.users.create(actor, dto);
  }

  @Patch(":id")
  update(@CurrentUser() actor: AuthUser, @Param("id") id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(actor, id, dto);
  }

  @Delete(":id")
  remove(@CurrentUser() actor: AuthUser, @Param("id") id: string) {
    return this.users.remove(actor, id);
  }
}

@Module({
  providers: [UsersService],
  controllers: [UsersController],
})
export class UsersModule {}
