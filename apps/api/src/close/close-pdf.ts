import PDFDocument from "pdfkit";
import { forEachBufferedPage } from "../common/pdf-page";
import { VENDOR } from "../common/vendor";

type Hotel = { name: string; tagline: string; address: string; phone: string };

export type ClosePdfSheet = {
  businessDate: string;
  dayStart: string;
  locked: boolean;
  frozen: boolean;
  saved: boolean;
  note: string;
  closedByName: string | null;
  closedAt: string | null;
  counters: {
    kind: string;
    label: string;
    cashSales: number;
    walkInCash?: number;
    creditCash?: number;
    tipTotal: number;
    expectedCash: number;
    collectedCash: number;
    missCash: number;
    surplusCash: number;
    missReason: string;
    billCount: number;
    paymentCount: number;
    creditBillCount?: number;
    creditPaymentCount?: number;
  }[];
  soldItems: { name: string; qty: number; amount: number }[];
  specialsClose?: {
    businessDate: string;
    closedByName: string | null;
    lines: {
      name: string;
      systemRemainingGrams: number;
      countedRemainingGrams: number;
      carryGrams: number;
      wasteGrams: number;
      lossCost: number;
      wasteNote: string | null;
    }[];
    wasteGrams: number;
    carryGrams: number;
    lossCost: number;
  } | null;
  pendingBills: {
    orderNo: number;
    tableNo: string | null;
    balance: number;
    paymentStatus: string;
    isCredit?: boolean;
    creditCustomerName?: string | null;
  }[];
  creditTodayBills?: {
    orderNo: number;
    tableNo: string | null;
    amount: number;
    paymentStatus: string;
    creditCustomerName?: string | null;
  }[];
  creditPaidBills?: {
    orderNo: number;
    tableNo: string | null;
    amount: number;
    creditCustomerName?: string | null;
    cashier?: string | null;
    createdAt: string;
  }[];
  creditUnpaidBills?: {
    orderNo: number;
    tableNo: string | null;
    balance: number;
    paymentStatus: string;
    isCredit?: boolean;
    creditCustomerName?: string | null;
  }[];
  totals: {
    cashSales: number;
    tipTotal: number;
    openingFloat: number;
    expectedCash: number;
    collectedCash: number;
    missCash: number;
    surplusCash: number;
    cardTotal: number;
    walletTotal: number;
    bankTotal: number;
    pendingAmount: number;
    pendingCount: number;
    paidBillsCount: number;
    totalSale: number;
    hotelExpenses: number;
    supplierPaid: number;
    selfExtra: number;
    cashOutTotal: number;
    creditTodayAmount?: number;
    creditTodayCount?: number;
    creditPaidAmount?: number;
    creditPaidCount?: number;
    creditUnpaidAmount: number;
    creditUnpaidCount?: number;
    drawerFormula: string;
  };
};

const INK = "#15202b";
const MUTED = "#5b6b7a";
const LINE = "#d5dde5";
const ACCENT = "#0f7a6c";
const DANGER = "#c0392b";
const SOFT = "#eef3f6";
const PAGE = { margin: 42, width: 595.28, height: 841.89 };

