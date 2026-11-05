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
import { TipService } from "../system/tip.service";
import { FinanceService } from "../finance/finance.service";
import { MachineLogService } from "../system/machine-log.service";
import {
  BillEditConfirmPayload,
  BillPayload,
  CreditSlipPayload,
  KotPayload,
  renderBill,
  renderBillEditConfirm,
  renderCreditSlip,
  renderKot,
  renderTest,
  TestPayload,
} from "./receipts";
import {
  listWindowsPrinters,
  printPdfToWindowsPrinter,
  sendToNetworkPrinter,
  sendToWindowsPrinter,
  writePreviewFile,
} from "./drivers";
import { splitTableLabel } from "./table-label";

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 4000;
const TICK_MS = 1000;
/** Agent claimed a job but never finished — return to queue. */
const AGENT_STALE_MS = 60_000;
/** Same window as print-agents "online" badge. */
const AGENT_ONLINE_MS = 45_000;
/** Pending AGENT jobs fail after this if the Additional PC stays offline (and server has no local spooler match). */
const AGENT_OFFLINE_FAIL_MS = 90_000;
/** Refresh Windows printer name cache on the server. */
const LOCAL_WIN_CACHE_MS = 30_000;

type KotOptions = {
  round?: number;
  reprint?: boolean;
  /** Full-order cancel slip with CANCELLED stamp for the kitchen. */
  cancelled?: boolean;
  /** Shown on the cancel kitchen slip. */
  cancelReason?: string | null;
  requestedById?: string | null;
  /**
   * Bill-edit removals: print these lines on a CANCELLED slip even after they
   * were deleted from the order (loadKot would otherwise only see remaining items).
   */
  cancelLines?: {
    name: string;
    quantity: number;
    unit: string;
    notes?: string | null;
    category?: string;
    station?: string;
  }[];
};

