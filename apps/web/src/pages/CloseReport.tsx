import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, money } from "../api";
import { useAuth } from "../auth";
import { DateField } from "../components/DateField";
import { useT } from "../i18n";
import { useToast } from "../toast";

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

type Counter = {
  kind: CounterKind;
  label: string;
  roleCode: string;
  cashiers: { id: string; name: string }[];
  expectedCash: number;
  collectedCash: number;
  missCash: number;
  missReason: string;
  billCount: number;
  paymentCount: number;
  tipTotal: number;
  pendingHandoverCash: number;
  payments: PaymentRow[];
  bills: {
    orderId: string;
    orderNo: number;
    tableNo: string | null;
    orderTotal: number;
    paidOnCounter: number;
    isCredit?: boolean;
    creditCustomerName?: string | null;
  }[];
};

type Sheet = {
  businessDate: string;
  today: string;
  isToday: boolean;
  dayStart: string;
  canEdit?: boolean;
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
    expectedCash: number;
    collectedCash: number;
    missCash: number;
    pendingAmount: number;
    pendingCount: number;
    paidBillsCount: number;
    paidSalesTotal: number;
    totalSale: number;
    cashPlusPending: number;
    creditUnpaidAmount?: number;
    creditUnpaidCount?: number;
    creditPaidAmount?: number;
    creditPaidCount?: number;
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

export function CloseReportPage() {
  const t = useT();
  const toast = useToast();
  const { can } = useAuth();
  const canManage = can("close.manage");

  const [date, setDate] = useState("");
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const [collected, setCollected] = useState<Record<CounterKind, string>>({
    COUNTER_1: "",
    COUNTER_2: "",
  });
  const [reasons, setReasons] = useState<Record<CounterKind, string>>({
    COUNTER_1: "",
    COUNTER_2: "",
  });

  const load = useCallback(
    async (d?: string) => {
      try {
        const q = d || date;
        const params = q ? `?date=${q}` : "";
        const data = await api<Sheet>(`/close/preview${params}`);
        setSheet(data);
        setDate(data.businessDate);
        setNote(data.note || "");
        setEditing(false);
        const nextCollected = { COUNTER_1: "", COUNTER_2: "" } as Record<CounterKind, string>;
        const nextReasons = { COUNTER_1: "", COUNTER_2: "" } as Record<CounterKind, string>;
        for (const c of data.counters) {
          nextCollected[c.kind] = String(c.collectedCash);
          nextReasons[c.kind] = c.missReason || "";
        }
        setCollected(nextCollected);
        setReasons(nextReasons);
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
    return sheet.counters.map((c) => {
      const typed = Number(collected[c.kind]);
      const collectedCash = Number.isFinite(typed) ? Math.max(0, typed) : 0;
      const missCash = Math.max(0, Math.round((c.expectedCash - collectedCash) * 100) / 100);
      return { ...c, collectedCash, missCash, missReason: reasons[c.kind] };
    });
  }, [sheet, collected, reasons]);

  const liveTotals = useMemo(() => {
    const expectedCash = liveCounters.reduce((s, c) => s + c.expectedCash, 0);
    const collectedCash = liveCounters.reduce((s, c) => s + c.collectedCash, 0);
    const missCash = liveCounters.reduce((s, c) => s + c.missCash, 0);
    return {
      expectedCash,
      collectedCash,
      missCash,
      pendingAmount: sheet?.totals.pendingAmount ?? 0,
      pendingCount: sheet?.totals.pendingCount ?? 0,
      paidBillsCount: sheet?.totals.paidBillsCount ?? 0,
      totalSale: sheet?.totals.totalSale ?? 0,
      cashPlusPending: Math.round((expectedCash + (sheet?.totals.pendingAmount ?? 0)) * 100) / 100,
      creditUnpaidAmount: sheet?.totals.creditUnpaidAmount ?? 0,
      creditUnpaidCount: sheet?.totals.creditUnpaidCount ?? 0,
      creditPaidAmount: sheet?.totals.creditPaidAmount ?? 0,
      creditPaidCount: sheet?.totals.creditPaidCount ?? 0,
    };
  }, [liveCounters, sheet]);

  const isToday = sheet?.isToday !== false;
  const canStartEdit = !!sheet && isToday && canManage && (sheet.canEdit !== false);
  const editable = canStartEdit && editing;

  function startEdit() {
    if (!canStartEdit) return;
    setEditing(true);
  }

  function cancelEdit() {
    if (!sheet) return;
    setNote(sheet.note || "");
    const nextCollected = { COUNTER_1: "", COUNTER_2: "" } as Record<CounterKind, string>;
    const nextReasons = { COUNTER_1: "", COUNTER_2: "" } as Record<CounterKind, string>;
    for (const c of sheet.counters) {
      nextCollected[c.kind] = String(c.collectedCash);
      nextReasons[c.kind] = c.missReason || "";
    }
    setCollected(nextCollected);
    setReasons(nextReasons);
    setEditing(false);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!sheet || !editable || !isToday) return;
    setBusy(true);
    try {
      const body = {
        businessDate: sheet.businessDate,
        note: note.trim() || undefined,
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
      toast.push(t("close.saved"), "ok");
      await loadHistory();
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
          {sheet && (
            <p className="page-head-meta tiny">
              <span>{t("close.dayWindow", { start: sheet.dayStart })}</span>
              <span>{isToday ? t("close.todayBadge") : t("close.viewOnlyBadge")}</span>
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
        </div>
      </div>

      {!isToday && sheet && (
        <div className="panel panel-pad alert-stale banner-row">
          <p style={{ margin: 0 }}>{t("close.pastReadOnly")}</p>
          <button type="button" className="btn ok sm" onClick={() => void load(sheet.today)}>
            {t("close.today")}
          </button>
        </div>
      )}

      {isToday && canStartEdit && !editing && (
        <div className="handover-confirm banner-row">
          <p style={{ margin: 0 }}>{sheet?.saved ? t("close.todaySavedHint") : t("close.todayEnterHint")}</p>
          <button type="button" className="btn" onClick={startEdit}>
            {sheet?.saved ? t("close.editToday") : t("close.enterToday")}
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
        <div className="panel stat">
          <span>{t("close.pendingBills")}</span>
          <strong>{money(liveTotals.pendingAmount)}</strong>
          <span className="tiny">{t("close.pendingN", { n: liveTotals.pendingCount })}</span>
        </div>
        <div className={`panel stat ${liveTotals.creditUnpaidAmount > 0 ? "alert-low" : ""}`}>
          <span>{t("close.creditUnpaid")}</span>
          <strong>{money(liveTotals.creditUnpaidAmount)}</strong>
          <span className="tiny">{t("close.creditUnpaidN", { n: liveTotals.creditUnpaidCount })}</span>
        </div>
        <div className="panel stat">
          <span>{t("close.creditPaid")}</span>
          <strong>{money(liveTotals.creditPaidAmount)}</strong>
          <span className="tiny">{t("close.creditPaidN", { n: liveTotals.creditPaidCount })}</span>
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
                  <span className="tiny">{t("close.billsPayments", { b: c.billCount, p: c.paymentCount })}</span>
                </div>
                <div className="panel stat">
                  <span>{t("close.tips")}</span>
                  <strong>{money(c.tipTotal)}</strong>
                </div>
                <div className={`panel stat ${c.missCash > 0 ? "alert-low" : ""}`}>
                  <span>{t("close.missCash")}</span>
                  <strong>{money(c.missCash)}</strong>
                </div>
              </div>

              <div className="field" style={{ marginTop: "0.65rem" }}>
                <label>{t("close.cashCollection")}</label>
                <input
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
                      {c.bills.map((b) => (
                        <tr key={b.orderId}>
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
                          <td>{money(b.orderTotal)}</td>
                          <td>
                            <strong>{money(b.paidOnCounter)}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
                      {c.payments.map((p) => (
                        <tr key={p.id}>
                          <td>{clock(p.createdAt)}</td>
                          <td>
                            <div className="row" style={{ gap: "0.35rem", flexWrap: "wrap" }}>
                              <span>#{p.orderNo}</span>
                              <CreditMark
                                isCredit={p.isCredit}
                                name={p.creditCustomerName}
                                label={t("close.credit")}
                              />
                            </div>
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
                </div>
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
            <>
              <div className="field" style={{ marginTop: "0.75rem" }}>
                <label>{t("close.note")}</label>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("close.notePh")} />
              </div>
              <div className="form-actions">
                <button type="button" className="btn ghost" disabled={busy} onClick={cancelEdit}>
                  {t("common.cancel")}
                </button>
                <button className="btn" type="submit" disabled={busy}>
                  {busy ? t("common.saving") : sheet?.saved ? t("close.update") : t("close.save")}
                </button>
              </div>
            </>
          )}
          {!editable && sheet?.note && (
            <p className="tiny muted" style={{ marginTop: "0.75rem" }}>
              {t("close.note")}: {sheet.note}
            </p>
          )}
        </div>
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
                  {sheet.soldItems.map((i) => (
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
            </div>
          )}
        </div>

        <div className="panel panel-pad">
          <h3 style={{ marginTop: 0 }}>{t("close.pendingList")}</h3>
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
                  {sheet.pendingBills.map((b) => (
                    <tr key={b.orderNo}>
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
                        <strong>{money(b.balance)}</strong>
                      </td>
                      <td className="tiny">
                        {b.isCredit ? t("close.credit") : b.paymentStatus}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
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
                {sheet.paidBills.map((b) => (
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
                {history.map((h) => {
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
          </div>
        )}
      </div>
    </div>
  );
}
