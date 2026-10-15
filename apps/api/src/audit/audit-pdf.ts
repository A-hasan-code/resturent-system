import PDFDocument from "pdfkit";
import { forEachBufferedPage } from "../common/pdf-page";
import { VENDOR } from "../common/vendor";
import type { AuditReport } from "./audit.service";

type Hotel = { name: string; tagline: string; address: string; phone: string };

const INK = "#15202b";
const MUTED = "#5b6b7a";
const LINE = "#d5dde5";
const ACCENT = "#0f7a6c";
const OK = "#1f7a4d";
const DANGER = "#c0392b";
const SOFT = "#eef3f6";
const PAGE = { margin: 42, width: 595.28, height: 841.89 };

const money = (n: number) => `Rs ${Math.round(n).toLocaleString("en-PK")}`;
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-PK", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const dayLabel = (d: string) => {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};

export function renderAuditPdf(report: AuditReport, hotel: Hotel): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      bufferPages: true,
      margins: { top: PAGE.margin, bottom: PAGE.margin + 18, left: PAGE.margin, right: PAGE.margin },
      info: {
        Title: `Sales report ${report.from} to ${report.to}`,
        Author: hotel.name,
        Subject: "PixalBotics Restaurant sales and audit report",
        Creator: "PixalBotics Restaurant",
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const contentW = PAGE.width - PAGE.margin * 2;
    const s = report.summary;
    const cashLeft = s.paymentsIn - s.purchasesOut;

    cover(doc, hotel, report, contentW);
    kpiRow(doc, contentW, [
      { label: "Range sales", value: money(s.salesTotal), note: `${s.billsPaid} paid bills` },
      { label: "Today", value: money(s.salesToday), note: "Current business day" },
      { label: "This month", value: money(s.salesMonth), note: "Month to date" },
      { label: "This year", value: money(s.salesYear), note: "Year to date" },
    ]);
    kpiRow(doc, contentW, [
      { label: "Discounts", value: money(s.discountsTotal), note: "On paid / credit bills" },
      { label: "Tax", value: money(s.taxTotal), note: "Exclusive sales tax" },
      { label: "Tips", value: money(s.tipsTotal), note: "Guest tips (separate)" },
      { label: "Food cost / profit", value: `${money(s.foodCost)} / ${money(s.profit)}`, note: "Recipe cost vs net food" },
    ]);
    kpiRow(doc, contentW, [
      { label: "Payments in", value: money(s.paymentsIn), note: `${s.paymentCount} receipts` },
      { label: "Cash / Card", value: `${money(s.byMethod.CASH)} / ${money(s.byMethod.CARD)}`, note: "Tender mix" },
      { label: "Wallet / Bank", value: `${money(s.byMethod.WALLET)} / ${money(s.byMethod.BANK)}`, note: "Tender mix" },
      { label: "Credit sales", value: money(s.creditSales), note: `${s.creditCount} credit bills` },
    ]);
    kpiRow(doc, contentW, [
      { label: "Purchases out", value: money(s.purchasesOut), note: `${s.purchaseCount} stock-ins` },
      { label: "Cash left", value: money(cashLeft), note: "Payments − purchases" },
      { label: "Orders", value: String(s.orders), note: `${s.cancelled} cancelled` },
      { label: "Unpaid amount", value: money(s.unpaidAmount), note: `${s.unpaidCount} open bills` },
    ]);

    sectionTitle(doc, "1. Cash flow by day", "Payments received versus stock purchases");
    barChart(doc, report.days, contentW);
    legend(doc, [
      { color: OK, label: "Payments in" },
      { color: DANGER, label: "Purchases out" },
    ]);

    ensureSpace(doc, 160);
    sectionTitle(doc, "2. Sales by who took the order", "Order taker · paid food sale · tips");
    table(
      doc,
      contentW,
      ["Staff", "Role", "Orders", "Sales", "Tips"],
      report.byOrderTaker.map((r) => [r.name, r.role, String(r.orders), money(r.sales), money(r.tips)]),
      [0.28, 0.2, 0.14, 0.2, 0.18]
    );

    ensureSpace(doc, 160);
    sectionTitle(doc, "3. Collection by cashier / staff", "Who received the customer payments");
    staffBars(doc, report.byStaff, contentW);
    table(
      doc,
      contentW,
      ["Staff", "Role", "Payments", "Amount"],
      report.byStaff.map((r) => [r.name, r.role, String(r.count), money(r.amount)]),
      [0.34, 0.24, 0.16, 0.26]
    );

    ensureSpace(doc, 120);
    sectionTitle(doc, "4. Daily sales", "Food sales for each day in the selected range");
    table(
      doc,
      contentW,
      ["Date", "Sales", "Disc.", "Tax", "Tips", "Bills", "In", "Out"],
      report.days
        .filter((d) => d.orders || d.paymentsIn || d.purchasesOut || d.sales)
        .map((d) => [
          dayLabel(d.date),
          money(d.sales),
          money(d.discounts),
          money(d.tax),
          money(d.tips),
          String(d.billsPaid),
          money(d.paymentsIn),
          money(d.purchasesOut),
        ]),
      [0.12, 0.12, 0.11, 0.11, 0.11, 0.1, 0.16, 0.17]
    );

    ensureSpace(doc, 120);
    sectionTitle(doc, "5. Sales register", "Every order in the period — order taken by · served by");
    table(
      doc,
      contentW,
      ["Time", "Bill", "Table", "Sale", "Disc.", "Tax", "Tip", "Pay"],
      report.sales.map((o) => [
        when(o.time),
        `#${o.orderNo}`,
        o.tableNo || "—",
        money(o.total),
        money(o.discountAmount),
        money(o.taxAmount),
        money(o.tipAmount),
        o.isCredit ? `CREDIT${o.creditName ? ` · ${o.creditName}` : ""}` : o.paymentStatus,
      ]),
      [0.14, 0.08, 0.08, 0.12, 0.1, 0.1, 0.1, 0.18]
    );

    ensureSpace(doc, 120);
    sectionTitle(doc, "6. Payment register", "Bill taken by · handed to cashier · confirmation time");
    table(
      doc,
      contentW,
      ["Time", "Bill", "Method", "Amount", "Tip", "Received by", "Handed to", "Confirmed"],
      report.payments.map((p) => [
        when(p.time),
        `#${p.orderNo}`,
        p.method || "CASH",
        money(p.amount),
        money(p.tipAmount),
        `${p.collectedBy}`,
        p.handedTo || "—",
        p.confirmedAt ? when(p.confirmedAt) : p.handedTo ? "Pending" : "—",
      ]),
      [0.14, 0.08, 0.1, 0.12, 0.1, 0.16, 0.14, 0.16]
    );

    ensureSpace(doc, 120);
    sectionTitle(doc, "7. Stock purchases", "Money spent on inventory in this period");
    table(
      doc,
      contentW,
      ["Time", "Item", "Qty", "Unit", "Amount", "Note"],
      report.purchases.map((p) => [
        when(p.time),
        p.item,
        String(p.quantity),
        p.unit,
        money(p.amount),
        p.note || "—",
      ]),
      [0.2, 0.24, 0.1, 0.1, 0.14, 0.22]
    );

    footer(doc, hotel);
    doc.end();
  });
}

