import PDFDocument from "pdfkit";
import { forEachBufferedPage } from "../common/pdf-page";
import { VENDOR } from "../common/vendor";

type Hotel = { name: string; tagline: string; address: string; phone: string };

export type SupplierLedgerPdf = {
  id: string;
  name: string;
  phone: string | null;
  supplyOf: string | null;
  brand: string | null;
  address: string | null;
  notes: string | null;
  purchased: number;
  paid: number;
  outstanding: number;
  purchases: {
    id: string;
    purchasedOn: string;
    payKind: string;
    total: number;
    extraExpense: number;
    extraExpenseNote: string | null;
    extraExpensePaidBy: string | null;
    paidAmount: number;
    balance: number;
    note: string | null;
    hasBillImage: boolean;
    lines: {
      item: string;
      category: string;
      unit: string;
      quantity: number;
      ratePerUnit: number;
      amount: number;
    }[];
  }[];
  payments: { paidOn: string; amount: number; note: string | null }[];
};

const INK = "#15202b";
const MUTED = "#5b6b7a";
const LINE = "#d5dde5";
const ACCENT = "#0f7a6c";
const SOFT = "#eef3f6";
const PAGE = { margin: 42, width: 595.28, height: 841.89 };

const money = (n: number) => `Rs ${Math.round(n).toLocaleString("en-PK")}`;
const dayLabel = (d: string) => {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};

export function renderSupplierLedgerPdf(ledger: SupplierLedgerPdf, hotel: Hotel): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      bufferPages: true,
      margins: { top: PAGE.margin, bottom: PAGE.margin + 18, left: PAGE.margin, right: PAGE.margin },
      info: {
        Title: `Supplier ledger — ${ledger.name}`,
        Author: hotel.name,
        Subject: "Supplier account / purchase record",
        Creator: "PixalBotics Restaurant",
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const w = PAGE.width - PAGE.margin * 2;

    doc.save();
    doc.rect(0, 0, PAGE.width, 108).fill(ACCENT);
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(20).text(hotel.name, PAGE.margin, 24, { width: w });
    doc.font("Helvetica").fontSize(9).fillColor("#d7f3ee");
    if (hotel.tagline) doc.text(hotel.tagline, PAGE.margin, 50, { width: w });
    const meta = [hotel.address, hotel.phone ? `Tel ${hotel.phone}` : ""].filter(Boolean).join("  ·  ");
    if (meta) doc.text(meta, PAGE.margin, 64, { width: w });
    doc.font("Helvetica-Bold").fontSize(14).fillColor("#ffffff").text("SUPPLIER ACCOUNT", PAGE.margin, 84, { width: w });
    doc.restore();

    doc.y = 126;
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(16).text(ledger.name, { width: w });
    doc.moveDown(0.25);
    doc.fillColor(MUTED).font("Helvetica").fontSize(9);
    const details = [
      ledger.phone ? `Phone: ${ledger.phone}` : null,
      ledger.supplyOf ? `Supplies: ${ledger.supplyOf}` : null,
      ledger.brand ? `Brand: ${ledger.brand}` : null,
      ledger.address ? `Address: ${ledger.address}` : null,
    ].filter(Boolean) as string[];
    for (const line of details) doc.text(line, { width: w });
    if (ledger.notes) doc.text(`Notes: ${ledger.notes}`, { width: w });
    doc.moveDown(0.35);
    doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(`Generated ${new Date().toLocaleString("en-PK")}`);
    doc.moveDown(0.5);
    doc.strokeColor(LINE).lineWidth(1).moveTo(PAGE.margin, doc.y).lineTo(PAGE.margin + w, doc.y).stroke();
    doc.moveDown(0.7);

    kpiRow(doc, w, [
      { label: "Total on supplier", value: money(ledger.purchased), note: `${ledger.purchases.length} bills` },
      { label: "Paid", value: money(ledger.paid), note: `${ledger.payments.length} payments` },
      { label: "Still to pay", value: money(ledger.outstanding), note: ledger.outstanding > 0.009 ? "Open balance" : "Cleared" },
    ]);

    sectionTitle(doc, "1. Bills", "Each purchase and what is left on that bill");
    table(
      doc,
      w,
      ["Date", "Pay", "Inventory", "Extra", "Bill total", "Paid", "Left"],
      ledger.purchases.map((p) => {
        const supplierExtra = p.extraExpensePaidBy === "SUPPLIER" ? p.extraExpense : 0;
        const billTotal = p.total + supplierExtra;
        return [
          dayLabel(p.purchasedOn),
          p.payKind === "CASH" ? "Cash" : "Credit",
          money(p.total),
          p.extraExpense > 0 ? money(p.extraExpense) : "—",
          money(billTotal),
          money(p.paidAmount),
          money(p.balance),
        ];
      }),
      [0.12, 0.1, 0.14, 0.12, 0.14, 0.14, 0.14]
    );

    for (const p of ledger.purchases) {
      if (!p.lines.length) continue;
      ensureSpace(doc, 56);
      doc.fillColor(INK).font("Helvetica-Bold").fontSize(9).text(`${dayLabel(p.purchasedOn)} — line items`);
      if (p.note) doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(`Note: ${p.note}`);
      if (p.extraExpense > 0) {
        const who = p.extraExpensePaidBy === "SELF" ? "self paid" : "on supplier";
        doc
          .fillColor(MUTED)
          .font("Helvetica")
          .fontSize(8)
          .text(`Extra: ${money(p.extraExpense)} (${who})${p.extraExpenseNote ? ` · ${p.extraExpenseNote}` : ""}`);
      }
      table(
        doc,
        w,
        ["Item", "Category", "Qty", "Rate", "Amount"],
        p.lines.map((l) => [
          l.item,
          l.category,
          `${trimNum(l.quantity)} ${l.unit.toLowerCase()}`,
          money(l.ratePerUnit),
          money(l.amount),
        ]),
        [0.32, 0.2, 0.16, 0.16, 0.16]
      );
    }

    ensureSpace(doc, 80);
    sectionTitle(doc, "2. Payments", "Cash paid against this supplier account");
    table(
      doc,
      w,
      ["Date", "Amount", "Note"],
      ledger.payments.map((p) => [dayLabel(p.paidOn), money(p.amount), p.note || "—"]),
      [0.2, 0.25, 0.55]
    );

    footer(doc, hotel, ledger.name);
    doc.end();
  });
}

function trimNum(n: number) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

function kpiRow(doc: PDFKit.PDFDocument, w: number, cards: { label: string; value: string; note: string }[]) {
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

function table(doc: PDFKit.PDFDocument, w: number, headers: string[], rows: string[][], weights: number[]) {
  if (!rows.length) {
    doc.fillColor(MUTED).font("Helvetica-Oblique").fontSize(9).text("None yet.");
    doc.moveDown(0.5);
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

function ensureSpace(doc: PDFKit.PDFDocument, need: number, onNewPage?: () => void) {
  if (doc.y + need < PAGE.height - PAGE.margin - 24) return;
  doc.addPage();
  onNewPage?.();
}

function footer(doc: PDFKit.PDFDocument, hotel: Hotel, supplierName: string) {
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
      `${hotel.name} · ${supplierName} · ${VENDOR.line} · ${VENDOR.phoneDisplay}`,
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