@Injectable()
export class PrintService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger("Print");
  private timer?: NodeJS.Timeout;
  private busy = false;
  private notBefore = new Map<string, number>();
  private agentClaimedAt = new Map<string, number>();
  private localWinCache: { at: number; names: Set<string> } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly identity: ServerIdentityService,
    private readonly realtime: RealtimeService,
    private readonly tips: TipService,
    private readonly finance: FinanceService,
    private readonly machineLogs: MachineLogService
  ) {}

  async onApplicationBootstrap() {
    await this.prisma.printJob.updateMany({
      where: { status: "PRINTING", type: { not: "REPORT" } },
      data: { status: "PENDING" },
    });
    await this.prisma.printJob.updateMany({
      where: { status: "PRINTING", type: "REPORT" },
      data: { status: "FAILED", lastError: "Interrupted while printing PDF" },
    });
    await this.healAgentPrinterRoles();
    await this.failOfflineAgentJobs(true);
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------- enqueue ----------

  /**
   * KOT routing (per round / reprint set):
   * - No station tags on printers → every KOT printer gets the full slip.
   * - One printer with several stations in `categories` (e.g. COOKING,BEVERAGES) → those
   *   lines merge into **one** job on that printer (intentional multi-station assign).
   * - Single station in the order (e.g. only beverages) → only that station’s printer,
   *   with its matching lines.
   * - Mixed stations in one order across **different** printers (BBQ + cooking) → each
   *   *involved* printer gets the **full** slip so distant stations still get a ticket.
   * - Catch-all printers (empty station/categories) get lines no specialized printer claimed.
   */
  async enqueueKot(orderId: string, opts: KotOptions = {}) {
    const kot = await this.loadKot(orderId, opts);
    const allKot = await this.prisma.printer.findMany({ where: { active: true, printsKot: true } });
    // Kitchen slips must not hit cashier / Other-print / bill-counter printers.
    const printers = this.kotPrinterPool(allKot);
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
      // Prefer categories (multi-station assign). Station field may be comma-separated legacy.
      if (cats.length) return cats;
      return splitCats(printer.station || "");
    };

    const slipStationLabel = (printer: (typeof printers)[number]) => {
      const label = (printer.station || "").trim();
      if (label) return label;
      const cats = splitCats(printer.categories);
      if (cats.length) return cats.map((c) => c.toUpperCase()).join(" + ");
      return printer.name;
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

    // Mixed across *printers* → full slip on each involved printer (distant BBQ vs cooking).
    // Several stations on the *same* printer stay one job (categories multi-select).
    const mixed = involved.length >= 2;
    for (const { printer, mine } of involved) {
      const lines = mixed ? printItems : mine;
      const payload = kot.payload(lines, slipStationLabel(printer));
      jobs.push(await this.createJob("KOT", printer.id, payload, orderId, opts.requestedById));
    }

    // Unmatched lines → catch-all, else every kitchen printer (never drop food).
    const leftovers = printItems.filter((i) => !routed.has(i));
    if (leftovers.length && catchAll.length) {
      for (const printer of catchAll) {
        jobs.push(
          await this.createJob("KOT", printer.id, kot.payload(leftovers, null), orderId, opts.requestedById),
        );
      }
    } else if (leftovers.length) {
      // Specialized tags didn't cover these lines (or matched nothing) — still print.
      const dump = catchAll.length ? catchAll : printers;
      for (const printer of dump) {
        jobs.push(
          await this.createJob(
            "KOT",
            printer.id,
            kot.payload(leftovers, slipStationLabel(printer)),
            orderId,
            opts.requestedById,
          ),
        );
      }
    }

    // Safety: items existed but routing produced zero jobs → print full slip everywhere.
    if (!jobs.length && printItems.length) {
      this.log.warn(`KOT routing empty for order ${orderId} — falling back to all kitchen printers`);
      for (const printer of printers) {
        jobs.push(
          await this.createJob("KOT", printer.id, kot.payload(printItems, null), orderId, opts.requestedById),
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
      logoUrl: this.settings.logoPublicUrl(),
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
      logoUrl: this.settings.logoPublicUrl(),
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
    // Edit-remove: caller passes the lines that left the bill (already deleted from DB).
    const fromCancelLines = (opts.cancelLines || [])
      .filter((l) => l && l.name && l.quantity > 0)
      .map((l) => ({
        category: (l.category || "General").toLowerCase(),
        station: (l.station || "COOKING").toLowerCase(),
        takenBy: staffLabel(order.waiter),
        line: {
          name: l.name,
          quantity: l.quantity,
          unit: l.unit || "plate",
          notes: l.notes ?? null,
          round: 0,
        },
      }));
    const allItems = fromCancelLines.length ? fromCancelLines : kitchenRows.map(mapItem);
    const round = opts.round ?? order.kotRounds;
    const roundItems = fromCancelLines.length
      ? fromCancelLines
      : kitchenRows.filter((i) => i.kotRound === round).map(mapItem);
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

  /** Credit account paid / partial settlement slip → cashier bill printer. */
  async enqueueCreditSlip(slip: CreditSlipPayload, requestedById?: string | null) {
    const printers = await this.prisma.printer.findMany({ where: { active: true, printsBill: true } });
    if (!printers.length) {
      const job = await this.prisma.printJob.create({
        data: {
          type: "CREDIT_SLIP",
          status: "FAILED",
          lastError: "No bill printer set up (Settings → Printers)",
          payload: slip as unknown as Prisma.InputJsonValue,
          requestedById: requestedById ?? null,
        },
      });
      this.realtime.printResult(
        { id: job.id, type: "CREDIT_SLIP", status: "FAILED", error: job.lastError, orderNo: null },
        requestedById
      );
      return [job];
    }
    const printerId = await this.resolveBillPrinterId(printers, requestedById, null);
    const billOpts = await this.tips.printBillOpts();
    const restaurant = await this.settings.restaurant();
    const payload: CreditSlipPayload = {
      ...slip,
      restaurant: {
        name: restaurant.name || slip.restaurant.name,
        tagline: restaurant.tagline || slip.restaurant.tagline,
        address: restaurant.address || slip.restaurant.address,
        phone: restaurant.phone || slip.restaurant.phone,
      },
      logoPath: this.settings.logoFilePath(),
      showLogo: billOpts.showLogo,
      showName: billOpts.showName,
      showPhone: billOpts.showPhone,
      showAddress: billOpts.showAddress,
    };
    return [await this.createJob("CREDIT_SLIP", printerId ?? printers[0]!.id, payload, null, requestedById)];
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
      // Bill shows cover charge only — package food lines (notes "Per head", Rs 0) stay kitchen-only.
      items: order.items
        .filter((i) => {
          if (i.lineKind === "PER_HEAD") return true;
          return !/^per\s*head\b/i.test((i.notes || "").trim());
        })
        .map((i) => ({
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
      blockOrder: billOpts.blockOrder,
      template: billOpts.template,
    };
  }

  /**
   * Bill printer pick order:
   * 1) Who pressed print (cashier at their counter)
   * 2) Order's assigned cashier printer (supervisor/floor print → that counter)
   * 3) First NETWORK bill printer, else first bill printer
   */
  private async resolveBillPrinterId(
    printers: { id: string; kind: Printer["kind"]; name?: string; target?: string }[],
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
    const looksKitchen = (p: { name?: string; target?: string }) =>
      /kitchen|kot|cook|grill|tandoor|bbq|bar|beverage|drink/i.test(`${p.target || ""} ${p.name || ""}`);
    const billFirst = printers.filter((p) => !looksKitchen(p));
    const pool = billFirst.length ? billFirst : printers;
    return pool.find((p) => p.kind === "NETWORK")?.id ?? pool[0]?.id ?? null;
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

  /** Active server Windows printers marked for Other print (A4 / PDF reports). */
  async listOtherPrinters() {
    const rows = await this.prisma.printer.findMany({
      where: { active: true, printsOther: true, kind: "WINDOWS" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, target: true, station: true },
    });
    return rows;
  }

  /**
   * Print a PDF report on an Other-print Windows printer (immediate, not ESC/POS queue).
   */
  async printPdfReport(opts: {
    title: string;
    pdf: Buffer;
    printerId?: string | null;
    requestedById?: string | null;
  }) {
    const others = await this.prisma.printer.findMany({
      where: { active: true, printsOther: true, kind: "WINDOWS" },
      orderBy: { name: "asc" },
    });
    if (!others.length) {
      throw new BadRequestException(
        "No Other print printer set up. Settings → Printers → add a Windows printer and tick Other print."
      );
    }
    const printer = opts.printerId
      ? others.find((p) => p.id === opts.printerId)
      : others[0];
    if (!printer) {
      throw new BadRequestException("Selected Other print printer not found or not enabled");
    }

    const job = await this.prisma.printJob.create({
      data: {
        type: "REPORT",
        printerId: printer.id,
        status: "PRINTING",
        attempts: 1,
        requestedById: opts.requestedById ?? null,
        payload: {
          title: opts.title,
          bytes: opts.pdf.length,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    try {
      await printPdfToWindowsPrinter(printer.target, opts.pdf);
      await this.prisma.printJob.update({
        where: { id: job.id },
        data: { status: "DONE", printedAt: new Date(), lastError: null },
      });
      this.realtime.printResult(
        { id: job.id, type: "REPORT", status: "DONE", printer: printer.name, orderNo: null },
        opts.requestedById
      );
      return { ok: true, jobId: job.id, printerId: printer.id, printerName: printer.name };
    } catch (e) {
      const error = (e as Error).message;
      await this.prisma.printJob.update({
        where: { id: job.id },
        data: { status: "FAILED", lastError: error },
      });
      this.realtime.printResult(
        { id: job.id, type: "REPORT", status: "FAILED", error, printer: printer.name, orderNo: null },
        opts.requestedById
      );
      throw new BadRequestException(`Other print failed: ${error}`);
    }
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
      logoUrl: this.settings.logoPublicUrl(),
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
      await this.failOfflineAgentJobs(false);
      const now = Date.now();
      const pending = await this.prisma.printJob.findMany({
        where: { status: "PENDING", type: { not: "REPORT" } },
        include: {
          printer: { include: { agent: { select: { lastSeenAt: true } } } },
          order: { select: { orderNo: true } },
        },
        orderBy: { createdAt: "asc" },
        take: 10,
      });
      for (const job of pending) {
        // AGENT: Additional PC claims when online; if offline but the same
        // Windows printer name exists on this server, print locally.
        if (job.printer?.kind === "AGENT") {
          const agentOnline =
            !!job.printer.agent &&
            now - job.printer.agent.lastSeenAt.getTime() < AGENT_ONLINE_MS;
          if (agentOnline) continue;
          if (!(await this.localWindowsHas(job.printer.target))) continue;
        }
        if ((this.notBefore.get(job.id) ?? 0) > now) continue;
        await this.process(job);
      }
    } catch (e) {
      this.log.error(`queue: ${(e as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  /** True when this server’s Windows spooler has a printer with that name. */
  private async localWindowsHas(target: string): Promise<boolean> {
    const name = target.trim();
    if (!name || process.platform !== "win32") return false;
    const now = Date.now();
    if (!this.localWinCache || now - this.localWinCache.at > LOCAL_WIN_CACHE_MS) {
      try {
        const list = await listWindowsPrinters();
        this.localWinCache = { at: now, names: new Set(list.map((p) => p.name.trim()).filter(Boolean)) };
      } catch {
        this.localWinCache = { at: now, names: new Set() };
      }
    }
    return this.localWinCache.names.has(name);
  }

  /** Prefer kitchen printers; exclude Other-print. Always keep at least one printsKot target. */
  private kotPrinterPool<T extends { name: string; target: string; station: string | null; categories: string | null; printsOther: boolean; printsBill: boolean; printsKot: boolean }>(
    printers: T[],
  ): T[] {
    if (!printers.length) return printers;
    const keyOf = (p: T) => `${p.target || ""} ${p.name || ""} ${p.station || ""}`.toLowerCase();
    const looksKitchen = (p: T) =>
      /kitchen|kot|cook|grill|tandoor|bbq|bar|beverage|drink|chef/.test(keyOf(p)) ||
      !!(p.station || "").trim() ||
      splitCats(p.categories || "").length > 0;
    const looksCashier = (p: T) =>
      /cashier|counter|pos|reception|billing|front.?desk|main.?pc/.test(keyOf(p)) && !looksKitchen(p);

    // Other-print = A4/PDF reports — never kitchen slips (unless that is the only KOT printer).
    const noOther = printers.filter((p) => !p.printsOther);
    const pool = noOther.length ? noOther : printers;

    const kitchen = pool.filter(looksKitchen);
    if (kitchen.length) return kitchen;

    const notCashier = pool.filter((p) => !looksCashier(p));
    if (notCashier.length) return notCashier;

    const kotOnly = pool.filter((p) => p.printsKot && !p.printsBill);
    return kotOnly.length ? kotOnly : pool;
  }

  /**
   * Boot heal (auto-synced only): Kitchen/Bar-named agent printers default to KOT, not bills.
   * Never touch `manual` printers — Settings choices must stick.
   */
  private async healAgentPrinterRoles() {
    const agents = await this.prisma.printer.findMany({
      where: { kind: "AGENT", active: true, manual: false },
      select: { id: true, target: true, name: true, printsKot: true, printsBill: true },
    });
    for (const p of agents) {
      const key = `${p.target} ${p.name}`.toLowerCase();
      if (!/kitchen|kot|cook|grill|tandoor|bbq|bar|beverage|drink/.test(key)) continue;
      if (p.printsKot && !p.printsBill) continue;
      await this.prisma.printer.update({
        where: { id: p.id },
        data: { printsKot: true, printsBill: false },
      });
      this.log.warn(`Healed agent printer roles: ${p.name} → KOT on, bill off`);
    }
  }

  /** Mark PENDING AGENT jobs as FAILED when Additional PC is offline and server cannot print locally. */
  private async failOfflineAgentJobs(forceStale: boolean) {
    const pending = await this.prisma.printJob.findMany({
      where: { status: "PENDING", printer: { kind: "AGENT" } },
      include: {
        printer: { include: { agent: { select: { displayName: true, hostname: true, lastSeenAt: true } } } },
        order: { select: { orderNo: true } },
      },
      take: 50,
      orderBy: { createdAt: "asc" },
    });
    const now = Date.now();
    for (const job of pending) {
      const agent = job.printer?.agent;
      const target = job.printer?.target ?? "";
      // Printer installed on Main PC Windows — server tick will print; don't fail as offline.
      if (target && (await this.localWindowsHas(target))) continue;
      if (!agent) {
        await this.failAgentOfflineJob(job, "Print agent missing — re-open desktop app on that PC");
        continue;
      }
      const offlineFor = now - agent.lastSeenAt.getTime();
      if (offlineFor < AGENT_ONLINE_MS) continue;
      const label = (agent.displayName || agent.hostname || "Additional PC").trim();
      const waiting = now - job.createdAt.getTime();
      // Annotate quickly; fail after grace (or immediately for old stuck jobs on boot).
      if (forceStale || waiting >= AGENT_OFFLINE_FAIL_MS || offlineFor >= AGENT_OFFLINE_FAIL_MS) {
        await this.failAgentOfflineJob(
          job,
          `${label} offline — open Hotel desktop app on that PC, then Retry`,
        );
      } else if (!job.lastError) {
        await this.prisma.printJob.update({
          where: { id: job.id },
          data: { lastError: `${label} offline — waiting for desktop app…` },
        });
      }
    }
  }

  private async failAgentOfflineJob(
    job: { id: string; type: PrintJob["type"]; requestedById: string | null; order: { orderNo: number } | null; printer: { name: string } | null },
    error: string,
  ) {
    await this.prisma.printJob.update({
      where: { id: job.id },
      data: { status: "FAILED", lastError: error },
    });
    this.notBefore.delete(job.id);
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
      include: {
        printer: { include: { agent: { select: { id: true, displayName: true, hostname: true } } } },
        order: { select: { orderNo: true } },
      },
    });
    if (!job) throw new NotFoundException("Print job not found");
    this.agentClaimedAt.delete(job.id);
    await this.prisma.printJob.update({
      where: { id: job.id },
      data: { status: "DONE", printedAt: new Date(), lastError: null },
    });
    this.notBefore.delete(job.id);
    const agent = job.printer?.agent;
    const mName = agent?.displayName || agent?.hostname || job.printer?.name || "Cashier PC";
    this.machineLogs.info(
      agentId,
      mName,
      `Print OK · ${job.type}${job.order?.orderNo != null ? ` #${job.order.orderNo}` : ""} · ${job.printer?.name || "?"}`
    );
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
      include: {
        printer: { include: { agent: { select: { id: true, displayName: true, hostname: true } } } },
        order: { select: { orderNo: true } },
      },
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
      const agent = job.printer?.agent;
      const mName = agent?.displayName || agent?.hostname || job.printer?.name || "Cashier PC";
      this.machineLogs.error(
        agentId,
        mName,
        `Print FAIL · ${job.type}${job.order?.orderNo != null ? ` #${job.order.orderNo}` : ""} · ${job.printer?.name || "?"} · ${error.slice(0, 160)}`
      );
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
      if (job.type === "REPORT") throw new Error("PDF reports print immediately — use Other print again");
      const doc = this.render(job, job.printer.paperWidth);
      await this.send(job.printer, doc.buffer(), doc.plain(), job);
      await this.prisma.printJob.update({
        where: { id: job.id },
        data: { status: "DONE", printedAt: new Date(), lastError: null },
      });
      this.notBefore.delete(job.id);
      this.machineLogs.info(
        job.printer.agentId || this.machineLogs.mainId(),
        job.printer.name,
        `Print OK · ${job.type}${job.order?.orderNo != null ? ` #${job.order.orderNo}` : ""} · ${job.printer.name}`
      );
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
        this.machineLogs.error(
          job.printer?.agentId || this.machineLogs.mainId(),
          job.printer?.name || "Main server",
          `Print FAIL · ${job.type}${job.order?.orderNo != null ? ` #${job.order.orderNo}` : ""} · ${job.printer?.name || "?"} · ${error.slice(0, 160)}`
        );
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
    if (job.type === "CREDIT_SLIP") return renderCreditSlip(p as CreditSlipPayload, paperWidth);
    return renderTest(p as TestPayload, paperWidth);
  }

  private async send(printer: Printer, data: Buffer, text: string, job: PrintJob) {
    if (printer.kind === "NETWORK") return sendToNetworkPrinter(printer.target, data);
    if (printer.kind === "WINDOWS" || printer.kind === "AGENT") {
      // AGENT fallback: same Windows printer name on Main PC spooler.
      return sendToWindowsPrinter(printer.target, data);
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    writePreviewFile(printer.target, `${stamp}-${job.type.toLowerCase()}-${job.id.slice(-6)}`, text);
  }

  private createJob(
    type: PrintJob["type"],
    printerId: string,
    payload: KotPayload | BillPayload | BillEditConfirmPayload | CreditSlipPayload | TestPayload,
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

function splitCats(s: string) {
  return s
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
}

/** Match menu category or kitchen station codes (BEVERAGES / COOKING / BBQ) to printer tags. */
function itemMatchesPrinter(
  item: { category: string; station: string },
  matchers: string[],
) {
  const station = (item.station || "").toLowerCase();
  const category = (item.category || "").toLowerCase();
  return matchers.some((raw) => {
    const m = raw.toLowerCase();
    if (!m) return false;
    return (
      m === category ||
      m === station ||
      // allow shorthand tags ("bev" / "Beverages" printer labels)
      (!!station && (station.includes(m) || m.includes(station)))
    );
  });
}