function cover(doc: PDFKit.PDFDocument, hotel: Hotel, report: AuditReport, w: number) {
  doc.save();
  doc.rect(0, 0, PAGE.width, 118).fill(ACCENT);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(22).text(hotel.name, PAGE.margin, 28, { width: w });
  doc.font("Helvetica").fontSize(10).fillColor("#d7f3ee");
  if (hotel.tagline) doc.text(hotel.tagline, PAGE.margin, 56, { width: w });
  const meta = [hotel.address, hotel.phone ? `Tel ${hotel.phone}` : ""].filter(Boolean).join("  ·  ");
  if (meta) doc.text(meta, PAGE.margin, 72, { width: w });
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#ffffff").text("SALES & AUDIT REPORT", PAGE.margin, 92, { width: w });
  doc.restore();

  doc.y = 136;
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(11).text(`Period  ${report.from}  →  ${report.to}`);
  const since = report.firstSaleDate ? `  ·  System sales since ${report.firstSaleDate}` : "";
  doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(`Generated ${new Date().toLocaleString("en-PK")}${since}  ·  Confidential — for management use`);
  doc.moveDown(0.8);
  doc.strokeColor(LINE).lineWidth(1).moveTo(PAGE.margin, doc.y).lineTo(PAGE.margin + w, doc.y).stroke();
  doc.moveDown(0.8);
}

