import { useEffect, useMemo, useState } from "react";
import { api, money, unitLabel } from "../api";
import { useAuth } from "../auth";
import { useToast } from "../toast";
import { Modal } from "../components/Modal";
import { printBill, type BillOrder } from "../components/BillPreview";
import { ThermalPreview } from "../components/ThermalPreview";
import { SearchField, matchesSearch } from "../components/SearchField";
import { Pagination, paginate } from "../components/Pagination";
import { downloadExcelCsv } from "../csv";
import { serverPrint } from "../printing";
import { useSocketEvent } from "../socket";
import { PayModal } from "../components/PayModal";
import { CashHandovers } from "../components/CashHandovers";
import { CashRecord } from "../components/CashRecord";
import { useI18n, useT } from "../i18n";
import { EditBillForm, serverNames, withCurrent, type EditBillMeta, type EditBillPerson, type EditBillTable } from "../components/EditBillForm";

type OrderPayment = {
  id: string;
  amount: number;
  collectedBy: string;
  handedTo: string | null;
  confirmedAt: string | null;
  createdAt: string;
};

type Order = BillOrder & {
  id: string;
  tableId?: string | null;
  status: string;
  paidAmount: number;
  tipAmount?: number;
  waiter?: string | null;
  orderedBy?: { id?: string; name: string; roleCode?: string; roleName: string } | null;
  assignedCashier?: { id: string; name: string; roleCode?: string; roleName?: string } | null;
  servedBy?: string | null;
  servedByName?: string | null;
  billRequestedAt?: string | null;
  payments?: OrderPayment[];
};

const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-PK", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

