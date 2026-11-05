import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ServerIdentityService, MDNS_HOST } from "./server-identity.service";
import { probeNetworkPrinter } from "../print/drivers";
import { MachineLogService } from "./machine-log.service";

const AGENT_ONLINE_MS = 45_000;

export type NetworkHealth = {
  checkedAt: string;
  ok: boolean;
  api: { ok: boolean; port: number; version: string; hostname: string };
  database: { ok: boolean; detail: string };
  lan: {
    ok: boolean;
    addresses: { iface: string; ip: string }[];
    urls: string[];
    mdnsUrl: string;
  };
  agents: {
    id: string;
    hostname: string;
    displayName: string;
    online: boolean;
    lastSeenAt: string;
    printerCount: number;
    activePrinters: number;
  }[];
  printers: {
    network: { total: number; online: number; offline: number };
    windows: { total: number; active: number };
    agent: { total: number; active: number };
  };
  summary: string[];
};

@Injectable()
export class NetworkHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: ServerIdentityService,
    private readonly logs: MachineLogService
  ) {}

  async check(): Promise<NetworkHealth> {
    const checkedAt = new Date().toISOString();
    const summary: string[] = [];

    let dbOk = false;
    let dbDetail = "not checked";
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      dbOk = true;
      dbDetail = "connected";
    } catch (e) {
      dbDetail = e instanceof Error ? e.message : "database unreachable";
      summary.push(`Database: ${dbDetail}`);
      this.logs.error(this.logs.mainId(), "Main server", `DB health failed: ${dbDetail}`);
    }

    const addresses = this.identity.addresses().map((a) => ({ iface: a.iface, ip: a.ip }));
    const urls = this.identity.info().urls as string[];
    const lanOk = addresses.length > 0;
    if (!lanOk) summary.push("No LAN IPv4 address found (Wi‑Fi / Ethernet?)");

    const agentRows = await this.prisma.printAgent.findMany({
      include: {
        printers: { select: { id: true, active: true } },
      },
      orderBy: { hostname: "asc" },
    });
    const agents = agentRows.map((a) => {
      const online = Date.now() - a.lastSeenAt.getTime() < AGENT_ONLINE_MS;
      return {
        id: a.id,
        hostname: a.hostname,
        displayName: a.displayName || a.hostname,
        online,
        lastSeenAt: a.lastSeenAt.toISOString(),
        printerCount: a.printers.length,
        activePrinters: a.printers.filter((p) => p.active).length,
      };
    });
    const offlineAgents = agents.filter((a) => !a.online);
    if (offlineAgents.length) {
      summary.push(
        `Offline Cashier PCs: ${offlineAgents.map((a) => a.displayName).join(", ")}`
      );
    }

    const allPrinters = await this.prisma.printer.findMany({
      where: { active: true },
      select: { kind: true, target: true },
    });
    const networkTargets = [
      ...new Set(
        allPrinters
          .filter((p) => p.kind === "NETWORK" && p.target.trim())
          .map((p) => p.target.trim())
      ),
    ];
    const probeList = networkTargets.slice(0, 12);
    const probeHits = await Promise.all(probeList.map((t) => probeNetworkPrinter(t, 1500)));
    const netOnline = probeHits.filter(Boolean).length;
    const netTotal = networkTargets.length;
    const netOffline = Math.max(0, netTotal - netOnline);
    if (netOffline > 0) summary.push(`LAN printers offline: ${netOffline} of ${netTotal}`);

    const windows = allPrinters.filter((p) => p.kind === "WINDOWS");
    const agentPrinters = allPrinters.filter((p) => p.kind === "AGENT");

    const ok = dbOk && lanOk;
    if (ok && !summary.length) summary.push("Network health OK");

    this.logs.info(
      this.logs.mainId(),
      "Main server",
      `Network health check: ${ok ? "OK" : "ISSUES"} (agents online ${agents.filter((a) => a.online).length}/${agents.length}, LAN printers ${netOnline}/${netTotal})`
    );

    return {
      checkedAt,
      ok,
      api: {
        ok: true,
        port: this.identity.port,
        version: this.identity.version,
        hostname: this.identity.info().hostname as string,
      },
      database: { ok: dbOk, detail: dbDetail },
      lan: {
        ok: lanOk,
        addresses,
        urls,
        mdnsUrl: `http://${MDNS_HOST}:${this.identity.port}`,
      },
      agents,
      printers: {
        network: { total: netTotal, online: netOnline, offline: netOffline },
        windows: { total: windows.length, active: windows.length },
        agent: { total: agentPrinters.length, active: agentPrinters.length },
      },
      summary,
    };
  }
}