function kpiRow(
  doc: PDFKit.PDFDocument,
  w: number,
  cards: { label: string; value: string; note: string }[]
) {
  ensureSpace(doc, 78);
  const gap = 8;
  const cardW = (w - gap * (cards.length - 1)) / cards.length;
  const y = doc.y;
  cards.forEach((c, i) => {
    const x = PAGE.margin + i * (cardW + gap);
    doc.roundedRect(x, y, cardW, 62, 6).fill(SOFT);
    doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(c.label.toUpperCase(), x + 10, y + 10, { width: cardW - 20 });
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(12).text(c.value, x + 10, y + 26, { width: cardW - 20 });
    doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(c.note, x + 10, y + 44, { width: cardW - 20 });
  });
  doc.y = y + 74;
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string, subtitle: string) {
  ensureSpace(doc, 40);
  doc.fillColor(ACCENT).font("Helvetica-Bold").fontSize(12).text(title);
  doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(subtitle);
  doc.moveDown(0.4);
}

function legend(doc: PDFKit.PDFDocument, items: { color: string; label: string }[]) {
  let x = PAGE.margin;
  const y = doc.y;
  for (const it of items) {
    doc.roundedRect(x, y, 10, 10, 2).fill(it.color);
    doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(it.label, x + 14, y - 1);
    x += 90;
  }
  doc.y = y + 18;
}

function barChart(doc: PDFKit.PDFDocument, days: AuditReport["days"], w: number) {
  ensureSpace(doc, 170);
  const chartH = 130;
  const chartTop = doc.y + 8;
  const chartBottom = chartTop + chartH;
  const axisW = 52;
  const left = PAGE.margin + axisW;
  const right = PAGE.margin + w - 4;
  const max = Math.max(1, ...days.flatMap((d) => [d.paymentsIn, d.purchasesOut]));
  const n = Math.max(days.length, 1);
  const slot = (right - left) / n;

  doc.strokeColor(LINE).lineWidth(0.6);
  for (let i = 0; i <= 4; i++) {
    const y = chartBottom - (chartH * i) / 4;
    doc.moveTo(left, y).lineTo(right, y).stroke();
    doc.fillColor(MUTED).font("Helvetica").fontSize(7).text(money((max * i) / 4), PAGE.margin, y - 4, {
      width: axisW - 6,
      align: "right",
      lineBreak: false,
    });
  }

  days.forEach((d, i) => {
    const x = left + i * slot;
    const hIn = (d.paymentsIn / max) * chartH;
    const hOut = (d.purchasesOut / max) * chartH;
    const barW = Math.min(10, slot * 0.28);
    doc.roundedRect(x + slot * 0.18, chartBottom - hIn, barW, Math.max(hIn, d.paymentsIn ? 1.5 : 0), 1.5).fill(OK);
    doc
      .roundedRect(x + slot * 0.18 + barW + 2, chartBottom - hOut, barW, Math.max(hOut, d.purchasesOut ? 1.5 : 0), 1.5)
      .fill(DANGER);
    if (n <= 16 || i % Math.ceil(n / 16) === 0) {
      doc.fillColor(MUTED).font("Helvetica").fontSize(7).text(d.date.slice(8), x, chartBottom + 4, {
        width: slot,
        align: "center",
      });
    }
  });
  doc.y = chartBottom + 22;
}

