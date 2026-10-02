import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from "@nestjs/common";
import { Prisma, Printer, PrintJob } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../system/settings.service";
import { ServerIdentityService } from "../system/server-identity.service";
import { RealtimeService } from "../realtime/realtime.service";
import { toNumber } from "../common/units";
import { BillPayload, KotPayload, renderBill, renderKot, renderTest, TestPayload } from "./receipts";
import { sendToNetworkPrinter, sendToWindowsPrinter, writePreviewFile } from "./drivers";

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 4000;
const TICK_MS = 1000;

type KotOptions = { round?: number; reprint?: boolean; requestedById?: string | null };

@Injectable()
export class PrintService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger("Print");
  private timer?: NodeJS.Timeout;
  private busy = false;
  private notBefore = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly identity: ServerIdentityService,
    private readonly realtime: RealtimeService
  ) {}

  async onApplicationBootstrap() {
    await this.prisma.printJob.updateMany({ where: { status: "PRINTING" }, data: { status: "PENDING" } });
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------- enqueue ----------

  async enqueueKot(orderId: string, opts: KotOptions = {}) {
    const kot = await this.loadKot(orderId, opts);
    const printers = await this.prisma.printer.findMany({ where: { active: true, printsKot: true } });
    if (!printers.length) return [await this.noPrinterJob("KOT", orderId, opts.requestedById, kot.orderNo)];

    const jobs: PrintJob[] = [];
    for (const printer of printers) {
      const cats = splitCats(printer.categories);
      const mine = cats.length ? kot.items.filter((i) => cats.includes(i.category)) : kot.items;
      if (!mine.length) continue;
      const payload = kot.payload(mine, cats.length ? printer.name : null);
      jobs.push(await this.createJob("KOT", printer.id, payload, orderId, opts.requestedById));
    }
    return jobs;
  }

  /** The full kitchen slip for a round (all stations combined), rendered as plain text for on-screen preview. */
  async previewKot(orderId: string, round?: number) {
    const kot = await this.loadKot(orderId, { round });
    const printer = await this.prisma.printer.findFirst({
      where: { active: true, printsKot: true },
      orderBy: { createdAt: "asc" },
    });
    const payload = kot.payload(kot.items, null);
    return {
      orderNo: kot.orderNo,
      tableNo: payload.tableNo,
      round: payload.round,
      takenBy: payload.takenBy,
      text: renderKot(payload, printer?.paperWidth ?? 80).plain(),
    };
  }

  private async loadKot(orderId: string, opts: KotOptions) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            menuItem: { select: { category: true } },
            addedBy: { select: { name: true, role: { select: { name: true } } } },
          },
          orderBy: { createdAt: "asc" },
        },
        waiter: { select: { name: true, role: { select: { name: true } } } },
      },
    });
    if (!order) throw new NotFoundException("Order not found");
    const all = opts.round ? order.items.filter((i) => i.kotRound === opts.round) : order.items;
    if (!all.length) throw new BadRequestException("No items to print");

    const items = all.map((i) => ({
      category: (i.menuItem.category || "General").toLowerCase(),
      takenBy: staffLabel(i.addedBy ?? order.waiter),
      line: {
        name: i.name,
        quantity: toNumber(i.quantity),
        unit: i.sellUnit,
        notes: i.notes,
        round: i.kotRound,
      },
    }));
    const restaurant = await this.settings.restaurant();
    const time = new Date().toISOString();

    return {
      orderNo: order.orderNo,
      items,
      payload: (mine: typeof items, station: string | null): KotPayload => {
        const takers = [...new Set(mine.map((i) => i.takenBy).filter((t): t is string => !!t))];
        return {
          restaurant,
          orderNo: order.orderNo,
          tableNo: order.tableNo,
          waiter: order.waiter?.name ?? null,
          takenBy: takers.length ? takers.join(", ") : null,
          round: opts.round ?? null,
          reprint: !!opts.reprint,
          station,
          time,
          notes: opts.round && opts.round > 1 ? null : order.notes,
          items: mine.map((i) => i.line),
        };
      },
    };
  }

  async enqueueBill(orderId: string, requestedById?: string | null) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        items: { orderBy: { createdAt: "asc" } },
        waiter: { select: { name: true } },
        cashier: { select: { name: true } },
        payments: { select: { collectedBy: { select: { name: true } } } },
      },
    });
    const printers = await this.prisma.printer.findMany({ where: { active: true, printsBill: true } });
    if (!printers.length) return [await this.noPrinterJob("BILL", orderId, requestedById, order.orderNo)];

    const cashier = order.cashier?.name ?? null;
    const collectors = [...new Set(order.payments.map((p) => p.collectedBy.name))].filter((n) => n !== cashier);
    const payload: BillPayload = {
      restaurant: await this.settings.restaurant(),
      orderNo: order.orderNo,
      tableNo: order.tableNo,
      cashier,
      waiter: order.waiter?.name ?? null,
      receivedBy: collectors.length ? collectors.join(", ") : null,
      time: order.createdAt.toISOString(),
      items: order.items.map((i) => ({
        name: i.name,
        quantity: toNumber(i.quantity),
        unit: i.sellUnit,
        rate: toNumber(i.ratePerUnit),
        amount: toNumber(i.amount),
      })),
      total: toNumber(order.total),
      paidAmount: toNumber(order.paidAmount),
      paymentStatus: order.paymentStatus,
    };
    // One bill copy, on the first bill printer.
    return [await this.createJob("BILL", printers[0].id, payload, orderId, requestedById)];
  }

  async enqueueTest(printerId: string, requestedById?: string | null) {
    const printer = await this.prisma.printer.findUnique({ where: { id: printerId } });
    if (!printer) throw new NotFoundException("Printer not found");
    const info = this.identity.info();
    const payload: TestPayload = {
      printerName: printer.name,
      serverName: info.name,
      urls: info.urls,
      time: new Date().toISOString(),
    };
    return this.createJob("TEST", printer.id, payload, null, requestedById);
  }

  async retry(jobId: string) {
    const job = await this.prisma.printJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException("Print job not found");
    this.notBefore.delete(jobId);
    return this.prisma.printJob.update({
      where: { id: jobId },
      data: { status: "PENDING", attempts: 0, lastError: null },
    });
  }

  async listJobs(status?: string) {
    const jobs = await this.prisma.printJob.findMany({
      where: status ? { status: status as PrintJob["status"] } : {},
      include: { printer: { select: { name: true } }, order: { select: { orderNo: true, tableNo: true } } },
      orderBy: { createdAt: "desc" },
      take: 60,
    });
    return jobs.map((j) => ({
      id: j.id,
      type: j.type,
      status: j.status,
      attempts: j.attempts,
      lastError: j.lastError,
      printer: j.printer?.name ?? null,
      orderNo: j.order?.orderNo ?? null,
      tableNo: j.order?.tableNo ?? null,
      createdAt: j.createdAt,
      printedAt: j.printedAt,
    }));
  }

  /** Text preview of a job, exactly as the thermal printer receives it. */
  async preview(jobId: string) {
    const job = await this.prisma.printJob.findUnique({ where: { id: jobId }, include: { printer: true } });
    if (!job) throw new NotFoundException("Print job not found");
    return { text: this.render(job, job.printer?.paperWidth ?? 80).plain() };
  }

  // ---------- worker ----------

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const now = Date.now();
      const pending = await this.prisma.printJob.findMany({
        where: { status: "PENDING" },
        include: { printer: true, order: { select: { orderNo: true } } },
        orderBy: { createdAt: "asc" },
        take: 10,
      });
      for (const job of pending) {
        if ((this.notBefore.get(job.id) ?? 0) > now) continue;
        await this.process(job);
      }
    } catch (e) {
      this.log.error(`queue: ${(e as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  private async process(job: PrintJob & { printer: Printer | null; order: { orderNo: number } | null }) {
    const attempts = job.attempts + 1;
    await this.prisma.printJob.update({ where: { id: job.id }, data: { status: "PRINTING", attempts } });
    try {
      if (!job.printer || !job.printer.active) throw new Error("Printer removed or disabled");
      const doc = this.render(job, job.printer.paperWidth);
      await this.send(job.printer, doc.buffer(), doc.plain(), job);
      await this.prisma.printJob.update({
        where: { id: job.id },
        data: { status: "DONE", printedAt: new Date(), lastError: null },
      });
      this.notBefore.delete(job.id);
      this.realtime.printResult(
        { id: job.id, type: job.type, status: "DONE", printer: job.printer.name, orderNo: job.order?.orderNo ?? null },
        job.requestedById
      );
    } catch (e) {
      const error = (e as Error).message;
      const final = attempts >= MAX_ATTEMPTS;
      await this.prisma.printJob.update({
        where: { id: job.id },
        data: { status: final ? "FAILED" : "PENDING", lastError: error },
      });
      if (final) {
        this.notBefore.delete(job.id);
        this.log.warn(`Job ${job.id} failed: ${error}`);
        this.realtime.printResult(
          {
            id: job.id,
            type: job.type,
            status: "FAILED",
            error,
            printer: job.printer?.name ?? null,
            orderNo: job.order?.orderNo ?? null,
          },
          job.requestedById
        );
      } else {
        this.notBefore.set(job.id, Date.now() + RETRY_DELAY_MS * attempts);
      }
    }
  }

  private render(job: PrintJob, paperWidth: number) {
    const p = job.payload as unknown;
    if (job.type === "KOT") return renderKot(p as KotPayload, paperWidth);
    if (job.type === "BILL") return renderBill(p as BillPayload, paperWidth);
    return renderTest(p as TestPayload, paperWidth);
  }

  private async send(printer: Printer, data: Buffer, text: string, job: PrintJob) {
    if (printer.kind === "NETWORK") return sendToNetworkPrinter(printer.target, data);
    if (printer.kind === "WINDOWS") return sendToWindowsPrinter(printer.target, data);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    writePreviewFile(printer.target, `${stamp}-${job.type.toLowerCase()}-${job.id.slice(-6)}`, text);
  }

  private createJob(
    type: PrintJob["type"],
    printerId: string,
    payload: KotPayload | BillPayload | TestPayload,
    orderId: string | null,
    requestedById?: string | null
  ) {
    return this.prisma.printJob.create({
      data: {
        type,
        printerId,
        orderId,
        requestedById: requestedById ?? null,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private async noPrinterJob(type: PrintJob["type"], orderId: string, requestedById: string | null | undefined, orderNo: number) {
    const error = type === "KOT" ? "No kitchen printer set up (Settings → Printers)" : "No bill printer set up (Settings → Printers)";
    const job = await this.prisma.printJob.create({
      data: { type, orderId, status: "FAILED", lastError: error, payload: {}, requestedById: requestedById ?? null },
    });
    this.realtime.printResult({ id: job.id, type, status: "FAILED", error, orderNo }, requestedById);
    return job;
  }
}

function staffLabel(u: { name: string; role: { name: string } } | null | undefined) {
  return u ? `${u.name} (${u.role.name})` : null;
}

function splitCats(s: string) {
  return s
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
}