const money = (n: number) => `Rs ${Math.round(n).toLocaleString("en-PK")}`;
const dayLabel = (d: string) => {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-PK", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export function renderClosePdf(sheet: ClosePdfSheet, hotel: Hotel): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      bufferPages: true,
      margins: { top: PAGE.margin, bottom: PAGE.margin + 18, left: PAGE.margin, right: PAGE.margin },
      info: {
        Title: `Close report ${sheet.businessDate}`,
        Author: hotel.name,
        Subject: "Day cash close report",
        Creator: "PixalBotics Restaurant",
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const w = PAGE.width - PAGE.margin * 2;
    const t = sheet.totals;

    doc.fillColor(ACCENT).font("Helvetica-Bold").fontSize(18).text(hotel.name, PAGE.margin, PAGE.margin);
    doc.fillColor(MUTED).font("Helvetica").fontSize(9);
    if (hotel.tagline) doc.text(hotel.tagline);
    const contact = [hotel.address, hotel.phone].filter(Boolean).join(" · ");
    if (contact) doc.text(contact);
    doc.moveDown(0.4);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(14).text(`Close report · ${dayLabel(sheet.businessDate)}`);
    doc.fillColor(MUTED).font("Helvetica").fontSize(8.5);
    const flags = [
      sheet.saved ? "Saved" : "Live preview",
      sheet.locked ? "Day locked" : null,
      sheet.frozen ? "Frozen snapshot" : null,
      `Business day from ${sheet.dayStart}`,
    ].filter(Boolean);
    doc.text(flags.join(" · "));
    if (sheet.closedByName) {
      doc.text(`Closed by ${sheet.closedByName}${sheet.closedAt ? ` · ${when(sheet.closedAt)}` : ""}`);
    }
    if (sheet.note) doc.text(`Note: ${sheet.note}`);
    doc.moveDown(0.6);

    kpi(doc, w, [
      { label: "Total sale", value: money(t.totalSale), note: `${t.paidBillsCount} paid bills` },
      { label: "Expected cash", value: money(t.expectedCash), note: t.drawerFormula },
      { label: "Collected", value: money(t.collectedCash), note: "Counted drawer" },
      {
        label: t.missCash > 0 ? "Miss" : "Surplus",
        value: money(t.missCash > 0 ? t.missCash : t.surplusCash),
        note: t.missCash > 0 ? "Short vs expected" : "Over expected",
      },
    ]);
    kpi(doc, w, [
      { label: "Opening float", value: money(t.openingFloat), note: "Start of day" },
      { label: "Cash sales", value: money(t.cashSales), note: "Drawer tenders" },
      { label: "Tips", value: money(t.tipTotal), note: "In drawer" },
      { label: "Cash out", value: money(t.cashOutTotal), note: "Hotel + supplier + self" },
    ]);
    kpi(doc, w, [
      { label: "Card", value: money(t.cardTotal), note: "Not in drawer" },
      { label: "Wallet", value: money(t.walletTotal), note: "Not in drawer" },
      { label: "Bank", value: money(t.bankTotal), note: "Not in drawer" },
      {
        label: "Table pending",
        value: money(t.pendingAmount),
        note: `${t.pendingCount} open tables`,
      },
    ]);

    section(doc, "Cash counters", "Expected = walk-in cash + credit cash + tips (+ float − cash out on C1)");
    table(
      doc,
      w,
      ["Counter", "Walk-in", "Credit", "Tips", "Expected", "Miss"],
      sheet.counters.map((c) => [
        c.label,
        money(c.walkInCash ?? c.cashSales),
        money(c.creditCash ?? 0),
        money(c.tipTotal),
        money(c.expectedCash),
        money(c.missCash),
      ]),
      [0.22, 0.16, 0.14, 0.12, 0.18, 0.18]
    );
    for (const c of sheet.counters) {
      if (c.missCash > 0 && c.missReason) {
        doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(`${c.label} miss reason: ${c.missReason}`);
      }
      if ((c.creditCash ?? 0) > 0) {
        doc
          .fillColor(MUTED)
          .font("Helvetica")
          .fontSize(8)
          .text(
            `${c.label} credit collections: ${money(c.creditCash ?? 0)} · ${c.creditPaymentCount ?? 0} payments (in drawer, listed separately from walk-in)`
          );
      }
    }

    section(doc, "Cash-out breakdown", "Taken from main counter drawer");
    table(
      doc,
      w,
      ["Kind", "Amount"],
      [
        ["Hotel expenses", money(t.hotelExpenses)],
        ["Supplier payments", money(t.supplierPaid)],
        ["Self-paid extras", money(t.selfExtra)],
        ["Total cash out", money(t.cashOutTotal)],
      ],
      [0.7, 0.3]
    );

    section(doc, "Items sold", "Paid bills only");
    table(
      doc,
      w,
      ["Item", "Qty", "Amount"],
      sheet.soldItems.slice(0, 40).map((i) => [i.name, String(i.qty), money(i.amount)]),
      [0.55, 0.15, 0.3]
    );
    if (sheet.soldItems.length > 40) {
      doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(`… and ${sheet.soldItems.length - 40} more items`);
    }

    if (sheet.specialsClose?.lines?.length) {
      const sc = sheet.specialsClose;
      section(doc, "Daily specials leftover", "Carry to tomorrow · waste / shrink loss");
      table(
        doc,
        w,
        ["Pot", "System", "Counted", "Carry", "Waste", "Loss"],
        sc.lines.map((l) => [
          l.name,
          `${Math.round(l.systemRemainingGrams)}g`,
          `${Math.round(l.countedRemainingGrams)}g`,
          `${Math.round(l.carryGrams)}g`,
          `${Math.round(l.wasteGrams)}g`,
          money(l.lossCost),
        ]),
        [0.28, 0.12, 0.12, 0.12, 0.12, 0.24]
      );
      doc
        .fillColor(MUTED)
        .font("Helvetica")
        .fontSize(8)
        .text(
          `Carry ${Math.round(sc.carryGrams)}g · Waste ${Math.round(sc.wasteGrams)}g · Loss ${money(sc.lossCost)}${
            sc.closedByName ? ` · Closed by ${sc.closedByName}` : ""
          }`
        );
      for (const l of sc.lines) {
        if (l.wasteNote) {
          doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(`${l.name}: ${l.wasteNote}`);
        }
      }
    }

    section(doc, "Pending table bills", "Open tables only — not in expected cash");
    table(
      doc,
      w,
      ["Bill", "Table", "Balance", "Status"],
      sheet.pendingBills.slice(0, 30).map((b) => [
        `#${b.orderNo}`,
        b.tableNo || "—",
        money(b.balance),
        b.paymentStatus,
      ]),
      [0.28, 0.18, 0.24, 0.3]
    );

    section(
      doc,
      "Credit summary",
      "New today · paid today · total outstanding (not in expected cash)"
    );
    table(
      doc,
      w,
      ["Kind", "Amount", "Count"],
      [
        ["Credit today (new)", money(t.creditTodayAmount ?? 0), String(t.creditTodayCount ?? 0)],
        ["Credit paid today", money(t.creditPaidAmount ?? 0), String(t.creditPaidCount ?? 0)],
        [
          "Total credit outstanding",
          money(t.creditUnpaidAmount),
          String(t.creditUnpaidCount ?? 0),
        ],
      ],
      [0.5, 0.3, 0.2]
    );

    const creditToday = sheet.creditTodayBills ?? [];
    if (creditToday.length) {
      section(doc, "Credit bills today", "Opened / put on credit this day");
      table(
        doc,
        w,
        ["Bill", "Table", "Amount", "Customer"],
        creditToday.slice(0, 30).map((b) => [
          `#${b.orderNo}`,
          b.tableNo || "—",
          money(b.amount),
          b.creditCustomerName || "Credit",
        ]),
        [0.22, 0.18, 0.22, 0.38]
      );
    }

    const creditPaid = sheet.creditPaidBills ?? [];
    if (creditPaid.length) {
      section(doc, "Credit payments today", "Cash collected against credit");
      table(
        doc,
        w,
        ["Bill", "Amount", "Customer", "Cashier"],
        creditPaid.slice(0, 30).map((b) => [
          `#${b.orderNo}`,
          money(b.amount),
          b.creditCustomerName || "Credit",
          b.cashier || "—",
        ]),
        [0.2, 0.2, 0.35, 0.25]
      );
    }

    const creditBills = sheet.creditUnpaidBills ?? [];
    section(
      doc,
      "All credit outstanding",
      `${t.creditUnpaidCount ?? creditBills.length} receivables — not in expected cash`
    );
    table(
      doc,
      w,
      ["Bill", "Table", "Balance", "Customer"],
      creditBills.slice(0, 40).map((b) => [
        `#${b.orderNo}`,
        b.tableNo || "—",
        money(b.balance),
        b.creditCustomerName || "Credit",
      ]),
      [0.22, 0.18, 0.22, 0.38]
    );

    forEachBufferedPage(doc, (n, total) => {
      doc
        .fillColor(MUTED)
        .font("Helvetica")
        .fontSize(7)
        .text(
          `${VENDOR.line} · Close report · ${dayLabel(sheet.businessDate)} · Page ${n}/${total}`,
          PAGE.margin,
          PAGE.height - 28,
          { width: w, align: "center", lineBreak: false }
        );
    });
    doc.end();
  });
}

