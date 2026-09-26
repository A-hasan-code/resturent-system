import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PERMS_KEY } from "./decorators";
import { AuthUser } from "./decorators";

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const needed = this.reflector.getAllAndOverride<string[]>(PERMS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!needed?.length) return true;

    const req = ctx.switchToHttp().getRequest();
    const user = req.user as AuthUser | undefined;
    const ok = needed.some((p) => user?.permissions?.includes(p));
    if (!ok) throw new ForbiddenException("Forbidden");
    return true;
  }
}
