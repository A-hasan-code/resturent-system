import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomBytes } from "crypto";
import { hostname as osHostname, networkInterfaces } from "os";
import { PrismaService } from "../prisma/prisma.service";
import { PrintService } from "./print.service";
import { MachineLogService } from "../system/machine-log.service";

const ONLINE_MS = 45_000;
const MAX_DEVICES = 80;

export type AgentPrinterIn = {
  name: string;
  driver?: string;
  port?: string;
  isDefault?: boolean;
};

export type AgentDeviceIn = {
  name: string;
  className?: string;
  status?: string;
  instanceId?: string;
  problem?: boolean;
};

@Injectable()
export class PrintAgentsService implements OnModuleInit {
  private readonly log = new Logger("PrintAgent");

  constructor(
    private readonly prisma: PrismaService,
    private readonly print: PrintService,
    private readonly machineLogs: MachineLogService,
  ) {}

  async onModuleInit() {
    await this.purgeMainServerAgents();
  }

  /**
   * Main PC must never appear under Cashier PCs. Removes agents whose hostname
   * matches this server (e.g. SITSERVER registered itself by mistake).
   */
  async purgeMainServerAgents() {
    const aliases = serverHostAliases();
    if (!aliases.size) return;
    const agents = await this.prisma.printAgent.findMany({
      select: { id: true, hostname: true, displayName: true },
    });
    for (const a of agents) {
      const h = normalizeHost(a.hostname);
      const d = normalizeHost(a.displayName);
      if (!aliases.has(h) && !aliases.has(d)) continue;
      await this.remove(a.id);
      this.log.warn(
        `Removed Main server self-agent "${a.displayName || a.hostname}" — use USB/Windows (server) printers, not Cashier PC`,
      );
    }
  }

  /** Admin: permanently remove a Cashier PC agent + its AGENT printers. */
  async remove(id: string) {
    const agent = await this.prisma.printAgent.findUnique({ where: { id } });
    if (!agent) throw new NotFoundException("Print agent not found");
    // Clear cashier bill-printer assignments pointing at this agent's printers
    const printerIds = (
      await this.prisma.printer.findMany({ where: { agentId: id }, select: { id: true } })
    ).map((p) => p.id);
    if (printerIds.length) {
      await this.prisma.user.updateMany({
        where: { billPrinterId: { in: printerIds } },
        data: { billPrinterId: null },
      });
    }
    await this.prisma.printAgent.delete({ where: { id } });
    this.log.log(`Deleted print agent ${agent.hostname} (${id})`);
    this.machineLogs.warn(
      id,
      agent.displayName || agent.hostname,
      `Cashier PC removed from Settings (${agent.hostname})`
    );
    return { ok: true };
  }

