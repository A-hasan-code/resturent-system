import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, randomBytes } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { PrintService } from "./print.service";

const ONLINE_MS = 45_000;

export type AgentPrinterIn = {
  name: string;
  driver?: string;
  port?: string;
  isDefault?: boolean;
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
  }) {
    const machineKey = body.machineKey.trim();
    const hostname = (body.hostname || "PC").trim().slice(0, 80) || "PC";
    const displayName = (body.displayName || hostname).trim().slice(0, 80);

    let agent = await this.prisma.printAgent.findUnique({ where: { machineKey } });
    const token = agent?.token || newToken();

    if (agent) {
      agent = await this.prisma.printAgent.update({
        where: { id: agent.id },
        data: { hostname, displayName, lastSeenAt: new Date(), token },
      });
    } else {
      agent = await this.prisma.printAgent.create({
        data: { machineKey, hostname, displayName, token, lastSeenAt: new Date() },
      });
      this.log.log(`Registered print agent ${hostname} (${machineKey.slice(0, 8)}…)`);
    }

    await this.syncPrinters(agent.id, hostname, body.printers || []);
    const printers = await this.prisma.printer.findMany({
      where: { agentId: agent.id },
      orderBy: { name: "asc" },
    });

    return {
      agentId: agent.id,
      token: agent.token,
      hostname: agent.hostname,
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

  async heartbeat(agentId: string, printers?: AgentPrinterIn[]) {
    const agent = await this.prisma.printAgent.findUnique({ where: { id: agentId } });
    if (!agent) throw new NotFoundException("Print agent not found");
    await this.prisma.printAgent.update({
      where: { id: agent.id },
      data: { lastSeenAt: new Date() },
    });
    if (printers) await this.syncPrinters(agent.id, agent.hostname, printers);
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
      })),
    );
  }

  private async syncPrinters(agentId: string, hostname: string, printers: AgentPrinterIn[]) {
    const seen = new Set<string>();
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
          data: { active: true, kind: "AGENT" },
        });
      } else {
        const station = hostname.slice(0, 60);
        await this.prisma.printer.create({
          data: {
            name: `${hostname} · ${target}`.slice(0, 60),
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
        this.log.log(`Synced agent printer: ${hostname} / ${target}`);
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

function newToken() {
  return createHash("sha256").update(randomBytes(32)).digest("hex");
}

function bearer(header: string | undefined) {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m?.[1]?.trim() || null;
}
