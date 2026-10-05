import { columnsFor, EscPos, paperDotsFor } from "./escpos";
import { logoRasterFromFile } from "./logo-raster";
import { splitTableLabel } from "./table-label";

export type Restaurant = { name: string; tagline: string; address: string; phone: string };

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
  footer?: string;
  /** Absolute path to branding logo file (PNG prints as raster). */
  logoPath?: string | null;
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
  tipAmount?: number;
  paidAmount: number;
  /** Cash the guest handed over (may exceed paidAmount). */
  tenderedAmount?: number;
  paymentStatus: string;
};

export type TestPayload = {
  printerName: string;
  serverName: string;
  urls: string[];
  time: string;
};

const UNIT: Record<string, string> = { KG: "kg", G: "g", L: "ltr", ML: "ml", PCS: "pcs" };
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

function place(p: { tableNo?: string | null; partitionName?: string | null; tableName?: string | null }) {
  return splitTableLabel(p.tableNo, p.partitionName, p.tableName);
}

function logoMaxDots(paperWidth: number) {
  if (paperWidth <= 58) return 200;
  if (paperWidth <= 72) return 240;
  if (paperWidth <= 80) return 280;
  return 320;
}

function stampMaxDots(paperWidth: number) {
  if (paperWidth <= 58) return 180;
  if (paperWidth <= 72) return 210;
  if (paperWidth <= 80) return 240;
  return 280;
}

/** Product | Qty | Rate | Amount column widths (sum ≈ paper cols minus gaps). */
function itemColWidths(cols: number): [number, number, number, number] {
  if (cols <= 32) return [11, 4, 6, 8]; // 29 + 3 gaps = 32
  if (cols <= 42) return [17, 5, 7, 10]; // 39 + 3 = 42
  if (cols <= 48) return [21, 5, 8, 11]; // 45 + 3 = 48
  return [28, 6, 10, 14]; // 58 + 3 = 61 ≈ 64
}

export function renderKot(p: KotPayload, paperWidth: number) {
  const e = new EscPos(columnsFor(paperWidth));
  const { partition, table } = place(p);
  const tableLabel = [partition, table || p.tableNo].filter(Boolean).join(" ") || "Walk-in";
  const dots = paperDotsFor(paperWidth);
  const billNo = p.orderNo;

  e.align("center");
  if (p.logoPath) {
    const img = logoRasterFromFile(p.logoPath, logoMaxDots(paperWidth), { centerOnPaperDots: dots });
    if (img) {
      e.raster(img);
      e.line("");
    }
  }
  if (p.restaurant?.name) e.bold().big().wrapped(p.restaurant.name).big(false).bold(false);
  if (p.restaurant?.phone) e.line(p.restaurant.phone);
  if (p.restaurant?.address) e.wrapped(p.restaurant.address);
  e.line("");
  e.bold().big().line("KITCHEN ORDER").big(false).bold(false);
  if (p.station) e.line(`[ ${p.station} ]`);
  if (p.reprint) e.bold().line("*** REPRINT ***").bold(false);
  e.align("left").line("");

  e.pair(`Date: ${datePart(p.time)}`, `Time: ${timePart(p.time)}`);
  e.pair(`Order #${p.orderNo}`, `Bill # ${billNo}`);
  e.align("center").bold().line(`Token No: ${p.orderNo}`).bold(false).align("left");
  if (partition) e.line(`Partition: ${partition}`);
  if (table || p.tableNo) e.line(`Table: ${table || p.tableNo}`);
  e.align("center").inverse(true).bold().line(` Table No. ${tableLabel} `).bold(false).inverse(false).align("left");
  if (p.round) e.align("center").bold().line(`Round ${p.round}`).bold(false).align("left");

  e.rule("-");
  for (const i of p.items) {
    e.bold().big().wrapped(`${qty(i.quantity, i.unit)}  ${i.name}`).big(false).bold(false);
    if (i.notes) e.wrapped(`>> ${i.notes}`, 2);
  }
  e.rule("-");

  if (p.notes) e.wrapped(`Note: ${p.notes}`).rule("-");
  if (p.round && p.round > 1) {
    e.align("center").bold().line(`** NEW ITEMS (Round ${p.round}) **`).bold(false).align("left");
  }

  const showBy = p.showOrderBy !== false;
  const takenBy = p.takenBy ?? p.waiter;
  if (showBy && takenBy) e.line(`Order taken by: ${takenBy}`);
  if (p.servedBy) e.line(`Served by: ${p.servedBy}`);

  e.align("center").line("-- no prices on kitchen copy --");
  if (p.footer) e.wrapped(p.footer);
  return e.feed(4).beep().cut();
}

