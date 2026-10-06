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
import { usePrompt } from "../components/ConfirmModal";
import { EditBillForm, serverNames, withCurrent, type EditBillMeta, type EditBillPerson, type EditBillTable } from "../components/EditBillForm";
import {
  bumpQty,
  clampQty,
  maxQtyOf,
  minQtyOf,
  qtyIssueOf,
  qtyStepOf,
  startQtyOf,
  type QtyRules,
} from "../menuQty";

type MenuRow = {
  id: string;
  name: string;
  category: string | null;
  sellUnit: string;
  sellingPrice: number;
  minQty?: number;
  maxQty?: number | null;
  qtyStep?: number | null;
  allowCustomQty?: boolean;
};

type EditAdd = {
  tempId: string;
  menuItemId: string;
  name: string;
  sellUnit: string;
  rate: number;
  quantity: number;
  minQty?: number;
  maxQty?: number | null;
  qtyStep?: number | null;
  allowCustomQty?: boolean;
};

function rulesOf(m: QtyRules): QtyRules {
  return {
    sellUnit: m.sellUnit,
    minQty: m.minQty,
    maxQty: m.maxQty,
    qtyStep: m.qtyStep,
    allowCustomQty: m.allowCustomQty,
  };
}

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
  cancelReason?: string | null;
  cancelledAt?: string | null;
  cancelledBy?: { id?: string; name: string; roleCode?: string; roleName?: string } | null;
  updatedAt?: string | null;
  payments?: OrderPayment[];
  items: (BillOrder["items"][number] & { menuItemId?: string | null; lineKind?: string })[];
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
  cancelledToday?: number;
  cancelledCount?: number;
};

/** Filter-independent billing tallies — unpaid never includes cancelled. */
type BillingTally = {
  unpaidCount: number;
  unpaidAmount: number;
  paidCount: number;
  cancelledCount: number;
  cancelledToday: number;
  cancelledAmount: number;
};

const emptyTally: BillingTally = {
  unpaidCount: 0,
  unpaidAmount: 0,
  paidCount: 0,
  cancelledCount: 0,
  cancelledToday: 0,
  cancelledAmount: 0,
};

function dueOf(o: Order) {
  const net = Math.max(0, o.total - (o.discountAmount ?? 0));
  return Math.max(0, net - (o.paidAmount ?? 0));
}

