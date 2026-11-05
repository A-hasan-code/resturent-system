import PDFDocument from "pdfkit";
import { forEachBufferedPage } from "../common/pdf-page";
import { VENDOR } from "../common/vendor";

type Hotel = { name: string; tagline: string; address: string; phone: string };

export type MenuSalesRow = {
  name: string;
  category: string;
  qty: number;
  sale: number;
  amount: number;
  purchase: number;
  tPurchase: number;
  profit: number;
};

export type MenuSalesPdfInput = {
  businessDate: string;
  dayStart: string;
  dayClose?: string;
  isToday: boolean;
  soldItems: MenuSalesRow[];
};

const INK = "#15202b";
const MUTED = "#5b6b7a";
const LINE = "#d5dde5";
const ACCENT = "#0f7a6c";
const SOFT = "#eef3f6";
const PAGE = { margin: 36, width: 595.28, height: 841.89 };

const money = (n: number) => `Rs ${Math.round(n).toLocaleString("en-PK")}`;
const qtyStr = (n: number) =>
  Number.isInteger(n) ? String(n) : (Math.round(n * 1000) / 1000).toFixed(3).replace(/\.?0+$/, "");
const dayLabel = (d: string) => {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};
const whenNow = () =>
  new Date().toLocaleString("en-PK", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

function ensureSpace(doc: PDFKit.PDFDocument, need: number) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + need > bottom) doc.addPage();
}

