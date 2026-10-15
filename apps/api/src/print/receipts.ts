import { columnsFor, EscPos, isNarrowPaper, normalizePaperWidth, paperDotsFor, wrap } from "./escpos";
import { VENDOR } from "../common/vendor";
import { logoRasterFromFile } from "./logo-raster";
import { tableBadgeRaster } from "./badge-raster";
import { splitTableLabel } from "./table-label";
import {
  DEFAULT_BILL_TEMPLATE,
  fillInlineTokens,
  isBlockOnlyLine,
  normalizeBillTemplate,
} from "./bill-template";

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
  /** Legacy block order — ignored when template is used. */
  blockOrder?: string[] | string;
  /** Mail-merge bill template. Empty → default hotel layout. */
  template?: string | null;
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

function orderTypeLabel(p: {
  tableNo?: string | null;
  tableName?: string | null;
  partitionName?: string | null;
}) {
  const part = (p.partitionName || "").trim();
  if (part) return part;
  return p.tableNo || p.tableName ? "DINE IN" : "TAKE AWAY";
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
  // SoftInfinity-style seal size — readable, not oversized.
  if (w <= 58) return 140;
  if (w <= 72) return 170;
  if (w <= 80) return 200;
  return 240;
}

/** Compact stamp for the empty middle of the totals block (labels ↔ amounts). */
function stampMaxDots(paperWidth: number) {
  const w = normalizePaperWidth(paperWidth);
  if (w <= 58) return 40;
  if (w <= 72) return 48;
  if (w <= 80) return 52;
  return 60;
}

/** Short time without seconds for one-line meta. */
function timePartShort(iso: string) {
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")}${ampm}`;
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
  // Qty fits "0.25"; Rate/Amount fit up to 7–8 digit plain numbers under headers.
  if (cols <= 42) return [cols - 22, 5, 7, 10];
  if (cols <= 48) return [cols - 24, 5, 8, 11];
  return [cols - 28, 5, 10, 13];
}