  async register(
    body: {
      machineKey: string;
      hostname: string;
      displayName?: string;
      printers: AgentPrinterIn[];
      devices?: AgentDeviceIn[];
    },
    opts?: { clientIp?: string },
  ) {
    let machineKey = body.machineKey.trim();
    const hostname = (body.hostname || "PC").trim().slice(0, 80) || "PC";
    const incomingLabel = (body.displayName || hostname).trim().slice(0, 80);
    const devicesJson = toDevicesJson(body.devices);

    // Never let the Main server PC register as a Cashier / Additional PC agent.
    if (isMainServerAgentRegister(hostname, incomingLabel, opts?.clientIp)) {
      this.log.warn(
        `Rejected print-agent register from Main server (host=${hostname}, ip=${opts?.clientIp || "?"})`,
      );
      this.machineLogs.warn(
        this.machineLogs.mainId(),
        "Main server",
        `Rejected self-register as Cashier PC (${hostname} / ${opts?.clientIp || "?"})`
      );
      await this.purgeMainServerAgents();
      return { idle: true, mainServer: true, agentId: null, token: null, printers: [] };
    }

    let agent = await this.prisma.printAgent.findUnique({ where: { machineKey } });
    // Cloned Windows images can share the same key — split by hostname so each counter PC stays separate.
    if (agent && agent.hostname.toLowerCase() !== hostname.toLowerCase()) {
      const splitKey = createHash("sha256")
        .update(`${machineKey}|${hostname.toLowerCase()}`)
        .digest("hex")
        .slice(0, 48);
      this.log.warn(
        `Print agent key collision (${machineKey.slice(0, 8)}…) — registering ${hostname} as ${splitKey.slice(0, 8)}…`,
      );
      machineKey = splitKey;
      agent = await this.prisma.printAgent.findUnique({ where: { machineKey } });
    }
    const token = agent?.token || newToken();

    if (agent) {
      // Keep admin counter label (Lawn / Main / Rooftop); never overwrite with hostname on re-register.
      const keepLabel = (agent.displayName || "").trim();
      agent = await this.prisma.printAgent.update({
        where: { id: agent.id },
        data: {
          hostname,
          displayName: keepLabel || incomingLabel || hostname,
          lastSeenAt: new Date(),
          token,
          devices: devicesJson,
        },
      });
      this.machineLogs.info(
        agent.id,
        agent.displayName || hostname,
        `Reconnected (${hostname}) · ${(body.printers || []).length} printer(s) · ip=${opts?.clientIp || "?"}`
      );
    } else {
      agent = await this.prisma.printAgent.create({
        data: {
          machineKey,
          hostname,
          displayName: incomingLabel || hostname,
          token,
          lastSeenAt: new Date(),
          devices: devicesJson,
        },
      });
      this.log.log(`Registered print agent ${hostname} (${machineKey.slice(0, 8)}…)`);
      this.machineLogs.info(
        agent.id,
        incomingLabel || hostname,
        `Registered Cashier PC (${hostname}) with ${(body.printers || []).length} Windows printer(s)`
      );
    }

    const label = (agent.displayName || agent.hostname).trim() || hostname;
    await this.syncPrinters(agent.id, label, body.printers || []);
    const printers = await this.prisma.printer.findMany({
      where: { agentId: agent.id },
      orderBy: { name: "asc" },
    });

    return {
      agentId: agent.id,
      token: agent.token,
      hostname: agent.hostname,
      displayName: agent.displayName || agent.hostname,
      printers: printers.map((p) => ({
        id: p.id,
        name: p.name,
        target: p.target,
        active: p.active,
        printsBill: p.printsBill,
        printsKot: p.printsKot,
      })),
    };
  }

  /** Admin: set counter label (e.g. Lawn Cashier) and retitle auto-named USB printers. */
  async rename(id: string, displayName: string) {
    const agent = await this.prisma.printAgent.findUnique({ where: { id } });
    if (!agent) throw new NotFoundException("Print agent not found");

    const oldLabel = (agent.displayName || agent.hostname).trim() || agent.hostname;
    const label = displayName.trim().slice(0, 80) || agent.hostname;

    const updated = await this.prisma.printAgent.update({
      where: { id: agent.id },
      data: { displayName: label },
    });

    const printers = await this.prisma.printer.findMany({ where: { agentId: agent.id } });
    for (const p of printers) {
      const autoOld = autoPrinterName(oldLabel, p.target);
      const autoHost = autoPrinterName(agent.hostname, p.target);
      const autoNew = autoPrinterName(label, p.target);
      const shouldRetitle =
        p.name === autoOld ||
        p.name === autoHost ||
        (!p.manual && (p.station === oldLabel || p.station === agent.hostname || !p.station));
      // Keep custom station from Settings; only retarget auto/default station labels.
      const stationIsAuto =
        !p.station?.trim() || p.station === oldLabel || p.station === agent.hostname;
      await this.prisma.printer.update({
        where: { id: p.id },
        data: {
          ...(stationIsAuto ? { station: label.slice(0, 60) } : {}),
          ...(shouldRetitle ? { name: autoNew } : {}),
        },
      });
    }

    this.log.log(`Renamed print agent ${agent.hostname} → ${label}`);
    return {
      id: updated.id,
      hostname: updated.hostname,
      displayName: updated.displayName || updated.hostname,
    };
  }

