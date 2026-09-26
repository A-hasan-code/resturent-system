import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { AuthUser } from "../common/decorators";

type JwtPayload = {
  sub: string;
  username: string;
  roleCode: string;
  permissions: string[];
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET || "dev-secret",
    });
  }

  validate(payload: JwtPayload): AuthUser {
    return {
      id: payload.sub,
      username: payload.username,
      roleCode: payload.roleCode,
      permissions: payload.permissions,
    };
  }
}
