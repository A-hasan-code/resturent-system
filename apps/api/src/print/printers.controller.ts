import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { PrinterKind } from "@prisma/client";
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PermissionsGuard } from "../common/permissions.guard";
import { AuthUser, CurrentUser, RequirePerms } from "../common/decorators";
import { PrismaService } from "../prisma/prisma.service";
import { PrintService } from "./print.service";
import { MachineLogService } from "../system/machine-log.service";
import { listUsbDevices, listWindowsPrinters, probeNetworkPrinter } from "./drivers";

const AGENT_ONLINE_MS = 45_000;
const NETWORK_PROBE_CACHE_MS = 12_000;

class PrinterDto {
  @IsString() @MaxLength(60) name!: string;
  @IsEnum(PrinterKind) kind!: PrinterKind;
  @IsString() @MaxLength(200) target!: string;
  @IsOptional() @IsString() @MaxLength(40) agentId?: string;
  @IsOptional() @IsIn([58, 72, 80, 112]) paperWidth?: number;
  @IsOptional() @IsBoolean() printsKot?: boolean;
  @IsOptional() @IsBoolean() printsBill?: boolean;
  @IsOptional() @IsBoolean() printsOther?: boolean;
  @IsOptional() @IsString() @MaxLength(60) station?: string;
  @IsOptional() @IsString() @MaxLength(300) categories?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

class UpdatePrinterDto {
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  @IsOptional() @IsEnum(PrinterKind) kind?: PrinterKind;
  @IsOptional() @IsString() @MaxLength(200) target?: string;
  @IsOptional() @IsString() @MaxLength(40) agentId?: string;
  @IsOptional() @IsIn([58, 72, 80, 112]) paperWidth?: number;
  @IsOptional() @IsBoolean() printsKot?: boolean;
  @IsOptional() @IsBoolean() printsBill?: boolean;
  @IsOptional() @IsBoolean() printsOther?: boolean;
  @IsOptional() @IsString() @MaxLength(60) station?: string;
  @IsOptional() @IsString() @MaxLength(300) categories?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

/** Short-lived LAN TCP probe cache (shared across list requests). */
const networkProbeCache = new Map<string, { at: number; online: boolean }>();

@Controller("printers")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PrintersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly print: PrintService,
    private readonly machineLogs: MachineLogService
  ) {}