  async heartbeat(agentId: string, printers?: AgentPrinterIn[], devices?: AgentDeviceIn[]) {
    const agent = await this.prisma.printAgent.findUnique({ where: { id: agentId } });
    if (!agent) throw new NotFoundException("Print agent not found");
    await this.prisma.printAgent.update({
      where: { id: agent.id },
      data: {
        lastSeenAt: new Date(),
        ...(devices ? { devices: toDevicesJson(devices) } : {}),
      },
    });
    const label = (agent.displayName || agent.hostname).trim() || agent.hostname;
    if (printers) await this.syncPrinters(agent.id, label, printers);
    return { ok: true, lastSeenAt: new Date().toISOString() };
  }

  async claimNext(agentId: string) {
    return this.print.claimNextForAgent(agentId);
  }

  async complete(agentId: string, jobId: string) {
    return this.print.completeAgentJob(agentId, jobId);
  }

  async fail(agentId: string, jobId: string, error: string) {
    return this.print.failAgentJob(agentId, jobId, error);
  }

  async requireAgent(authHeader: string | undefined) {
    const token = bearer(authHeader);
    if (!token) throw new UnauthorizedException("Print agent token required");
    const agent = await this.prisma.printAgent.findUnique({ where: { token } });
    if (!agent) throw new UnauthorizedException("Invalid print agent token");
    return agent;
  }

  async listForAdmin() {
    // Drop Main server if it listed itself again (Settings refresh).
    await this.purgeMainServerAgents();
    const rows = await this.prisma.printAgent.findMany({
      include: {
        printers: {
          select: { id: true, name: true, target: true, active: true, printsBill: true, printsKot: true },
          orderBy: { name: "asc" },
        },
      },
      orderBy: { hostname: "asc" },
    });
    return rows.map((a) => ({
      id: a.id,
      hostname: a.hostname,
      displayName: a.displayName || a.hostname,
      lastSeenAt: a.lastSeenAt,
      online: Date.now() - a.lastSeenAt.getTime() < ONLINE_MS,
      printers: a.printers,
      devices: parseDevices(a.devices),
    }));
  }

  private async syncPrinters(agentId: string, label: string, printers: AgentPrinterIn[]) {
    const seen = new Set<string>();
    const station = label.slice(0, 60);
    for (const p of printers) {
      const target = (p.name || "").trim();
      if (!target || target.length > 200) continue;
      seen.add(target);
      const existing = await this.prisma.printer.findUnique({
        where: { agentId_target: { agentId, target } },
      });
      if (existing) {
        // Admin edited / deactivated this printer in Settings (manual) — never
        // overwrite bill/KOT/active/station on heartbeat / re-register.
        if (existing.manual) continue;

        // Do NOT force active:true — cashier Active/Remove must stick.
        // Soft-disabled auto printers that reappear stay off until admin
        // ticks Active again (avoids fighting Settings every ~15s).
        const stationPatch = !existing.station?.trim() ? { station } : {};
        if (existing.kind !== "AGENT" || Object.keys(stationPatch).length) {
          await this.prisma.printer.update({
            where: { id: existing.id },
            data: {
              kind: "AGENT",
              ...stationPatch,
            },
          });
        }
      } else {
        const roles = guessAgentPrinterRoles(target);
        await this.prisma.printer.create({
          data: {
            name: autoPrinterName(label, target),
            kind: "AGENT",
            target,
            agentId,
            station,
            paperWidth: 80,
            printsKot: roles.printsKot,
            printsBill: roles.printsBill,
            active: true,
          },
        });
        this.log.log(
          `Synced agent printer: ${label} / ${target} (kot=${roles.printsKot} bill=${roles.printsBill})`,
        );
        this.machineLogs.info(agentId, label, `New USB printer synced: ${target}`);
      }
    }

    // Soft-disable auto-synced printers that disappeared from the PC.
    // Manual (+ Add) AGENT printers stay until the admin removes them.
    const gone = await this.prisma.printer.findMany({
      where: {
        agentId,
        kind: "AGENT",
        active: true,
        manual: false,
        NOT: { target: { in: [...seen] } },
      },
    });
    for (const g of gone) {
      if (!seen.size) break; // empty list = listing failed; don't wipe
      await this.prisma.printer.update({ where: { id: g.id }, data: { active: false } });
      this.machineLogs.warn(agentId, label, `Printer gone from PC (auto-off): ${g.target}`);
    }
  }
}

