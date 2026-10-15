import PDFDocument from "pdfkit";
import { forEachBufferedPage } from "../common/pdf-page";
import { VENDOR } from "../common/vendor";

type Hotel = { name: string; tagline: string; address: string; phone: string };

export type KitchenClosePdfSheet = {
  businessDate: string;
  station: string;
  stationName: string;
  dayStart: string;
  saved: boolean;
  closedByName: string | null;
  closedAt: string | null;
  sales: number;
  stockUsedValue: number;
  transferredValue: number;
  profit: number;
  items: {
    name: string;
    category: string;
    unit: string;
    kitchenOnHand: number;
    transferredQty: number;
    autoQty: number;
    extraQty: number;
    variance: number;
    reason: string;
    value: number;
  }[];
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
const qty = (n: number) =>
  Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-PK", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export function renderKitchenClosePdf(sheet: KitchenClosePdfSheet, hotel: Hotel): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      bufferPages: true,
      margins: { top: PAGE.margin, bottom: PAGE.margin + 18, left: PAGE.margin, right: PAGE.margin },
      info: {
        Title: `Kitchen closing ${sheet.businessDate} · ${sheet.stationName}`,
        Author: hotel.name,
        Subject: "Kitchen station day closing",
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
    doc.font("Helvetica-Bold").fontSize(14).fillColor("#ffffff").text("KITCHEN CLOSING", PAGE.margin, 84, { width: w });
    doc.restore();

    doc.y = 126;
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(16).text(sheet.stationName, { width: w });
    doc.moveDown(0.2);
    doc.fillColor(MUTED).font("Helvetica").fontSize(9);
    doc.text(`Business day: ${dayLabel(sheet.businessDate)}  ·  Day start ${sheet.dayStart}`, { width: w });
    doc.text(
      [
        sheet.saved ? "Status: Saved" : "Status: Draft / not saved",
        sheet.closedByName ? `Closed by ${sheet.closedByName}` : null,
        sheet.closedAt ? when(String(sheet.closedAt)) : null,
      ]
        .filter(Boolean)
        .join("  ·  "),
      { width: w }
    );
    doc.moveDown(0.3);
    doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(`Generated ${new Date().toLocaleString("en-PK")}`);
    doc.moveDown(0.5);
    doc.strokeColor(LINE).lineWidth(1).moveTo(PAGE.margin, doc.y).lineTo(PAGE.margin + w, doc.y).stroke();
    doc.moveDown(0.7);

    kpiRow(doc, w, [
      { label: "Transferred", value: money(sheet.transferredValue), note: `${sheet.items.length} items` },
      { label: "Stock used", value: money(sheet.stockUsedValue), note: "Recipes + extra" },
      { label: "Sales", value: money(sheet.sales), note: "Paid bills (day)" },
      { label: "Food margin", value: money(sheet.profit), note: "Sales − used" },
    ]);

    sectionTitle(doc, "Station stock", "Transfers today, on-hand leftover, or recipe use");
    table(
      doc,
      w,
      ["Item", "Issued", "Recipe", "Extra", "Left", "Value"],
      sheet.items.map((i) => [
        `${i.name}${i.reason ? ` (${i.reason})` : ""}`,
        `${qty(i.transferredQty)} ${i.unit}`,
        `${qty(i.autoQty)} ${i.unit}`,
        `${qty(i.extraQty)} ${i.unit}`,
        `${qty(i.variance)} ${i.unit}`,
        money(i.value),
      ]),
      [0.28, 0.14, 0.14, 0.12, 0.14, 0.18]
    );

    footer(doc, hotel, sheet.stationName, sheet.businessDate);
    doc.end();
  });
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
    doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(c.label.toUpperCase(), x + 8, y + 10, {
      width: cardW - 16,
    });
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(11).text(c.value, x + 8, y + 26, {
      width: cardW - 16,
    });
    doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(c.note, x + 8, y + 44, {
      width: cardW - 16,
    });
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
    doc.fillColor(MUTED).font("Helvetica-Oblique").fontSize(9).text("No transfers to this station today.");
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
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(7).text(h.toUpperCase(), x, y + 4, {
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
      doc.fillColor(INK).font("Helvetica").fontSize(7).text(cell, x, y + 2, {
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

function footer(doc: PDFKit.PDFDocument, hotel: Hotel, stationName: string, businessDate: string) {
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
      `${hotel.name} · Kitchen ${stationName} · ${dayLabel(businessDate)} · ${VENDOR.line}`,
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
