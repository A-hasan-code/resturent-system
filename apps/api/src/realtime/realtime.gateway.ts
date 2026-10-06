import { Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";

type TokenPayload = { sub: string; roleCode: string; permissions: string[] };

export const ROOM = {
  all: "all",
  kitchen: "kitchen",
  /** Floor staff who pick up READY food (waiter + supervisor). */
  floor: "floor",
  cashier: "cashier",
  print: "print",
  user: (id: string) => `user:${id}`,
};

const FLOOR_ROLES = new Set(["WAITER", "SUPERVISOR"]);

@WebSocketGateway({ cors: { origin: true } })
export class RealtimeGateway implements OnGatewayConnection {
  private readonly log = new Logger("Realtime");
  private readonly jwt = new JwtService({ secret: process.env.JWT_SECRET || "dev-secret" });

  @WebSocketServer()
  server!: Server;

  async handleConnection(client: Socket) {
    const token =
      (client.handshake.auth?.token as string | undefined) ||
      (client.handshake.query?.token as string | undefined);
    try {
      const p = await this.jwt.verifyAsync<TokenPayload>(token || "");
      const perms = new Set(p.permissions || []);
      const rooms = [ROOM.all, ROOM.user(p.sub)];
      if (perms.has("kitchen.view")) rooms.push(ROOM.kitchen);
      if (FLOOR_ROLES.has(p.roleCode)) rooms.push(ROOM.floor);
      if (perms.has("order.pay") || perms.has("bill.view")) rooms.push(ROOM.cashier);
      if (perms.has("order.pay") || perms.has("printers.manage") || perms.has("print.bill")) {
        rooms.push(ROOM.print);
      }
      await client.join(rooms);
    } catch {
      client.emit("auth.error", { message: "Login expired" });
      client.disconnect(true);
    }
  }

  emit(rooms: string | string[], event: string, payload: unknown) {
    if (!this.server) return;
    this.server.to(rooms).emit(event, payload);
  }

  logClients() {
    this.log.log(`clients: ${this.server?.engine.clientsCount ?? 0}`);
  }
}