  @Get()
  @RequirePerms("printers.manage", "print.bill", "print.kot")
  async list() {
    const rows = await this.prisma.printer.findMany({
      include: {
        agent: { select: { id: true, hostname: true, displayName: true, lastSeenAt: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const networkTargets = [
      ...new Set(
        rows
          .filter((p) => p.kind === "NETWORK" && p.active && p.target.trim())
          .map((p) => p.target.trim()),
      ),
    ];
    const needWindows =
      rows.some((p) => p.kind === "WINDOWS" && p.active) ||
      rows.some((p) => p.kind === "AGENT" && p.active);
    const [reachability, winList] = await Promise.all([
      probeNetworkTargets(networkTargets),
      needWindows ? listWindowsPrinters().catch(() => []) : Promise.resolve([]),
    ]);
    const winByName = new Map(winList.map((w) => [w.name.trim().toLowerCase(), w]));

    return rows.map((p) => {
      const agentOnline = p.agent
        ? Date.now() - p.agent.lastSeenAt.getTime() < AGENT_ONLINE_MS
        : false;
      let online: boolean | null = null;
      if (p.kind === "NETWORK") {
        online = reachability.get(p.target.trim()) ?? false;
      } else if (p.kind === "WINDOWS") {
        const w = winByName.get(p.target.trim().toLowerCase());
        // Installed + not WorkOffline → Online; missing from spooler → Offline
        online = w ? w.online : false;
      } else if (p.kind === "AGENT") {
        // Prefer live agent; if same printer name exists on Main PC spooler, show Online
        // so server-attached printers are not stuck "Offline — open desktop app".
        const w = winByName.get(p.target.trim().toLowerCase());
        online = agentOnline || (w ? w.online : false);
      }

      return {
        id: p.id,
        name: p.name,
        kind: p.kind,
        target: p.target,
        paperWidth: p.paperWidth,
        printsKot: p.printsKot,
        printsBill: p.printsBill,
        printsOther: p.printsOther,
        station: p.station,
        categories: p.categories,
        active: p.active,
        manual: p.manual,
        agentId: p.agentId,
        online,
        agent: p.agent
          ? {
              id: p.agent.id,
              hostname: p.agent.hostname,
              displayName: p.agent.displayName || p.agent.hostname,
              lastSeenAt: p.agent.lastSeenAt,
              online: agentOnline,
            }
          : null,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      };
    });
  }

  /** Printers installed in Windows on the server PC (USB / shared). */
  @Get("system")
  @RequirePerms("printers.manage")
  async system() {
    try {
      return await listWindowsPrinters();
    } catch {
      return [];
    }
  }

  /** Active Other-print printers (A4 / PDF reports on this server). */
  @Get("other")
  @RequirePerms("printers.manage", "print.bill", "close.view", "payments.view", "store.view", "reports.view")
  other() {
    return this.print.listOtherPrinters();
  }

  /** USB / PnP devices on the main server PC (incl. Unknown USB missing drivers). */
  @Get("devices")
  @RequirePerms("printers.manage")
  async devices() {
    try {
      return await listUsbDevices();
    } catch {
      return [];
    }
  }

  @Post()
  @RequirePerms("printers.manage")
  async create(@Body() dto: PrinterDto) {
    if (dto.kind === PrinterKind.AGENT) {
      return this.createAgentPrinter(dto);
    }
    if (dto.kind === PrinterKind.FILE || dto.kind === PrinterKind.WINDOWS || dto.kind === PrinterKind.NETWORK) {
      return this.prisma.printer.create({
        data: {
          name: dto.name,
          kind: dto.kind,
          target: dto.target.trim(),
          paperWidth: dto.paperWidth,
          printsKot: dto.printsKot,
          printsBill: dto.printsBill,
          printsOther: dto.kind === PrinterKind.WINDOWS ? !!dto.printsOther : false,
          station: dto.station,
          categories: dto.categories,
          active: dto.active ?? true,
          manual: true,
        },
      });
    }
    throw new BadRequestException("Unsupported printer kind");
  }

  @Patch(":id")
  @RequirePerms("printers.manage")
  async update(@Param("id") id: string, @Body() dto: UpdatePrinterDto) {
    const exists = await this.prisma.printer.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException("Printer not found");

    if (dto.kind === PrinterKind.AGENT && exists.kind !== PrinterKind.AGENT) {
      throw new BadRequestException("Cannot convert a printer to Additional PC USB — add a new one instead");
    }

    if (exists.kind === PrinterKind.AGENT) {
      const agentId = dto.agentId?.trim() || exists.agentId;
      if (dto.agentId !== undefined) {
        if (!agentId) throw new BadRequestException("Select a Cashier / Additional PC");
        const agent = await this.prisma.printAgent.findUnique({ where: { id: agentId } });
        if (!agent) throw new BadRequestException("Cashier PC not found — open the desktop app on that PC first");
      }
      const target = dto.target !== undefined ? dto.target.trim() : exists.target;
      if (!target) throw new BadRequestException("Windows printer name required");
      return this.prisma.printer.update({
        where: { id },
        data: {
          name: dto.name,
          target,
          agentId: agentId || undefined,
          paperWidth: dto.paperWidth,
          printsKot: dto.printsKot,
          printsBill: dto.printsBill,
          printsOther: false,
          station: dto.station,
          categories: dto.categories,
          active: dto.active,
          manual: true,
        },
      });
    }

    const updated = await this.prisma.printer.update({
      where: { id },
      data: {
        name: dto.name,
        kind: dto.kind,
        target: dto.target !== undefined ? dto.target.trim() : undefined,
        paperWidth: dto.paperWidth,
        printsKot: dto.printsKot,
        printsBill: dto.printsBill,
        printsOther:
          dto.printsOther !== undefined
            ? (dto.kind ?? exists.kind) === PrinterKind.WINDOWS
              ? !!dto.printsOther
              : false
            : undefined,
        station: dto.station,
        categories: dto.categories,
        active: dto.active,
        // Any Settings edit owns the row so sync/heal cannot revert it.
        manual: true,
      },
    });
    if (dto.active !== undefined && dto.active !== exists.active) {
      const mid = exists.agentId || this.machineLogs.mainId();
      const mname = exists.agentId
        ? (await this.prisma.printAgent.findUnique({ where: { id: exists.agentId } }))?.displayName ||
          exists.name
        : "Main server";
      this.machineLogs.info(
        mid,
        mname,
        `Printer "${exists.name}" Active → ${dto.active ? "ON" : "OFF"}`
      );
    }
    return updated;
  }

  /** Soft-remove: keeps the row so Active can restore (hard-delete lost printers forever). */
  @Delete(":id")
  @RequirePerms("printers.manage")
  async remove(@Param("id") id: string) {
    const exists = await this.prisma.printer.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException("Printer not found");
    // manual:true so Additional PC heartbeat/register cannot revive this printer.
    await this.prisma.printer.update({
      where: { id },
      data: { active: false, manual: true },
    });
    const mid = exists.agentId || this.machineLogs.mainId();
    const mname = exists.agentId
      ? (await this.prisma.printAgent.findUnique({ where: { id: exists.agentId } }))?.displayName ||
        exists.name
      : "Main server";
    this.machineLogs.warn(mid, mname, `Printer removed (soft): ${exists.name}`);
    return { ok: true, active: false };
  }

  @Post(":id/test")
  @RequirePerms("printers.manage")
  test(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.print.enqueueTest(id, user.id);
  }

  private async createAgentPrinter(dto: PrinterDto) {
    const agentId = (dto.agentId || "").trim();
    const target = dto.target.trim();
    if (!agentId) throw new BadRequestException("Select a Cashier / Additional PC");
    if (!target) throw new BadRequestException("Windows printer name on that PC is required");
    const agent = await this.prisma.printAgent.findUnique({ where: { id: agentId } });
    if (!agent) throw new BadRequestException("Cashier PC not found — open the desktop app on that PC first");

    const existing = await this.prisma.printer.findUnique({
      where: { agentId_target: { agentId, target } },
    });
    if (existing) {
      return this.prisma.printer.update({
        where: { id: existing.id },
        data: {
          name: dto.name,
          paperWidth: dto.paperWidth,
          printsKot: dto.printsKot,
          printsBill: dto.printsBill,
          printsOther: false,
          station: dto.station ?? existing.station,
          categories: dto.categories,
          active: dto.active ?? true,
          manual: true,
          kind: PrinterKind.AGENT,
        },
      });
    }

    return this.prisma.printer.create({
      data: {
        name: dto.name,
        kind: PrinterKind.AGENT,
        target,
        agentId,
        paperWidth: dto.paperWidth ?? 80,
        printsKot: dto.printsKot ?? false,
        printsBill: dto.printsBill ?? true,
        printsOther: false,
        station: dto.station || (agent.displayName || agent.hostname).slice(0, 60),
        categories: dto.categories,
        active: dto.active ?? true,
        manual: true,
      },
    });
  }
}

async function probeNetworkTargets(targets: string[]): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  const now = Date.now();
  const toProbe: string[] = [];
  for (const t of targets) {
    const cached = networkProbeCache.get(t);
    if (cached && now - cached.at < NETWORK_PROBE_CACHE_MS) {
      out.set(t, cached.online);
    } else {
      toProbe.push(t);
    }
  }
  await Promise.all(
    toProbe.map(async (t) => {
      const online = await probeNetworkPrinter(t, 2000);
      networkProbeCache.set(t, { at: Date.now(), online });
      out.set(t, online);
    }),
  );
  return out;
}

@Controller("print")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PrintJobsController {
  constructor(private readonly print: PrintService) {}

  @Get("jobs")
  @RequirePerms("printers.manage", "print.bill")
  jobs(@Query("status") status?: string) {
    return this.print.listJobs(status);
  }

  @Get("jobs/:id/preview")
  @RequirePerms("printers.manage", "print.bill", "print.kot")
  preview(@Param("id") id: string) {
    return this.print.preview(id);
  }

  @Post("jobs/:id/retry")
  @RequirePerms("printers.manage", "print.bill", "print.kot")
  retry(@Param("id") id: string) {
    return this.print.retry(id);
  }
}
