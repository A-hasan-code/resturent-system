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
    return out;
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
