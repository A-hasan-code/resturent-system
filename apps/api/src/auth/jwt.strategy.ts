import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { AuthUser } from "../common/decorators";
import { AuthService } from "./auth.service";

type JwtPayload = { sub: string };

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly auth: AuthService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET || "dev-secret",
    });
  }

  /** Role, permissions and active flag are read live, so admin changes apply without re-login. */
  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.auth.loadUserAuth(payload.sub);
    if (!user) throw new UnauthorizedException("Account disabled");
    return user;
  }
}