/** Same clock format as the printed/customer bill. */
function billTime(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes();
  const s = d.getSeconds();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${h}:${pad(m)}:${pad(s)}${ampm}`;
}

const ITEMS_PREVIEW = 2;

type Stats = {
  pendingKitchen: number;
  preparing: number;
  ready: number;
  completed: number;
  totalOrders: number;
  unpaidCount: number;
  unpaidAmount: number;
  paidCount: number;
  revenueToday: number;
  revenueAll: number;
  ordersToday: number;
};

const PAGE_SIZE = 10;

export function BillsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const t = useT();
  const { ts } = useI18n();
  const [filter, setFilter] = useState<"UNPAID" | "PAID" | "ALL">("UNPAID");
  const [orders, setOrders] = useState<Order[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selected, setSelected] = useState<Order | null>(null);
  const [paying, setPaying] = useState<Order | null>(null);
  const [view, setView] = useState<"bills" | "cash">("bills");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [editQty, setEditQty] = useState<Record<string, number>>({});
  const [editMeta, setEditMeta] = useState<EditBillMeta | null>(null);
  const [editTables, setEditTables] = useState<EditBillTable[]>([]);
  const [editPartitions, setEditPartitions] = useState<{ id: string; name: string }[]>([]);
  const [editStaff, setEditStaff] = useState<EditBillPerson[]>([]);
  const [editing, setEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [thermal, setThermal] = useState<{
    text: string;
    paperWidth?: number;
    logoUrl?: string | null;
    paidStampUrl?: string | null;
    unpaidStampUrl?: string | null;
  } | null>(null);

  async function load() {
    try {
      const query = filter === "ALL" ? "?view=billing" : `?view=billing&paymentStatus=${filter}`;
      const [list, dash] = await Promise.all([
        api<Order[]>(`/orders${query}`),
        api<Stats>("/dashboard"),
      ]);
      setOrders(list);
      setStats(dash);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("bills.loadFailed"), "err");
    }
  }

  useEffect(() => {
    load();
  }, [filter]);

  useSocketEvent("orders.changed", () => void load());

  const shown = useMemo(() => {
    const filtered = orders.filter((o) =>
      matchesSearch(
        q,
        o.orderNo,
        o.tableNo,
        o.paymentStatus,
        o.status,
        o.assignedCashier?.name,
        ...o.items.map((i) => i.name)
      )
    );
    // Bill requests first so the assigned cashier sees them immediately.
    return filtered.sort((a, b) => {
      const ar = a.billRequestedAt && a.paymentStatus !== "PAID" ? 1 : 0;
      const br = b.billRequestedAt && b.paymentStatus !== "PAID" ? 1 : 0;
      if (ar !== br) return br - ar;
      return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
    });
  }, [orders, q]);

  function openBill(o: Order) {
    setSelected(o);
    setEditing(false);
    setThermal(null);
    const qty: Record<string, number> = {};
    for (const i of o.items) {
      if (i.id) qty[i.id] = i.quantity;
    }
    setEditQty(qty);
  }

  useEffect(() => {
    if (!selected?.id || editing) return;
    let cancelled = false;
    api<{
      text: string;
      paperWidth?: number;
      logoUrl?: string | null;
      paidStampUrl?: string | null;
      unpaidStampUrl?: string | null;
    }>(`/orders/${selected.id}/bill-preview`)
      .then((r) => {
        if (!cancelled) setThermal(r);
      })
      .catch(() => {
        if (!cancelled) setThermal(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.id, selected?.paymentStatus, selected?.paidAmount, selected?.total, editing]);

  async function startBillEdit(o: Order) {
    const qty: Record<string, number> = {};
    for (const i of o.items) {
      if (i.id) qty[i.id] = i.quantity;
    }
    setEditQty(qty);
    try {
      const [board, cashiers, servers] = await Promise.all([
        api<{ partitions: { id: string; name: string; tables: { id: string; name: string; label: string; partitionId: string; order: { id: string } | null }[] }[] }>("/tables"),
        api<EditBillPerson[]>("/payments/cashiers"),
        api<EditBillPerson[]>("/payments/servers"),
      ]);
      const tables = board.partitions.flatMap((p) =>
        p.tables.map((tbl) => ({ id: tbl.id, name: tbl.name, partitionId: tbl.partitionId, orderId: tbl.order?.id ?? null, label: tbl.label }))
      );
      setEditPartitions(board.partitions.map((p) => ({ id: p.id, name: p.name })));
      setEditTables(tables);
      setEditStaff([...cashiers, ...servers]);
      const table = tables.find((tbl) => tbl.id === o.tableId) ?? tables.find((tbl) => tbl.label === o.tableNo);
      setEditMeta({
        partitionId: table?.partitionId ?? "",
        tableId: table?.id ?? "",
        cashierId: o.assignedCashier?.id ?? "",
        supervisorId: o.orderedBy?.id ?? "",
        servedBy: o.servedByName || o.servedBy || "",
      });
      setEditing(true);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("bills.editFailed"), "err");
    }
  }

  async function saveEdit() {
    if (!selected || !can("order.edit")) return;
    const items = Object.entries(editQty).map(([id, quantity]) => ({ id, quantity }));
    if (!items.length) return;
    setSavingEdit(true);
    try {
      const updated = await api<Order>(`/orders/${selected.id}/edit`, {
        method: "POST",
        body: JSON.stringify({
          items,
          ...(editMeta?.tableId ? { tableId: editMeta.tableId } : {}),
          ...(editMeta?.cashierId ? { assignedCashierId: editMeta.cashierId } : {}),
          ...(editMeta?.supervisorId ? { waiterId: editMeta.supervisorId } : {}),
          servedByName: editMeta?.servedBy ?? "",
        }),
      });
      toast.push(t("bills.editSaved"), "ok");
      setSelected(updated);
      setEditing(false);
      const qty: Record<string, number> = {};
      for (const i of updated.items) {
        if (i.id) qty[i.id] = i.quantity;
      }
      setEditQty(qty);
      void load();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("bills.editFailed"), "err");
    } finally {
      setSavingEdit(false);
    }
  }

  useEffect(() => {
    setPage(1);
  }, [filter, q]);

  const pageRows = paginate(shown, page, PAGE_SIZE);

  async function printOnServer(id: string) {
    try {
      await serverPrint("bill", id);
      toast.push(t("bills.printing"), "ok");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("common.printFailed"), "err");
    }
  }

  function paid() {
    setPaying(null);
    setSelected(null);
    void load();
  }

  const seesRevenue = can("payments.view");
  const keepsCash = can("cash.keep");

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t("bills.title")}</h1>
          <p>{t("bills.subtitle")}</p>
        </div>
        {keepsCash && (
          <div className="page-head-actions">
            <div className="seg">
              <button type="button" className={view === "bills" ? "active" : ""} onClick={() => setView("bills")}>
                {t("bills.tabBills")}
              </button>
              <button type="button" className={view === "cash" ? "active" : ""} onClick={() => setView("cash")}>
                {t("bills.tabCash")}
              </button>
            </div>
          </div>
        )}
        <div className="filter-bar" style={view === "cash" ? { display: "none" } : undefined}>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => {
              downloadExcelCsv(
                `billing-${filter.toLowerCase()}-${Date.now()}.csv`,
                shown.map((o) => ({
                  OrderNo: o.orderNo,
                  Table: o.tableNo || "",
                  Time: billTime(o.createdAt),
                  Items: o.items
                    .map((i) => `${i.quantity} ${i.sellUnit} ${i.name}`)
                    .join("; "),
                  KitchenStatus: o.status,
                  Payment: o.paymentStatus,
                  Total: o.total,
                  Date: o.createdAt
                    ? new Date(o.createdAt).toLocaleString("en-PK")
                    : "",
                }))
              );
              toast.push(t("bills.excelOk"), "ok");
            }}
          >
            {t("common.excel")}
          </button>
          {(["UNPAID", "PAID", "ALL"] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={`btn ${filter === f ? "" : "ghost"} sm`}
              onClick={() => setFilter(f)}
            >
              {ts(f)}
            </button>
          ))}
        </div>
      </div>

      {keepsCash && <CashHandovers />}

      {view === "cash" ? (
        <CashRecord />
      ) : (
      <>
      <div className="stats">
        {seesRevenue && (
          <>
            <div className="panel stat">
              <span>{t("bills.revenueToday")}</span>
              <strong>{stats ? money(stats.revenueToday) : "—"}</strong>
            </div>
            <div className="panel stat">
              <span>{t("bills.totalRevenue")}</span>
              <strong>{stats ? money(stats.revenueAll) : "—"}</strong>
            </div>
          </>
        )}
        <div className="panel stat">
          <span>{t("bills.unpaidBills")}</span>
          <strong>
            {stats?.unpaidCount ?? "—"}
            <span className="tiny muted" style={{ display: "block", fontWeight: 500 }}>
              {stats ? money(stats.unpaidAmount) : ""}
            </span>
          </strong>
        </div>
        <div className="panel stat">
          <span>{t("bills.ordersToday")}</span>
          <strong>{stats?.ordersToday ?? "—"}</strong>
        </div>
        {!seesRevenue && (
          <div className="panel stat">
            <span>{t("bills.readyToServe")}</span>
            <strong>{stats?.ready ?? "—"}</strong>
          </div>
        )}
      </div>

      <div className="stats">
        <div className="panel stat">
          <span>{t("bills.pendingKitchen")}</span>
          <strong>{stats?.pendingKitchen ?? "—"}</strong>
        </div>
        <div className="panel stat">
          <span>{t("bills.preparing")}</span>
          <strong>{stats?.preparing ?? "—"}</strong>
        </div>
        <div className="panel stat">
          <span>{t("bills.ready")}</span>
          <strong>{stats?.ready ?? "—"}</strong>
        </div>
        <div className="panel stat">
          <span>{t("bills.completedPaid")}</span>
          <strong>
            {stats?.completed ?? "—"} / {stats?.paidCount ?? "—"}
          </strong>
        </div>
      </div>

      <div className="row" style={{ marginBottom: "0.85rem" }}>
        <SearchField
          value={q}
          onChange={setQ}
          placeholder={t("bills.search")}
        />
      </div>

      <div className="panel panel-pad">
        {!shown.length ? (
          <div className="empty">{t("bills.noMatch")}</div>
        ) : (
          <div className="table-wrap wide">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>{t("common.table")}</th>
                <th>{t("common.time")}</th>
                <th>{t("bills.orderedBy")}</th>
                <th>{t("bills.assignedCashier")}</th>
                <th>{t("common.items")}</th>
                <th>{t("bills.kitchen")}</th>
                <th>{t("common.total")}</th>
                <th>{t("bills.tip")}</th>
                <th>{t("bills.pay")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((o) => {
                const preview = o.items.slice(0, ITEMS_PREVIEW);
                const extra = o.items.length - preview.length;
                return (
                <tr
                  key={o.id}
                  className={
                    o.billRequestedAt && o.paymentStatus !== "PAID" ? "bill-requested-row" : undefined
                  }
                >
                  <td>{o.orderNo}</td>
                  <td>
                    {o.tableNo || "—"}
                    {o.billRequestedAt && o.paymentStatus !== "PAID" && (
                      <span className="badge pending" style={{ marginLeft: "0.35rem" }}>
                        {t("bills.billRequested")}
                      </span>
                    )}
                  </td>
                  <td className="tiny bill-time-cell">{billTime(o.createdAt)}</td>
                  <td className="tiny">
                    {o.orderedBy
                      ? `${o.orderedBy.name} (${o.orderedBy.roleName})`
                      : o.waiter || "—"}
                    {(o.servedByName || o.servedBy) && (
                      <div className="muted">
                        {t("bills.servedBy")} {o.servedByName || o.servedBy}
                      </div>
                    )}
                  </td>
                  <td className="tiny">{o.assignedCashier?.name || "—"}</td>
                  <td className="bill-items-cell">
                    {!o.items.length ? (
                      "—"
                    ) : (
                      <div className="bill-items">
                        {preview.map((i) => (
                          <div key={i.id ?? `${i.name}-${i.quantity}`} className="bill-item-line">
                            <span className="bill-item-qty">
                              {i.sellUnit === "PCS"
                                ? `${i.quantity}×`
                                : `${i.quantity} ${unitLabel(i.sellUnit)}`}
                            </span>
                            <span className="bill-item-name">{i.name}</span>
                          </div>
                        ))}
                        {extra > 0 && (
                          <div className="bill-items-more">
                            <span className="bill-items-more-trigger" tabIndex={0}>
                              {t("bills.moreItems", { n: extra })}
                            </span>
                            <div className="bill-items-tip" role="tooltip">
                              <div className="bill-items-tip-head">
                                {t("common.items")} · {o.items.length}
                              </div>
                              <ul className="bill-items-tip-list">
                                {o.items.map((i) => (
                                  <li key={i.id ?? `${i.name}-${i.quantity}`}>
                                    <span className="bill-item-qty">
                                      {i.sellUnit === "PCS"
                                        ? `${i.quantity}×`
                                        : `${i.quantity} ${unitLabel(i.sellUnit)}`}
                                    </span>
                                    <span className="bill-item-name">{i.name}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        o.status === "PENDING" || o.status === "PREPARING"
                          ? "pending"
                          : "ready"
                      }`}
                    >
                      {ts(o.status)}
                    </span>
                  </td>
                  <td>{money(o.total)}</td>
                  <td>{(o.tipAmount ?? 0) > 0 ? money(o.tipAmount ?? 0) : "—"}</td>
                  <td>
                    <span
                      className={`badge ${
                        o.paymentStatus === "PAID" ? "paid" : "unpaid"
                      }`}
                    >
                      {ts(o.paymentStatus)}
                    </span>
                  </td>
                  <td className="row">
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => openBill(o)}
                    >
                      {t("bills.open")}
                    </button>
                    {can("order.pay") && o.paymentStatus !== "PAID" && (
                      <button type="button" className="btn ok sm" onClick={() => setPaying(o)}>
                        {t("bills.pay")}
                      </button>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={shown.length}
        onChange={setPage}
      />
      </>
      )}

      <Modal
        open={!!selected}
        title={selected ? t("bills.billNo", { n: selected.orderNo }) : t("bills.modalTitle")}
        onClose={() => {
          setSelected(null);
          setEditing(false);
        }}
      >
        {selected && (
          <>
            <div className="modal-scroll">
              {selected.assignedCashier && !editing && (
                <div className="pay-summary no-print" style={{ marginBottom: "0.75rem" }}>
                  <span>{t("bills.assignedCashier")}</span>
                  <strong>{selected.assignedCashier.name}</strong>
                </div>
              )}
              {can("order.edit") && selected.paymentStatus !== "PAID" && editing && editMeta ? (
                <div className="no-print" style={{ marginBottom: "1rem" }}>
                  <EditBillForm
                    meta={editMeta}
                    onChange={setEditMeta}
                    currentOrderId={selected.id}
                    partitions={editPartitions}
                    tables={editTables}
                    cashiers={withCurrent(
                      editStaff.filter((s) => s.roleCode === "MAIN_CASHIER" || s.roleCode === "CASHIER"),
                      selected.assignedCashier
                    )}
                    supervisors={withCurrent(
                      editStaff.filter((s) => s.roleCode === "SUPERVISOR"),
                      selected.orderedBy
                    )}
                    servers={serverNames(editStaff, editMeta.servedBy)}
                    labels={{
                      where: t("bills.editWhere"),
                      who: t("bills.editWho"),
                      partition: t("bills.partition"),
                      table: t("bills.table"),
                      cashier: t("bills.cashier"),
                      supervisor: t("bills.supervisor"),
                      servedBy: t("bills.servedBy"),
                      busy: t("bills.tableBusy"),
                    }}
                  />
                  <div className="edit-bill-items">{t("common.items")}</div>
                  {selected.items.map((i) =>
                    i.id ? (
                      <div key={i.id} className="row" style={{ justifyContent: "space-between", marginBottom: "0.5rem" }}>
                        <span>
                          {i.name}
                          <span className="tiny muted"> · {unitLabel(i.sellUnit)}</span>
                        </span>
                        <div className="row" style={{ gap: "0.35rem", alignItems: "center" }}>
                          <button
                            type="button"
                            className="qty-btn"
                            onClick={() =>
                              setEditQty((prev) => ({
                                ...prev,
                                [i.id!]: Math.max(0, +((prev[i.id!] ?? i.quantity) - 1).toFixed(3)),
                              }))
                            }
                          >
                            −
                          </button>
                          <span className="qty-val">{editQty[i.id] ?? i.quantity}</span>
                          <button
                            type="button"
                            className="qty-btn"
                            onClick={() =>
                              setEditQty((prev) => ({
                                ...prev,
                                [i.id!]: +((prev[i.id!] ?? i.quantity) + 1).toFixed(3),
                              }))
                            }
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ) : null
                  )}
                </div>
              ) : thermal?.text ? (
                <ThermalPreview
                  text={thermal.text}
                  paperWidth={thermal.paperWidth}
                  logoUrl={thermal.logoUrl}
                  paidStampUrl={thermal.paidStampUrl}
                  unpaidStampUrl={thermal.unpaidStampUrl}
                />
              ) : (
                <p className="tiny muted">{t("settings.billPreviewLoading")}</p>
              )}
              {!!selected.payments?.length && (
                <ul className="payment-log no-print">
                  {selected.payments.map((p) => (
                    <li key={p.id}>
                      <strong>{money(p.amount)}</strong> {t("bills.receivedBy")}{" "}
                      <strong>{p.collectedBy}</strong> · {stamp(p.createdAt)}
                      {p.handedTo && (
                        <>
                          {" "}
                          → {t("bills.handedTo")} <strong>{p.handedTo}</strong>{" "}
                          {p.confirmedAt ? (
                            <span className="badge paid">{t("bills.confirmed")}</span>
                          ) : (
                            <span className="badge pending">{t("bills.notConfirmed")}</span>
                          )}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="form-footer no-print">
              {can("order.edit") && selected.paymentStatus !== "PAID" && (
                editing ? (
                  <>
                    <button type="button" className="btn" disabled={savingEdit} onClick={() => void saveEdit()}>
                      {savingEdit ? t("common.saving") : t("bills.saveEdit")}
                    </button>
                    <button type="button" className="btn ghost" onClick={() => setEditing(false)}>
                      {t("common.cancel")}
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn ghost" onClick={() => void startBillEdit(selected)}>
                    {t("bills.editOrder")}
                  </button>
                )
              )}
              {can("print.bill") && !editing && (
                <button type="button" className="btn" onClick={() => void printOnServer(selected.id)}>
                  {t("common.printOnPrinter")}
                </button>
              )}
              {!editing && (
                <button type="button" className="btn ghost" onClick={printBill}>
                  {t("common.browserPrint")}
                </button>
              )}
              {can("order.pay") && selected.paymentStatus !== "PAID" && !editing && (
                <button type="button" className="btn ok" onClick={() => setPaying(selected)}>
                  {t("bills.takePayment")}
                </button>
              )}
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setSelected(null);
                  setEditing(false);
                }}
              >
                {t("common.close")}
              </button>
            </div>
          </>
        )}
      </Modal>

      <PayModal order={paying} onClose={() => setPaying(null)} onPaid={paid} />
    </div>
  );
}
