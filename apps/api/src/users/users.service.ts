import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { AuthUser } from "../common/decorators";
import { CreateUserDto, UpdateUserDto } from "./dto";

const ADMIN = "ADMIN";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const users = await this.prisma.user.findMany({
      include: { role: true },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });
    return users.map((u) => this.toDto(u));
  }

  roles() {
    return this.prisma.role.findMany({
      select: { code: true, name: true },
      orderBy: { name: "asc" },
    });
  }

  async create(actor: AuthUser, dto: CreateUserDto) {
    const role = await this.role(dto.roleCode);
    this.assertCanAssign(actor, role.code);
    const username = dto.username.toLowerCase();
    if (await this.prisma.user.findUnique({ where: { username } })) {
      throw new ConflictException(`Username "${username}" is already taken`);
    }
    const user = await this.prisma.user.create({
      data: {
        name: dto.name.trim(),
        username,
        passwordHash: await bcrypt.hash(dto.password, 10),
        pinHash: dto.pin ? await bcrypt.hash(dto.pin, 10) : null,
        roleId: role.id,
      },
      include: { role: true },
    });
    return this.toDto(user);
  }

  async update(actor: AuthUser, id: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { role: true } });
    if (!user) throw new NotFoundException("User not found");
    if (user.role.code === ADMIN && actor.roleCode !== ADMIN) {
      throw new ForbiddenException("Only an admin can change an admin account");
    }

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.username !== undefined && dto.username.toLowerCase() !== user.username) {
      const username = dto.username.toLowerCase();
      if (await this.prisma.user.findUnique({ where: { username } })) {
        throw new ConflictException(`Username "${username}" is already taken`);
      }
      data.username = username;
    }
    if (dto.password) data.passwordHash = await bcrypt.hash(dto.password, 10);
    if (dto.pin !== undefined) data.pinHash = dto.pin ? await bcrypt.hash(dto.pin, 10) : null;

    let newRoleCode = user.role.code;
    if (dto.roleCode !== undefined && dto.roleCode !== user.role.code) {
      if (id === actor.id) throw new BadRequestException("You cannot change your own role");
      const role = await this.role(dto.roleCode);
      this.assertCanAssign(actor, role.code);
      data.roleId = role.id;
      newRoleCode = role.code;
    }
    if (dto.active !== undefined && dto.active !== user.active) {
      if (id === actor.id && !dto.active) throw new BadRequestException("You cannot deactivate your own account");
      data.active = dto.active;
    }

    const losesAdmin = user.role.code === ADMIN && user.active && (newRoleCode !== ADMIN || dto.active === false);
    if (losesAdmin) {
      const admins = await this.prisma.user.count({ where: { active: true, role: { code: ADMIN } } });
      if (admins <= 1) throw new BadRequestException("At least one active admin account is required");
    }

    const updated = await this.prisma.user.update({ where: { id }, data, include: { role: true } });
    return this.toDto(updated);
  }

  private assertCanAssign(actor: AuthUser, roleCode: string) {
    if (roleCode === ADMIN && actor.roleCode !== ADMIN) {
      throw new ForbiddenException("Only an admin can create or assign admin accounts");
    }
  }

  private async role(code: string) {
    const role = await this.prisma.role.findUnique({ where: { code } });
    if (!role) throw new BadRequestException(`Unknown role "${code}"`);
    return role;
  }

  private toDto(u: {
    id: string;
    name: string;
    username: string;
    active: boolean;
    pinHash: string | null;
    createdAt: Date;
    role: { code: string; name: string };
  }) {
    return {
      id: u.id,
      name: u.name,
      username: u.username,
      active: u.active,
      hasPin: !!u.pinHash,
      roleCode: u.role.code,
      roleName: u.role.name,
      createdAt: u.createdAt,
    };
  }
}
