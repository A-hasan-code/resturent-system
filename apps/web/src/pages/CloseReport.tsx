import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, downloadApi, formatKg, gramsToKg, kgToGrams, money } from "../api";
import { useAuth } from "../auth";
import { DateField } from "../components/DateField";
import { OtherPrintButton } from "../components/OtherPrintButton";
import { useShiftOpen } from "../hotel-gate";
import { useT } from "../i18n";
import { useToast } from "../toast";
import { Pagination, paginate } from "../components/Pagination";

const PAGE_SIZE = 15;

type CounterKind = "COUNTER_1" | "COUNTER_2";

type PaymentRow = {
  id: string;
  amount: number;
  tipAmount: number;
  createdAt: string;
  confirmedAt: string | null;
  orderNo: number;
  tableNo: string | null;
  orderTotal: number;
  isCredit?: boolean;
  creditCustomerName?: string | null;
  collectedBy: { id: string; name: string; roleCode: string };
  handedTo: { id: string; name: string; roleCode: string } | null;
  drawerName: string;
  pendingHandover: boolean;
};

type CounterBill = {
  orderId: string;
  orderNo: number;
  tableNo: string | null;
  orderTotal: number;
  paidOnCounter: number;
  isCredit?: boolean;
  creditCustomerName?: string | null;
};

type Counter = {
  kind: CounterKind;
  label: string;
  roleCode: string;
  cashiers: { id: string; name: string }[];
  cashSales?: number;
  /** Walk-in / table cash only (excludes credit settlements). */
  walkInCash?: number;
  /** Credit account collections on this drawer. */
  creditCash?: number;
  expectedCash: number;
  collectedCash: number;
  missCash: number;
  surplusCash?: number;
  missReason: string;
  billCount: number;
  creditBillCount?: number;
  paymentCount: number;
  creditPaymentCount?: number;
  tipTotal: number;
  pendingHandoverCash: number;
  payments: PaymentRow[];
  bills: CounterBill[];
  creditPayments?: PaymentRow[];
  creditBills?: CounterBill[];
};

type Sheet = {
  businessDate: string;
  today: string;
  isToday: boolean;
  dayStart: string;
  canEdit?: boolean;
  /** Admin may edit unlocked past days. */
  adminPastEdit?: boolean;
  canAdminEditPast?: boolean;
  locked?: boolean;
  frozen?: boolean;
  saved: boolean;
  closeId: string | null;
  note: string;
  closedByName: string | null;
  closedAt: string | null;
  counters: Counter[];
  soldItems: { name: string; qty: number; amount: number }[];
  pendingBills: {
    orderNo: number;
    tableNo: string | null;
    total: number;
    paidAmount: number;
    balance: number;
    paymentStatus: string;
    isCredit?: boolean;
    creditCustomerName?: string | null;
    cashier: string | null;
  }[];
  /** Credit invoices opened this business day. */
  creditTodayBills?: {
    orderNo: number;
    tableNo: string | null;
    total: number;
    amount: number;
    paidAmount: number;
    balance: number;
    paymentStatus: string;
    creditCustomerName?: string | null;
    cashier: string | null;
    createdAt: string;
  }[];
  /** Cash collected today against credit accounts. */
  creditPaidBills?: {
    id: string;
    orderNo: number;
    tableNo: string | null;
    amount: number;
    creditCustomerName?: string | null;
    cashier: string | null;
    createdAt: string;
  }[];
  /** Open credit receivables (any day) — not included in expected cash. */
  creditUnpaidBills?: {
    orderNo: number;
    tableNo: string | null;
    total: number;
    paidAmount: number;
    balance: number;
    paymentStatus: string;
    isCredit?: boolean;
    creditCustomerName?: string | null;
    cashier: string | null;
    createdAt?: string;
  }[];
  paidBills: {
    orderNo: number;
    tableNo: string | null;
    total: number;
    tipAmount: number;
    isCredit?: boolean;
    creditCustomerName?: string | null;
    cashier: string | null;
    createdAt: string;
  }[];
  totals: {
    cashSales?: number;
    tipTotal?: number;
    openingFloat?: number;
    expectedCash: number;
    collectedCash: number;
    missCash: number;
    surplusCash?: number;
    cardTotal?: number;
    walletTotal?: number;
    bankTotal?: number;
    pendingAmount: number;
    pendingCount: number;
    paidBillsCount: number;
    paidSalesTotal: number;
    totalSale: number;
    cashPlusPending: number;
    creditTodayAmount?: number;
    creditTodayCount?: number;
    creditPaidAmount?: number;
    creditPaidCount?: number;
    creditUnpaidAmount?: number;
    creditUnpaidCount?: number;
    hotelExpenses?: number;
    hotelExpenseCount?: number;
    supplierPaid?: number;
    supplierPaymentCount?: number;
    selfExtra?: number;
    cashOutTotal?: number;
    drawerFormula?: string;
  };
};

type HistoryRow = {
  id: string;
  businessDate: string;
  expectedCash: number;
  collectedCash: number;
  missCash: number;
  pendingAmount: number;
  pendingCount: number;
  paidBillsCount: number;
  totalSale: number;
  closedByName: string | null;
  closedAt: string;
  counters: { kind: CounterKind; label: string; expectedCash: number; collectedCash: number; missCash: number }[];
};

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" });

function CreditMark({
  isCredit,
  name,
  label,
}: {
  isCredit?: boolean;
  name?: string | null;
  label: string;
}) {
  if (!isCredit) return null;
  return (
    <span className="badge credit" title={name || label}>
      {label}
      {name ? ` · ${name}` : ""}
    </span>
  );
}

