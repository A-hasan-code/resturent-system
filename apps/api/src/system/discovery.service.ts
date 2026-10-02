import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { createSocket, Socket } from "dgram";
import { Bonjour, Service } from "bonjour-service";
import { APP_ID, MDNS_HOST, ServerIdentityService } from "./server-identity.service";

/** Clients listen here for periodic server announcements. */
export const BEACON_PORT = 41234;
/** Server listens here; clients send a probe and get a direct reply. */
export const PROBE_PORT = 41235;
const BEACON_EVERY_MS = 2000;

@Injectable()
export class DiscoveryService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger("Discovery");
  private beacon?: Socket;
  private probe?: Socket;
  private timer?: NodeJS.Timeout;
  private bonjour?: Bonjour;
  private mdns?: Service;

  constructor(private readonly identity: ServerIdentityService) {}

  onApplicationBootstrap() {
    if (process.env.DISCOVERY_DISABLED === "1") return;
    this.startBeacon();
    this.startProbeResponder();
    this.startMdns();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.beacon?.close();
    this.probe?.close();
    this.mdns?.stop?.();
    this.bonjour?.destroy();
  }

  private message() {
    return Buffer.from(
      JSON.stringify({
        ...this.identity.identity(),
        ips: this.identity.addresses().map((a) => a.ip),
      })
    );
  }

  private startBeacon() {
    const sock = createSocket({ type: "udp4", reuseAddr: true });
    sock.on("error", (e) => this.log.warn(`beacon: ${e.message}`));
    sock.bind(() => {
      sock.setBroadcast(true);
      const send = () => {
        const msg = this.message();
        const targets = new Set(["255.255.255.255", ...this.identity.addresses().map((a) => a.broadcast)]);
        for (const t of targets) sock.send(msg, BEACON_PORT, t, () => undefined);
      };
      send();
      this.timer = setInterval(send, BEACON_EVERY_MS);
      this.log.log(`UDP beacon → port ${BEACON_PORT} every ${BEACON_EVERY_MS / 1000}s`);
    });
    this.beacon = sock;
  }

  private startProbeResponder() {
    const sock = createSocket({ type: "udp4", reuseAddr: true });
    sock.on("error", (e) => this.log.warn(`probe: ${e.message}`));
    sock.on("message", (buf, rinfo) => {
      const text = buf.toString();
      if (!text.includes(APP_ID)) return;
      sock.send(this.message(), rinfo.port, rinfo.address, () => undefined);
    });
    sock.bind(PROBE_PORT, () => this.log.log(`Probe responder on UDP ${PROBE_PORT}`));
    this.probe = sock;
  }

  private startMdns() {
    try {
      this.bonjour = new Bonjour(undefined, (e: Error) => this.log.warn(`mDNS: ${e.message}`));
      this.mdns = this.bonjour.publish({
        name: `Hotel System ${this.identity.serverId.slice(0, 8)}`,
        type: "http",
        port: this.identity.port,
        host: MDNS_HOST,
        txt: { app: APP_ID, serverId: this.identity.serverId, path: "/" },
      });
      this.log.log(`mDNS: http://${MDNS_HOST}:${this.identity.port}`);
    } catch (e) {
      this.log.warn(`mDNS disabled: ${(e as Error).message}`);
    }
  }
}
