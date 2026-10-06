import { columnsFor, EscPos, isNarrowPaper, normalizePaperWidth, paperDotsFor, wrap } from "./escpos";
import { VENDOR } from "../common/vendor";
import { logoRasterFromFile } from "./logo-raster";
import { splitTableLabel } from "./table-label";

export type Restaurant = { name: string; tagline: string; address: string; phone: string; ntn?: string; strn?: string };

export type KotPayload = {
  restaurant: Restaurant;
  orderNo: number;
  tableNo: string | null;
  partitionName?: string | null;
  tableName?: string | null;
  waiter: string | null;
  /** Who took the items on this slip, e.g. "Ahmed (Waiter)". Absent on jobs stored by older versions. */
  takenBy?: string | null;
  /** Who is serving the table. */
  servedBy?: string | null;
  round: number | null;
  reprint: boolean;
  station: string | null;
  time: string;
  notes: string | null;
  items: Array<{ name: string; quantity: number; unit: string; notes: string | null; round: number }>;
  showOrderBy?: boolean;
  showLogo?: boolean;
  showName?: boolean;
  showPhone?: boolean;
  showAddress?: boolean;
  footer?: string;
  /** Absolute path to branding logo file (PNG prints as raster). */
  logoPath?: string | null;
  /** When true, slip is a kitchen cancel notice (stamp + CANCELLED banner). */
  cancelled?: boolean;
  /** Absolute path to CANCELLED stamp PNG. */
  cancelledStampPath?: string | null;
  /** Why the order was cancelled (printed on cancel slips). */
  cancelReason?: string | null;
};

export type BillDesign = {
  showLogo?: boolean;
  showName?: boolean;
  showTagline?: boolean;
  showAddress?: boolean;
  showPhone?: boolean;
  title?: string;
  showOrderBy?: boolean;
  showServedBy?: boolean;
  showCashier?: boolean;
  showTip?: boolean;
  showPaidStamp?: boolean;
  paidStampText?: string;
  paidStampBig?: boolean;
  footer?: string;
  /** Absolute path to branding logo file (PNG prints as raster). */
  logoPath?: string | null;
  /** Absolute path to PAID stamp PNG (preferred over text stamp). */
  paidStampPath?: string | null;
  /** Absolute path to UNPAID stamp PNG. */
  unpaidStampPath?: string | null;
};

export type BillPayload = BillDesign & {
  restaurant: Restaurant;
  orderNo: number;
  /** Bill number — same as orderNo in this system, printed as its own field. */
  billNo?: number;
  tableNo: string | null;
  partitionName?: string | null;
  tableName?: string | null;
  creditName?: string | null;
  creditPhone?: string | null;
  creditAddress?: string | null;
  cashier: string | null;
  waiter: string | null;
  /** Order-taker with role, e.g. "Ali (Manager)". */
  orderedBy?: string | null;
  /** Table server with role. */
  servedBy?: string | null;
  /** Staff who collected the payment(s), when not the cashier. */
  receivedBy?: string | null;
  time: string;
  items: Array<{ name: string; quantity: number; unit: string; rate: number; amount: number }>;
  total: number;
  discountAmount?: number;
  taxAmount?: number;
  taxPercent?: number;
  tipAmount?: number;
  paidAmount: number;
  /** Cash the guest handed over (may exceed paidAmount). */
  tenderedAmount?: number;
  paymentStatus: string;
  /** Individual payment rows (method-aware). */
  payments?: Array<{
    method: "CASH" | "CARD" | "WALLET" | "BANK";
    amount: number;
    tipAmount: number;
    tenderedAmount?: number;
  }>;
};

/** Cashier / admin confirmation slip after a PAID bill was edited. */
export type BillEditConfirmPayload = {
  restaurant: Restaurant;
  orderNo: number;
  billNo?: number;
  tableNo: string | null;
  partitionName?: string | null;
  tableName?: string | null;
  time: string;
  reason: string;
  beforeTotal: number;
  afterTotal: number;
  beforeNet: number;
  afterNet: number;
  editedBy: string;
  items?: Array<{ name: string; beforeQty: number; afterQty: number; beforeAmount: number; afterAmount: number }>;
  showLogo?: boolean;
  showName?: boolean;
  showPhone?: boolean;
  showAddress?: boolean;
  logoPath?: string | null;
};

export type TestPayload = {
  printerName: string;
  serverName: string;
  urls: string[];
  time: string;
};

