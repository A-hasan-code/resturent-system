import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from "@nestjs/common";
import { Prisma, Printer, PrintJob } from "@prisma/client";
import { basename } from "path";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../system/settings.service";
import { ServerIdentityService } from "../system/server-identity.service";
import { RealtimeService } from "../realtime/realtime.service";
import { toNumber } from "../common/units";
import { TipService } from "../system/tip.service";
import { FinanceService } from "../finance/finance.service";
import { BillEditConfirmPayload, BillPayload, KotPayload, renderBill, renderBillEditConfirm, renderKot, renderTest, TestPayload } from "./receipts";
import { sendToNetworkPrinter, sendToWindowsPrinter, writePreviewFile } from "./drivers";
import { splitTableLabel } from "./table-label";

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 4000;
const TICK_MS = 1000;
/** Agent claimed a job but never finished — return to queue. */
const AGENT_STALE_MS = 60_000;

type KotOptions = {
  round?: number;
  reprint?: boolean;
  /** Full-order cancel slip with CANCELLED stamp for the kitchen. */
  cancelled?: boolean;
  /** Shown on the cancel kitchen slip. */
  cancelReason?: string | null;
  requestedById?: string | null;
};

@Injectable()
export class PrintService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger("Print");
  private timer?: NodeJS.Timeout;
  private busy = false;
  private notBefore = new Map<string, number>();
  private agentClaimedAt = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly identity: ServerIdentityService,
    private readonly realtime: RealtimeService,
    private readonly tips: TipService,
    private readonly finance: FinanceService
  ) {}

  async onApplicationBootstrap() {
    await this.prisma.printJob.updateMany({ where: { status: "PRINTING" }, data: { status: "PENDING" } });
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------- enqueue ----------

  /**
   * KOT routing (per round / reprint set):
   * - No station tags on printers → every KOT printer gets the full slip.
   * - Single station in the order (e.g. only beverages) → only that station’s printer,
   *   with its matching lines.
   * - Mixed stations in one order (BBQ + cooking + beverage) → each *involved*
   *   station printer gets the **full** slip (all lines) so pickers see the whole ticket.
   * - Catch-all printers (empty station/categories) get lines no specialized printer claimed.
   */
  async enqueueKot(orderId: string, opts: KotOptions = {}) {
    const kot = await this.loadKot(orderId, opts);
    const printers = await this.prisma.printer.findMany({ where: { active: true, printsKot: true } });
    if (!printers.length) return [await this.noPrinterJob("KOT", orderId, opts.requestedById, kot.orderNo)];

    // Cancel / full reprint → all kitchen lines; otherwise only that round's lines.
    const printItems =
      opts.cancelled || (opts.round == null && opts.reprint) ? kot.allItems : kot.roundItems;
    if (!printItems.length) return [];

    type KotLine = (typeof printItems)[number];
    const jobs: PrintJob[] = [];

    const specialized = printers.filter((p) => {
      const cats = splitCats(p.categories);
      return cats.length > 0 || !!(p.station || "").trim();
    });
    const catchAll = printers.filter((p) => !specialized.includes(p));

    // Single kitchen / no station tags → every KOT printer gets the full round.
    if (!specialized.length) {
      for (const printer of printers) {
        jobs.push(
          await this.createJob("KOT", printer.id, kot.payload(printItems, null), orderId, opts.requestedById),
        );
      }
      return jobs;
    }

    const matchersOf = (printer: (typeof printers)[number]) => {
      const cats = splitCats(printer.categories);
      const stationTag = (printer.station || "").trim().toLowerCase();
      return cats.length ? cats : stationTag ? [stationTag] : [];
    };

    const involved = specialized
      .map((printer) => {
        const matchers = matchersOf(printer);
        const mine = printItems.filter((i) => itemMatchesPrinter(i, matchers));
        return { printer, matchers, mine };
      })
      .filter((x) => x.mine.length > 0);

    const routed = new Set<KotLine>();
    for (const { mine } of involved) mine.forEach((i) => routed.add(i));

    // Mixed bill → full slip on every involved station printer.
    // Single station → only that printer, with its own lines.
    const mixed = involved.length >= 2;
    for (const { printer, mine } of involved) {
      const lines = mixed ? printItems : mine;
      const payload = kot.payload(lines, printer.station || printer.name);
      jobs.push(await this.createJob("KOT", printer.id, payload, orderId, opts.requestedById));
    }

    // Unmatched lines → catch-all kitchen printers.
    const leftovers = printItems.filter((i) => !routed.has(i));
    if (leftovers.length && catchAll.length) {
      for (const printer of catchAll) {
        jobs.push(
          await this.createJob("KOT", printer.id, kot.payload(leftovers, null), orderId, opts.requestedById),
        );
      }
    } else if (leftovers.length && !involved.length) {
      // Specialized printers exist but nothing matched — still print somewhere.
      for (const printer of specialized) {
        jobs.push(
          await this.createJob(
            "KOT",
            printer.id,
            kot.payload(leftovers, printer.station || printer.name),
            orderId,
            opts.requestedById,
          ),
        );
      }
    }

    return jobs;
  }

  /** Structured kitchen slip for UI preview + plain text for thermal match. */
  async previewKot(orderId: string, round?: number) {
    const kot = await this.loadKot(orderId, { round });
    const printer = await this.prisma.printer.findFirst({
      where: { active: true, printsKot: true },
      orderBy: { createdAt: "asc" },
    });
    const paperWidth = printer?.paperWidth ?? 80;
    const payload = kot.payload(kot.roundItems.length ? kot.roundItems : kot.items, null);
    const { partition, table } = splitTableLabel(payload.tableNo, payload.partitionName, payload.tableName);
    return {
      orderNo: kot.orderNo,
      billNo: kot.orderNo,
      tableNo: payload.tableNo,
      partitionName: partition,
      tableName: table,
      round: payload.round,
      reprint: payload.reprint,
      station: payload.station,
      takenBy: payload.takenBy,
      servedBy: payload.servedBy,
      time: payload.time,
      notes: payload.notes,
      footer: payload.footer || null,
      showOrderBy: payload.showOrderBy !== false,
      items: payload.items.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        sellUnit: i.unit,
        notes: i.notes,
        round: i.round,
      })),
      text: renderKot(payload, paperWidth).plain(),
      paperWidth,
      logoUrl: brandingPublicUrl(this.settings.logoFilePath()),
      paidStampUrl: null,
      unpaidStampUrl: null,
      cancelledStampUrl: "/branding/cancelled-stamp.png",
    };
  }

  /** Exact customer-bill bytes as plain text — same payload path as thermal print. */
  async previewBill(orderId: string) {
    const payload = await this.loadBillPayload(orderId);
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        cashierId: true,
        assignedCashierId: true,
        assignedCashier: { select: { billPrinterId: true } },
        cashier: { select: { billPrinterId: true } },
      },
    });
    const printers = await this.prisma.printer.findMany({
      where: { active: true, printsBill: true },
      select: { id: true, kind: true, paperWidth: true },
      orderBy: { createdAt: "asc" },
    });
    let paperWidth = 80;
    if (printers.length) {
      const printerId = await this.resolveBillPrinterId(
        printers,
        order?.cashierId ?? null,
        order?.assignedCashier?.billPrinterId ?? order?.cashier?.billPrinterId ?? null,
      );
      paperWidth =
        printers.find((p) => p.id === printerId)?.paperWidth ?? printers[0]?.paperWidth ?? 80;
    }
    return {
      text: renderBill(payload, paperWidth).plain(),
      paperWidth,
      paymentStatus: payload.paymentStatus,
      logoUrl: brandingPublicUrl(this.settings.logoFilePath()),
      paidStampUrl: "/branding/paid-stamp.png",
      unpaidStampUrl: "/branding/unpaid-stamp.png",
    };
  }

  private async loadKot(orderId: string, opts: KotOptions) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            menuItem: { select: { category: true, kitchenStation: true } },
            addedBy: { select: { name: true, role: { select: { name: true } } } },
          },
          orderBy: { createdAt: "asc" },
        },
        waiter: { select: { name: true, role: { select: { name: true } } } },
        table: { include: { partition: { select: { name: true } } } },
      },
    });
    if (!order) throw new NotFoundException("Order not found");
    // Cover charge / per-head is bill-only — never on kitchen slips.
    // Cancel slips still print food lines even if the menu item was later removed.
    const kitchenRows = order.items.filter((i) =>
      i.lineKind !== "PER_HEAD" && (opts.cancelled || !!i.menuItem),
    );
    const mapItem = (i: (typeof kitchenRows)[number]) => ({
      category: (i.menuItem?.category || "General").toLowerCase(),
      station: (i.menuItem?.kitchenStation || "COOKING").toLowerCase(),
      takenBy: staffLabel(i.addedBy ?? order.waiter),
      line: {
        name: i.name,
        quantity: toNumber(i.quantity),
        unit: i.sellUnit,
        notes: i.notes,
        round: i.kotRound,
      },
    });
    const allItems = kitchenRows.map(mapItem);
    const round = opts.round ?? order.kotRounds;
    const roundItems = kitchenRows.filter((i) => i.kotRound === round).map(mapItem);
    const printable = opts.cancelled || !opts.round ? allItems : roundItems;
    if (!printable.length) throw new BadRequestException("No items to print");

    const restaurant = await this.settings.restaurant();
    const time = new Date().toISOString();
    const kotOpts = await this.tips.printKotOpts();
    const billOpts = await this.tips.printBillOpts();
    const cancelled = !!opts.cancelled;

    return {
      orderNo: order.orderNo,
      defaultRound: order.kotRounds,
      allItems,
      roundItems: roundItems.length ? roundItems : allItems,
      /** @deprecated use roundItems / allItems — kept for previewKot */
      items: opts.round ? roundItems : allItems,
      payload: (mine: typeof allItems, station: string | null): KotPayload => {
        const takers = [...new Set(mine.map((i) => i.takenBy).filter((t): t is string => !!t))];
        return {
          restaurant,
          orderNo: order.orderNo,
          tableNo: order.tableNo,
          partitionName: order.table?.partition?.name ?? null,
          tableName: order.table?.name ?? null,
          waiter: order.waiter?.name ?? null,
          takenBy: takers.length ? takers.join(", ") : null,
          servedBy: order.servedByName || null,
          round: cancelled ? null : opts.round ?? null,
          reprint: cancelled ? false : !!opts.reprint,
          cancelled,
          cancelledStampPath: cancelled ? this.settings.cancelledStampFilePath() : null,
          cancelReason: cancelled
            ? (opts.cancelReason || order.cancelReason || null)
            : null,
          station,
          time,
          notes: !cancelled && opts.round && opts.round > 1 ? null : order.notes,
          items: mine.map((i) => i.line),
          showOrderBy: kotOpts.showOrderBy,
          showLogo: billOpts.showLogo,
          showName: billOpts.showName,
          showPhone: billOpts.showPhone,
          showAddress: billOpts.showAddress,
          footer: kotOpts.footer || undefined,
          logoPath: this.settings.logoFilePath(),
        };
      },
    };
  }

  async enqueueBill(orderId: string, requestedById?: string | null) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { orderNo: true, assignedCashier: { select: { billPrinterId: true } } },
    });
    const printers = await this.prisma.printer.findMany({ where: { active: true, printsBill: true } });
    if (!printers.length) return [await this.noPrinterJob("BILL", orderId, requestedById, order.orderNo)];

    const printerId = await this.resolveBillPrinterId(
      printers,
      requestedById,
      order.assignedCashier?.billPrinterId ?? null,
    );
    const payload = await this.loadBillPayload(orderId);
    return [await this.createJob("BILL", printerId ?? printers[0]!.id, payload, orderId, requestedById)];
  }

  /** Cashier confirmation slip after a paid bill edit (reason + before/after amounts). */
  async enqueueBillEditConfirm(editId: string, requestedById?: string | null) {
    const edit = await this.prisma.orderBillEdit.findUniqueOrThrow({
      where: { id: editId },
      include: {
        order: {
          select: {
            id: true,
            orderNo: true,
            tableNo: true,
            assignedCashier: { select: { billPrinterId: true } },
            table: { include: { partition: { select: { name: true } } } },
          },
        },
      },
    });
    const printers = await this.prisma.printer.findMany({ where: { active: true, printsBill: true } });
    if (!printers.length) {
      return [await this.noPrinterJob("BILL_EDIT", edit.order.id, requestedById, edit.order.orderNo)];
    }
    const printerId = await this.resolveBillPrinterId(
      printers,
      requestedById,
      edit.order.assignedCashier?.billPrinterId ?? null,
    );
    const billOpts = await this.tips.printBillOpts();
    const restaurant = await this.settings.restaurant();
    const items = Array.isArray(edit.itemsJson)
      ? (edit.itemsJson as Array<{
          name: string;
          beforeQty: number;
          afterQty: number;
          beforeAmount: number;
          afterAmount: number;
        }>)
      : [];
    const payload: BillEditConfirmPayload = {
      restaurant: {
        name: restaurant.name,
        tagline: restaurant.tagline,
        address: restaurant.address,
        phone: restaurant.phone,
      },
      logoPath: this.settings.logoFilePath(),
      orderNo: edit.order.orderNo,
      billNo: edit.order.orderNo,
      tableNo: edit.order.tableNo,
      partitionName: edit.order.table?.partition?.name ?? null,
      tableName: edit.order.table?.name ?? null,
      time: edit.createdAt.toISOString(),
      reason: edit.reason,
      beforeTotal: toNumber(edit.beforeTotal),
      afterTotal: toNumber(edit.afterTotal),
      beforeNet: toNumber(edit.beforeNet),
      afterNet: toNumber(edit.afterNet),
      editedBy: edit.editedByName,
      items,
      showLogo: billOpts.showLogo,
      showName: billOpts.showName,
      showPhone: billOpts.showPhone,
      showAddress: billOpts.showAddress,
    };
    return [await this.createJob("BILL_EDIT", printerId ?? printers[0]!.id, payload, edit.order.id, requestedById)];
  }

  private async loadBillPayload(orderId: string): Promise<BillPayload> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        items: { orderBy: { createdAt: "asc" } },
        waiter: { select: { name: true, role: { select: { name: true } } } },
        cashier: { select: { name: true } },
        creditCustomer: { select: { name: true, phone: true, address: true } },
        payments: {
          select: {
            amount: true,
            tipAmount: true,
            tenderedAmount: true,
            method: true,
            collectedBy: { select: { name: true } },
          },
          orderBy: { createdAt: "asc" },
        },
        table: { include: { partition: { select: { name: true } } } },
      },
    });
    const cashier = order.cashier?.name ?? null;
    const collectors = [
      ...new Set(order.payments.map((p) => p.collectedBy?.name).filter(Boolean) as string[]),
    ].filter((n) => n !== cashier);
    const billOpts = await this.tips.printBillOpts();
    const restaurant = await this.settings.restaurant();
    const legal = await this.settings.getMany("restaurant.");

    let taxAmount = toNumber(order.taxAmount);
    let taxPercent = toNumber(order.taxPercent);
    // Unpaid / pre-pay print: show live tax from settings so due matches PayModal.
    if (order.paymentStatus !== "PAID" && !(taxAmount > 0)) {
      const taxCfg = await this.finance.taxSettings();
      if (taxCfg.percent > 0) {
        const computed = this.finance.computeTax(
          toNumber(order.total),
          toNumber(order.discountAmount),
          taxCfg.percent
        );
        taxAmount = computed.taxAmount;
        taxPercent = computed.taxPercent;
      }
    }

    return {
      restaurant: {
        name: restaurant.name,
        tagline: restaurant.tagline,
        address: restaurant.address,
        phone: restaurant.phone,
        ntn: (legal["restaurant.ntn"] || "").trim() || undefined,
        strn: (legal["restaurant.strn"] || "").trim() || undefined,
      },
      logoPath: this.settings.logoFilePath(),
      orderNo: order.orderNo,
      billNo: order.orderNo,
      tableNo: order.tableNo,
      partitionName: order.table?.partition?.name ?? null,
      tableName: order.table?.name ?? null,
      creditName: order.creditCustomer?.name ?? null,
      creditPhone: order.creditCustomer?.phone ?? null,
      creditAddress: order.creditCustomer?.address ?? null,
      cashier,
      waiter: order.waiter?.name ?? null,
      orderedBy: staffLabel(order.waiter),
      servedBy: order.servedByName || null,
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
      discountAmount: toNumber(order.discountAmount),
      taxAmount,
      taxPercent,
      tipAmount: toNumber(order.tipAmount),
      paidAmount: toNumber(order.paidAmount),
      tenderedAmount: toNumber(order.tenderedAmount),
      paymentStatus: order.paymentStatus,
      payments: order.payments.map((p) => ({
        method: (p.method || "CASH") as "CASH" | "CARD" | "WALLET" | "BANK",
        amount: toNumber(p.amount),
        tipAmount: toNumber(p.tipAmount),
        tenderedAmount: toNumber(p.tenderedAmount),
      })),
      showLogo: billOpts.showLogo,
      showName: billOpts.showName,
      showTagline: billOpts.showTagline,
      showAddress: billOpts.showAddress,
      showPhone: billOpts.showPhone,
      title: billOpts.title,
      showOrderBy: billOpts.showOrderBy,
      showServedBy: billOpts.showServedBy,
      showCashier: billOpts.showCashier,
      showTip: billOpts.showTip,
      showPaidStamp: billOpts.showPaidStamp,
      paidStampText: billOpts.paidStampText,
      paidStampBig: billOpts.paidStampBig,
      paidStampPath: this.settings.paidStampFilePath(),
      unpaidStampPath: this.settings.unpaidStampFilePath(),
      footer: billOpts.footer,
    };
  }

  /**
   * Bill printer pick order:
   * 1) Who pressed print (cashier at their counter)
   * 2) Order's assigned cashier printer (supervisor/floor print → that counter)
   * 3) First NETWORK bill printer, else first bill printer
   */
  private async resolveBillPrinterId(
    printers: { id: string; kind: Printer["kind"] }[],
    requestedById?: string | null,
    assignedCashierPrinterId?: string | null,
  ) {
    const pick = (id: string | null | undefined) =>
      id && printers.some((p) => p.id === id) ? id : null;

    if (requestedById) {
      const user = await this.prisma.user.findUnique({
        where: { id: requestedById },
        select: { billPrinterId: true },
      });
      const own = pick(user?.billPrinterId);
      if (own) return own;
    }
    const assigned = pick(assignedCashierPrinterId);
    if (assigned) return assigned;
    return printers.find((p) => p.kind === "NETWORK")?.id ?? printers[0]?.id ?? null;
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
    const paperWidth = job.printer?.paperWidth ?? 80;
    return {
      text: this.render(job, paperWidth).plain(),
      paperWidth,
      logoUrl: brandingPublicUrl(this.settings.logoFilePath()),
      paidStampUrl: "/branding/paid-stamp.png",
      unpaidStampUrl: "/branding/unpaid-stamp.png",
      cancelledStampUrl: "/branding/cancelled-stamp.png",
    };
  }

  // ---------- worker ----------

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.recoverStaleAgentJobs();
      const now = Date.now();
      const pending = await this.prisma.printJob.findMany({
        where: { status: "PENDING" },
        include: { printer: true, order: { select: { orderNo: true } } },
        orderBy: { createdAt: "asc" },
        take: 10,
      });
      for (const job of pending) {
        // AGENT jobs are claimed + printed by the Additional PC desktop app.
        if (job.printer?.kind === "AGENT") continue;
        if ((this.notBefore.get(job.id) ?? 0) > now) continue;
        await this.process(job);
      }
    } catch (e) {
      this.log.error(`queue: ${(e as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  private async recoverStaleAgentJobs() {
    const now = Date.now();
    for (const [jobId, claimedAt] of this.agentClaimedAt) {
      if (now - claimedAt < AGENT_STALE_MS) continue;
      this.agentClaimedAt.delete(jobId);
      const job = await this.prisma.printJob.findUnique({
        where: { id: jobId },
        select: { id: true, status: true, attempts: true, printer: { select: { kind: true } } },
      });
      if (!job || job.status !== "PRINTING" || job.printer?.kind !== "AGENT") continue;
      const final = job.attempts >= MAX_ATTEMPTS;
      await this.prisma.printJob.update({
        where: { id: job.id },
        data: {
          status: final ? "FAILED" : "PENDING",
          lastError: final ? "Additional PC did not finish printing" : "Additional PC timed out — retrying",
        },
      });
    }
  }

  /**
   * Additional PC desktop agent: take the next pending job for this PC's USB printers.
   * Server renders ESC/POS; the agent only writes raw bytes to its local Windows printer.
   */
  async claimNextForAgent(agentId: string) {
    const pending = await this.prisma.printJob.findFirst({
      where: {
        status: "PENDING",
        printer: { agentId, kind: "AGENT", active: true },
      },
      include: { printer: true, order: { select: { orderNo: true } } },
      orderBy: { createdAt: "asc" },
    });
    if (!pending?.printer) return null;
    if ((this.notBefore.get(pending.id) ?? 0) > Date.now()) return null;

    const attempts = pending.attempts + 1;
    await this.prisma.printJob.update({
      where: { id: pending.id },
      data: { status: "PRINTING", attempts, lastError: null },
    });
    this.agentClaimedAt.set(pending.id, Date.now());

    try {
      const doc = this.render(pending, pending.printer.paperWidth);
      return {
        id: pending.id,
        type: pending.type,
        printerName: pending.printer.target,
        orderNo: pending.order?.orderNo ?? null,
        dataBase64: doc.buffer().toString("base64"),
      };
    } catch (e) {
      this.agentClaimedAt.delete(pending.id);
      const error = (e as Error).message;
      const final = attempts >= MAX_ATTEMPTS;
      await this.prisma.printJob.update({
        where: { id: pending.id },
        data: { status: final ? "FAILED" : "PENDING", lastError: error },
      });
      if (!final) this.notBefore.set(pending.id, Date.now() + RETRY_DELAY_MS * attempts);
      throw e;
    }
  }

  async completeAgentJob(agentId: string, jobId: string) {
    const job = await this.prisma.printJob.findFirst({
      where: { id: jobId, printer: { agentId } },
      include: { printer: true, order: { select: { orderNo: true } } },
    });
    if (!job) throw new NotFoundException("Print job not found");
    this.agentClaimedAt.delete(job.id);
    await this.prisma.printJob.update({
      where: { id: job.id },
      data: { status: "DONE", printedAt: new Date(), lastError: null },
    });
    this.notBefore.delete(job.id);
    this.realtime.printResult(
      {
        id: job.id,
        type: job.type,
        status: "DONE",
        printer: job.printer?.name ?? null,
        orderNo: job.order?.orderNo ?? null,
      },
      job.requestedById,
    );
    return { ok: true };
  }

  async failAgentJob(agentId: string, jobId: string, error: string) {
    const job = await this.prisma.printJob.findFirst({
      where: { id: jobId, printer: { agentId } },
      include: { printer: true, order: { select: { orderNo: true } } },
    });
    if (!job) throw new NotFoundException("Print job not found");
    this.agentClaimedAt.delete(job.id);
    const attempts = job.attempts;
    const final = attempts >= MAX_ATTEMPTS;
    await this.prisma.printJob.update({
      where: { id: job.id },
      data: { status: final ? "FAILED" : "PENDING", lastError: error },
    });
    if (final) {
      this.notBefore.delete(job.id);
      this.log.warn(`Agent job ${job.id} failed: ${error}`);
      this.realtime.printResult(
        {
          id: job.id,
          type: job.type,
          status: "FAILED",
          error,
          printer: job.printer?.name ?? null,
          orderNo: job.order?.orderNo ?? null,
        },
        job.requestedById,
      );
    } else {
      this.notBefore.set(job.id, Date.now() + RETRY_DELAY_MS * Math.max(1, attempts));
    }
    return { ok: true, status: final ? "FAILED" : "PENDING" };
  }

  private async process(job: PrintJob & { printer: Printer | null; order: { orderNo: number } | null }) {
    const attempts = job.attempts + 1;
    await this.prisma.printJob.update({ where: { id: job.id }, data: { status: "PRINTING", attempts } });
    try {
      if (!job.printer || !job.printer.active) throw new Error("Printer removed or disabled");
      if (job.printer.kind === "AGENT") throw new Error("Agent printer must be claimed by Additional PC");
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
    if (job.type === "BILL_EDIT") return renderBillEditConfirm(p as BillEditConfirmPayload, paperWidth);
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
    payload: KotPayload | BillPayload | BillEditConfirmPayload | TestPayload,
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
    const error =
      type === "KOT"
        ? "No kitchen printer set up (Settings → Printers)"
        : "No bill printer set up (Settings → Printers)";
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

/** Public /branding URL for a file under the branding data dir (PNG preferred for print). */
function brandingPublicUrl(absPath: string | null | undefined) {
  if (!absPath) return null;
  return `/branding/${basename(absPath)}`;
}

function splitCats(s: string) {
  return s
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
}

/** Match menu category or kitchen station (beverages / cooking / bbq) to printer tags. */
function itemMatchesPrinter(
  item: { category: string; station: string },
  matchers: string[],
) {
  return matchers.some(
    (m) =>
      m === item.category ||
      m === item.station ||
      // allow "Beverages" printer station / shorthand tags
      item.station.includes(m) ||
      m.includes(item.station),
  );
}