export function renderBill(p: BillPayload, paperWidth: number) {
  const e = new EscPos(columnsFor(paperWidth));
  const r = p.restaurant;
  const tip = p.tipAmount ?? 0;
  const showTip = p.showTip !== false && tip > 0;
  const showLogo = p.showLogo !== false;
  const showName = p.showName !== false;
  const showTagline = p.showTagline !== false;
  const showAddress = p.showAddress !== false;
  const showPhone = p.showPhone !== false;
  const title = (p.title || "Customer Bill").trim() || "Customer Bill";
  const paidStamp = (p.paidStampText || "*** PAID ***").trim() || "*** PAID ***";
  const showPaidStamp = p.showPaidStamp !== false;
  const paidStampBig = p.paidStampBig !== false;
  const billNo = p.billNo ?? p.orderNo;
  const { partition, table } = place(p);
  const dots = paperDotsFor(paperWidth);
  const discount = Math.max(0, p.discountAmount ?? 0);
  const net = Math.max(0, p.total - discount);
  const foodPaid = p.paidAmount > 0 ? p.paidAmount : p.paymentStatus === "PAID" ? net : 0;
  const grand = net + (showTip ? tip : 0);
  const cash =
    (p.tenderedAmount ?? 0) > 0
      ? p.tenderedAmount!
      : foodPaid > 0
        ? foodPaid + (showTip ? tip : 0)
        : p.paymentStatus === "PAID"
          ? grand
          : 0;
  const change = Math.max(0, cash - foodPaid - (showTip ? tip : 0));
  const party = (p.creditName || "General").trim() || "General";
  const tableLabel = [partition, table || p.tableNo].filter(Boolean).join(" ") || "Walk-in";
  const widths = itemColWidths(e.cols);

  // Header: logo → name → phone → address → Customer Bill (matches sample slip)
  e.align("center");
  if (showLogo && p.logoPath) {
    const img = logoRasterFromFile(p.logoPath, logoMaxDots(paperWidth), { centerOnPaperDots: dots });
    if (img) {
      e.raster(img);
      e.line("");
    }
  }
  if (showName) e.bold().big().wrapped(r.name).big(false).bold(false);
  if (showPhone && r.phone) e.line(r.phone);
  if (showAddress && r.address) e.wrapped(r.address);
  if (showTagline && r.tagline) e.wrapped(r.tagline);
  e.line("");
  e.bold().big().line(title).big(false).bold(false);
  e.align("left").line("");

  e.pair(`Date: ${datePart(p.time)}`, `Time: ${timePart(p.time)}`);
  e.pair(`Order #${p.orderNo}`, `Bill # ${billNo}`);
  e.align("center").bold().line(`Token No: ${billNo}`).bold(false).align("left");
  if (partition) e.line(`Partition: ${partition}`);
  if (table || p.tableNo) e.line(`Table: ${table || p.tableNo}`);
  e.align("center").inverse(true).bold().line(` Table No. ${tableLabel} `).bold(false).inverse(false).align("left");
  e.line(`Party Name: ${party}`);
  if (p.showCashier !== false && p.cashier) e.line(`Cashier: ${p.cashier}`);
  const orderedBy = p.orderedBy ?? p.waiter;
  if (p.showOrderBy !== false && orderedBy) e.line(`Order by: ${orderedBy}`);
  if (p.showServedBy !== false && p.servedBy) e.line(`Served by: ${p.servedBy}`);

  e.rule("-");
  e.bold().columns(["Product", "Qty", "Rate", "Amount"], widths).bold(false);
  e.rule("-");
  for (const i of p.items) {
    const nameLines = wrapName(i.name, widths[0]);
    e.columns([nameLines[0], qtyNum(i.quantity), amountPlain(i.rate), amountPlain(i.amount)], widths);
    for (const extra of nameLines.slice(1)) e.line(extra);
  }
  e.rule("-");

  e.pair("Gross Total:", money(p.total));
  if (discount > 0) e.pair("Discount:", money(discount));
  if (discount > 0) e.pair("Net Total:", money(net));
  if (showTip && tip > 0) e.pair("Tip:", money(tip));
  if (cash > 0) {
    e.line("");
    e.boxLine("Cash Received :", money(cash));
    if (change > 0) e.pair("Change:", money(change));
  } else if (p.paymentStatus !== "PAID") {
    e.line(`Payment: ${p.paymentStatus}`);
  }
  if (foodPaid > 0 && foodPaid < net) e.pair("Balance:", money(net - foodPaid));
  if (p.receivedBy) e.line(`Received by: ${p.receivedBy}`);

  if (p.paymentStatus === "PAID" && showPaidStamp) {
    e.align("center").line("");
    const stampImg = p.paidStampPath
      ? logoRasterFromFile(p.paidStampPath, stampMaxDots(paperWidth), { centerOnPaperDots: dots })
      : null;
    if (stampImg) e.raster(stampImg, "[PAID STAMP]");
    else {
      e.bold();
      if (paidStampBig) e.big();
      e.line(paidStamp);
      if (paidStampBig) e.big(false);
      e.bold(false);
    }
    e.align("left");
  }

  e.line("");
  e.align("center").wrapped(p.footer || "Thanks for your Visit..");
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
      tipAmount: 0,
      paidAmount: 2700,
      tenderedAmount: 3000,
      paymentStatus: "PAID",
    },
    paperWidth
  ).plain();
}
