import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { AuthUser } from "../common/decorators";
import { ChangePasswordDto, ChangePinDto, LoginDto, PinLoginDto } from "./dto";
import { LoginThrottle } from "./login-throttle";

const INVALID = "Invalid username or password";

@Injectable()
export class AuthService {
  private readonly throttle = new LoginThrottle();

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
    if (!user?.active || user.deletedAt) return null;
    return {
      id: user.id,
      name: user.name,
      username: user.username,
      roleCode: user.role.code,
      permissions: user.role.permissions.map((p) => p.permission.code),
    };
  }

  async login(dto: LoginDto, ip: string) {
    const username = dto.username.trim().toLowerCase();
    const key = `pw:${ip}:${username}`;
    this.throttle.assertAllowed(key);
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user?.active || user.deletedAt || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      this.throttle.fail(key);
      throw new UnauthorizedException(INVALID);
    }
    this.throttle.succeed(key);
    return this.issue(user.id);
  }

  async loginWithPin(dto: PinLoginDto, ip: string) {
    const key = `pin:${ip}:${dto.userId}`;
    this.throttle.assertAllowed(key);
    const user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (
      !user?.active ||
      user.deletedAt ||
      !user.pinHash ||
      !(await bcrypt.compare(dto.pin, user.pinHash))
    ) {
      this.throttle.fail(key);
      throw new UnauthorizedException("Wrong PIN");
    }
    this.throttle.succeed(key);
    return this.issue(user.id);
  }

  /** Public list for the PIN login screen: only active staff who have a PIN. */
  async staff() {
    const users = await this.prisma.user.findMany({
      where: { active: true, deletedAt: null, pinHash: { not: null } },
      include: { role: true },
      orderBy: [{ role: { code: "asc" } }, { name: "asc" }],
    });
    return users.map((u) => ({ id: u.id, name: u.name, roleCode: u.role.code, roleName: u.role.name }));
  }

  async me(userId: string) {
    const authUser = await this.loadUserAuth(userId);
    if (!authUser) throw new UnauthorizedException();
    return authUser;
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    await this.verifyPassword(userId, dto.currentPassword);
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException("New password must be different from the current one");
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(dto.newPassword, 10) },
    });
    return { ok: true };
  }

  async changePin(userId: string, dto: ChangePinDto) {
    await this.verifyPassword(userId, dto.currentPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { pinHash: await bcrypt.hash(dto.pin, 10) },
    });
    return { ok: true };
  }

  private async verifyPassword(userId: string, password: string) {
    const key = `verify:${userId}`;
    this.throttle.assertAllowed(key);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      this.throttle.fail(key);
      throw new BadRequestException("Current password is incorrect");
    }
    this.throttle.succeed(key);
  }

  private async issue(userId: string) {
    const authUser = await this.loadUserAuth(userId);
    if (!authUser) throw new UnauthorizedException(INVALID);
    const token = await this.jwt.signAsync({
      sub: authUser.id,
      username: authUser.username,
      roleCode: authUser.roleCode,
      permissions: authUser.permissions,
    });
    return { token, user: authUser };
  }
}
