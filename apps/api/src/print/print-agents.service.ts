import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomBytes } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { PrintService } from "./print.service";

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
export class PrintAgentsService {
  private readonly log = new Logger("PrintAgent");

  constructor(
    private readonly prisma: PrismaService,
    private readonly print: PrintService,
  ) {}

  async register(body: {
    machineKey: string;
    hostname: string;
    displayName?: string;
    printers: AgentPrinterIn[];
    devices?: AgentDeviceIn[];
  }) {
    let machineKey = body.machineKey.trim();
    const hostname = (body.hostname || "PC").trim().slice(0, 80) || "PC";
    const incomingLabel = (body.displayName || hostname).trim().slice(0, 80);
    const devicesJson = toDevicesJson(body.devices);

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
        p.station === oldLabel ||
        p.station === agent.hostname ||
        !p.station;
      await this.prisma.printer.update({
        where: { id: p.id },
        data: {
          station: label.slice(0, 60),
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

  listForAdmin() {
    return this.prisma.printAgent.findMany({
      include: {
        printers: {
          select: { id: true, name: true, target: true, active: true, printsBill: true, printsKot: true },
          orderBy: { name: "asc" },
        },
      },
      orderBy: { hostname: "asc" },
    }).then((rows) =>
      rows.map((a) => ({
        id: a.id,
        hostname: a.hostname,
        displayName: a.displayName || a.hostname,
        lastSeenAt: a.lastSeenAt,
        online: Date.now() - a.lastSeenAt.getTime() < ONLINE_MS,
        printers: a.printers,
        devices: parseDevices(a.devices),
      })),
    );
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
        await this.prisma.printer.update({
          where: { id: existing.id },
          data: {
            active: true,
            kind: "AGENT",
            ...(!existing.station?.trim() ? { station } : {}),
          },
        });
      } else {
        await this.prisma.printer.create({
          data: {
            name: autoPrinterName(label, target),
            kind: "AGENT",
            target,
            agentId,
            station,
            paperWidth: 80,
            printsKot: false,
            printsBill: true,
            active: true,
          },
        });
        this.log.log(`Synced agent printer: ${label} / ${target}`);
      }
    }

    // Soft-disable printers that disappeared from the PC (keep history / assignments).
    const gone = await this.prisma.printer.findMany({
      where: { agentId, kind: "AGENT", active: true, NOT: { target: { in: [...seen] } } },
    });
    for (const g of gone) {
      if (!seen.size) break; // empty list = listing failed; don't wipe
      await this.prisma.printer.update({ where: { id: g.id }, data: { active: false } });
    }
  }
}

function autoPrinterName(label: string, target: string) {
  return `${label} · ${target}`.slice(0, 60);
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
