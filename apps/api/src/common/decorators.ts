import { createParamDecorator, ExecutionContext, SetMetadata } from "@nestjs/common";

export const PERMS_KEY = "perms";
export const RequirePerms = (...perms: string[]) => SetMetadata(PERMS_KEY, perms);

export type AuthUser = {
  id: string;
  name: string;
  username: string;
  roleCode: string;
  permissions: string[];
};

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.user;
  }
);