function kpi(
  doc: PDFKit.PDFDocument,
  w: number,
  cells: { label: string; value: string; note: string }[]
) {
  ensure(doc, 58);
  const gap = 8;
  const cellW = (w - gap * (cells.length - 1)) / cells.length;
  const y = doc.y;
  cells.forEach((c, i) => {
    const x = PAGE.margin + i * (cellW + gap);
    doc.roundedRect(x, y, cellW, 52, 4).fill(SOFT);
    doc.fillColor(MUTED).font("Helvetica").fontSize(7).text(c.label.toUpperCase(), x + 8, y + 8, {
      width: cellW - 16,
    });
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(11).text(c.value, x + 8, y + 22, {
      width: cellW - 16,
    });
    doc.fillColor(MUTED).font("Helvetica").fontSize(7).text(c.note, x + 8, y + 38, {
      width: cellW - 16,
      ellipsis: true,
    });
  });
  doc.y = y + 60;
}

function section(doc: PDFKit.PDFDocument, title: string, sub: string) {
  ensure(doc, 40);
  doc.moveDown(0.35);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(11).text(title);
  doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(sub);
  doc
    .strokeColor(LINE)
    .lineWidth(0.8)
    .moveTo(PAGE.margin, doc.y + 2)
    .lineTo(PAGE.margin + (PAGE.width - PAGE.margin * 2), doc.y + 2)
    .stroke();
  doc.moveDown(0.5);
}

