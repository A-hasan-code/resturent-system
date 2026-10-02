import { Injectable, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "crypto";
import { existsSync, statSync } from "fs";
import { hostname, networkInterfaces } from "os";
import { join } from "path";
import { SettingsService } from "./settings.service";
import { ANDROID_APK, appVersion, downloadsDir, httpPort } from "../config/env";

export const APP_ID = "hotel-system";
export const MDNS_HOST = "hotel.local";

export type LanAddress = { iface: string; ip: string; broadcast: string };

@Injectable()
export class ServerIdentityService implements OnModuleInit {
  serverId = "";
  name = "";
  readonly version = appVersion();
  readonly port = httpPort();

  constructor(private readonly settings: SettingsService) {}

  async onModuleInit() {
    let id = await this.settings.get("server.id");
    if (!id) {
      id = process.env.HOTEL_SERVER_ID || randomUUID();
      await this.settings.set("server.id", id);
    }
    this.serverId = id;
    this.name = await this.settings.get("server.name", hostname());
  }

  async rename(name: string) {
    this.name = name.trim() || hostname();
    await this.settings.set("server.name", this.name);
  }

  addresses(): LanAddress[] {
    const out: LanAddress[] = [];
    for (const [iface, list] of Object.entries(networkInterfaces())) {
      for (const a of list ?? []) {
        if (a.family !== "IPv4" || a.internal) continue;
        if (a.address.startsWith("169.254.")) continue;
        out.push({ iface, ip: a.address, broadcast: broadcastOf(a.address, a.netmask) });
      }
    }
    // Prefer real Wi-Fi / Ethernet over Hyper-V, WSL, Docker, etc. (QR + tablet URLs use [0]).
    return out.sort((a, b) => lanRank(a) - lanRank(b) || a.ip.localeCompare(b.ip));
  }

  identity() {
    return {
      ok: true,
      app: APP_ID,
      serverId: this.serverId,
      name: this.name,
      version: this.version,
      port: this.port,
    };
  }

  info() {
    const addresses = this.addresses();
    return {
      ...this.identity(),
      hostname: hostname(),
      addresses,
      urls: addresses.map((a) => `http://${a.ip}:${this.port}`),
      mdnsUrl: `http://${MDNS_HOST}:${this.port}`,
      androidApk: this.androidApk(),
      time: new Date().toISOString(),
    };
  }

  private androidApk() {
    const dir = downloadsDir();
    const file = dir ? join(dir, ANDROID_APK) : null;
    if (!file || !existsSync(file)) return null;
    const s = statSync(file);
    return { path: `/downloads/${ANDROID_APK}`, size: s.size, updatedAt: s.mtime.toISOString() };
  }
}

function broadcastOf(ip: string, mask: string) {
  const a = ip.split(".").map(Number);
  const m = mask.split(".").map(Number);
  return a.map((o, i) => (o & m[i]) | (~m[i] & 255)).join(".");
}

/** Lower score = better for tablets / QR (real LAN first). */
function lanRank(a: LanAddress): number {
  let score = 0;
  const iface = a.iface.toLowerCase();
  if (
    /vethernet|hyper-?v|wsl|vmware|virtualbox|vbox|docker|vpn|zerotier|hamachi|tap-windows|bluetooth|loopback|pseudo|isatap|teredo|wi-?fi direct|hosted network|virtual/.test(
      iface
    )
  ) {
    score += 1000;
  }
  if (a.ip.startsWith("192.168.")) score += 0;
  else if (/^10\./.test(a.ip)) score += 10;
  else if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(a.ip)) score += 20;
  else score += 50;

  if (/wi-?fi|wlan|wireless|ethernet|local area connection|^eth\d|^en\d/.test(iface)) score -= 5;
  return score;
}