function autoPrinterName(label: string, target: string) {
  return `${label} · ${target}`.slice(0, 60);
}

/** Heuristic roles for newly synced USB printers (admin can change later in Settings). */
export function guessAgentPrinterRoles(target: string): { printsKot: boolean; printsBill: boolean } {
  const n = target.trim().toLowerCase();
  if (/kitchen|kot|cook|grill|tandoor|bbq|bar|beverage|drink/.test(n)) {
    return { printsKot: true, printsBill: false };
  }
  if (/cashier|bill|receipt|counter|laser|office/.test(n)) {
    return { printsKot: false, printsBill: true };
  }
  return { printsKot: false, printsBill: true };
}

function toDevicesJson(devices?: AgentDeviceIn[]): Prisma.InputJsonValue {
  return parseDevices(devices ?? []) as unknown as Prisma.InputJsonValue;
}

function parseDevices(raw: unknown): AgentDeviceIn[] {
  if (!Array.isArray(raw)) return [];
  const out: AgentDeviceIn[] = [];
  for (const d of raw.slice(0, MAX_DEVICES)) {
    if (!d || typeof d !== "object") continue;
    const row = d as Record<string, unknown>;
    const name = String(row.name || "").trim().slice(0, 200);
    if (!name) continue;
    out.push({
      name,
      className: String(row.className || "").slice(0, 80),
      status: String(row.status || "").slice(0, 40),
      instanceId: String(row.instanceId || "").slice(0, 260),
      problem: !!row.problem,
    });
  }
  return out;
}

function newToken() {
  return createHash("sha256").update(randomBytes(32)).digest("hex");
}

function bearer(header: string | undefined) {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m?.[1]?.trim() || null;
}

function normalizeHost(value: string | null | undefined) {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/\.local$/i, "")
    .replace(/\.$/, "");
}

/** Hostnames that mean "this Main server PC" (never a Cashier agent). */
function serverHostAliases() {
  const set = new Set<string>();
  const host = normalizeHost(osHostname());
  if (host) {
    set.add(host);
    // short name if FQDN
    const short = host.split(".")[0];
    if (short) set.add(short);
  }
  return set;
}

function localServerIps() {
  const ips = new Set<string>(["127.0.0.1", "::1", "0:0:0:0:0:0:0:1"]);
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list || []) {
      const fam = a.family as string | number;
      if ((fam === "IPv4" || fam === 4 || fam === "IPv6" || fam === 6) && a.address) {
        ips.add(a.address);
        // strip IPv6 zone id
        const bare = a.address.split("%")[0];
        if (bare) ips.add(bare);
      }
    }
  }
  return ips;
}

function normalizeClientIp(raw?: string) {
  if (!raw) return "";
  let ip = raw.trim().toLowerCase();
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  if (ip === "::1") return "127.0.0.1";
  return ip.split("%")[0];
}

/** True when register is coming from the Main server itself (hostname or same-machine IP). */
function isMainServerAgentRegister(hostname: string, displayName: string, clientIp?: string) {
  const aliases = serverHostAliases();
  if (aliases.has(normalizeHost(hostname)) || aliases.has(normalizeHost(displayName))) return true;
  const ip = normalizeClientIp(clientIp);
  if (!ip) return false;
  return localServerIps().has(ip);
}