function table(doc: PDFKit.PDFDocument, w: number, headers: string[], rows: string[][], weights: number[]) {
  if (!rows.length) {
    doc.fillColor(MUTED).font("Helvetica").fontSize(8).text("None.");
    doc.moveDown(0.4);
    return;
  }
  const cols = weights.map((wt) => wt * w);
  const rowH = 15;
  const header = () => {
    ensure(doc, rowH + 8);
    const y = doc.y;
    doc.roundedRect(PAGE.margin, y, w, rowH + 2, 3).fill(ACCENT);
    let x = PAGE.margin + 4;
    headers.forEach((h, i) => {
      doc.fillColor("#fff").font("Helvetica-Bold").fontSize(7.5).text(h.toUpperCase(), x, y + 4, {
        width: cols[i] - 6,
        ellipsis: true,
      });
      x += cols[i];
    });
    doc.y = y + rowH + 4;
  };
  header();
  rows.forEach((row, ri) => {
    ensure(doc, rowH + 4, header);
    const y = doc.y;
    if (ri % 2 === 0) doc.rect(PAGE.margin, y - 1, w, rowH).fill(SOFT);
    let x = PAGE.margin + 4;
    row.forEach((cell, i) => {
      doc
        .fillColor(cell.includes("Miss") || false ? DANGER : INK)
        .font("Helvetica")
        .fontSize(7.5)
        .text(cell, x, y + 2, { width: cols[i] - 6, ellipsis: true, lineBreak: false });
      x += cols[i];
    });
    doc.y = y + rowH;
  });
  doc.moveDown(0.4);
}

function ensure(doc: PDFKit.PDFDocument, need: number, onNewPage?: () => void) {
  if (doc.y + need < PAGE.height - PAGE.margin - 20) return;
  doc.addPage();
  onNewPage?.();
}