/** Narrow (58mm) Product | Qty | Amt — must sum to `cols`. */
function itemColWidthsNarrow(cols: number): [number, number, number] {
  if (cols <= 32) return [cols - 13, 5, 8];
  return [cols - 15, 5, 10];
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

function printLogoBlock(e: EscPos, p: BillPayload, paperWidth: number, dots: number) {
  // SoftInfinity clone — restaurant logo (our branding), then name/phone/address.
  if (!p.logoPath || p.showLogo === false) return;
  e.align("center");
  const img = logoRasterFromFile(p.logoPath, logoMaxDots(paperWidth), {
    centerOnPaperDots: dots,
    frame: false,
    mode: "logo",
    maxHeight: logoMaxDots(paperWidth),
  });
  if (img) e.raster(img);
  else e.rasterMarker("[LOGO]");
}

function printNameBlock(e: EscPos, p: BillPayload) {
  if (!p.restaurant?.name) return;
  e.align("center").bold().wrapped(p.restaurant.name.trim()).bold(false);
}

function printPhoneBlock(e: EscPos, p: BillPayload) {
  if (!p.restaurant?.phone) return;
  e.align("center").line(p.restaurant.phone);
}

function printAddressBlock(e: EscPos, p: BillPayload) {
  e.align("center");
  if (p.restaurant?.address) e.wrapped(p.restaurant.address);
  if (p.restaurant?.ntn) e.line(`NTN: ${p.restaurant.ntn}`);
  if (p.restaurant?.strn) e.line(`STRN: ${p.restaurant.strn}`);
}

function printTaglineBlock(e: EscPos, p: BillPayload) {
  if (!p.restaurant?.tagline) return;
  e.align("center").wrapped(p.restaurant.tagline);
}

function printTitleBlock(e: EscPos, p: BillPayload) {
  // SoftInfinity default title
  const title = (p.title || "Provisional Bill").trim() || "Provisional Bill";
  e.align("center").bold().line(title).bold(false);
}

function printItemsBlock(e: EscPos, p: BillPayload, narrow: boolean) {
  e.align("left");
  const widths = narrow ? itemColWidthsNarrow(e.cols) : itemColWidthsWide(e.cols);
  e.rule("-");
  // No bold on headers: emphasized glyphs are wider on many ESC/POS printers and
  // shift Qty/Rate/Amount off the column grid used by the data rows.
  if (narrow) {
    e.columns(["Product", "Qty", "Amt"], widths);
    e.rule("-");
    for (const i of p.items) {
      const nameLines = wrapName(i.name, widths[0]);
      e.columns([nameLines[0], qtyNum(i.quantity), amountPlain(i.amount)], widths);
      for (const extra of nameLines.slice(1)) e.columns([extra, "", ""], widths);
    }
  } else {
    e.columns(["Product", "Qty", "Rate", "Amount"], widths);
    e.rule("-");
    for (const i of p.items) {
      const nameLines = wrapName(i.name, widths[0]);
      e.columns([nameLines[0], qtyNum(i.quantity), amountPlain(i.rate), amountPlain(i.amount)], widths);
      for (const extra of nameLines.slice(1)) e.columns([extra, "", "", ""], widths);
    }
  }
  e.rule("-");
}

function printFooterBlock(e: EscPos, p: BillPayload) {
  e.align("center").wrapped(p.footer || "Thanks for your Visit..");
}

function printVendorFooter(e: EscPos, _narrow: boolean) {
  // SoftInfinity clone footer — PixalBotics instead of SoftInfinity URL
  e.align("center").font("B").line(VENDOR.line).font("A");
}

function printBlockToken(
  token: string,
  e: EscPos,
  p: BillPayload,
  paperWidth: number,
  t: BillTotals,
  narrow: boolean
) {
  switch (token) {
    case "logo":
      printLogoBlock(e, p, paperWidth, t.dots);
      break;
    case "name":
      printNameBlock(e, p);
      break;
    case "phone":
      printPhoneBlock(e, p);
      break;
    case "address":
      printAddressBlock(e, p);
      break;
    case "tagline":
      printTaglineBlock(e, p);
      break;
    case "title":
      printTitleBlock(e, p);
      break;
    case "meta":
      e.align("left");
      printBillMeta(e, p, t, paperWidth);
      break;
    case "staff":
      e.align("left");
      printStaffBlock(e, p);
      break;
    case "items":
      printItemsBlock(e, p, narrow);
      break;
    case "totals":
      e.align("left");
      // Stamp prints inside totals (middle gap) so amounts stay readable
      printBillTotals(e, p, t, paperWidth);
      break;
    case "stamp":
      // Already printed inside {{totals}} — skip so it does not repeat under footer
      break;
    case "footer":
      printFooterBlock(e, p);
      break;
    case "vendor":
      printVendorFooter(e, narrow);
      break;
    case "rule":
      e.rule("-");
      break;
    case "rule_eq":
      e.rule("=");
      break;
  }
}

function buildTemplateVars(p: BillPayload, t: BillTotals): Record<string, string> {
  const { partition, table } = place(p);
  const tableLabel = [partition, table || p.tableNo].filter(Boolean).join(" ") || "Walk-in";
  const orderedBy = p.orderedBy ?? p.waiter ?? "";
  return {
    "restaurant.name": (p.restaurant?.name || "").trim(),
    "restaurant.phone": (p.restaurant?.phone || "").trim(),
    "restaurant.address": (p.restaurant?.address || "").trim(),
    "restaurant.tagline": (p.restaurant?.tagline || "").trim(),
    "restaurant.ntn": (p.restaurant?.ntn || "").trim(),
    "restaurant.strn": (p.restaurant?.strn || "").trim(),
    bill_title: ((p.title || "Provisional Bill").trim() || "Provisional Bill"),
    footer_text: (p.footer || "Thanks for your Visit..").trim(),
    order_no: String(p.orderNo),
    bill_no: String(t.billNo),
    table: tableLabel,
    partition: partition || "",
    table_name: table || p.tableNo || "",
    date: datePart(p.time),
    time: timePart(p.time),
    order_type: t.orderType,
    payment_mode: t.paymentMode,
    payment_status: p.paymentStatus,
    customer_name: t.customerName,
    customer_phone: t.customerPhone,
    gross_total: money(p.total),
    discount: money(t.discount),
    tax: money(t.tax),
    tip: money(t.tip),
    grand_total: money(t.grand),
    amount_paid: money(t.amountPaid),
    balance: money(t.balance),
    change: money(t.change),
    cashier: (p.cashier || "").trim(),
    ordered_by: orderedBy.trim(),
    served_by: (p.servedBy || "").trim(),
    received_by: (p.receivedBy || "").trim(),
  };
}

/** Mail-merge render: template lines + block tokens. */
function printBillFromTemplate(
  e: EscPos,
  p: BillPayload,
  paperWidth: number,
  t: BillTotals,
  narrow: boolean
) {
  const template = normalizeBillTemplate(p.template ?? DEFAULT_BILL_TEMPLATE);
  const vars = buildTemplateVars(p, t);
  const lines = template.replace(/\r\n/g, "\n").split("\n");

  for (const rawLine of lines) {
    const block = isBlockOnlyLine(rawLine);
    if (block) {
      printBlockToken(block, e, p, paperWidth, t, narrow);
      continue;
    }

    let line = rawLine;
    let center = false;
    let bold = false;
    if (line.startsWith(">>")) {
      center = true;
      line = line.slice(2);
    }
    if (line.startsWith("**") && line.endsWith("**") && line.length > 4) {
      bold = true;
      line = line.slice(2, -2);
    }
    const filled = fillInlineTokens(line, vars);
    if (!filled.trim()) {
      // Skip blank template lines — saves thermal paper height.
      continue;
    }
    if (center) e.align("center");
    else e.align("left");
    if (bold) e.bold();
    e.wrapped(filled);
    if (bold) e.bold(false);
  }
}

function printBillSections(e: EscPos, p: BillPayload, paperWidth: number, t: BillTotals, narrow: boolean) {
  // Mail-merge template is the source of truth (default = classic hotel layout).
  printBillFromTemplate(e, p, paperWidth, t, narrow);
}

/**
 * Small PAID/UNPAID stamp on the cashier bill (must print on thermal — not preview-only).
 * Compact size so totals amounts stay readable; preview still overlays via the marker.
 */
function printPaidStampInline(e: EscPos, t: BillTotals, paperWidth: number) {
  if (t.showPaidStamp === false) return;
  const label = t.paid ? "[PAID STAMP]" : "[UNPAID STAMP]";
  e.align("center");
  const stampImg = paymentStampRaster(t.stampPath, paperWidth, t.dots);
  if (stampImg) e.raster(stampImg, label);
  else {
    e.rasterMarker(label);
    e.bold().line(t.paid ? t.paidStamp : "*** UNPAID ***").bold(false);
  }
  e.align("left");
}

/**
 * SoftInfinity-style table badge: solid black bar + white letters (GS v 0 raster).
 * Do NOT use GS B inverse — many printers print dim / unreadable black-on-black.
 */
function printTableBadge(e: EscPos, tableLabel: string, paperWidth?: number, paperDots?: number) {
  const label = String(tableLabel || "Walk-in").trim().replace(/\s+/g, " ") || "Walk-in";
  const dots = paperDots && paperDots > 0 ? paperDots : paperDotsFor(paperWidth || 80);
  const text = `Table No. ${label}`;
  e.align("center");
  const img = tableBadgeRaster(label, dots, { withPrefix: true });
  if (img) e.raster(img, text);
  else e.font("A").bold().line(`*** ${text.toUpperCase()} ***`).bold(false);
  e.align("left").font("A");
}

/** SoftInfinity meta: Date/Time, Serving Area, Table No. badge, Party, Description. */
function printBillMeta(e: EscPos, p: BillPayload, t: BillTotals, paperWidth: number) {
  const { partition, table } = place(p);
  const tableLabel = [partition, table || p.tableNo].filter(Boolean).join(" ") || "Walk-in";
  const party = (p.creditName || "General").trim() || "General";
  const description =
    ((p.orderedBy ?? p.waiter) || p.creditName || "").trim() || party;

  e.font("A");
  e.pair(`Date: ${datePart(p.time)}`, `Time: ${timePart(p.time)}`);
  e.line(`Serving Area: ${t.orderType}`);
  // One crisp black raster badge (TABLE NO. …) — matches SoftInfinity look, readable on thermal.
  printTableBadge(e, tableLabel, paperWidth, t.dots);
  e.line(`Party Name: ${party}`);
  e.line(`Description: ${description}`);
}

/**
 * SoftInfinity staff lines (under payment box): Order Taker + Login.
 */
function printStaffBlock(e: EscPos, p: BillPayload) {
  const orderTaker =
    p.showOrderBy !== false ? ((p.orderedBy ?? p.waiter) || "").trim() : "";
  const login = p.showCashier !== false ? (p.cashier || "").trim() : "";
  if (orderTaker) e.line(`Order Taker: ${orderTaker}`);
  if (login) e.line(`Login: ${login}`);
}

/** SoftInfinity totals: Gross Total → stamp → Cash Received box. */
function printBillTotals(e: EscPos, p: BillPayload, t: BillTotals, paperWidth: number) {
  e.pair("Gross Total:", money(p.total));
  if (t.discount > 0) e.pair("Discount:", money(t.discount));
  if (t.discount > 0) e.pair("Net Total:", money(t.net));
  if (t.tax > 0) e.pair(`Tax (${t.taxPercent}%):`, money(t.tax));
  if (t.showTip) e.pair("Tip:", money(t.tip));
  if (Math.round(t.grand) !== Math.round(p.total) && (t.discount > 0 || t.tax > 0 || t.showTip)) {
    e.pair("Grand Total:", money(t.grand));
  }
  printPaidStampInline(e, t, paperWidth);
  if (t.methodLines.length) {
    for (const line of t.methodLines) {
      e.boxLine(`${line.label} :`, money(line.amount));
    }
    if (t.change > 0) e.pair("Change:", money(t.change));
  } else if (t.isCredit && !t.paid) {
    e.boxLine("Cash Received :", "");
    e.pair("Payment:", "Credit / On account");
  } else {
    // SoftInfinity always shows the Cash Received frame
    e.boxLine("Cash Received :", t.paid ? money(t.amountPaid) : "");
  }
  if (t.balance > 0) e.pair("Balance Due:", money(t.balance));
}

/** Compact slip for 50/58mm rolls — same hotel bill structure, tighter columns. */
function renderBillNarrow(p: BillPayload, paperWidth: number, t: BillTotals) {
  const e = new EscPos(columnsFor(paperWidth));
  // Font A keeps a fixed character grid so Product/Qty/Rate/Amount stay aligned.
  e.font("A");
  printBillSections(e, p, paperWidth, t, true);
  return e.feed(1).cut();
}

/** Full hotel bill for 72/80/112mm rolls (reference layout + thermal logo). */
function renderBillWide(p: BillPayload, paperWidth: number, t: BillTotals) {
  const e = new EscPos(columnsFor(paperWidth));
  // Font A keeps a fixed character grid so Product/Qty/Rate/Amount stay aligned.
  e.font("A");
  printBillSections(e, p, paperWidth, t, false);
  return e.feed(1).cut();
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

  const showName = p.showName !== false;
  const showPhone = p.showPhone !== false;
  const showAddress = p.showAddress !== false;

  const cancelled = !!p.cancelled;

  e.align("center");
  // No logo on kitchen slip — name first (saves paper).
  if (showName && p.restaurant?.name) e.bold().wrapped(p.restaurant.name).bold(false);
  if (showPhone && p.restaurant?.phone) e.line(p.restaurant.phone);
  if (showAddress && p.restaurant?.address) e.wrapped(p.restaurant.address);
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
  printTableBadge(e, tableLabel, paperWidth, dots);
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
  e.align("center").font("B").line(VENDOR.line).font("A");
  return e.feed(1).beep().cut();
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
      maxHeight: logoMaxDots(paperWidth),
    });
    if (img) e.raster(img);
  }
  if (showName && p.restaurant?.name) e.bold().wrapped(p.restaurant.name).bold(false);
  if (showPhone && p.restaurant?.phone) e.line(p.restaurant.phone);
  if (showAddress && p.restaurant?.address) e.wrapped(p.restaurant.address);
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
      receivedBy: "Front Desk",
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