export function renderMenuSalesPdf(input: MenuSalesPdfInput, hotel: Hotel): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      bufferPages: true,
      margins: { top: PAGE.margin, bottom: PAGE.margin + 20, left: PAGE.margin, right: PAGE.margin },
      info: {
        Title: `Menu sales report ${input.businessDate}`,
        Author: hotel.name,
        Subject: "Restaurant menu product sales report",
        Creator: "PixalBotics Restaurant",
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const w = PAGE.width - PAGE.margin * 2;
    const items = input.soldItems ?? [];
    const totalQty = items.reduce((s, i) => s + i.qty, 0);
    const totalSale = items.reduce((s, i) => s + i.amount, 0);
    const totalPurchase = items.reduce((s, i) => s + i.tPurchase, 0);
    const totalProfit = items.reduce((s, i) => s + i.profit, 0);

    const catRank = (c: string) => (c === "Per Head" ? 0 : 1);
    const byCategory = new Map<string, MenuSalesRow[]>();
    for (const row of [...items].sort((a, b) => {
      const r = catRank(a.category) - catRank(b.category);
      if (r !== 0) return r;
      const c = a.category.localeCompare(b.category);
      return c !== 0 ? c : b.amount - a.amount;
    })) {
      const list = byCategory.get(row.category) ?? [];
      list.push(row);
      byCategory.set(row.category, list);
    }

    doc.fillColor(ACCENT).font("Helvetica-Bold").fontSize(16).text(hotel.name, PAGE.margin, PAGE.margin, {
      width: w,
      align: "center",
    });
    doc.fillColor(MUTED).font("Helvetica").fontSize(8.5);
    if (hotel.tagline) doc.text(hotel.tagline, { width: w, align: "center" });
    const contact = [hotel.address, hotel.phone].filter(Boolean).join(" · ");
    if (contact) doc.text(contact, { width: w, align: "center" });
    doc.moveDown(0.35);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(13).text("Restaurant Menu Product Report", {
      width: w,
      align: "center",
    });
    doc.fillColor(MUTED).font("Helvetica").fontSize(8.5);
    doc.text(`Printed: ${whenNow()}`, { width: w, align: "center" });
    doc.text(
      `Business day: ${dayLabel(input.businessDate)} · shift ${input.dayStart} → ${
        input.dayClose || "03:00"
      }${input.isToday ? " · live to now" : ""}`,
      { width: w, align: "center" }
    );
    doc.text(
      "Includes paid bills and credit sales · menu items + Per Head cover. Cancelled / open table unpaid excluded.",
      { width: w, align: "center" },
    );
    doc.moveDown(0.55);

    // Totals strip
    const kpiH = 42;
    const kpiW = w / 4;
    const kpiY = doc.y;
    const kpis = [
      { label: "Items", value: String(items.length) },
      { label: "Total Qty", value: qtyStr(Math.round(totalQty * 1000) / 1000) },
      { label: "T.Sale", value: money(totalSale) },
      { label: "Profit", value: money(totalProfit) },
    ];
    kpis.forEach((k, i) => {
      const x = PAGE.margin + i * kpiW;
      doc.rect(x, kpiY, kpiW - 4, kpiH).fill(SOFT);
      doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(k.label, x + 6, kpiY + 6, { width: kpiW - 16 });
      doc.fillColor(INK).font("Helvetica-Bold").fontSize(10).text(k.value, x + 6, kpiY + 20, { width: kpiW - 16 });
    });
    doc.y = kpiY + kpiH + 12;

    const cols = [
      { key: "name", label: "Product Title", flex: 0.34 },
      { key: "qty", label: "Qty", flex: 0.1 },
      { key: "sale", label: "Sale", flex: 0.12 },
      { key: "tSale", label: "T.Sale", flex: 0.14 },
      { key: "purchase", label: "Purchase", flex: 0.1 },
      { key: "tPurchase", label: "T.Purchase", flex: 0.1 },
      { key: "profit", label: "Profit", flex: 0.1 },
    ] as const;
    const colXs: number[] = [];
    let cx = PAGE.margin;
    for (const c of cols) {
      colXs.push(cx);
      cx += w * c.flex;
    }

    const drawHeader = () => {
      ensureSpace(doc, 22);
      const y = doc.y;
      doc.rect(PAGE.margin, y, w, 16).fill(ACCENT);
      doc.fillColor("#fff").font("Helvetica-Bold").fontSize(7.5);
      cols.forEach((c, i) => {
        doc.text(c.label, colXs[i]! + 2, y + 4, { width: w * c.flex - 4, align: i === 0 ? "left" : "right" });
      });
      doc.y = y + 18;
    };

    const drawRow = (cells: string[], opts?: { bold?: boolean; fill?: string; muted?: boolean }) => {
      ensureSpace(doc, 14);
      const y = doc.y;
      if (opts?.fill) doc.rect(PAGE.margin, y, w, 13).fill(opts.fill);
      doc
        .fillColor(opts?.muted ? MUTED : INK)
        .font(opts?.bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(7.5);
      cells.forEach((text, i) => {
        doc.text(text, colXs[i]! + 2, y + 2.5, {
          width: w * cols[i]!.flex - 4,
          align: i === 0 ? "left" : "right",
          lineBreak: false,
        });
      });
      doc
        .moveTo(PAGE.margin, y + 13)
        .lineTo(PAGE.margin + w, y + 13)
        .strokeColor(LINE)
        .lineWidth(0.4)
        .stroke();
      doc.y = y + 14;
    };

    if (!items.length) {
      doc.fillColor(MUTED).font("Helvetica").fontSize(10).text("No menu items sold for this business day.");
    } else {
      drawHeader();
      for (const [category, rows] of byCategory) {
        ensureSpace(doc, 28);
        doc.rect(PAGE.margin, doc.y, w, 14).fill("#dce8e6");
        doc
          .fillColor(ACCENT)
          .font("Helvetica-Bold")
          .fontSize(8.5)
          .text(category, PAGE.margin + 4, doc.y + 3, { width: w - 8 });
        doc.y += 16;

        let cQty = 0;
        let cSale = 0;
        let cPurchase = 0;
        let cProfit = 0;
        for (const r of rows) {
          cQty += r.qty;
          cSale += r.amount;
          cPurchase += r.tPurchase;
          cProfit += r.profit;
          drawRow([
            r.name,
            qtyStr(r.qty),
            money(r.sale),
            money(r.amount),
            money(r.purchase),
            money(r.tPurchase),
            money(r.profit),
          ]);
        }
        drawRow(
          [
            `${category} Total`,
            qtyStr(Math.round(cQty * 1000) / 1000),
            "",
            money(cSale),
            "",
            money(cPurchase),
            money(cProfit),
          ],
          { bold: true, fill: SOFT }
        );
        doc.moveDown(0.25);
      }

      ensureSpace(doc, 20);
      drawRow(
        [
          "GRAND TOTAL",
          qtyStr(Math.round(totalQty * 1000) / 1000),
          "",
          money(totalSale),
          "",
          money(totalPurchase),
          money(totalProfit),
        ],
        { bold: true, fill: "#d5ebe7" }
      );
    }

    forEachBufferedPage(doc, (pageNumber, pageCount) => {
      const y = PAGE.height - 16;
      doc
        .fontSize(7)
        .fillColor(MUTED)
        .text(`${VENDOR.name} · Menu sales`, PAGE.margin, y, { width: w / 2, lineBreak: false });
      doc.text(`Page ${pageNumber} / ${pageCount}`, PAGE.margin, y, {
        width: w,
        align: "right",
        lineBreak: false,
      });
    });

    doc.end();
  });
}