function CloseBars({
  c1,
  c2,
  pending,
  miss,
}: {
  c1: number;
  c2: number;
  pending: number;
  miss: number;
}) {
  const t = useT();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(420);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const sync = () => setWidth(Math.max(el.clientWidth, 240));
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const items = [
    { key: "c1", label: t("close.counter1Short"), value: c1, color: "var(--accent, #0f7a6c)" },
    { key: "c2", label: t("close.counter2Short"), value: c2, color: "#2a6f97" },
    { key: "pending", label: t("close.pendingShort"), value: pending, color: "#b08900" },
    { key: "miss", label: t("close.missShort"), value: miss, color: "#b42318" },
  ];
  const max = Math.max(1, ...items.map((i) => i.value));
  const chartH = 140;
  const padX = 24;
  const slot = (width - padX * 2) / items.length;

  return (
    <div className="audit-chart" ref={wrapRef}>
      <svg width="100%" height={180} viewBox={`0 0 ${width} 180`} preserveAspectRatio="xMidYMid meet" role="img">
        {items.map((it, i) => {
          const h = (it.value / max) * chartH;
          const cx = padX + i * slot + slot / 2;
          const barW = Math.min(36, slot * 0.45);
          return (
            <g key={it.key}>
              <rect
                x={cx - barW / 2}
                y={chartH - h}
                width={barW}
                height={Math.max(h, it.value ? 2 : 0)}
                rx={3}
                fill={it.color}
              />
              <text x={cx} y={chartH + 16} textAnchor="middle" fontSize={11} fill="currentColor">
                {it.label}
              </text>
              <text x={cx} y={chartH + 32} textAnchor="middle" fontSize={10} fill="currentColor" opacity={0.7}>
                {money(it.value)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

type BatchCloseLineDraft = {
  specialProductId: string;
  name: string;
  systemRemainingGrams: number;
  countedRemainingGrams: string;
  carryGrams: string;
  wasteGrams: string;
  wasteNote: string;
};

type BatchPreview = {
  businessDate: string;
  batchCloseDone: boolean;
  dayCashClosed?: boolean;
  locked?: boolean;
  canEditLeftover?: boolean;
  products: {
    id: string;
    name: string;
    remainingGrams: number;
    cookedGrams: number;
    soldGrams: number;
    status: string | null;
  }[];
  existingClose: {
    id: string;
    lines: {
      specialProductId: string;
      systemRemainingGrams: number;
      countedRemainingGrams: number;
      carryGrams: number;
      wasteGrams: number;
      lossCost: number;
      wasteNote: string | null;
      specialProduct: { name: string };
    }[];
  } | null;
};

function draftLinesFromPreview(bp: BatchPreview): BatchCloseLineDraft[] {
  if (bp.existingClose?.lines?.length) {
    return bp.existingClose.lines.map((l) => ({
      specialProductId: l.specialProductId,
      name: l.specialProduct.name,
      systemRemainingGrams: Number(l.systemRemainingGrams),
      countedRemainingGrams: String(gramsToKg(Number(l.countedRemainingGrams))),
      carryGrams: String(gramsToKg(Number(l.carryGrams))),
      wasteGrams: String(gramsToKg(Number(l.wasteGrams))),
      wasteNote: l.wasteNote || "",
    }));
  }
  return bp.products
    .filter((p) => p.remainingGrams > 0.0005 || (p.cookedGrams > 0 && p.status === "OPEN"))
    .map((p) => ({
      specialProductId: p.id,
      name: p.name,
      systemRemainingGrams: p.remainingGrams,
      countedRemainingGrams: String(gramsToKg(p.remainingGrams)),
      carryGrams: String(gramsToKg(p.remainingGrams)),
      wasteGrams: "0",
      wasteNote: "",
    }));
}

export function CloseReportPage() {
  const t = useT();
  const toast = useToast();
  const { can, user } = useAuth();
  const canManage = can("close.manage");
  const canUnlock = can("system.manage");
  const isAdmin = user?.roleCode === "ADMIN";
  const shiftOpen = useShiftOpen();

  const [date, setDate] = useState("");
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const [openingFloat, setOpeningFloat] = useState("0");
  const [collected, setCollected] = useState<Record<CounterKind, string>>({
    COUNTER_1: "",
    COUNTER_2: "",
  });
  const [reasons, setReasons] = useState<Record<CounterKind, string>>({
    COUNTER_1: "",
    COUNTER_2: "",
  });
  const [soldPage, setSoldPage] = useState(1);
  const [pendingPage, setPendingPage] = useState(1);
  const [creditTodayPage, setCreditTodayPage] = useState(1);
  const [creditPaidPage, setCreditPaidPage] = useState(1);
  const [creditUnpaidPage, setCreditUnpaidPage] = useState(1);
  const [paidPage, setPaidPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [counterBillsPage, setCounterBillsPage] = useState<Record<CounterKind, number>>({
    COUNTER_1: 1,
    COUNTER_2: 1,
  });
  const [counterPaymentsPage, setCounterPaymentsPage] = useState<Record<CounterKind, number>>({
    COUNTER_1: 1,
    COUNTER_2: 1,
  });
  const [counterCreditBillsPage, setCounterCreditBillsPage] = useState<Record<CounterKind, number>>({
    COUNTER_1: 1,
    COUNTER_2: 1,
  });
  const [counterCreditPaysPage, setCounterCreditPaysPage] = useState<Record<CounterKind, number>>({
    COUNTER_1: 1,
    COUNTER_2: 1,
  });
  const [batchPreview, setBatchPreview] = useState<BatchPreview | null>(null);
  const [batchLines, setBatchLines] = useState<BatchCloseLineDraft[]>([]);


  useEffect(() => {
    setSoldPage(1);
    setPendingPage(1);
    setCreditTodayPage(1);
    setCreditPaidPage(1);
    setCreditUnpaidPage(1);
    setPaidPage(1);
    setHistoryPage(1);
    setCounterBillsPage({ COUNTER_1: 1, COUNTER_2: 1 });
    setCounterPaymentsPage({ COUNTER_1: 1, COUNTER_2: 1 });
    setCounterCreditBillsPage({ COUNTER_1: 1, COUNTER_2: 1 });
    setCounterCreditPaysPage({ COUNTER_1: 1, COUNTER_2: 1 });
  }, [date, sheet?.businessDate]);

  const creditTodayBills = sheet?.creditTodayBills ?? [];
  const creditPaidBills = sheet?.creditPaidBills ?? [];
  const creditUnpaidBills = sheet?.creditUnpaidBills ?? [];

  const load = useCallback(
    async (d?: string) => {
      try {
        const q = d || date;
        const params = q ? `?date=${q}` : "";
        const data = await api<Sheet>(`/close/preview${params}`);
        setSheet(data);
        setDate(data.businessDate);
        setNote(data.note || "");
        setOpeningFloat(String(data.totals.openingFloat ?? 0));
        setEditing(false);
        const nextCollected = { COUNTER_1: "", COUNTER_2: "" } as Record<CounterKind, string>;
        const nextReasons = { COUNTER_1: "", COUNTER_2: "" } as Record<CounterKind, string>;
        for (const c of data.counters) {
          nextCollected[c.kind] = String(c.collectedCash);
          nextReasons[c.kind] = c.missReason || "";
        }
        setCollected(nextCollected);
        setReasons(nextReasons);
        try {
          const bp = await api<BatchPreview>(
            `/specials/close-preview?date=${encodeURIComponent(data.businessDate)}`
          );
          setBatchPreview(bp);
          setBatchLines(draftLinesFromPreview(bp));
        } catch {
          setBatchPreview(null);
          setBatchLines([]);
        }
      } catch (e) {
        toast.push(e instanceof Error ? e.message : t("close.loadFailed"), "err");
      }
    },
    [date, toast, t]
  );

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await api<HistoryRow[]>("/close/history?limit=90"));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void load();
    void loadHistory();
    // initial only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const liveCounters = useMemo(() => {
    if (!sheet) return [];
    const savedFloat = sheet.totals.openingFloat ?? 0;
    const typedFloatRaw = Number(openingFloat);
    const typedFloat = Number.isFinite(typedFloatRaw) ? Math.max(0, typedFloatRaw) : 0;
    const adjustFloat = editing && sheet.isToday !== false && !sheet.frozen;
    return sheet.counters.map((c) => {
      let expectedCash = c.expectedCash;
      if (adjustFloat && c.kind === "COUNTER_1") {
        expectedCash = Math.max(0, Math.round((c.expectedCash - savedFloat + typedFloat) * 100) / 100);
      }
      const typed = Number(collected[c.kind]);
      const collectedCash = Number.isFinite(typed) ? Math.max(0, typed) : 0;
      const missCash = Math.max(0, Math.round((expectedCash - collectedCash) * 100) / 100);
      const surplusCash = Math.max(0, Math.round((collectedCash - expectedCash) * 100) / 100);
      return { ...c, expectedCash, collectedCash, missCash, surplusCash, missReason: reasons[c.kind] };
    });
  }, [sheet, collected, reasons, openingFloat, editing]);

  const liveTotals = useMemo(() => {
    const expectedCash = liveCounters.reduce((s, c) => s + c.expectedCash, 0);
    const collectedCash = liveCounters.reduce((s, c) => s + c.collectedCash, 0);
    const missCash = Math.max(0, Math.round((expectedCash - collectedCash) * 100) / 100);
    const surplusCash = Math.max(0, Math.round((collectedCash - expectedCash) * 100) / 100);
    const floatRaw = Number(openingFloat);
    const float = Number.isFinite(floatRaw) ? Math.max(0, floatRaw) : sheet?.totals.openingFloat ?? 0;
    return {
      expectedCash,
      collectedCash,
      missCash,
      surplusCash,
      openingFloat: float,
      cashSales: sheet?.totals.cashSales ?? 0,
      tipTotal: sheet?.totals.tipTotal ?? 0,
      cardTotal: sheet?.totals.cardTotal ?? 0,
      walletTotal: sheet?.totals.walletTotal ?? 0,
      bankTotal: sheet?.totals.bankTotal ?? 0,
      pendingAmount: sheet?.totals.pendingAmount ?? 0,
      pendingCount: sheet?.totals.pendingCount ?? 0,
      paidBillsCount: sheet?.totals.paidBillsCount ?? 0,
      totalSale: sheet?.totals.totalSale ?? 0,
      cashPlusPending: Math.round((expectedCash + (sheet?.totals.pendingAmount ?? 0)) * 100) / 100,
      creditTodayAmount: sheet?.totals.creditTodayAmount ?? 0,
      creditTodayCount: sheet?.totals.creditTodayCount ?? 0,
      creditPaidAmount: sheet?.totals.creditPaidAmount ?? 0,
      creditPaidCount: sheet?.totals.creditPaidCount ?? 0,
      creditUnpaidAmount: sheet?.totals.creditUnpaidAmount ?? 0,
      creditUnpaidCount: sheet?.totals.creditUnpaidCount ?? 0,
      hotelExpenses: sheet?.totals.hotelExpenses ?? 0,
      hotelExpenseCount: sheet?.totals.hotelExpenseCount ?? 0,
      supplierPaid: sheet?.totals.supplierPaid ?? 0,
      supplierPaymentCount: sheet?.totals.supplierPaymentCount ?? 0,
      selfExtra: sheet?.totals.selfExtra ?? 0,
      cashOutTotal: sheet?.totals.cashOutTotal ?? 0,
      drawerFormula: sheet?.totals.drawerFormula || "float + cash sales + tips − cash out",
    };
  }, [liveCounters, sheet, openingFloat]);

  const isToday = sheet?.isToday !== false;
  const locked = !!sheet?.locked;
  const frozen = !!sheet?.frozen;
  /** Today: close.manage + shift open. Past: Admin only (after unlock if locked). */
  const canStartEdit =
    !!sheet &&
    canManage &&
    sheet.canEdit !== false &&
    !locked &&
    (isToday ? shiftOpen : isAdmin);
  const editable = canStartEdit && editing;
  /** Leftover: today for managers; past days Admin only. */
  const canEditLeftoverSection =
    !!sheet &&
    canManage &&
    !!batchPreview?.canEditLeftover &&
    !locked &&
    (isToday ? shiftOpen : isAdmin);

  function batchPayloadOrError():
    | { ok: true; lines: null | ReturnType<typeof mapBatchLine>[] }
    | { ok: false } {
    // Final leftover only after day cash close — until then always send lines with Save.
    const finalized = !!(batchPreview?.dayCashClosed && batchPreview?.existingClose);
    if (finalized || !batchLines.length) return { ok: true, lines: null };
    if (!isToday && !canEditLeftoverSection) return { ok: true, lines: null };
    const lines = batchLines.map(mapBatchLine);
    for (const l of lines) {
      if (!Number.isFinite(l.countedRemainingGrams) || l.countedRemainingGrams < 0) {
        toast.push(t("specials.closeInvalid"), "err");
        return { ok: false };
      }
      if (Math.abs(l.carryGrams + l.wasteGrams - l.countedRemainingGrams) > 50) {
        toast.push(t("specials.carryWasteMatch"), "err");
        return { ok: false };
      }
      const draft = batchLines.find((d) => d.specialProductId === l.specialProductId);
      const systemG = draft?.systemRemainingGrams ?? 0;
      const shrink = Math.max(0, systemG - l.countedRemainingGrams);
      const wasteTotal = l.wasteGrams + shrink;
      if (wasteTotal > 50 && !(l.wasteNote || "").trim()) {
        toast.push(t("specials.wasteNoteRequired", { name: draft?.name || "special" }), "err");
        return { ok: false };
      }
    }
    return { ok: true, lines };
  }

  function mapBatchLine(l: BatchCloseLineDraft) {
    return {
      specialProductId: l.specialProductId,
      countedRemainingGrams: kgToGrams(Number(l.countedRemainingGrams)),
      carryGrams: kgToGrams(Number(l.carryGrams)),
      wasteGrams: kgToGrams(Number(l.wasteGrams)),
      wasteNote: l.wasteNote.trim() || undefined,
    };
  }

  function startEdit() {
    if (!canStartEdit) return;
    setEditing(true);
  }

  function cancelEdit() {
    if (!sheet) return;
    setNote(sheet.note || "");
    setOpeningFloat(String(sheet.totals.openingFloat ?? 0));
    const nextCollected = { COUNTER_1: "", COUNTER_2: "" } as Record<CounterKind, string>;
    const nextReasons = { COUNTER_1: "", COUNTER_2: "" } as Record<CounterKind, string>;
    for (const c of sheet.counters) {
      nextCollected[c.kind] = String(c.collectedCash);
      nextReasons[c.kind] = c.missReason || "";
    }
    setCollected(nextCollected);
    setReasons(nextReasons);
    if (batchPreview && !(batchPreview.dayCashClosed && batchPreview.existingClose)) {
      setBatchLines(
        batchPreview.products
          .filter((p) => p.remainingGrams > 0.0005 || (p.cookedGrams > 0 && p.status === "OPEN"))
          .map((p) => ({
            specialProductId: p.id,
            name: p.name,
            systemRemainingGrams: p.remainingGrams,
            countedRemainingGrams: String(gramsToKg(p.remainingGrams)),
            carryGrams: String(gramsToKg(p.remainingGrams)),
            wasteGrams: "0",
            wasteNote: "",
          }))
      );
    }
    setEditing(false);
  }

  async function saveLeftoverOnly() {
    if (!sheet || !canEditLeftoverSection || !batchLines.length) return;
    const batch = batchPayloadOrError();
    if (!batch.ok || !batch.lines?.length) return;
    setBusy(true);
    try {
      await api("/specials/close", {
        method: "POST",
        body: JSON.stringify({
          lines: batch.lines,
          businessDate: sheet.businessDate,
        }),
      });
      toast.push(t("close.savedWithSpecials"), "ok");
      await load(sheet.businessDate);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("common.failed"), "err");
    } finally {
      setBusy(false);
    }
  }

  async function reopenLeftover() {
    if (!sheet || !canEditLeftoverSection) return;
    setBusy(true);
    try {
      await api("/specials/reopen-today", {
        method: "POST",
        body: JSON.stringify({ businessDate: sheet.businessDate }),
      });
      toast.push(t("specials.reopenCloseOk"), "ok");
      await load(sheet.businessDate);
      setEditing(true);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("specials.reopenCloseFailed"), "err");
    } finally {
      setBusy(false);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!sheet || !editable) return;
    if (!isToday && !isAdmin) return;
    const batch = batchPayloadOrError();
    if (!batch.ok) return;
    setBusy(true);
    try {
      if (batch.lines?.length) {
        await api("/specials/close", {
          method: "POST",
          body: JSON.stringify({
            lines: batch.lines,
            businessDate: sheet.businessDate,
          }),
        });
      }
      const body = {
        businessDate: sheet.businessDate,
        note: note.trim() || undefined,
        openingFloat: liveTotals.openingFloat,
        counters: liveCounters.map((c) => ({
          kind: c.kind,
          collectedCash: c.collectedCash,
          missReason: c.missReason.trim() || undefined,
        })),
      };
      const data = await api<Sheet>("/close", { method: "POST", body: JSON.stringify(body) });
      setSheet(data);
      setNote(data.note || "");
      setEditing(false);
      toast.push(
        batch.lines?.length ? t("close.savedWithSpecials") : t("close.saved"),
        "ok"
      );
      await load(date);
      await loadHistory();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("common.failed"), "err");
    } finally {
      setBusy(false);
    }
  }

  async function downloadPdf() {
    if (!sheet) return;
    setPdfBusy(true);
    try {
      await downloadApi(`/close/export?date=${sheet.businessDate}`, `close-${sheet.businessDate}.pdf`);
      toast.push(t("close.pdfOk"), "ok");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("common.failed"), "err");
    } finally {
      setPdfBusy(false);
    }
  }

  async function unlockDay() {
    if (!sheet) return;
    setBusy(true);
    try {
      await api("/finance/unlock-day", {
        method: "POST",
        body: JSON.stringify({ businessDate: sheet.businessDate }),
      });
      toast.push(t("finance.unlocked"), "ok");
      await load(sheet.businessDate);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("common.failed"), "err");
    } finally {
      setBusy(false);
    }
  }

  const c1 = liveCounters.find((c) => c.kind === "COUNTER_1");
  const c2 = liveCounters.find((c) => c.kind === "COUNTER_2");

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t("close.title")}</h1>
          <p className="page-head-meta">{t("close.hint")}</p>
          {!shiftOpen && <p className="page-head-meta tiny muted">{t("hotel.shiftEnded")}</p>}
          {sheet && (
            <p className="page-head-meta tiny">
              <span>{t("close.dayWindow", { start: sheet.dayStart })}</span>
              <span>{isToday ? t("close.todayBadge") : t("close.viewOnlyBadge")}</span>
              {locked ? <span className="badge pending">{t("close.lockedBadge")}</span> : null}
              {frozen ? <span className="badge">{t("close.frozenBadge")}</span> : null}
              <span>
                {sheet.saved
                  ? t("close.savedBy", {
                      name: sheet.closedByName || "—",
                      when: sheet.closedAt ? clock(sheet.closedAt) : "",
                    })
                  : t("close.notSaved")}
              </span>
            </p>
          )}
        </div>
        <div className="row page-head-actions">
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="close-date">{t("close.date")}</label>
            <DateField
              id="close-date"
              value={date}
              max={sheet?.today}
              onChange={(v) => {
                setDate(v);
                void load(v);
              }}
            />
          </div>
          <button type="button" className="btn ghost sm page-head-btn" onClick={() => void load(sheet?.today)}>
            {t("close.today")}
          </button>
          <button
            type="button"
            className="btn ghost sm page-head-btn"
            disabled={!sheet || pdfBusy}
            onClick={() => void downloadPdf()}
          >
            {pdfBusy ? t("common.loading") : t("close.pdf")}
          </button>
          {sheet && (
            <OtherPrintButton
              path={`/close/print?date=${encodeURIComponent(sheet.businessDate)}`}
              className="btn ghost sm page-head-btn"
              disabled={pdfBusy}
            />
          )}
          {locked && canUnlock && (
            <button type="button" className="btn sm page-head-btn" disabled={busy} onClick={() => void unlockDay()}>
              {t("finance.unlock")}
            </button>
          )}
        </div>
      </div>

      {!isToday && sheet && !isAdmin && (
        <div className="panel panel-pad alert-stale banner-row">
          <p style={{ margin: 0 }}>
            {frozen ? t("close.frozenHint") : t("close.pastReadOnly")}
          </p>
          <button type="button" className="btn ok sm" onClick={() => void load(sheet.today)}>
            {t("close.today")}
          </button>
        </div>
      )}

      {!isToday && sheet && isAdmin && locked && (
        <div className="panel panel-pad alert-stale banner-row">
          <p style={{ margin: 0 }}>{t("close.pastLockedAdmin")}</p>
          {canUnlock ? (
            <button type="button" className="btn sm" disabled={busy} onClick={() => void unlockDay()}>
              {t("finance.unlock")}
            </button>
          ) : null}
        </div>
      )}

      {!isToday && sheet && isAdmin && !locked && (
        <div className="panel panel-pad banner-row" style={{ borderColor: "var(--accent)" }}>
          <p style={{ margin: 0 }}>{t("close.pastAdminEditHint")}</p>
          <button type="button" className="btn ok sm" onClick={() => void load(sheet.today)}>
            {t("close.today")}
          </button>
        </div>
      )}

      {isToday && locked && (
        <div className="panel panel-pad alert-stale banner-row">
          <p style={{ margin: 0 }}>{t("close.lockedHint")}</p>
          {canUnlock ? (
            <button type="button" className="btn sm" disabled={busy} onClick={() => void unlockDay()}>
              {t("finance.unlock")}
            </button>
          ) : null}
        </div>
      )}

      {canStartEdit && !editing && (
        <div className="handover-confirm banner-row">
          <p style={{ margin: 0 }}>
            {isToday
              ? sheet?.saved
                ? t("close.todaySavedHint")
                : t("close.todayEnterHint")
              : t("close.pastAdminEditHint")}
          </p>
          <button type="button" className="btn" onClick={startEdit}>
            {isToday
              ? sheet?.saved
                ? t("close.editToday")
                : t("close.enterToday")
              : t("close.editPastAdmin")}
          </button>
        </div>
      )}

      <div className="stats">
        <div className="panel stat">
          <span>{t("close.totalSale")}</span>
          <strong>{money(liveTotals.totalSale)}</strong>
          <span className="tiny">{t("close.paidBillsN", { n: liveTotals.paidBillsCount })}</span>
        </div>
        <div className="panel stat">
          <span>{t("close.openingFloat")}</span>
          <strong>{money(liveTotals.openingFloat)}</strong>
          <span className="tiny">{t("close.drawerFormula")}</span>
        </div>
        <div className="panel stat">
          <span>{t("close.expectedCash")}</span>
          <strong>{money(liveTotals.expectedCash)}</strong>
          <span className="tiny">{t("close.bothCounters")}</span>
        </div>
        <div className="panel stat">
          <span>{t("close.collectedCash")}</span>
          <strong>{money(liveTotals.collectedCash)}</strong>
        </div>
        <div className={`panel stat ${liveTotals.missCash > 0 ? "alert-low" : ""}`}>
          <span>{t("close.missCash")}</span>
          <strong>{money(liveTotals.missCash)}</strong>
        </div>
        <div className={`panel stat ${liveTotals.surplusCash > 0 ? "" : ""}`}>
          <span>{t("close.surplusCash")}</span>
          <strong>{money(liveTotals.surplusCash)}</strong>
        </div>
        <div className="panel stat">
          <span>{t("close.pendingBills")}</span>
          <strong>{money(liveTotals.pendingAmount)}</strong>
          <span className="tiny">{t("close.pendingN", { n: liveTotals.pendingCount })}</span>
        </div>
        <div className="panel stat">
          <span>{t("close.hotelExpenses")}</span>
          <strong>{money(liveTotals.hotelExpenses)}</strong>
          <span className="tiny">{t("close.hotelExpensesN", { n: liveTotals.hotelExpenseCount })}</span>
        </div>
        <div className="panel stat">
          <span>{t("close.supplierPaid")}</span>
          <strong>{money(liveTotals.supplierPaid)}</strong>
          <span className="tiny">{t("close.supplierPaidN", { n: liveTotals.supplierPaymentCount })}</span>
        </div>
        <div className="panel stat">
          <span>{t("close.selfExtra")}</span>
          <strong>{money(liveTotals.selfExtra)}</strong>
        </div>
        <div className={`panel stat ${liveTotals.cashOutTotal > 0 ? "alert-low" : ""}`}>
          <span>{t("close.cashOutTotal")}</span>
          <strong>{money(liveTotals.cashOutTotal)}</strong>
          <span className="tiny">{t("close.cashOutHint")}</span>
        </div>
      </div>

      <h3 style={{ margin: "0.85rem 0 0.5rem" }}>{t("close.creditSectionTitle")}</h3>
      <p className="tiny muted" style={{ margin: "0 0 0.5rem" }}>
        {t("close.creditSectionHint")}
      </p>
      <div className="stats">
        <div className="panel stat">
          <span>{t("close.creditToday")}</span>
          <strong>{money(liveTotals.creditTodayAmount)}</strong>
          <span className="tiny">{t("close.creditTodayN", { n: liveTotals.creditTodayCount })}</span>
        </div>
        <div className="panel stat">
          <span>{t("close.creditPaid")}</span>
          <strong>{money(liveTotals.creditPaidAmount)}</strong>
          <span className="tiny">{t("close.creditPaidN", { n: liveTotals.creditPaidCount })}</span>
        </div>
        <div className={`panel stat ${liveTotals.creditUnpaidAmount > 0 ? "alert-low" : ""}`}>
          <span>{t("close.creditUnpaid")}</span>
          <strong>{money(liveTotals.creditUnpaidAmount)}</strong>
          <span className="tiny">{t("close.creditUnpaidN", { n: liveTotals.creditUnpaidCount })}</span>
        </div>
      </div>

      <h3 style={{ margin: "0.85rem 0 0.5rem" }}>{t("close.nonCashTitle")}</h3>
      <div className="stats">
        <div className="panel stat">
          <span>{t("pay.method.CARD")}</span>
          <strong>{money(liveTotals.cardTotal)}</strong>
          <span className="tiny">{t("close.nonCashHint")}</span>
        </div>
        <div className="panel stat">
          <span>{t("pay.method.WALLET")}</span>
          <strong>{money(liveTotals.walletTotal)}</strong>
          <span className="tiny">{t("close.nonCashHint")}</span>
        </div>
        <div className="panel stat">
          <span>{t("pay.method.BANK")}</span>
          <strong>{money(liveTotals.bankTotal)}</strong>
          <span className="tiny">{t("close.nonCashHint")}</span>
        </div>
      </div>

      <div className="panel panel-pad" style={{ marginTop: "0.85rem" }}>
        <h3 style={{ marginTop: 0 }}>{t("close.chartTitle")}</h3>
        <CloseBars
          c1={c1?.expectedCash ?? 0}
          c2={c2?.expectedCash ?? 0}
          pending={liveTotals.pendingAmount}
          miss={liveTotals.missCash}
        />
      </div>

      <form onSubmit={save}>
        {(editable || (sheet && (sheet.totals.openingFloat ?? 0) > 0) || isToday) && (
          <div className="panel panel-pad" style={{ marginTop: "0.85rem" }}>
            <h3 style={{ marginTop: 0 }}>{t("close.drawerTitle")}</h3>
            <p className="tiny muted" style={{ marginTop: 0 }}>
              {t("close.drawerFormulaHint")}
            </p>
            {editable ? (
              <div className="field" style={{ maxWidth: 280 }}>
                <label>{t("close.openingFloat")}</label>
                <input
                  className="field-ctrl"
                  type="number"
                  min={0}
                  step="0.01"
                  value={openingFloat}
                  onChange={(e) => setOpeningFloat(e.target.value)}
                  placeholder="0"
                />
                <span className="tiny muted">{t("close.openingFloatHint")}</span>
              </div>
            ) : (
              <div className="stats" style={{ marginTop: "0.5rem" }}>
                <div className="panel stat">
                  <span>{t("close.openingFloat")}</span>
                  <strong>{money(liveTotals.openingFloat)}</strong>
                </div>
                <div className="panel stat">
                  <span>{t("close.cashSales")}</span>
                  <strong>{money(liveTotals.cashSales)}</strong>
                </div>
                <div className="panel stat">
                  <span>{t("close.tips")}</span>
                  <strong>{money(liveTotals.tipTotal)}</strong>
                </div>
                <div className="panel stat">
                  <span>{t("close.cashOutTotal")}</span>
                  <strong>{money(liveTotals.cashOutTotal)}</strong>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="grid-2" style={{ marginTop: "0.85rem" }}>
          {liveCounters.map((c) => (
            <div key={c.kind} className="panel panel-pad">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                <h3 style={{ margin: 0 }}>{c.kind === "COUNTER_1" ? t("close.counter1") : t("close.counter2")}</h3>
                <span className="tiny muted">{c.cashiers.map((x) => x.name).join(", ") || c.roleCode}</span>
              </div>
              <div className="stats" style={{ marginTop: "0.65rem" }}>
                <div className="panel stat">
                  <span>{t("close.expectedCash")}</span>
                  <strong>{money(c.expectedCash)}</strong>
                  <span className="tiny">
                    {t("close.billsPayments", {
                      b: c.billCount + (c.creditBillCount ?? 0),
                      p: c.paymentCount + (c.creditPaymentCount ?? 0),
                    })}
                  </span>
                </div>
                <div className="panel stat">
                  <span>{t("close.walkInCash")}</span>
                  <strong>{money(c.walkInCash ?? c.cashSales ?? 0)}</strong>
                  <span className="tiny">{t("close.walkInCashN", { b: c.billCount, p: c.paymentCount })}</span>
                </div>
                <div className={`panel stat ${(c.creditCash ?? 0) > 0 ? "alert-low" : ""}`}>
                  <span>{t("close.creditCashOnCounter")}</span>
                  <strong>{money(c.creditCash ?? 0)}</strong>
                  <span className="tiny">
                    {t("close.creditCashOnCounterN", {
                      b: c.creditBillCount ?? 0,
                      p: c.creditPaymentCount ?? 0,
                    })}
                  </span>
                </div>
                <div className="panel stat">
                  <span>{t("close.tips")}</span>
                  <strong>{money(c.tipTotal)}</strong>
                </div>
                <div className={`panel stat ${c.missCash > 0 ? "alert-low" : ""}`}>
                  <span>{t("close.missCash")}</span>
                  <strong>{money(c.missCash)}</strong>
                </div>
                <div className="panel stat">
                  <span>{t("close.surplusCash")}</span>
                  <strong>{money(c.surplusCash ?? 0)}</strong>
                </div>
              </div>

              <div className="field" style={{ marginTop: "0.65rem" }}>
                <label>{t("close.cashCollection")}</label>
                <input
                  className="field-ctrl"
                  type="number"
                  min={0}
                  step="0.01"
                  value={collected[c.kind]}
                  disabled={!editable}
                  onChange={(e) => setCollected((prev) => ({ ...prev, [c.kind]: e.target.value }))}
                  required={editable}
                />
                <p className="tiny muted" style={{ margin: "0.25rem 0 0" }}>
                  {t("close.cashCollectionHint")}
                </p>
              </div>

              {c.missCash > 0 && (
                <div className="field">
                  <label>{t("close.missReason")}</label>
                  <input
                    className="field-ctrl"
                    value={reasons[c.kind]}
                    disabled={!editable}
                    onChange={(e) => setReasons((prev) => ({ ...prev, [c.kind]: e.target.value }))}
                    placeholder={t("close.missReasonPh")}
                    required={editable}
                  />
                </div>
              )}

              {c.pendingHandoverCash > 0 && (
                <p className="tiny muted" style={{ color: "var(--warn)" }}>
                  {t("close.pendingHandover", { amount: money(c.pendingHandoverCash) })}
                </p>
              )}

              <h4 style={{ margin: "0.85rem 0 0.4rem" }}>{t("close.paidOnCounter")}</h4>
              <p className="tiny muted" style={{ marginTop: 0 }}>
                {t("close.paidOnCounterHint")}
              </p>
              {!c.bills.length ? (
                <div className="empty">{t("close.noPaid")}</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("payments.bill")}</th>
                        <th>{t("common.table")}</th>
                        <th>{t("close.billTotal")}</th>
                        <th>{t("close.paidHere")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginate(c.bills, counterBillsPage[c.kind], PAGE_SIZE).map((b) => (
                        <tr key={b.orderId}>
                          <td>
                            <span>#{b.orderNo}</span>
                          </td>
                          <td>{b.tableNo || "—"}</td>
                          <td>{money(b.orderTotal)}</td>
                          <td>
                            <strong>{money(b.paidOnCounter)}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Pagination
                    page={counterBillsPage[c.kind]}
                    pageSize={PAGE_SIZE}
                    total={c.bills.length}
                    onChange={(p) => setCounterBillsPage((prev) => ({ ...prev, [c.kind]: p }))}
                  />
                </div>
              )}

              <h4 style={{ margin: "0.85rem 0 0.4rem" }}>{t("close.paymentRows")}</h4>
              {!c.payments.length ? (
                <div className="empty">{t("close.noPayments")}</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("common.time")}</th>
                        <th>{t("payments.bill")}</th>
                        <th>{t("common.amount")}</th>
                        <th>{t("close.drawer")}</th>
                        <th>{t("close.handover")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginate(c.payments, counterPaymentsPage[c.kind], PAGE_SIZE).map((p) => (
                        <tr key={p.id}>
                          <td>{clock(p.createdAt)}</td>
                          <td>
                            <span>#{p.orderNo}</span>
                          </td>
                          <td>
                            <strong>{money(p.amount)}</strong>
                          </td>
                          <td className="tiny">{p.drawerName}</td>
                          <td className="tiny muted">
                            {p.handedTo
                              ? p.confirmedAt
                                ? t("close.handoverOk")
                                : t("close.handoverPending")
                              : t("close.direct")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Pagination
                    page={counterPaymentsPage[c.kind]}
                    pageSize={PAGE_SIZE}
                    total={c.payments.length}
                    onChange={(p) => setCounterPaymentsPage((prev) => ({ ...prev, [c.kind]: p }))}
                  />
                </div>
              )}

              <h4 style={{ margin: "0.85rem 0 0.4rem" }}>{t("close.creditOnCounter")}</h4>
              <p className="tiny muted" style={{ marginTop: 0 }}>
                {t("close.creditOnCounterHint", { amount: money(c.creditCash ?? 0) })}
              </p>
              {!(c.creditBills?.length || c.creditPayments?.length) ? (
                <div className="empty">{t("close.noCreditOnCounter")}</div>
              ) : (
                <>
                  {(c.creditBills?.length ?? 0) > 0 && (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>{t("payments.bill")}</th>
                            <th>{t("close.credit")}</th>
                            <th>{t("close.paidHere")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {paginate(c.creditBills ?? [], counterCreditBillsPage[c.kind], PAGE_SIZE).map((b) => (
                            <tr key={b.orderId}>
                              <td>
                                <div className="row" style={{ gap: "0.35rem", flexWrap: "wrap" }}>
                                  <span>#{b.orderNo}</span>
                                  <CreditMark isCredit name={b.creditCustomerName} label={t("close.credit")} />
                                </div>
                              </td>
                              <td className="tiny">{b.creditCustomerName || "—"}</td>
                              <td>
                                <strong>{money(b.paidOnCounter)}</strong>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <Pagination
                        page={counterCreditBillsPage[c.kind]}
                        pageSize={PAGE_SIZE}
                        total={c.creditBills?.length ?? 0}
                        onChange={(p) => setCounterCreditBillsPage((prev) => ({ ...prev, [c.kind]: p }))}
                      />
                    </div>
                  )}
                  {(c.creditPayments?.length ?? 0) > 0 && (
                    <div className="table-wrap" style={{ marginTop: "0.5rem" }}>
                      <table>
                        <thead>
                          <tr>
                            <th>{t("common.time")}</th>
                            <th>{t("payments.bill")}</th>
                            <th>{t("close.credit")}</th>
                            <th>{t("common.amount")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {paginate(c.creditPayments ?? [], counterCreditPaysPage[c.kind], PAGE_SIZE).map((p) => (
                            <tr key={p.id}>
                              <td>{clock(p.createdAt)}</td>
                              <td>#{p.orderNo}</td>
                              <td className="tiny">{p.creditCustomerName || "—"}</td>
                              <td>
                                <strong>{money(p.amount)}</strong>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <Pagination
                        page={counterCreditPaysPage[c.kind]}
                        pageSize={PAGE_SIZE}
                        total={c.creditPayments?.length ?? 0}
                        onChange={(p) => setCounterCreditPaysPage((prev) => ({ ...prev, [c.kind]: p }))}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>

        <div className="panel panel-pad" style={{ marginTop: "0.85rem" }}>
          <h3 style={{ marginTop: 0 }}>{t("close.combinedTitle")}</h3>
          <div className="table-wrap">
            <table>
              <tbody>
                <tr>
                  <td>{t("close.counter1")}</td>
                  <td>
                    <strong>{money(c1?.expectedCash ?? 0)}</strong>
                    <span className="tiny muted"> → {money(c1?.collectedCash ?? 0)}</span>
                  </td>
                </tr>
                <tr>
                  <td>{t("close.counter2")}</td>
                  <td>
                    <strong>{money(c2?.expectedCash ?? 0)}</strong>
                    <span className="tiny muted"> → {money(c2?.collectedCash ?? 0)}</span>
                  </td>
                </tr>
                <tr>
                  <td>{t("close.bothCash")}</td>
                  <td>
                    <strong>{money(liveTotals.expectedCash)}</strong>
                  </td>
                </tr>
                <tr>
                  <td>{t("close.collectedCash")}</td>
                  <td>
                    <strong>{money(liveTotals.collectedCash)}</strong>
                  </td>
                </tr>
                <tr>
                  <td>{t("close.missCash")}</td>
                  <td>
                    <strong style={{ color: liveTotals.missCash ? "var(--danger)" : undefined }}>
                      {money(liveTotals.missCash)}
                    </strong>
                  </td>
                </tr>
                <tr>
                  <td>{t("close.surplusCash")}</td>
                  <td>
                    <strong>{money(liveTotals.surplusCash)}</strong>
                  </td>
                </tr>
                <tr>
                  <td>{t("close.openingFloat")}</td>
                  <td>
                    <strong>{money(liveTotals.openingFloat)}</strong>
                  </td>
                </tr>
                <tr>
                  <td>{t("pay.method.CARD")} / {t("pay.method.WALLET")} / {t("pay.method.BANK")}</td>
                  <td>
                    <strong>
                      {money(liveTotals.cardTotal)} / {money(liveTotals.walletTotal)} / {money(liveTotals.bankTotal)}
                    </strong>
                  </td>
                </tr>
                <tr>
                  <td>{t("close.pendingBills")}</td>
                  <td>
                    <strong>{money(liveTotals.pendingAmount)}</strong>
                    <span className="tiny muted"> ({liveTotals.pendingCount})</span>
                  </td>
                </tr>
                <tr>
                  <td>{t("close.totalSale")}</td>
                  <td>
                    <strong>{money(liveTotals.totalSale)}</strong>
                  </td>
                </tr>
                <tr>
                  <td>{t("close.cashPlusPending")}</td>
                  <td>
                    <strong>{money(liveTotals.cashPlusPending)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {editable && (
            <div className="field" style={{ marginTop: "0.75rem" }}>
              <label>{t("close.note")}</label>
              <input
                className="field-ctrl wide"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("close.notePh")}
              />
            </div>
          )}
          {!editable && sheet?.note && (
            <p className="tiny muted" style={{ marginTop: "0.75rem" }}>
              {t("close.note")}: {sheet.note}
            </p>
          )}
        </div>

        {batchPreview && (batchLines.length > 0 || batchPreview.existingClose) && (
          <div className="panel panel-pad" style={{ marginTop: "0.85rem" }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
              <h3 style={{ marginTop: 0, marginBottom: 0 }}>{t("specials.closeTitle")}</h3>
              {canEditLeftoverSection && batchPreview.existingClose && batchPreview.dayCashClosed === false ? (
                <button
                  type="button"
                  className="btn ghost sm"
                  disabled={busy}
                  onClick={() => void reopenLeftover()}
                >
                  {t("specials.reopenClose")}
                </button>
              ) : null}
              {canEditLeftoverSection && !isToday ? (
                <button
                  type="button"
                  className="btn sm"
                  disabled={busy || !batchLines.length}
                  onClick={() => void saveLeftoverOnly()}
                >
                  {t("specials.editPrevClose")}
                </button>
              ) : null}
            </div>
            {batchPreview.dayCashClosed && batchPreview.existingClose && !canEditLeftoverSection ? (
              <div>
                <p className="tiny muted">{t("specials.alreadyClosed")}</p>
                {batchPreview.existingClose.lines.map((l) => (
                  <div key={l.specialProductId} className="tiny" style={{ marginBottom: "0.35rem" }}>
                    <strong>{l.specialProduct.name}</strong>: {formatKg(Number(l.carryGrams))}{" "}
                    {t("specials.carry")} · {formatKg(Number(l.wasteGrams))} {t("specials.waste")}
                    {Number(l.lossCost) > 0
                      ? ` · ${t("specials.lossCost")} ${money(Number(l.lossCost))}`
                      : ""}
                    {l.wasteNote ? ` · ${l.wasteNote}` : ""}
                  </div>
                ))}
              </div>
            ) : (
              <>
                <p className="tiny muted" style={{ marginTop: "0.5rem" }}>
                  {t("specials.closeHintWithReport")}
                </p>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("common.item")}</th>
                        <th>{t("specials.systemRem")}</th>
                        <th>{t("specials.counted")} ({t("common.kg")})</th>
                        <th>{t("specials.carry")} ({t("common.kg")})</th>
                        <th>{t("specials.waste")} ({t("common.kg")})</th>
                        <th>{t("specials.wasteNote")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batchLines.map((l) => (
                        <tr key={l.specialProductId}>
                          <td>{l.name}</td>
                          <td>{formatKg(l.systemRemainingGrams)}</td>
                          <td>
                            <input
                              className="field-ctrl sm"
                              inputMode="decimal"
                              value={l.countedRemainingGrams}
                              disabled={!(editable || (canEditLeftoverSection && !isToday))}
                              onChange={(e) =>
                                setBatchLines((rows) =>
                                  rows.map((r) =>
                                    r.specialProductId === l.specialProductId
                                      ? { ...r, countedRemainingGrams: e.target.value }
                                      : r
                                  )
                                )
                              }
                            />
                          </td>
                          <td>
                            <input
                              className="field-ctrl sm"
                              inputMode="decimal"
                              value={l.carryGrams}
                              disabled={!(editable || (canEditLeftoverSection && !isToday))}
                              onChange={(e) =>
                                setBatchLines((rows) =>
                                  rows.map((r) =>
                                    r.specialProductId === l.specialProductId
                                      ? { ...r, carryGrams: e.target.value }
                                      : r
                                  )
                                )
                              }
                            />
                          </td>
                          <td>
                            <input
                              className="field-ctrl sm"
                              inputMode="decimal"
                              value={l.wasteGrams}
                              disabled={!(editable || (canEditLeftoverSection && !isToday))}
                              onChange={(e) =>
                                setBatchLines((rows) =>
                                  rows.map((r) =>
                                    r.specialProductId === l.specialProductId
                                      ? { ...r, wasteGrams: e.target.value }
                                      : r
                                  )
                                )
                              }
                            />
                          </td>
                          <td>
                            <input
                              className="field-ctrl wide"
                              value={l.wasteNote}
                              disabled={!(editable || (canEditLeftoverSection && !isToday))}
                              onChange={(e) =>
                                setBatchLines((rows) =>
                                  rows.map((r) =>
                                    r.specialProductId === l.specialProductId
                                      ? { ...r, wasteNote: e.target.value }
                                      : r
                                  )
                                )
                              }
                              placeholder={t("specials.wasteNotePh")}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {editable && (
          <div className="form-actions" style={{ marginTop: "0.85rem" }}>
            <button type="button" className="btn ghost" disabled={busy} onClick={cancelEdit}>
              {t("common.cancel")}
            </button>
            <button className="btn" type="submit" disabled={busy}>
              {busy ? t("common.saving") : sheet?.saved ? t("close.update") : t("close.save")}
            </button>
          </div>
        )}
      </form>
      <div className="grid-2" style={{ marginTop: "0.85rem" }}>
        <div className="panel panel-pad">
          <h3 style={{ marginTop: 0 }}>{t("close.itemsSold")}</h3>
          {!sheet?.soldItems.length ? (
            <div className="empty">{t("close.noItems")}</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("common.item")}</th>
                    <th>{t("common.qty")}</th>
                    <th>{t("store.amount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {paginate(sheet.soldItems, soldPage, PAGE_SIZE).map((i) => (
                    <tr key={i.name}>
                      <td>{i.name}</td>
                      <td>{i.qty}</td>
                      <td>
                        <strong>{money(i.amount)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination
                page={soldPage}
                pageSize={PAGE_SIZE}
                total={sheet.soldItems.length}
                onChange={setSoldPage}
              />
            </div>
          )}
        </div>

        <div className="panel panel-pad">
          <h3 style={{ marginTop: 0 }}>{t("close.pendingList")}</h3>
          <p className="tiny muted" style={{ marginTop: 0 }}>
            {t("close.pendingListHint")}
          </p>
          {!sheet?.pendingBills.length ? (
            <div className="empty">{t("close.noPending")}</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("payments.bill")}</th>
                    <th>{t("common.table")}</th>
                    <th>{t("close.balance")}</th>
                    <th>{t("common.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {paginate(sheet.pendingBills, pendingPage, PAGE_SIZE).map((b) => (
                    <tr key={b.orderNo}>
                      <td>
                        <span>#{b.orderNo}</span>
                      </td>
                      <td>{b.tableNo || "—"}</td>
                      <td>
                        <strong>{money(b.balance)}</strong>
                      </td>
                      <td className="tiny">{b.paymentStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination
                page={pendingPage}
                pageSize={PAGE_SIZE}
                total={sheet.pendingBills.length}
                onChange={setPendingPage}
              />
            </div>
          )}
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: "0.85rem", gap: "0.85rem" }}>
        <div className="panel panel-pad">
          <h3 style={{ marginTop: 0 }}>{t("close.creditTodayList")}</h3>
          <p className="tiny muted" style={{ marginTop: 0 }}>
            {t("close.creditTodayListHint")}
          </p>
          {!creditTodayBills.length ? (
            <div className="empty">{t("close.noCreditToday")}</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("common.time")}</th>
                    <th>{t("payments.bill")}</th>
                    <th>{t("close.credit")}</th>
                    <th>{t("common.amount")}</th>
                    <th>{t("common.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {paginate(creditTodayBills, creditTodayPage, PAGE_SIZE).map((b) => (
                    <tr key={b.orderNo}>
                      <td>{clock(b.createdAt)}</td>
                      <td>#{b.orderNo}</td>
                      <td className="tiny">{b.creditCustomerName || "—"}</td>
                      <td>
                        <strong>{money(b.amount)}</strong>
                      </td>
                      <td className="tiny">{b.paymentStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination
                page={creditTodayPage}
                pageSize={PAGE_SIZE}
                total={creditTodayBills.length}
                onChange={setCreditTodayPage}
              />
            </div>
          )}
        </div>

        <div className="panel panel-pad">
          <h3 style={{ marginTop: 0 }}>{t("close.creditPaidList")}</h3>
          <p className="tiny muted" style={{ marginTop: 0 }}>
            {t("close.creditPaidListHint")}
          </p>
          {!creditPaidBills.length ? (
            <div className="empty">{t("close.noCreditPaid")}</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("common.time")}</th>
                    <th>{t("payments.bill")}</th>
                    <th>{t("close.credit")}</th>
                    <th>{t("common.amount")}</th>
                    <th>{t("close.cashier")}</th>
                  </tr>
                </thead>
                <tbody>
                  {paginate(creditPaidBills, creditPaidPage, PAGE_SIZE).map((b) => (
                    <tr key={b.id}>
                      <td>{clock(b.createdAt)}</td>
                      <td>#{b.orderNo}</td>
                      <td className="tiny">{b.creditCustomerName || "—"}</td>
                      <td>
                        <strong>{money(b.amount)}</strong>
                      </td>
                      <td className="tiny muted">{b.cashier || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination
                page={creditPaidPage}
                pageSize={PAGE_SIZE}
                total={creditPaidBills.length}
                onChange={setCreditPaidPage}
              />
            </div>
          )}
        </div>
      </div>

      <div className="panel panel-pad" style={{ marginTop: "0.85rem" }}>
        <h3 style={{ marginTop: 0 }}>{t("close.creditUnpaidList")}</h3>
        <p className="tiny muted" style={{ marginTop: 0 }}>
          {t("close.creditUnpaidListHint")}
        </p>
        {!creditUnpaidBills.length ? (
          <div className="empty">{t("close.noCreditUnpaid")}</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("payments.bill")}</th>
                  <th>{t("common.table")}</th>
                  <th>{t("close.balance")}</th>
                  <th>{t("close.credit")}</th>
                </tr>
              </thead>
              <tbody>
                {paginate(creditUnpaidBills, creditUnpaidPage, PAGE_SIZE).map((b) => (
                  <tr key={b.orderNo}>
                    <td>
                      <div className="row" style={{ gap: "0.35rem", flexWrap: "wrap" }}>
                        <span>#{b.orderNo}</span>
                        <CreditMark
                          isCredit
                          name={b.creditCustomerName}
                          label={t("close.credit")}
                        />
                      </div>
                    </td>
                    <td>{b.tableNo || "—"}</td>
                    <td>
                      <strong>{money(b.balance)}</strong>
                    </td>
                    <td className="tiny">{b.creditCustomerName || t("close.credit")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
              page={creditUnpaidPage}
              pageSize={PAGE_SIZE}
              total={creditUnpaidBills.length}
              onChange={setCreditUnpaidPage}
            />
          </div>
        )}
      </div>

      <div className="panel panel-pad" style={{ marginTop: "0.85rem" }}>
        <h3 style={{ marginTop: 0 }}>{t("close.allPaidBills")}</h3>
        {!sheet?.paidBills.length ? (
          <div className="empty">{t("close.noPaid")}</div>
        ) : (
          <div className="table-wrap wide">
            <table>
              <thead>
                <tr>
                  <th>{t("common.time")}</th>
                  <th>{t("payments.bill")}</th>
                  <th>{t("common.table")}</th>
                  <th>{t("audit.sales")}</th>
                  <th>{t("close.tips")}</th>
                  <th>{t("close.cashier")}</th>
                </tr>
              </thead>
              <tbody>
                {paginate(sheet.paidBills, paidPage, PAGE_SIZE).map((b) => (
                  <tr key={b.orderNo}>
                    <td>{clock(b.createdAt)}</td>
                    <td>
                      <div className="row" style={{ gap: "0.35rem", flexWrap: "wrap" }}>
                        <span>#{b.orderNo}</span>
                        <CreditMark
                          isCredit={b.isCredit}
                          name={b.creditCustomerName}
                          label={t("close.credit")}
                        />
                      </div>
                    </td>
                    <td>{b.tableNo || "—"}</td>
                    <td>
                      <strong>{money(b.total)}</strong>
                    </td>
                    <td>{money(b.tipAmount)}</td>
                    <td className="tiny muted">{b.cashier || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
              page={paidPage}
              pageSize={PAGE_SIZE}
              total={sheet.paidBills.length}
              onChange={setPaidPage}
            />
          </div>
        )}
      </div>

      <div className="panel panel-pad" style={{ marginTop: "0.85rem" }}>
        <h3 style={{ marginTop: 0 }}>{t("close.history")}</h3>
        {!history.length ? (
          <div className="empty">{t("close.noHistory")}</div>
        ) : (
          <div className="table-wrap wide">
            <table>
              <thead>
                <tr>
                  <th>{t("close.date")}</th>
                  <th>{t("close.totalSale")}</th>
                  <th>{t("close.collectedCash")}</th>
                  <th>{t("close.missCash")}</th>
                  <th>{t("close.pendingBills")}</th>
                  <th>{t("close.closedBy")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {paginate(history, historyPage, PAGE_SIZE).map((h) => {
                  const todayRow = h.businessDate === sheet?.today;
                  return (
                    <tr key={h.id}>
                      <td>
                        <strong>{h.businessDate}</strong>
                        {todayRow && (
                          <div className="tiny" style={{ color: "var(--ok)" }}>
                            {t("close.todayBadge")}
                          </div>
                        )}
                      </td>
                      <td>{money(h.totalSale)}</td>
                      <td>{money(h.collectedCash)}</td>
                      <td>{money(h.missCash)}</td>
                      <td>{money(h.pendingAmount)}</td>
                      <td className="tiny muted">{h.closedByName || "—"}</td>
                      <td>
                        <button
                          type="button"
                          className={`btn sm ${todayRow ? "ok" : "ghost"}`}
                          onClick={() => {
                            setDate(h.businessDate);
                            void load(h.businessDate);
                          }}
                        >
                          {todayRow ? t("close.today") : t("close.open")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pagination page={historyPage} pageSize={PAGE_SIZE} total={history.length} onChange={setHistoryPage} />
          </div>
        )}
      </div>
    </div>
  );
}
