import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Observable, tap } from "rxjs";
import { MachineLogService } from "../system/machine-log.service";
import { AuthUser } from "./decorators";

/** Paths that heartbeat / poll too often — skip activity log. */
const SKIP =
  /^\/api\/(print-agents\/heartbeat|print-agents\/jobs\/claim|print-agents\/jobs\/[^/]+\/(done|fail)|system\/machine-logs|system\/network-health|health|auth\/staff|auth\/login|auth\/pin)(\?|$)/i;

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function shortAction(method: string, path: string): string {
  const p = path.replace(/^\/api/, "").split("?")[0];
  const parts = p.split("/").filter(Boolean);
  const head = parts[0] || "api";
  const tail = parts.slice(1, 3).join("/");
  return `${method} /${head}${tail ? "/" + tail : ""}`;
}

@Injectable()
export class MachineActivityInterceptor implements NestInterceptor {
  constructor(private readonly logs: MachineLogService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<{
      method?: string;
      originalUrl?: string;
      url?: string;
      user?: AuthUser;
      ip?: string;
    }>();
    const method = (req.method || "GET").toUpperCase();
    const path = req.originalUrl || req.url || "";
    if (!MUTATING.has(method)) return next.handle();
    if (SKIP.test(path)) return next.handle();

    const started = Date.now();
    return next.handle().pipe(
      tap({
        next: () => {
          const user = req.user;
          const who = user?.name || user?.username || "guest";
          const role = user?.roleCode ? ` (${user.roleCode})` : "";
          this.logs.info(
            this.logs.mainId(),
            "Main server",
            `${shortAction(method, path)} · ${who}${role} · ${Date.now() - started}ms`,
            { method, path: path.split("?")[0], userId: user?.id }
          );
        },
        error: (err: { status?: number; message?: string; statusCode?: number }) => {
          const user = req.user;
          const who = user?.name || user?.username || "guest";
          const code = err?.status || err?.statusCode || 500;
          const msg = err?.message ? String(err.message).slice(0, 160) : "failed";
          this.logs.warn(
            this.logs.mainId(),
            "Main server",
            `${shortAction(method, path)} · ${who} · HTTP ${code}: ${msg}`,
            { method, path: path.split("?")[0], status: code }
          );
        },
      })
    );
  }
}