function staffBars(doc: PDFKit.PDFDocument, staff: AuditReport["byStaff"], w: number) {
  if (!staff.length) {
    emptyNote(doc, "No payments in this period.");
    return;
  }
  ensureSpace(doc, staff.length * 22 + 10);
  const max = Math.max(1, ...staff.map((s) => s.amount));
  const barMax = w * 0.55;
  for (const s of staff) {
    ensureSpace(doc, 22);
    const y = doc.y;
    doc.fillColor(INK).font("Helvetica").fontSize(9).text(`${s.name}  (${s.role})`, PAGE.margin, y, { width: w * 0.38 });
    const bw = (s.amount / max) * barMax;
    doc.roundedRect(PAGE.margin + w * 0.4, y + 2, Math.max(bw, 2), 10, 3).fill(ACCENT);
    doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(money(s.amount), PAGE.margin + w * 0.4 + bw + 6, y + 1);
    doc.y = y + 20;
  }
  doc.moveDown(0.3);
}

function table(
  doc: PDFKit.PDFDocument,
  w: number,
  headers: string[],
  rows: string[][],
  weights: number[]
) {
  if (!rows.length) {
    emptyNote(doc, "No rows for this section.");
    return;
  }
  const cols = weights.map((wt) => wt * w);
  const rowH = 16;
  const drawHeader = () => {
    ensureSpace(doc, rowH + 8);
    const y = doc.y;
    doc.roundedRect(PAGE.margin, y, w, rowH + 2, 3).fill(ACCENT);
    let x = PAGE.margin + 4;
    headers.forEach((h, i) => {
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(7.5).text(h.toUpperCase(), x, y + 4, {
        width: cols[i] - 6,
        ellipsis: true,
      });
      x += cols[i];
    });
    doc.y = y + rowH + 4;
  };

  drawHeader();
  rows.forEach((row, ri) => {
    ensureSpace(doc, rowH + 4, drawHeader);
    const y = doc.y;
    if (ri % 2 === 0) doc.rect(PAGE.margin, y - 1, w, rowH).fill(SOFT);
    let x = PAGE.margin + 4;
    row.forEach((cell, i) => {
      doc.fillColor(INK).font("Helvetica").fontSize(7.5).text(cell, x, y + 2, {
        width: cols[i] - 6,
        ellipsis: true,
        lineBreak: false,
      });
      x += cols[i];
    });
    doc.y = y + rowH;
  });
  doc.moveDown(0.6);
}

function emptyNote(doc: PDFKit.PDFDocument, text: string) {
  doc.fillColor(MUTED).font("Helvetica-Oblique").fontSize(9).text(text);
  doc.moveDown(0.5);
}

function ensureSpace(doc: PDFKit.PDFDocument, need: number, onNewPage?: () => void) {
  if (doc.y + need < PAGE.height - PAGE.margin - 24) return;
  doc.addPage();
  onNewPage?.();
}

function footer(doc: PDFKit.PDFDocument, hotel: Hotel) {
  forEachBufferedPage(doc, (n, total) => {
    doc.save();
    doc
      .strokeColor(LINE)
      .lineWidth(0.7)
      .moveTo(PAGE.margin, PAGE.height - 28)
      .lineTo(PAGE.width - PAGE.margin, PAGE.height - 28)
      .stroke();
    doc.fillColor(MUTED).font("Helvetica").fontSize(8);
    doc.text(
      `${hotel.name} · Sales & audit report · ${VENDOR.line} · ${VENDOR.phoneDisplay}`,
      PAGE.margin,
      PAGE.height - 22,
      { lineBreak: false, width: PAGE.width - PAGE.margin * 2 - 90 }
    );
    doc.text(`Page ${n} of ${total}`, PAGE.width - PAGE.margin - 80, PAGE.height - 22, {
      width: 80,
      align: "right",
      lineBreak: false,
    });
    doc.restore();
  });
}