const UNIT: Record<string, string> = { KG: "kg", G: "g", L: "liter", ML: "ml", PCS: "pcs" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function qtyNum(q: number) {
  if (Number.isInteger(q)) return String(q);
  return q.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function qty(q: number, unit: string) {
  return `${qtyNum(q)} ${UNIT[unit] ?? unit.toLowerCase()}`;
}

function money(n: number) {
  return Math.round(n).toLocaleString("en-US");
}

function amountPlain(n: number) {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}

function when(iso: string) {
  const d = new Date(iso);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function datePart(iso: string) {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function timePart(iso: string) {
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes();
  const s = d.getSeconds();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${h}:${pad(m)}:${pad(s)}${ampm}`;
}

/** Reference-style bill datetime: JUN 17, 2024 14:15 */
function dateTimeBill(iso: string) {
  const d = new Date(iso);
  const mon = MONTHS[d.getMonth()].toUpperCase();
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${mon} ${d.getDate()}, ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function orderTypeLabel(p: { tableNo?: string | null; tableName?: string | null }) {
  return p.tableNo || p.tableName ? "DINE IN" : "WALK IN";
}

function methodLabel(method: string) {
  switch (method) {
    case "CARD":
      return "Card";
    case "WALLET":
      return "Wallet";
    case "BANK":
      return "Bank";
    default:
      return "Cash";
  }
}

function paymentModeLabel(p: {
  creditName?: string | null;
  paymentStatus: string;
  payments?: BillPayload["payments"];
}) {
  if (p.creditName) {
    return p.paymentStatus === "PAID" ? "Credit settled" : "Credit / On account";
  }
  const methods = [...new Set((p.payments || []).map((x) => x.method))];
  if (methods.length === 1) return methodLabel(methods[0]!);
  if (methods.length > 1) return methods.map(methodLabel).join(" + ");
  if (p.paymentStatus === "PAID") return "Cash";
  if (p.paymentStatus === "PARTIAL") return "Partial";
  return "Unpaid";
}

function place(p: { tableNo?: string | null; partitionName?: string | null; tableName?: string | null }) {
  return splitTableLabel(p.tableNo, p.partitionName, p.tableName);
}

function logoMaxDots(paperWidth: number) {
  const w = normalizePaperWidth(paperWidth);
  // Clear circular seal on the slip — large enough to read, not a tiny icon.
  if (w <= 58) return 180;
  if (w <= 72) return 220;
  if (w <= 80) return 256;
  return 300;
}

/** PAID / UNPAID stamp under totals (not over the item list). */
function stampMaxDots(paperWidth: number) {
  const w = normalizePaperWidth(paperWidth);
  if (w <= 58) return 96;
  if (w <= 72) return 112;
  if (w <= 80) return 128;
  return 144;
}

function paymentStampRaster(
  path: string | null | undefined,
  paperWidth: number,
  paperDots: number,
) {
  if (!path) return null;
  const max = stampMaxDots(paperWidth);
  return logoRasterFromFile(path, max, {
    centerOnPaperDots: paperDots,
    maxHeight: max,
    mode: "stamp",
  });
}

/** Wide (80mm+) Product | Qty | Rate | Amount — must sum to `cols`. */
function itemColWidthsWide(cols: number): [number, number, number, number] {
  if (cols <= 42) return [cols - 22, 4, 8, 10];
  if (cols <= 48) return [cols - 26, 4, 10, 12];
  return [cols - 32, 5, 12, 15];
}

/** Narrow (58mm) Product | Qty | Amt — must sum to `cols`. */
function itemColWidthsNarrow(cols: number): [number, number, number] {
  if (cols <= 32) return [cols - 12, 4, 8];
  return [cols - 14, 5, 9];
}

type BillTotals = {
  tip: number;
  showTip: boolean;
  discount: number;
  tax: number;
  taxPercent: number;
  net: number;
  grand: number;
  amountPaid: number;
  cash: number;
  cashTender: number;
  balance: number;
  change: number;
  billNo: number;
  customerName: string;
  customerPhone: string;
  customerAddr: string;
  paid: boolean;
  isCredit: boolean;
  paymentMode: string;
  orderType: string;
  methodLines: { label: string; amount: number }[];
  stampPath: string | null | undefined;
  paidStamp: string;
  showPaidStamp: boolean;
  dots: number;
};

function billTotals(p: BillPayload, paperWidth: number): BillTotals {
  const tip = p.tipAmount ?? 0;
  const showTip = p.showTip !== false && tip > 0;
  const billNo = p.billNo ?? p.orderNo;
  const { partition, table } = place(p);
  const discount = Math.max(0, p.discountAmount ?? 0);
  const tax = Math.max(0, p.taxAmount ?? 0);
  const taxPercent = Math.max(0, p.taxPercent ?? 0);
  const net = Math.max(0, p.total - discount);
  const dueBase = net + tax;
  const foodPaid = p.paidAmount > 0 ? p.paidAmount : p.paymentStatus === "PAID" ? dueBase : 0;
  const grand = dueBase + (showTip ? tip : 0);
  const amountPaid = foodPaid + (showTip && foodPaid > 0 ? tip : 0);
  const payments = p.payments || [];
  const byMethod = new Map<string, number>();
  let cashTender = 0;
  for (const pay of payments) {
    const method = pay.method || "CASH";
    const food = Math.max(0, pay.amount);
    byMethod.set(method, Math.round(((byMethod.get(method) || 0) + food) * 100) / 100);
    if (method === "CASH") {
      const tender = (pay.tenderedAmount ?? 0) > 0 ? pay.tenderedAmount! : food + Math.max(0, pay.tipAmount || 0);
      cashTender = Math.round((cashTender + tender) * 100) / 100;
    }
  }
  // Legacy / no payment rows: treat tendered as cash only when paid and not credit.
  if (!payments.length && amountPaid > 0 && !p.creditName) {
    byMethod.set("CASH", foodPaid);
    cashTender =
      (p.tenderedAmount ?? 0) > 0
        ? p.tenderedAmount!
        : amountPaid > 0
          ? amountPaid
          : p.paymentStatus === "PAID"
            ? grand
            : 0;
  }
  const methodLines = [...byMethod.entries()].map(([method, amount]) => ({
    label: `${methodLabel(method)} Received`,
    amount,
  }));
  const cash = cashTender > 0 ? cashTender : methodLines.length === 1 && methodLines[0]!.label.startsWith("Cash") ? amountPaid : 0;
  const cashFoodAndTip = payments
    .filter((x) => (x.method || "CASH") === "CASH")
    .reduce((s, x) => s + x.amount + (showTip ? Math.max(0, x.tipAmount || 0) : 0), 0);
  const change = Math.max(0, cashTender - (cashFoodAndTip || (payments.length ? 0 : amountPaid)));
  const balance = Math.max(0, grand - amountPaid);
  const customerName = (p.creditName || "Walk In Guest").trim() || "Walk In Guest";
  const customerPhone = (p.creditPhone || "").trim();
  const tableLabel = [partition, table || p.tableNo].filter(Boolean).join(" ") || "Pickup Counter";
  const customerAddr = (p.creditAddress || "").trim() || (p.creditName ? tableLabel : "");
  const paid = p.paymentStatus === "PAID";
  return {
    tip,
    showTip,
    discount,
    tax,
    taxPercent,
    net,
    grand,
    amountPaid,
    cash,
    cashTender,
    balance,
    change,
    billNo,
    customerName,
    customerPhone,
    customerAddr,
    paid,
    isCredit: !!p.creditName,
    paymentMode: paymentModeLabel(p),
    orderType: orderTypeLabel(p),
    methodLines,
    stampPath: paid ? p.paidStampPath : p.unpaidStampPath,
    paidStamp: (p.paidStampText || "*** PAID ***").trim() || "*** PAID ***",
    showPaidStamp: p.showPaidStamp !== false,
    dots: paperDotsFor(paperWidth),
  };
}

function printBrandHeader(e: EscPos, p: BillPayload, paperWidth: number, dots: number) {
  const showLogo = p.showLogo !== false;
  const showName = p.showName !== false;
  const showTagline = p.showTagline !== false;
  const showAddress = p.showAddress !== false;
  const showPhone = p.showPhone !== false;
  const title = (p.title || "Customer Bill").trim() || "Customer Bill";
  const r = p.restaurant;
  e.align("center");
  if (showLogo && p.logoPath) {
    const img = logoRasterFromFile(p.logoPath, logoMaxDots(paperWidth), {
      centerOnPaperDots: dots,
      frame: false,
      mode: "logo",
      maxHeight: logoMaxDots(paperWidth),
    });
    if (img) e.raster(img);
    else e.rasterMarker("[LOGO]");
    e.line("");
  }
  // Hotel name — full paper width, bold, centered (readable on printer + preview).
  if (showName && r.name) {
    e.bold().wrapped(r.name.trim()).bold(false);
  }
  if (showPhone && r.phone) e.line(r.phone);
  if (showAddress && r.address) e.wrapped(r.address);
  if (r.ntn) e.line(`NTN: ${r.ntn}`);
  if (r.strn) e.line(`STRN: ${r.strn}`);
  if (showTagline && r.tagline) e.wrapped(r.tagline);
  e.rule("=");
  e.bold().line(title).bold(false);
  e.rule("=");
  e.align("left");
}

/** Clear PAID/UNPAID mark under the totals — never drawn over item prices. */
function printPaidStamp(e: EscPos, t: BillTotals, paperWidth: number) {
  if (!t.showPaidStamp) return;
  const label = t.paid ? "[PAID STAMP SMALL]" : "[UNPAID STAMP SMALL]";
  e.align("center").line("");
  const stampImg = paymentStampRaster(t.stampPath, paperWidth, t.dots);
  if (stampImg) e.raster(stampImg, label);
  else {
    e.rasterMarker(label);
    e.bold().line(t.paid ? t.paidStamp : "*** UNPAID ***").bold(false);
  }
  e.align("left");
}

function printBillMeta(e: EscPos, p: BillPayload, t: BillTotals) {
  const { partition, table } = place(p);
  const tableLabel = [partition, table || p.tableNo].filter(Boolean).join(" ") || "Walk-in";
  const party = (p.creditName || "General").trim() || "General";

  e.pair(`Date: ${datePart(p.time)}`, `Time: ${timePart(p.time)}`);
  e.pair(`Order #${p.orderNo}`, `Bill # ${t.billNo}`);
  e.align("center").bold().line(`Token No: ${t.billNo}`).bold(false).align("left");
  e.align("center")
    .inverse(true)
    .bold()
    .big()
    .line(` Table No. ${tableLabel} `)
    .big(false)
    .bold(false)
    .inverse(false)
    .align("left");
  e.line(`Order type: ${t.orderType}`);
  e.line(`Payment mode: ${t.paymentMode}`);
  e.line(`Party Name: ${party}`);
  if (t.customerPhone) e.line(`Phone: ${t.customerPhone}`);
  if (t.customerAddr) e.wrapped(`Address: ${t.customerAddr}`);
  if (p.showCashier !== false && p.cashier) e.line(`Cashier: ${p.cashier}`);
  const orderedBy = p.orderedBy ?? p.waiter;
  if (p.showOrderBy !== false && orderedBy) e.line(`Order by: ${orderedBy}`);
  if (p.showServedBy !== false && p.servedBy) e.line(`Served by: ${p.servedBy}`);
}

function printBillTotals(e: EscPos, p: BillPayload, t: BillTotals) {
  e.pair("Gross Total:", money(p.total));
  if (t.discount > 0) e.pair("Discount:", money(t.discount));
  if (t.discount > 0) e.pair("Net Total:", money(t.net));
  if (t.tax > 0) e.pair(`Tax (${t.taxPercent}%):`, money(t.tax));
  if (t.showTip) e.pair("Tip:", money(t.tip));
  e.pair("Grand Total:", money(t.grand));
  if (t.methodLines.length) {
    e.line("");
    for (const line of t.methodLines) {
      e.boxLine(`${line.label} :`, money(line.amount));
    }
    if (t.change > 0) e.pair("Change:", money(t.change));
  } else if (t.isCredit && !t.paid) {
    e.line("Payment: Credit / On account");
  } else if (!t.paid) {
    e.line(`Payment: ${p.paymentStatus}`);
  }
  if (t.balance > 0) e.pair("Balance:", money(t.balance));
  if (p.receivedBy) e.line(`Received by: ${p.receivedBy}`);
}

/** Compact slip for 50/58mm rolls — same hotel bill structure, tighter columns. */
function renderBillNarrow(p: BillPayload, paperWidth: number, t: BillTotals) {
  const e = new EscPos(columnsFor(paperWidth));
  const widths = itemColWidthsNarrow(e.cols);
  printBrandHeader(e, p, paperWidth, t.dots);
  printBillMeta(e, p, t);

  e.rule("-");
  e.bold().columns(["Product", "Qty", "Amt"], widths).bold(false);
  e.rule("-");
  for (const i of p.items) {
    const nameLines = wrapName(i.name, widths[0]);
    e.columns([nameLines[0], qtyNum(i.quantity), amountPlain(i.amount)], widths);
    for (const extra of nameLines.slice(1)) e.columns([extra, "", ""], widths);
    e.columns([`@${amountPlain(i.rate)}`, "", ""], widths);
  }
  e.rule("-");

  printBillTotals(e, p, t);
  printPaidStamp(e, t, paperWidth);

  e.line("");
  e.align("center").wrapped(p.footer || "Thanks for your Visit..");
  e.line("");
  e.line(VENDOR.line);
  return e.feed(3).cut();
}

/** Full hotel bill for 72/80/112mm rolls (reference layout + thermal logo). */
function renderBillWide(p: BillPayload, paperWidth: number, t: BillTotals) {
  const e = new EscPos(columnsFor(paperWidth));
  const widths = itemColWidthsWide(e.cols);
  printBrandHeader(e, p, paperWidth, t.dots);
  printBillMeta(e, p, t);

  e.rule("-");
  e.bold().columns(["Product", "Qty", "Rate", "Amount"], widths).bold(false);
  e.rule("-");
  for (const i of p.items) {
    const nameLines = wrapName(i.name, widths[0]);
    e.columns([nameLines[0], qtyNum(i.quantity), amountPlain(i.rate), amountPlain(i.amount)], widths);
    for (const extra of nameLines.slice(1)) e.columns([extra, "", "", ""], widths);
  }
  e.rule("-");

  printBillTotals(e, p, t);
  printPaidStamp(e, t, paperWidth);

  e.line("");
  e.align("center").wrapped(p.footer || "Thanks for your Visit..");
  e.line("");
  e.line(VENDOR.line);
  if (VENDOR.phoneDisplay) e.line(VENDOR.phoneDisplay);
  return e.feed(3).cut();
}

export function renderBill(p: BillPayload, paperWidth: number) {
  const mm = normalizePaperWidth(paperWidth);
  const t = billTotals(p, mm);
  return isNarrowPaper(mm) ? renderBillNarrow(p, mm, t) : renderBillWide(p, mm, t);
}

export function renderKot(p: KotPayload, paperWidth: number) {
  const e = new EscPos(columnsFor(paperWidth));
  const { partition, table } = place(p);
  const tableLabel = [partition, table || p.tableNo].filter(Boolean).join(" ") || "Walk-in";
  const dots = paperDotsFor(paperWidth);
  const billNo = p.orderNo;

  const showLogo = p.showLogo !== false;
  const showName = p.showName !== false;
  const showPhone = p.showPhone !== false;
  const showAddress = p.showAddress !== false;

  const cancelled = !!p.cancelled;

  e.align("center");
  if (showLogo && p.logoPath) {
    const img = logoRasterFromFile(p.logoPath, logoMaxDots(paperWidth), {
      centerOnPaperDots: dots,
      frame: false,
      mode: "logo",
    });
    if (img) {
      e.raster(img);
      e.line("");
    } else {
      e.rasterMarker("[LOGO]");
    }
  }
  if (showName && p.restaurant?.name) e.bold().wrapped(p.restaurant.name).bold(false);
  if (showPhone && p.restaurant?.phone) e.line(p.restaurant.phone);
  if (showAddress && p.restaurant?.address) e.wrapped(p.restaurant.address);
  e.line("");
  e.bold().line(cancelled ? "CANCELLED ORDER" : "KITCHEN ORDER").bold(false);
  if (p.station) e.line(`[ ${p.station} ]`);
  if (cancelled) {
    e.bold().big().line("*** CANCELLED ***").big(false).bold(false);
    const stampImg = paymentStampRaster(p.cancelledStampPath, paperWidth, dots);
    if (stampImg) e.raster(stampImg, "[CANCELLED STAMP]");
    else e.bold().line("*** ORDER CANCELLED ***").bold(false);
  } else if (p.reprint) {
    e.bold().line("*** REPRINT ***").bold(false);
  }
  e.align("left").line("");

  e.pair(`Date: ${datePart(p.time)}`, `Time: ${timePart(p.time)}`);
  e.pair(`Order #${p.orderNo}`, `Bill # ${billNo}`);
  e.align("center").bold().line(`Token No: ${p.orderNo}`).bold(false).align("left");
  if (partition) e.line(`Partition: ${partition}`);
  if (table || p.tableNo) e.line(`Table: ${table || p.tableNo}`);
  e.align("center")
    .inverse(true)
    .bold()
    .big()
    .line(` Table No. ${tableLabel} `)
    .big(false)
    .bold(false)
    .inverse(false)
    .align("left");
  if (p.round && !cancelled) e.align("center").bold().line(`Round ${p.round}`).bold(false).align("left");

  e.rule("-");
  const qtyWidth = e.cols <= 32 ? 9 : 10;
  const isPerHeadPkg = (notes: string | null | undefined) =>
    !!notes && /^per\s*head\b/i.test(notes.trim());
  const perHeadItems = p.items.filter((i) => isPerHeadPkg(i.notes));
  const otherItems = p.items.filter((i) => !isPerHeadPkg(i.notes));
  const printKotLine = (i: (typeof p.items)[number], hidePerHeadNote = false) => {
    const q = qty(i.quantity, i.unit);
    const nameWidth = Math.max(6, e.width() - qtyWidth - 1);
    const names = wrap(i.name, nameWidth);
    if (q.length > qtyWidth) {
      e.bold().line(q).bold(false);
      for (const n of names) e.line(`${" ".repeat(qtyWidth)} ${n}`);
    } else {
      e.bold().line(`${q.padEnd(qtyWidth)} ${names[0] || ""}`.trimEnd()).bold(false);
      for (const extra of names.slice(1)) e.line(`${" ".repeat(qtyWidth)} ${extra}`);
    }
    if (i.notes && !(hidePerHeadNote && isPerHeadPkg(i.notes))) e.wrapped(`>> ${i.notes}`);
  };
  if (perHeadItems.length) {
    e.align("center").bold().line("--- PER HEAD ITEMS ---").bold(false).align("left");
    for (const i of perHeadItems) printKotLine(i, true);
    if (otherItems.length) e.rule("-");
  }
  for (const i of otherItems) printKotLine(i);
  e.rule("-");

  if (p.notes) e.wrapped(`Note: ${p.notes}`).rule("-");
  if (!cancelled && p.round && p.round > 1) {
    e.align("center").bold().line(`** NEW ITEMS (Round ${p.round}) **`).bold(false).align("left");
  }

  const showBy = p.showOrderBy !== false;
  const takenBy = p.takenBy ?? p.waiter;
  if (showBy && takenBy) e.line(`Order taken by: ${takenBy}`);
  if (p.servedBy) e.line(`Served by: ${p.servedBy}`);

  if (cancelled) {
    if (p.cancelReason) {
      e.align("left").wrapped(`Reason: ${p.cancelReason}`).rule("-");
    }
    e.align("center").line("");
    e.bold().line("*** DO NOT PREPARE ***").bold(false);
    e.line("*** Kitchen cancel notice ***");
  } else {
    e.align("center").line("*** Kitchen copy - no prices ***");
  }
  if (p.footer) e.wrapped(p.footer);
  return e.feed(4).beep().cut();
}

/** Special slip for cashier + admin: paid bill was edited (reason, before/after, sign). */
export function renderBillEditConfirm(p: BillEditConfirmPayload, paperWidth: number) {
  const e = new EscPos(columnsFor(paperWidth));
  const { partition, table } = place(p);
  const dots = paperDotsFor(paperWidth);
  const showLogo = p.showLogo !== false;
  const showName = p.showName !== false;
  const showPhone = p.showPhone !== false;
  const showAddress = p.showAddress !== false;
  const diff = Math.round((p.afterNet - p.beforeNet) * 100) / 100;

  e.align("center");
  if (showLogo && p.logoPath) {
    const img = logoRasterFromFile(p.logoPath, logoMaxDots(paperWidth), {
      centerOnPaperDots: dots,
      frame: false,
      mode: "logo",
    });
    if (img) {
      e.raster(img);
      e.line("");
    }
  }
  if (showName && p.restaurant?.name) e.bold().wrapped(p.restaurant.name).bold(false);
  if (showPhone && p.restaurant?.phone) e.line(p.restaurant.phone);
  if (showAddress && p.restaurant?.address) e.wrapped(p.restaurant.address);
  e.line("");
  e.bold().big().line("PAID BILL EDIT").big(false).bold(false);
  e.bold().line("CASHIER CONFIRMATION").bold(false);
  e.line("(Not a customer copy)");
  e.align("left").line("");

  e.pair(`Date: ${datePart(p.time)}`, `Time: ${timePart(p.time)}`);
  e.pair(`Order #${p.orderNo}`, `Bill # ${p.billNo ?? p.orderNo}`);
  if (partition) e.line(`Partition: ${partition}`);
  if (table || p.tableNo) e.line(`Table: ${table || p.tableNo}`);
  e.line(`Cashier: ${p.editedBy}`);
  e.rule("=");
  e.bold().line("EDITED AFTER PAYMENT").bold(false);
  e.pair("Before amount:", money(p.beforeNet));
  e.pair("After amount:", money(p.afterNet));
  e.pair("Difference:", `${diff > 0 ? "+" : ""}${money(diff)}`);
  e.rule("-");
  e.line("Reason:");
  for (const line of wrap(p.reason, e.cols)) e.line(line);
  if (p.items?.length) {
    e.rule("-");
    e.bold().line("Item changes").bold(false);
    for (const it of p.items) {
      e.line(it.name);
      e.pair(
        `  ${qtyNum(it.beforeQty)} → ${qtyNum(it.afterQty)}`,
        `${money(it.beforeAmount)} → ${money(it.afterAmount)}`
      );
    }
  }
  e.rule("=");
  e.line("");
  e.line("Cashier sign: ________________");
  e.line("");
  e.line("Admin / SM confirm: __________");
  e.line("");
  e.align("center").line("Keep with day close report");
  e.line(VENDOR.line);
  return e.feed(4).cut();
}

function wrapName(name: string, width: number): string[] {
  const words = name.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= width) cur += " " + w;
    else {
      out.push(cur);
      cur = w;
    }
    while (cur.length > width) {
      out.push(cur.slice(0, width));
      cur = cur.slice(width);
    }
  }
  if (cur || !out.length) out.push(cur);
  return out;
}

export function renderTest(p: TestPayload, paperWidth: number) {
  const e = new EscPos(columnsFor(paperWidth));
  e.align("center").bold().big().line("TEST PRINT").big(false).bold(false);
  e.line("PixalBotics Restaurant");
  e.rule();
  e.align("left").line(`Printer: ${p.printerName}`);
  e.line(`Server: ${p.serverName}`);
  for (const u of p.urls) e.line(`Open: ${u}`);
  e.line(`Time: ${when(p.time)}`);
  e.rule();
  e.line("1234567890".repeat(Math.ceil(e.cols / 10)).slice(0, e.cols));
  e.align("center").line("If you can read this, printing works.");
  return e.feed(4).cut();
}

/** Sample bill for Settings live preview. */
export function sampleBillPayload(restaurant: Restaurant, design: BillDesign, paperWidth = 80): string {
  return renderBill(
    {
      ...design,
      restaurant,
      orderNo: 206,
      billNo: 206,
      tableNo: "Roof Top · Table 4",
      partitionName: "Roof Top",
      tableName: "Table 4",
      creditName: null,
      creditPhone: null,
      creditAddress: null,
      cashier: "Cashier",
      waiter: "Ali",
      orderedBy: "Ali (Waiter)",
      servedBy: "Hassan",
      receivedBy: null,
      time: new Date().toISOString(),
      items: [
        { name: "Beef Karahi Black Pepper (Full)", quantity: 0.75, unit: "KG", rate: 2500, amount: 1875 },
        { name: "Quetta Sangat Special Kheer", quantity: 1, unit: "PCS", rate: 150, amount: 150 },
        { name: "Per Head", quantity: 3, unit: "PCS", rate: 120, amount: 360 },
        { name: "Gur Chaye", quantity: 3, unit: "PCS", rate: 100, amount: 300 },
        { name: "Raita Glass Extra", quantity: 1, unit: "PCS", rate: 100, amount: 100 },
      ],
      total: 2785,
      discountAmount: 85,
      taxAmount: 135,
      taxPercent: 5,
      tipAmount: 50,
      paidAmount: 2835,
      tenderedAmount: 3000,
      paymentStatus: "PAID",
      payments: [{ method: "CASH", amount: 2835, tipAmount: 50, tenderedAmount: 3000 }],
    },
    paperWidth
  ).plain();
}
