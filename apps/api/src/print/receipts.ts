import { columnsFor, EscPos } from "./escpos";

export type Restaurant = { name: string; tagline: string; address: string; phone: string };

export type KotPayload = {
  restaurant: Restaurant;
  orderNo: number;
  tableNo: string | null;
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
};

export type BillPayload = {
  restaurant: Restaurant;
  orderNo: number;
  tableNo: string | null;
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
  tipAmount?: number;
  paidAmount: number;
  paymentStatus: string;
  showOrderBy?: boolean;
  showServedBy?: boolean;
  showCashier?: boolean;
  showTip?: boolean;
  footer?: string;
};

export type TestPayload = {
  printerName: string;
  serverName: string;
  urls: string[];
  time: string;
};

const UNIT: Record<string, string> = { KG: "kg", G: "g", L: "ltr", ML: "ml", PCS: "pcs" };

function qty(q: number, unit: string) {
  const n = Number.isInteger(q) ? String(q) : q.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return `${n} ${UNIT[unit] ?? unit.toLowerCase()}`;
}

function money(n: number) {
  return `Rs ${Math.round(n).toLocaleString("en-US")}`;
}

function when(iso: string) {
  const d = new Date(iso);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function renderKot(p: KotPayload, paperWidth: number) {
  const e = new EscPos(columnsFor(paperWidth));
  e.align("center").bold().big().line("KITCHEN ORDER").big(false).bold(false);
  if (p.station) e.line(`[ ${p.station} ]`);
  if (p.reprint) e.bold().line("*** REPRINT ***").bold(false);
  e.align("left").rule("=");
  e.bold().big().line(`TABLE: ${p.tableNo || "Walk-in"}`).big(false).bold(false);
  e.pair(`Order #${p.orderNo}`, p.round ? `Round ${p.round}` : "All items");
  e.line(`Time: ${when(p.time)}`);
  e.rule();
  for (const i of p.items) {
    e.bold().big().wrapped(`${qty(i.quantity, i.unit)}  ${i.name}`).big(false).bold(false);
    if (i.notes) e.wrapped(`>> ${i.notes}`, 2);
  }
  e.rule();
  if (p.notes) e.wrapped(`Note: ${p.notes}`).rule();
  if (p.round && p.round > 1) e.align("center").bold().line(`** NEW ITEMS (Round ${p.round}) **`).bold(false);
  const showBy = p.showOrderBy !== false;
  const takenBy = p.takenBy ?? p.waiter;
  if (showBy && takenBy) e.align("left").bold().wrapped(`Order taken by: ${takenBy}`).bold(false);
  if (p.servedBy) e.align("left").bold().wrapped(`Served by: ${p.servedBy}`).bold(false);
  e.align("center").line("-- no prices on kitchen copy --");
  if (p.footer) e.align("center").wrapped(p.footer);
  return e.feed(4).beep().cut();
}

export function renderBill(p: BillPayload, paperWidth: number) {
  const e = new EscPos(columnsFor(paperWidth));
  const r = p.restaurant;
  const tip = p.tipAmount ?? 0;
  const showTip = p.showTip !== false && tip > 0;
  e.align("center").bold().big().wrapped(r.name).big(false).bold(false);
  if (r.tagline) e.wrapped(r.tagline);
  if (r.address) e.wrapped(r.address);
  if (r.phone) e.line(`Tel: ${r.phone}`);
  e.align("left").rule("=");
  e.align("center").bold().line("CUSTOMER BILL").bold(false).align("left");
  e.pair(`Bill #${p.orderNo}`, `Table: ${p.tableNo || "-"}`);
  if (p.creditName) e.bold().line(`Credit: ${p.creditName}`).bold(false);
  e.line(when(p.time));
  const orderedBy = p.orderedBy ?? p.waiter;
  if (p.showOrderBy !== false && orderedBy) e.bold().line(`Order taken by: ${orderedBy}`).bold(false);
  if (p.showServedBy !== false && p.servedBy) e.bold().line(`Served by: ${p.servedBy}`).bold(false);
  if (p.showCashier !== false && p.cashier) e.line(`Cashier: ${p.cashier}`);
  e.rule();
  for (const i of p.items) {
    e.wrapped(i.name);
    e.pair(`  ${qty(i.quantity, i.unit)} x ${money(i.rate)}`, money(i.amount));
  }
  e.rule();
  e.bold().pair("SUBTOTAL", money(p.total)).bold(false);
  if (showTip) e.pair("Tip", money(tip));
  if (showTip) e.bold().big().pair("TOTAL", money(p.total + tip)).big(false).bold(false);
  else e.bold().big().pair("TOTAL", money(p.total)).big(false).bold(false);
  if (p.paidAmount > 0) e.pair("Paid", money(p.paidAmount));
  if (showTip && tip > 0) e.pair("Tip paid", money(tip));
  if (p.receivedBy) e.line(`Received by: ${p.receivedBy}`);
  if (p.paidAmount > 0 && p.paidAmount < p.total) e.pair("Balance", money(p.total - p.paidAmount));
  e.rule();
  if (p.paymentStatus === "PAID") {
    e.align("center").bold().big().line("*** PAID ***").big(false).bold(false).align("left");
  } else {
    e.line(`Payment: ${p.paymentStatus}`);
  }
  e.rule("=");
  e.align("center").wrapped(p.footer || "Thank you - Come again!");
  return e.feed(4).cut();
}

export function renderTest(p: TestPayload, paperWidth: number) {
  const e = new EscPos(columnsFor(paperWidth));
  e.align("center").bold().big().line("TEST PRINT").big(false).bold(false);
  e.line("Hotel System");
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