function isCancelled(o: Order) {
  return o.status === "CANCELLED" || o.paymentStatus === "VOID";
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function buildTally(unpaid: Order[], paid: Order[], cancelled: Order[]): BillingTally {
  const unpaidOpen = unpaid.filter((o) => !isCancelled(o));
  const paidOpen = paid.filter((o) => !isCancelled(o));
  const today = startOfToday();
  const cancelledToday = cancelled.filter((o) => {
    const when = o.cancelledAt || o.createdAt || o.updatedAt;
    return when ? new Date(when).getTime() >= today : false;
  }).length;
  return {
    unpaidCount: unpaidOpen.length,
    unpaidAmount: unpaidOpen.reduce((s, o) => s + dueOf(o), 0),
    paidCount: paidOpen.length,
    cancelledCount: cancelled.length,
    cancelledToday,
    cancelledAmount: cancelled.reduce((s, o) => s + Math.max(0, o.total - (o.discountAmount ?? 0)), 0),
  };
}

const PAGE_SIZE = 10;

export function BillsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const t = useT();
  const { ts } = useI18n();
  const askPrompt = usePrompt();
  const [filter, setFilter] = useState<"UNPAID" | "PAID" | "CANCELLED" | "ALL">("UNPAID");
  const [orders, setOrders] = useState<Order[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [tally, setTally] = useState<BillingTally>(emptyTally);
  const [selected, setSelected] = useState<Order | null>(null);
  const [paying, setPaying] = useState<Order | null>(null);
  const [view, setView] = useState<"bills" | "cash">("bills");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [editQty, setEditQty] = useState<Record<string, number>>({});
  const [editQtyDraft, setEditQtyDraft] = useState<Record<string, string>>({});
  const [editAdds, setEditAdds] = useState<EditAdd[]>([]);
  const [editMenu, setEditMenu] = useState<MenuRow[]>([]);
  const [addSearch, setAddSearch] = useState("");
  const [editMeta, setEditMeta] = useState<EditBillMeta | null>(null);
  const [editTables, setEditTables] = useState<EditBillTable[]>([]);
  const [editPartitions, setEditPartitions] = useState<{ id: string; name: string }[]>([]);
  const [editStaff, setEditStaff] = useState<EditBillPerson[]>([]);
  const [editing, setEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [thermal, setThermal] = useState<{
    text: string;
    paperWidth?: number;
    logoUrl?: string | null;
    paidStampUrl?: string | null;
    unpaidStampUrl?: string | null;
  } | null>(null);

  async function load() {
    try {
      const query =
        filter === "ALL"
          ? "?view=billing"
          : filter === "CANCELLED"
            ? "?view=billing&status=CANCELLED"
            : `?view=billing&paymentStatus=${filter}`;
      const [list, dash, unpaidRows, paidRows, cancelledRows] = await Promise.all([
        api<Order[]>(`/orders${query}`),
        api<Stats>("/dashboard"),
        api<Order[]>("/orders?view=billing&paymentStatus=UNPAID"),
        api<Order[]>("/orders?view=billing&paymentStatus=PAID"),
        api<Order[]>("/orders?view=billing&status=CANCELLED"),
      ]);
      setOrders(list);
      setStats(dash);
      setTally(buildTally(unpaidRows, paidRows, cancelledRows));
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("bills.loadFailed"), "err");
    }
  }

  useEffect(() => {
    load();
  }, [filter]);

  useSocketEvent("orders.changed", () => void load());

  const shown = useMemo(() => {
    const filtered = orders
      .filter((o) => {
        if (filter === "CANCELLED") return isCancelled(o);
        if (filter === "ALL") return true;
        return !isCancelled(o);
      })
      .filter((o) =>
        matchesSearch(
          q,
          o.orderNo,
          o.tableNo,
          o.paymentStatus,
          o.status,
          o.cancelReason,
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
  }, [orders, q, filter]);

  function openBill(o: Order) {
    setSelected(o);
    setEditing(false);
    setEditAdds([]);
    setEditQtyDraft({});
    setAddSearch("");
    setThermal(null);
    const qty: Record<string, number> = {};
    for (const i of o.items) {
      if (i.id) qty[i.id] = i.quantity;
    }
    setEditQty(qty);
  }

  function menuRulesForItem(i: Order["items"][number]): QtyRules {
    const hit = i.menuItemId
      ? editMenu.find((m) => m.id === i.menuItemId)
      : editMenu.find((m) => m.name === i.name && m.sellUnit === i.sellUnit);
    return hit
      ? rulesOf(hit)
      : { sellUnit: i.sellUnit, allowCustomQty: true };
  }

  function existingQtyText(id: string, fallback: number) {
    return editQtyDraft[id] ?? String(editQty[id] ?? fallback);
  }

  function existingQtyIssue(i: Order["items"][number]) {
    if (!i.id) return null;
    const text = existingQtyText(i.id, i.quantity).trim();
    if (text === "" || text === "." || text === "-") return "invalid" as const;
    const n = Number(text);
    // 0 = remove — allowed
    if (n === 0) return null;
    return qtyIssueOf(menuRulesForItem(i), n);
  }

  function addQtyIssue(a: EditAdd) {
    const text = (editQtyDraft[a.tempId] ?? String(a.quantity)).trim();
    if (text === "" || text === "." || text === "-") return "invalid" as const;
    return qtyIssueOf(rulesOf(a), Number(text));
  }

  const editQtyBlocked =
    editing &&
    selected &&
    (selected.items.some((i) => i.id && existingQtyIssue(i) != null) ||
      editAdds.some((a) => addQtyIssue(a) != null) ||
      (selected.items.every((i) => !i.id || (editQty[i.id] ?? i.quantity) <= 0) && !editAdds.length));

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
    if (!can("order.edit") || o.status === "CANCELLED" || o.paymentStatus === "PAID") return;
    const qty: Record<string, number> = {};
    const draft: Record<string, string> = {};
    for (const i of o.items) {
      if (i.id) {
        qty[i.id] = i.quantity;
        draft[i.id] = String(i.quantity);
      }
    }
    setEditQty(qty);
    setEditQtyDraft(draft);
    setEditAdds([]);
    setAddSearch("");
    try {
      const menu = await api<MenuRow[]>("/menu");
      setEditMenu(menu);
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

  function setExistingQty(id: string, qty: number, item: Order["items"][number]) {
    const rules = menuRulesForItem(item);
    if (qty <= 0) {
      setEditQty((prev) => ({ ...prev, [id]: 0 }));
      setEditQtyDraft((d) => ({ ...d, [id]: "0" }));
      return;
    }
    const next = clampQty(rules, qty);
    setEditQty((prev) => ({ ...prev, [id]: next }));
    setEditQtyDraft((d) => ({ ...d, [id]: String(next) }));
  }

  function setExistingQtyTyped(id: string, text: string) {
    setEditQtyDraft((d) => ({ ...d, [id]: text }));
    const n = Number(text);
    if (!Number.isFinite(n)) return;
    setEditQty((prev) => ({ ...prev, [id]: +n.toFixed(3) }));
  }

  function addMenuToEdit(m: MenuRow) {
    const rules = rulesOf(m);
    const start = startQtyOf(rules);
    const tempId = `add-${m.id}-${Date.now()}`;
    setEditAdds((prev) => [
      ...prev,
      {
        tempId,
        menuItemId: m.id,
        name: m.name,
        sellUnit: m.sellUnit,
        rate: m.sellingPrice,
        quantity: start,
        minQty: rules.minQty ?? undefined,
        maxQty: rules.maxQty ?? null,
        qtyStep: rules.qtyStep ?? null,
        allowCustomQty: rules.allowCustomQty,
      },
    ]);
    setEditQtyDraft((d) => ({ ...d, [tempId]: String(start) }));
    setAddSearch("");
  }

  function setAddQty(tempId: string, qty: number) {
    const row = editAdds.find((a) => a.tempId === tempId);
    if (!row) return;
    if (qty <= 0) {
      setEditAdds((prev) => prev.filter((a) => a.tempId !== tempId));
      setEditQtyDraft((d) => {
        const n = { ...d };
        delete n[tempId];
        return n;
      });
      return;
    }
    const next = clampQty(rulesOf(row), qty);
    setEditAdds((prev) => prev.map((a) => (a.tempId === tempId ? { ...a, quantity: next } : a)));
    setEditQtyDraft((d) => ({ ...d, [tempId]: String(next) }));
  }

  function setAddQtyTyped(tempId: string, text: string) {
    setEditQtyDraft((d) => ({ ...d, [tempId]: text }));
    const n = Number(text);
    if (!Number.isFinite(n)) return;
    setEditAdds((prev) =>
      prev.map((a) => (a.tempId === tempId ? { ...a, quantity: +n.toFixed(3) } : a))
    );
  }

  async function saveEdit() {
    if (!selected || !can("order.edit")) return;
    if (editQtyBlocked) {
      toast.push(t("waiter.qtyFixFirst"), "err");
      return;
    }
    const items = selected.items
      .filter((i): i is typeof i & { id: string } => !!i.id)
      .map((i) => ({ id: i.id, quantity: editQty[i.id] ?? i.quantity }));
    const addItems = editAdds.map((a) => ({
      menuItemId: a.menuItemId,
      quantity: a.quantity,
    }));
    if (!items.length && !addItems.length) return;
    if (selected.paymentStatus === "PAID") {
      toast.push(t("bills.editFailed"), "err");
      return;
    }
    setSavingEdit(true);
    try {
      const updated = await api<Order>(`/orders/${selected.id}/edit`, {
        method: "POST",
        body: JSON.stringify({
          items,
          ...(addItems.length ? { addItems } : {}),
          ...(editMeta?.tableId ? { tableId: editMeta.tableId } : {}),
          ...(editMeta?.cashierId ? { assignedCashierId: editMeta.cashierId } : {}),
          ...(editMeta?.supervisorId ? { waiterId: editMeta.supervisorId } : {}),
          servedByName: editMeta?.servedBy ?? "",
        }),
      });
      toast.push(t("bills.editSaved"), "ok");
      setSelected(updated);
      setEditing(false);
      setEditAdds([]);
      setEditQtyDraft({});
      setAddSearch("");
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

  async function cancelOrder() {
    if (!selected || !can("order.edit")) return;
    if (selected.paymentStatus === "PAID" || selected.status === "CANCELLED") return;
    const reason = await askPrompt({
      title: t("bills.cancelConfirmTitle"),
      body: t("bills.cancelConfirmBody", { n: selected.orderNo }),
      confirmLabel: t("bills.cancelConfirm"),
      danger: true,
      inputLabel: t("bills.cancelReason"),
      inputPlaceholder: t("bills.cancelReasonPh"),
      inputRequired: true,
      inputMaxLength: 200,
    });
    if (!reason) return;
    setCancelling(true);
    try {
      const res = await api<Order & { printQueued?: number; printError?: string | null }>(
        `/orders/${selected.id}/cancel`,
        {
          method: "POST",
          body: JSON.stringify({ reason }),
        },
      );
      if ((res.printQueued ?? 0) > 0) {
        toast.push(t("bills.cancelled", { n: res.orderNo }), "ok");
      } else {
        toast.push(
          res.printError
            ? `${t("bills.cancelledNoPrint", { n: res.orderNo })} — ${res.printError}`
            : t("bills.cancelledNoPrint", { n: res.orderNo }),
          "err",
        );
      }
      setSelected(null);
      setEditing(false);
      void load();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("bills.cancelFailed"), "err");
    } finally {
      setCancelling(false);
    }
  }

  async function reverseOrder() {
    if (!selected || !can("order.edit")) return;
    if (selected.paymentStatus !== "PAID" || selected.status === "CANCELLED") return;
    const reason = await askPrompt({
      title: t("bills.reverseConfirmTitle"),
      body: t("bills.reverseConfirmBody", { n: selected.orderNo }),
      confirmLabel: t("bills.reverseConfirm"),
      danger: true,
      inputLabel: t("bills.reverseReason"),
      inputPlaceholder: t("bills.reverseReasonPh"),
      inputRequired: true,
      inputMaxLength: 200,
    });
    if (!reason) return;
    setCancelling(true);
    try {
      const res = await api<Order>(`/orders/${selected.id}/reverse`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      toast.push(t("bills.reversed", { n: res.orderNo }), "ok");
      setSelected(null);
      setEditing(false);
      void load();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("bills.reverseFailed"), "err");
    } finally {
      setCancelling(false);
    }
  }

  async function printCancelSlip(orderId: string) {
    try {
      const res = await api<{ queued: number; jobs: { error: string | null }[] }>(
        `/orders/${orderId}/print-cancel-kot`,
        { method: "POST", body: "{}" },
      );
      if (!res.queued) throw new Error(t("common.printFailed"));
      const failed = res.jobs.find((j) => j.error);
      if (failed?.error) throw new Error(failed.error);
      toast.push(t("bills.cancelSlipSent"), "ok");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("common.printFailed"), "err");
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
                  CancelReason: o.cancelReason || "",
                  CancelledBy: o.cancelledBy?.name || "",
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
          {(
            [
              { key: "UNPAID" as const, n: tally.unpaidCount },
              { key: "PAID" as const, n: tally.paidCount },
              { key: "CANCELLED" as const, n: tally.cancelledCount },
              {
                key: "ALL" as const,
                n: tally.unpaidCount + tally.paidCount + tally.cancelledCount,
              },
            ] as const
          ).map((f) => (
            <button
              key={f.key}
              type="button"
              className={`btn ${filter === f.key ? "" : "ghost"} sm`}
              onClick={() => setFilter(f.key)}
            >
              {ts(f.key)}
              <span className="tiny" style={{ marginLeft: "0.35rem", opacity: 0.8 }}>
                ({f.n})
              </span>
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
            {tally.unpaidCount}
            <span className="tiny muted" style={{ display: "block", fontWeight: 500 }}>
              {money(tally.unpaidAmount)}
            </span>
          </strong>
        </div>
        <div className="panel stat">
          <span>{t("bills.ordersToday")}</span>
          <strong>{stats?.ordersToday ?? "—"}</strong>
        </div>
        <div className="panel stat">
          <span>{t("bills.cancelledToday")}</span>
          <strong style={{ color: tally.cancelledToday || tally.cancelledCount ? "var(--danger)" : undefined }}>
            {tally.cancelledToday}
            <span className="tiny muted" style={{ display: "block", fontWeight: 500 }}>
              {t("bills.cancelledAll", { n: tally.cancelledCount })}
              {tally.cancelledCount > 0 ? ` · ${money(tally.cancelledAmount)}` : ""}
            </span>
          </strong>
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
            {stats?.completed ?? "—"} / {tally.paidCount}
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
                <th />
                <th>{t("common.table")}</th>
                <th>{t("common.time")}</th>
                <th>{t("bills.orderedBy")}</th>
                <th>{t("bills.assignedCashier")}</th>
                <th>{t("common.items")}</th>
                <th>{t("bills.kitchen")}</th>
                <th>{t("bills.cancelReasonCol")}</th>
                <th>{t("common.total")}</th>
                <th>{t("bills.tip")}</th>
                <th>{t("bills.pay")}</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((o) => {
                const itemsText = o.items
                  .map((i) => `${i.quantity} ${unitLabel(i.sellUnit)} ${i.name}`)
                  .join(", ");
                const cancelled = o.status === "CANCELLED";
                return (
                <tr
                  key={o.id}
                  className={
                    cancelled
                      ? "bill-cancelled-row"
                      : o.billRequestedAt && o.paymentStatus !== "PAID"
                        ? "bill-requested-row"
                        : undefined
                  }
                >
                  <td>{o.orderNo}</td>
                  <td className="row">
                    {can("order.pay") && o.paymentStatus !== "PAID" && !cancelled && (
                      <button type="button" className="btn ok sm" onClick={() => setPaying(o)}>
                        {t("bills.pay")}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => openBill(o)}
                    >
                      {t("bills.open")}
                    </button>
                    {cancelled && (can("order.edit") || can("print.kot")) && (
                      <button
                        type="button"
                        className="btn danger sm"
                        onClick={() => void printCancelSlip(o.id)}
                      >
                        {t("bills.printCancelSlip")}
                      </button>
                    )}
                  </td>
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
                  <td className="cell-ellipsis" title={itemsText}>
                    {itemsText}
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        cancelled
                          ? "cancelled"
                          : o.status === "PENDING" || o.status === "PREPARING"
                            ? "pending"
                            : "ready"
                      }`}
                    >
                      {ts(o.status)}
                    </span>
                  </td>
                  <td className="tiny">
                    {cancelled ? (
                      <>
                        <div>{o.cancelReason || "—"}</div>
                        {o.cancelledBy?.name && (
                          <div className="muted">
                            {t("bills.cancelledBy", { name: o.cancelledBy.name })}
                          </div>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{money(o.total)}</td>
                  <td>{(o.tipAmount ?? 0) > 0 ? money(o.tipAmount ?? 0) : "—"}</td>
                  <td>
                    <span
                      className={`badge ${
                        cancelled ? "cancelled" : o.paymentStatus === "PAID" ? "paid" : "unpaid"
                      }`}
                    >
                      {cancelled ? ts("CANCELLED") : ts(o.paymentStatus)}
                    </span>
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
              {selected.status === "CANCELLED" && (
                <div className="pay-summary no-print" style={{ marginBottom: "0.75rem" }}>
                  <span>{t("bills.cancelReason")}</span>
                  <strong style={{ color: "var(--danger)" }}>
                    {selected.cancelReason || "—"}
                    {selected.cancelledBy?.name
                      ? ` · ${t("bills.cancelledBy", { name: selected.cancelledBy.name })}`
                      : ""}
                  </strong>
                </div>
              )}
              {can("order.edit") &&
              selected.status !== "CANCELLED" &&
              selected.paymentStatus !== "PAID" &&
              editing &&
              editMeta ? (
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
                  {selected.items.map((i) => {
                    if (!i.id) return null;
                    const rules = menuRulesForItem(i);
                    const cur = editQty[i.id] ?? i.quantity;
                    const removed = cur <= 0;
                    const issue = existingQtyIssue(i);
                    const minQ = minQtyOf(rules);
                    const maxQ = maxQtyOf(rules);
                    const issueMsg =
                      issue === "below_min"
                        ? t("waiter.qtyKeepAbove", { n: minQ, u: unitLabel(i.sellUnit) })
                        : issue === "above_max" && maxQ != null
                          ? t("waiter.qtyKeepBelow", { n: maxQ, u: unitLabel(i.sellUnit) })
                          : issue === "invalid"
                            ? t("waiter.qtyInvalid")
                            : issue === "bad_step"
                              ? t("waiter.qtyBadStep", {
                                  n: qtyStepOf(rules),
                                  u: unitLabel(i.sellUnit),
                                })
                              : null;
                    return (
                      <div
                        key={i.id}
                        className={`waiter-line${issue || removed ? " qty-error" : ""}`}
                        style={{ marginBottom: "0.35rem" }}
                      >
                        <div className="row" style={{ justifyContent: "space-between", gap: "0.5rem" }}>
                          <span>
                            {i.name}
                            <span className="tiny muted"> · {unitLabel(i.sellUnit)}</span>
                            {removed ? (
                              <span className="tiny qty-error-msg"> · {t("bills.itemRemoved")}</span>
                            ) : null}
                          </span>
                          {!removed ? (
                            <button
                              type="button"
                              className="btn danger sm"
                              onClick={() => setExistingQty(i.id!, 0, i)}
                            >
                              {t("bills.removeItem")}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn ghost sm"
                              onClick={() => setExistingQty(i.id!, startQtyOf(rules) || i.quantity || 1, i)}
                            >
                              {t("bills.undoRemove")}
                            </button>
                          )}
                        </div>
                        {!removed && (
                          <>
                            <div className="row waiter-qty">
                              <button
                                type="button"
                                className="qty-btn"
                                onClick={() => {
                                  const base = Number(existingQtyText(i.id!, i.quantity));
                                  const from = Number.isFinite(base) ? base : cur;
                                  const proposed = +(from - qtyStepOf(rules)).toFixed(3);
                                  setExistingQty(
                                    i.id!,
                                    proposed + 1e-9 < startQtyOf(rules) ? 0 : proposed,
                                    i
                                  );
                                }}
                              >
                                −
                              </button>
                              <input
                                className={`field-ctrl sm${issue ? " qty-error-input" : ""}`}
                                style={{ textAlign: "center" }}
                                type="text"
                                inputMode="decimal"
                                value={existingQtyText(i.id, i.quantity)}
                                onChange={(e) => setExistingQtyTyped(i.id!, e.target.value)}
                                aria-invalid={!!issue}
                              />
                              <span className="tiny muted">{unitLabel(i.sellUnit)}</span>
                              <button
                                type="button"
                                className="qty-btn"
                                onClick={() => {
                                  const base = Number(existingQtyText(i.id!, i.quantity));
                                  const from = Number.isFinite(base) && base > 0 ? base : cur;
                                  setExistingQty(i.id!, bumpQty(rules, from, 1), i);
                                }}
                              >
                                +
                              </button>
                            </div>
                            {issueMsg ? (
                              <div className="tiny qty-error-msg">{issueMsg}</div>
                            ) : minQ || maxQ != null ? (
                              <div className="tiny muted">
                                {minQ ? t("waiter.qtyMin", { n: minQ, u: unitLabel(i.sellUnit) }) : null}
                                {maxQ != null
                                  ? `${minQ ? " · " : ""}${t("waiter.qtyMaxHint", { n: maxQ, u: unitLabel(i.sellUnit) })}`
                                  : null}
                              </div>
                            ) : null}
                          </>
                        )}
                      </div>
                    );
                  })}

                  {editAdds.map((a) => {
                    const issue = addQtyIssue(a);
                    const minQ = minQtyOf(a);
                    const maxQ = maxQtyOf(a);
                    const issueMsg =
                      issue === "below_min"
                        ? t("waiter.qtyKeepAbove", { n: minQ, u: unitLabel(a.sellUnit) })
                        : issue === "above_max" && maxQ != null
                          ? t("waiter.qtyKeepBelow", { n: maxQ, u: unitLabel(a.sellUnit) })
                          : issue === "invalid"
                            ? t("waiter.qtyInvalid")
                            : null;
                    return (
                      <div
                        key={a.tempId}
                        className={`waiter-line${issue ? " qty-error" : ""}`}
                        style={{ marginBottom: "0.35rem" }}
                      >
                        <div className="row" style={{ justifyContent: "space-between", gap: "0.5rem" }}>
                          <span>
                            <span className="badge">{t("bills.newItem")}</span> {a.name}
                            <span className="tiny muted"> · {unitLabel(a.sellUnit)}</span>
                          </span>
                          <button
                            type="button"
                            className="btn danger sm"
                            onClick={() => setAddQty(a.tempId, 0)}
                          >
                            {t("bills.removeItem")}
                          </button>
                        </div>
                        <div className="row waiter-qty">
                          <button
                            type="button"
                            className="qty-btn"
                            onClick={() => {
                              const base = Number(editQtyDraft[a.tempId] ?? a.quantity);
                              const from = Number.isFinite(base) ? base : a.quantity;
                              setAddQty(a.tempId, +(from - qtyStepOf(a)).toFixed(3));
                            }}
                          >
                            −
                          </button>
                          <input
                            className={`field-ctrl sm${issue ? " qty-error-input" : ""}`}
                            style={{ textAlign: "center" }}
                            type="text"
                            inputMode="decimal"
                            value={editQtyDraft[a.tempId] ?? String(a.quantity)}
                            onChange={(e) => setAddQtyTyped(a.tempId, e.target.value)}
                            aria-invalid={!!issue}
                          />
                          <span className="tiny muted">{unitLabel(a.sellUnit)}</span>
                          <button
                            type="button"
                            className="qty-btn"
                            onClick={() => {
                              const base = Number(editQtyDraft[a.tempId] ?? a.quantity);
                              const from = Number.isFinite(base) && base > 0 ? base : a.quantity;
                              setAddQty(a.tempId, bumpQty(rulesOf(a), from, 1));
                            }}
                          >
                            +
                          </button>
                        </div>
                        {issueMsg ? <div className="tiny qty-error-msg">{issueMsg}</div> : null}
                      </div>
                    );
                  })}

                  <div className="field" style={{ marginTop: "0.75rem" }}>
                    <label>{t("bills.addItem")}</label>
                    <input
                      className="field-ctrl wide"
                      value={addSearch}
                      onChange={(e) => setAddSearch(e.target.value)}
                      placeholder={t("bills.addItemPh")}
                      autoComplete="off"
                    />
                    {addSearch.trim() ? (
                      <div className="suggest-list">
                        {editMenu
                          .filter((m) => matchesSearch(addSearch, m.name, m.category, m.sellUnit))
                          .slice(0, 8)
                          .map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              className="suggest-item"
                              onClick={() => addMenuToEdit(m)}
                            >
                              <strong>{m.name}</strong>
                              <span className="tiny muted">
                                {m.category} · {money(m.sellingPrice)} / {unitLabel(m.sellUnit)}
                              </span>
                            </button>
                          ))}
                        {!editMenu.filter((m) => matchesSearch(addSearch, m.name, m.category, m.sellUnit)).length ? (
                          <div className="tiny muted" style={{ padding: "0.5rem 0.65rem" }}>
                            {t("waiter.noItems")}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : thermal?.text ? (
                <div
                  className="bill-design-preview-frame"
                  style={{ ["--preview-mm" as string]: `${thermal.paperWidth || 80}mm` }}
                >
                  <ThermalPreview
                    text={thermal.text}
                    paperWidth={thermal.paperWidth}
                    logoUrl={thermal.logoUrl}
                    paidStampUrl={thermal.paidStampUrl}
                    unpaidStampUrl={thermal.unpaidStampUrl}
                  />
                </div>
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
              {can("order.edit") &&
                selected.status !== "CANCELLED" &&
                selected.paymentStatus !== "PAID" &&
                (editing ? (
                  <>
                    <button
                      type="button"
                      className="btn"
                      disabled={savingEdit || !!editQtyBlocked}
                      onClick={() => void saveEdit()}
                    >
                      {savingEdit ? t("common.saving") : t("bills.saveEdit")}
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => {
                        setEditing(false);
                        setEditAdds([]);
                        setEditQtyDraft({});
                        setAddSearch("");
                      }}
                    >
                      {t("common.cancel")}
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="btn ghost" onClick={() => void startBillEdit(selected)}>
                      {t("bills.editOrder")}
                    </button>
                    <button
                      type="button"
                      className="btn danger"
                      disabled={cancelling || (selected.paidAmount ?? 0) > 0}
                      onClick={() => void cancelOrder()}
                      title={(selected.paidAmount ?? 0) > 0 ? t("bills.cancelFailed") : undefined}
                    >
                      {cancelling ? t("common.saving") : t("bills.cancelOrder")}
                    </button>
                  </>
                ))}
              {can("order.edit") &&
                selected.paymentStatus === "PAID" &&
                selected.status !== "CANCELLED" &&
                !editing && (
                  <button
                    type="button"
                    className="btn danger"
                    disabled={cancelling}
                    onClick={() => void reverseOrder()}
                  >
                    {cancelling ? t("common.saving") : t("bills.reversePayment")}
                  </button>
                )}
              {selected.status === "CANCELLED" &&
                (can("order.edit") || can("print.kot")) &&
                !editing && (
                <button type="button" className="btn danger" onClick={() => void printCancelSlip(selected.id)}>
                  {t("bills.printCancelSlip")}
                </button>
              )}
              {can("print.bill") && selected.status !== "CANCELLED" && !editing && (
                <button type="button" className="btn" onClick={() => void printOnServer(selected.id)}>
                  {t("common.printOnPrinter")}
                </button>
              )}
              {selected.status !== "CANCELLED" && !editing && (
                <button type="button" className="btn ghost" onClick={printBill}>
                  {t("common.browserPrint")}
                </button>
              )}
              {can("order.pay") &&
                selected.paymentStatus !== "PAID" &&
                selected.status !== "CANCELLED" &&
                !editing && (
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
