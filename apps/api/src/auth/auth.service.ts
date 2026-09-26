import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { AuthUser } from "../common/decorators";
import { LoginDto } from "./dto";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService
  ) {}

  async loadUserAuth(userId: string): Promise<AuthUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
      },
    });
    if (!user?.active) return null;
    return {
      id: user.id,
      username: user.username,
      roleCode: user.role.code,
      permissions: user.role.permissions.map((p) => p.permission.code),
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (
      !user?.active ||
      !(await bcrypt.compare(dto.password, user.passwordHash))
    ) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const authUser = await this.loadUserAuth(user.id);
    if (!authUser) throw new UnauthorizedException("Invalid credentials");

    const token = await this.jwt.signAsync({
      sub: authUser.id,
      username: authUser.username,
      roleCode: authUser.roleCode,
      permissions: authUser.permissions,
    });

    return {
      token,
      user: {
        id: authUser.id,
        name: user.name,
        username: authUser.username,
        roleCode: authUser.roleCode,
        permissions: authUser.permissions,
      },
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    const authUser = await this.loadUserAuth(userId);
    return {
      id: user.id,
      name: user.name,
      username: authUser!.username,
      roleCode: authUser!.roleCode,
      permissions: authUser!.permissions,
    };
  }
}
