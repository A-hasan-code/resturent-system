import { useCallback, useEffect, useMemo, useState } from "react";
import { api, money, unitLabel } from "../api";
import { useAuth } from "../auth";
import { useToast } from "../toast";
import { useSocketEvent } from "../socket";
import { serverPrint, useKotPreviewPref } from "../printing";
import { SearchField, matchesSearch } from "../components/SearchField";
import { KotPreviewModal, type KotTarget } from "../components/KotPreviewModal";
import { PayModal } from "../components/PayModal";
import { PickServerModal } from "../components/PickServerModal";
import { PickCashierModal } from "../components/PickCashierModal";
import { MessageKey, useI18n, useT } from "../i18n";

type OrderSummary = {
  id: string;
  orderNo: number;
  status: string;
  paymentStatus: string;
  total: number;
  billRequested: boolean;
  waiterId: string | null;
  waiter: string | null;
  assignedCashierId: string | null;
  assignedCashier: { id: string; name: string; roleCode: string } | null;
  since: string;
  label?: string;
};

type TableCard = {
  id: string;
  name: string;
  label: string;
  area: string | null;
  partitionId: string;
  partitionName: string;
  seats: number;
  order: OrderSummary | null;
};

type TakeawayCard = OrderSummary & { label: string };

type PartitionBoard = {
  id: string;
  name: string;
  sortOrder: number;
  tables: TableCard[];
};

type TablesBoard = {
  partitions: PartitionBoard[];
  tables: TableCard[];
  takeaway?: TakeawayCard[];
};

const twKey = (orderId: string) => `tw:${orderId}`;
const isTwKey = (sel: string | null) => !!sel && sel.startsWith("tw:");
const twId = (sel: string) => sel.slice(3);

type MenuItem = { id: string; name: string; category: string | null; sellUnit: string; sellingPrice: number };

type OrderItem = {
  id: string;
  lineKind?: "MENU" | "PER_HEAD";
  name: string;
  sellUnit: string;
  quantity: number;
  amount: number;
  notes: string | null;
  kotRound: number;
  addedBy: string | null;
};

type Order = {
  id: string;
  orderNo: number;
  tableNo: string | null;
  status: string;
  paymentStatus: string;
  total: number;
  paidAmount: number;
  tipAmount?: number;
  kotRounds: number;
  billRequestedAt: string | null;
  waiter: string | null;
  waiterId?: string | null;
  servedByName?: string | null;
  servedBy?: string | null;
  orderedBy?: { id: string; name: string; roleCode: string; roleName: string } | null;
  assignedCashier?: { id: string; name: string; roleCode: string; roleName: string } | null;
  items: OrderItem[];
};

type CartLine = {
  cartKey: string;
  kind: "MENU" | "PER_HEAD";
  menuItemId?: string;
  name: string;
  sellUnit: string;
  rate: number;
  quantity: number;
  notes: string;
};

type PerHeadCfg = { enabled: boolean; amount: number; label: string };

const WALK_IN = "__walkin__";
const PER_HEAD_KEY = "__per_head__";

const step = (unit: string) => (unit === "KG" || unit === "L" ? 0.5 : 1);
const quickQty = (unit: string) => (unit === "KG" || unit === "L" ? [0.5, 1, 1.5, 2] : [1, 2, 3, 4]);

function minutesSince(
  iso: string,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
) {
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return t("dash.minN", { n: m });
  return t("dash.hm", { h: Math.floor(m / 60), m: m % 60 });
}

function roundTakers(items: OrderItem[]) {
  return [...new Set(items.map((i) => i.addedBy).filter(Boolean))].join(", ");
}

function orderCardState(o: OrderSummary | null | undefined) {
  if (!o) return "free";
  if (o.billRequested) return "bill";
  if (o.status === "READY") return "ready";
  return "busy";
}

function tableState(t: TableCard) {
  return orderCardState(t.order);
}

export function WaiterPage() {
  const { can, user } = useAuth();
  const toast = useToast();
  const t = useT();
  const { ts } = useI18n();
  const [previewFirst, setPreviewFirst] = useKotPreviewPref(user);
  const [kot, setKot] = useState<KotTarget | null>(null);
  const closeKot = useCallback(() => setKot(null), []);
  const [partitions, setPartitions] = useState<PartitionBoard[]>([]);
  const [tables, setTables] = useState<TableCard[]>([]);
  const [takeaways, setTakeaways] = useState<TakeawayCard[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [walkInName, setWalkInName] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const [paying, setPaying] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cat, setCat] = useState("ALL");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [pickServer, setPickServer] = useState(false);
  const [pickCashier, setPickCashier] = useState(false);
  const [pendingServer, setPendingServer] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editQty, setEditQty] = useState<Record<string, number>>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [perHead, setPerHead] = useState<PerHeadCfg | null>(null);

  const selectedTable = tables.find((tbl) => tbl.id === selected) ?? null;
  const selectedTakeaway = isTwKey(selected)
    ? takeaways.find((tw) => tw.id === twId(selected!)) ?? null
    : null;
  const selectedLabel =
    selected === WALK_IN
      ? t("waiter.takeaway")
      : selectedTakeaway
        ? selectedTakeaway.label || t("waiter.takeaway")
        : selectedTable?.label || selectedTable?.name || "";

  const needsCashierPick = !order && !can("cash.keep");
  const isCashierRole = ["CASHIER", "MAIN_CASHIER"].includes(user?.roleCode ?? "");
  const isTakeawayView = selected === WALK_IN || isTwKey(selected);
  /** Kitchen KOT reprint is for floor/kitchen — not cashier counters. */
  const canReprintKot = can("print.kot") && !isCashierRole;
  /** Counter takeaway: customer is at cashier — skip request/print unpaid bill; Take payment prints PAID. */
  const showTakeawayCashierBillActions = !(isTakeawayView && isCashierRole);
  const canAddPerHead =
    ["SUPERVISOR", "ADMIN", "MANAGER"].includes(user?.roleCode ?? "") || can("users.manage");
  const showPerHeadBtn = canAddPerHead && !!perHead?.enabled && (perHead?.amount ?? 0) > 0;
  const cartHasMenu = cart.some((c) => c.kind === "MENU");

  const loadTables = useCallback(async () => {
    try {
      const board = await api<TablesBoard>("/tables");
      setPartitions(board.partitions ?? []);
      setTables(board.tables ?? []);
      setTakeaways(board.takeaway ?? []);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("waiter.loadFailed"), "err");
    }
  }, [toast, t]);

  const loadOrder = useCallback(async (orderId: string | null | undefined) => {
    if (!orderId) {
      setOrder(null);
      return;
    }
    try {
      setOrder(await api<Order>(`/orders/${orderId}`));
    } catch {
      setOrder(null);
    }
  }, []);

  useEffect(() => {
    void loadTables();
    api<MenuItem[]>("/menu")
      .then(setMenu)
      .catch((e) => toast.push(e instanceof Error ? e.message : t("waiter.loadFailed"), "err"));
    const timer = setInterval(() => void loadTables(), 30000);
    return () => clearInterval(timer);
  }, [loadTables, toast, t]);

  useEffect(() => {
    if (!canAddPerHead) {
      setPerHead(null);
      return;
    }
    let cancelled = false;
    const apply = (cfg: PerHeadCfg | null | undefined) => {
      if (!cancelled && cfg) setPerHead(cfg);
    };
    api<PerHeadCfg>("/orders/per-head")
      .then(apply)
      .catch(() =>
        api<{ billing?: { perHead?: PerHeadCfg } }>("/system/settings")
          .then((s) => apply(s.billing?.perHead))
          .catch(() => {
            if (!cancelled) setPerHead(null);
          })
      );
    return () => {
      cancelled = true;
    };
  }, [canAddPerHead, user?.id]);

  useEffect(() => {
    if (isTwKey(selected)) {
      void loadOrder(twId(selected!));
      return;
    }
    void loadOrder(selectedTable?.order?.id);
  }, [selected, selectedTable?.order?.id, loadOrder]);

  useSocketEvent("orders.changed", () => {
    void loadTables();
    if (order) void loadOrder(order.id);
  });

  const categories = useMemo(
    () => ["ALL", ...Array.from(new Set(menu.map((m) => m.category || "General")))],
    [menu]
  );

  const shownMenu = menu.filter(
    (m) =>
      (cat === "ALL" || (m.category || "General") === cat) &&
      matchesSearch(q, m.name, m.category)
  );

  const cartTotal = cart.reduce((s, l) => s + l.rate * l.quantity, 0);

  function canOpenOrder(o: OrderSummary | null | undefined) {
    if (!o) return true;
    if (!o.waiterId || o.waiterId === user?.id) return true;
    if (o.assignedCashierId === user?.id) return true;
    if (can("order.edit") || can("users.manage") || can("order.pay")) return true;
    return false;
  }

  function openTable(tbl: TableCard) {
    if (!canOpenOrder(tbl.order)) {
      toast.push(
        tbl.order?.waiter
          ? t("waiter.tableBooked", { name: tbl.order.waiter })
          : t("waiter.tableBookedGeneric"),
        "err"
      );
      return;
    }
    setSelected(tbl.id);
    setCart([]);
    setQ("");
    setNoteFor(null);
    setEditing(false);
  }

  function openTakeaway(tw: TakeawayCard) {
    if (!canOpenOrder(tw)) {
      toast.push(
        tw.waiter ? t("waiter.tableBooked", { name: tw.waiter }) : t("waiter.tableBookedGeneric"),
        "err"
      );
      return;
    }
    setSelected(twKey(tw.id));
    setCart([]);
    setQ("");
    setNoteFor(null);
    setEditing(false);
    setWalkInName(tw.label === "Takeaway" ? "" : tw.label);
  }

  function openWalkIn() {
    setSelected(WALK_IN);
    setCart([]);
    setQ("");
    setNoteFor(null);
    setOrder(null);
    setEditing(false);
    setWalkInName("");
  }

  function back() {
    setSelected(null);
    setOrder(null);
    setCart([]);
    setWalkInName("");
    setEditing(false);
  }

  function add(m: MenuItem) {
    setCart((prev) => {
      const hit = prev.find((p) => p.cartKey === m.id);
      if (hit) {
        return prev.map((p) =>
          p.cartKey === m.id ? { ...p, quantity: +(p.quantity + step(m.sellUnit)).toFixed(3) } : p
        );
      }
      return [
        ...prev,
        {
          cartKey: m.id,
          kind: "MENU",
          menuItemId: m.id,
          name: m.name,
          sellUnit: m.sellUnit,
          rate: m.sellingPrice,
          quantity: 1,
          notes: "",
        },
      ];
    });
  }

  function addPerHead() {
    if (!perHead?.enabled || perHead.amount <= 0) {
      toast.push(t("waiter.perHeadDisabled"), "err");
      return;
    }
    setCart((prev) => {
      const hit = prev.find((p) => p.cartKey === PER_HEAD_KEY);
      if (hit) {
        return prev.map((p) =>
          p.cartKey === PER_HEAD_KEY ? { ...p, quantity: p.quantity + 1, rate: perHead.amount, name: perHead.label } : p
        );
      }
      return [
        ...prev,
        {
          cartKey: PER_HEAD_KEY,
          kind: "PER_HEAD",
          name: perHead.label,
          sellUnit: "PCS",
          rate: perHead.amount,
          quantity: 1,
          notes: "",
        },
      ];
    });
  }

  function setQty(id: string, qty: number) {
    setCart((prev) =>
      qty <= 0 ? prev.filter((p) => p.cartKey !== id) : prev.map((p) => (p.cartKey === id ? { ...p, quantity: +qty.toFixed(3) } : p))
    );
  }

  function setNote(id: string, notes: string) {
    setCart((prev) => prev.map((p) => (p.cartKey === id ? { ...p, notes } : p)));
  }

  async function sendToKitchen() {
    if (!cart.length) return;
    setPickServer(true);
  }

  function afterServerPicked(serverName: string) {
    setPickServer(false);
    if (needsCashierPick) {
      setPendingServer(serverName);
      setPickCashier(true);
      return;
    }
    void sendOrder(serverName);
  }

  function afterCashierPicked(cashierId: string) {
    setPickCashier(false);
    const serverName = pendingServer || user?.name || "";
    setPendingServer(null);
    void sendOrder(serverName, cashierId);
  }

  async function sendOrder(serverName: string, assignedCashierId?: string) {
    setBusy(true);
    const hasMenu = cart.some((c) => c.kind === "MENU");
    const items = cart.map((c) =>
      c.kind === "PER_HEAD"
        ? { kind: "PER_HEAD" as const, quantity: c.quantity, notes: c.notes || undefined }
        : { menuItemId: c.menuItemId!, quantity: c.quantity, notes: c.notes || undefined }
    );
    const preview = hasMenu && previewFirst && canReprintKot;
    try {
      const isNewWalkIn = selected === WALK_IN;
      const isTakeaway = isNewWalkIn || isTwKey(selected);
      const tableNo = isTakeaway
        ? walkInName.trim() || order?.tableNo || "Takeaway"
        : selectedTable?.label || selectedTable?.name || "";
      const body = { items, printKot: hasMenu && !preview, servedByName: serverName };
      const res = order
        ? await api<Order>(`/orders/${order.id}/items`, { method: "POST", body: JSON.stringify(body) })
        : await api<Order>("/orders", {
            method: "POST",
            body: JSON.stringify({
              ...body,
              tableNo,
              ...(selectedTable && !isTakeaway ? { tableId: selectedTable.id } : {}),
              ...(assignedCashierId ? { assignedCashierId } : {}),
            }),
          });
      if (!hasMenu) {
        toast.push(t("waiter.sentBillOnly", { n: res.orderNo }), "ok");
      } else if (preview) {
        toast.push(t("waiter.sent", { n: res.orderNo }), "ok");
        setKot({ orderId: res.id, round: res.kotRounds, reprint: false });
      } else {
        toast.push(t("waiter.sentPrint", { n: res.orderNo }), "ok");
      }
      setCart([]);
      setOrder(res);
      if (isTakeaway) setSelected(twKey(res.id));
      void loadTables();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("waiter.sendFailed"), "err");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (!order || !can("order.edit")) return;
    const items = Object.entries(editQty).map(([id, quantity]) => ({ id, quantity }));
    if (!items.length) return;
    setSavingEdit(true);
    try {
      const updated = await api<Order>(`/orders/${order.id}/edit`, {
        method: "POST",
        body: JSON.stringify({ items }),
      });
      setOrder(updated);
      setEditing(false);
      toast.push(t("bills.editSaved"), "ok");
      void loadTables();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("bills.editFailed"), "err");
    } finally {
      setSavingEdit(false);
    }
  }

  async function reprint(round?: number) {
    if (!order) return;
    if (previewFirst) {
      setKot({ orderId: order.id, round, reprint: true });
      return;
    }
    try {
      await serverPrint("kot", order.id, { round });
      toast.push(t("waiter.reprinting"), "ok");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("common.printFailed"), "err");
    }
  }

  async function requestBill() {
    if (!order) return;
    try {
      await api(`/orders/${order.id}/request-bill`, { method: "POST", body: "{}" });
      toast.push(t("waiter.billAsked"), "ok");
      void loadOrder(order.id);
      void loadTables();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("waiter.requestFailed"), "err");
    }
  }

  async function printBillNow() {
    if (!order) return;
    try {
      await serverPrint("bill", order.id);
      toast.push(t("waiter.printingBill"), "ok");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("common.printFailed"), "err");
    }
  }

  function paid() {
    setPaying(false);
    void loadTables();
    back();
  }

  function catLabel(c: string) {
    if (c === "ALL") return t("common.all");
    if (c === "General") return t("common.general");
    return c;
  }

  function renderOrderBits(o: OrderSummary) {
    return (
      <>
        <span className="tiny">
          #{o.orderNo} · {minutesSince(o.since, t)}
        </span>
        <span className="tiny">
          {o.billRequested ? t("waiter.billRequested") : ts(o.status)}
          {o.waiter ? ` · ${o.waiter}` : ""}
        </span>
        {o.assignedCashier && (
          <span className="tiny muted">
            {t("waiter.cashier")}: {o.assignedCashier.name}
          </span>
        )}
        <span className="tiny">{money(o.total)}</span>
      </>
    );
  }

  function renderTableCard(tbl: TableCard) {
    return (
      <button
        key={tbl.id}
        type="button"
        className={`table-card ${tableState(tbl)}`}
        onClick={() => openTable(tbl)}
      >
        <strong>{tbl.name}</strong>
        <span className="tiny">{tbl.partitionName || tbl.area || ""}</span>
        {tbl.order ? renderOrderBits(tbl.order) : <span className="tiny">{t("waiter.free")}</span>}
      </button>
    );
  }

  function renderTakeawayCard(tw: TakeawayCard) {
    return (
      <button
        key={tw.id}
        type="button"
        className={`table-card walkin ${orderCardState(tw)}`}
        onClick={() => openTakeaway(tw)}
      >
        <strong>{tw.label || t("waiter.takeaway")}</strong>
        <span className="tiny">{t("waiter.takeaway")}</span>
        {renderOrderBits(tw)}
      </button>
    );
  }

  const kotModal = (
    <>
      <PickServerModal
        open={pickServer}
        initialName={order?.servedByName || order?.servedBy}
        orderTakenBy={order?.orderedBy?.name || order?.waiter || user?.name}
        onClose={() => setPickServer(false)}
        onPick={(name) => afterServerPicked(name)}
      />
      <PickCashierModal
        open={pickCashier}
        onClose={() => {
          setPickCashier(false);
          setPendingServer(null);
        }}
        onPick={(id) => afterCashierPicked(id)}
      />
      <KotPreviewModal target={kot} onClose={closeKot} />
      <PayModal order={paying ? order : null} onClose={() => setPaying(false)} onPaid={paid} />
    </>
  );

  // ---------- table grid ----------
  if (!selected) {
    const busyCount = tables.filter((tbl) => tbl.order).length + takeaways.length;
    const sections =
      partitions.length > 0
        ? partitions
        : [{ id: "_all", name: "", sortOrder: 0, tables }];
    return (
      <div className="waiter">
        {kotModal}
        <div className="page-head">
          <div>
            <h1>{t("waiter.title")}</h1>
            <p>
              {t("waiter.occupied", { n: busyCount })} ·{" "}
              {t("waiter.freeCount", { n: tables.length - tables.filter((x) => x.order).length })} ·{" "}
              {t("waiter.takeawayOpen", { n: takeaways.length })} · {t("waiter.hint")}
            </p>
          </div>
          <button type="button" className="btn ghost sm" onClick={() => void loadTables()}>
            {t("common.refresh")}
          </button>
        </div>
        <div className="table-legend tiny muted">
          <span className="dot free" /> {t("waiter.free")}{" "}
          <span className="dot busy" /> {t("waiter.inProgress")}
          <span className="dot ready" /> {t("waiter.foodReady")}{" "}
          <span className="dot bill" /> {t("waiter.billRequested")}
        </div>
        {sections.map((p) => (
          <div key={p.id} className="table-partition" style={{ marginBottom: "1.25rem" }}>
            {p.name ? (
              <h2 style={{ margin: "0 0 0.6rem", fontSize: "1.05rem" }}>{p.name}</h2>
            ) : null}
            <div className="table-grid">
              {p.tables.map(renderTableCard)}
            </div>
          </div>
        ))}
        <div className="table-partition" style={{ marginTop: "0.5rem" }}>
          <h2 style={{ margin: "0 0 0.6rem", fontSize: "1.05rem" }}>{t("waiter.takeawaySection")}</h2>
          <div className="table-grid">
            <button type="button" className="table-card walkin free" onClick={openWalkIn}>
              <strong>+ {t("waiter.newTakeaway")}</strong>
              <span className="tiny">{t("waiter.walkInParcel")}</span>
            </button>
            {takeaways.map(renderTakeawayCard)}
          </div>
        </div>
      </div>
    );
  }

  // ---------- order screen ----------
  const rounds = order
    ? Array.from({ length: order.kotRounds }, (_, i) => i + 1).map((r) => ({
        round: r,
        items: order.items.filter((i) => i.lineKind !== "PER_HEAD" && i.kotRound === r),
      })).filter((r) => r.items.length)
    : [];
  const billOnlyItems = order?.items.filter((i) => i.lineKind === "PER_HEAD") ?? [];
  const showSentBlock = rounds.length > 0 || billOnlyItems.length > 0 || editing;

  return (
    <div className="waiter">
      {kotModal}
      <div className="page-head">
        <div className="row">
          <button type="button" className="btn ghost" onClick={back}>
            {t("waiter.backTables")}
          </button>
          <div>
            <h1 style={{ margin: 0 }}>{selectedLabel}</h1>
            <p style={{ margin: 0 }}>
              {order
                ? `${t("common.order")} #${order.orderNo} · ${ts(order.status)}${order.billRequestedAt ? ` · ${t("waiter.billRequested")}` : ""}`
                : t("waiter.newOrder")}
              {order?.assignedCashier ? ` · ${t("waiter.cashier")}: ${order.assignedCashier.name}` : ""}
            </p>
          </div>
        </div>
        {(selected === WALK_IN || (isTwKey(selected) && !order)) && (
          <input
            className="walkin-name"
            value={walkInName}
            onChange={(e) => setWalkInName(e.target.value)}
            placeholder={t("waiter.customerName")}
          />
        )}
      </div>

      <div className="waiter-layout">
        <section className="panel panel-pad">
          <SearchField value={q} onChange={setQ} placeholder={t("waiter.searchMenu")} />
          <div className="chips" style={{ marginTop: "0.6rem" }}>
            {categories.map((c) => (
              <button key={c} type="button" className={`chip ${cat === c ? "active" : ""}`} onClick={() => setCat(c)}>
                {catLabel(c)}
              </button>
            ))}
          </div>
          <div className="waiter-menu">
            {showPerHeadBtn && (
              <button
                type="button"
                className={`waiter-item waiter-item-perhead ${cart.some((c) => c.cartKey === PER_HEAD_KEY) ? "in-cart" : ""}`}
                onClick={addPerHead}
                title={t("waiter.perHeadHint")}
              >
                <strong>{perHead!.label || t("waiter.perHead")}</strong>
                <span className="tiny muted">
                  {money(perHead!.amount)} / {unitLabel("PCS")} · {t("waiter.onBill")}
                </span>
                {cart.find((c) => c.cartKey === PER_HEAD_KEY) && (
                  <span className="waiter-item-qty">
                    {cart.find((c) => c.cartKey === PER_HEAD_KEY)!.quantity} {unitLabel("PCS")}
                  </span>
                )}
              </button>
            )}
            {shownMenu.map((m) => {
              const inCart = cart.find((c) => c.cartKey === m.id);
              return (
                <button key={m.id} type="button" className={`waiter-item ${inCart ? "in-cart" : ""}`} onClick={() => add(m)}>
                  <strong>{m.name}</strong>
                  <span className="tiny muted">
                    {money(m.sellingPrice)} / {unitLabel(m.sellUnit)}
                  </span>
                  {inCart && (
                    <span className="waiter-item-qty">
                      {inCart.quantity} {unitLabel(m.sellUnit)}
                    </span>
                  )}
                </button>
              );
            })}
            {!shownMenu.length && !showPerHeadBtn && <div className="empty">{t("waiter.noItems")}</div>}
          </div>
        </section>

        <aside className="panel panel-pad waiter-cart">
          {showPerHeadBtn && (
            <button
              type="button"
              className="btn ghost waiter-perhead-cart"
              onClick={addPerHead}
              title={t("waiter.perHeadHint")}
              style={{ width: "100%", marginBottom: "0.75rem", justifyContent: "space-between" }}
            >
              <span>+ {perHead!.label || t("waiter.perHead")}</span>
              <span className="tiny muted">
                {money(perHead!.amount)} · {t("waiter.onBill")}
              </span>
            </button>
          )}
          {showSentBlock && (
            <div className="sent-items">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ margin: 0 }}>
                  {rounds.length ? t("waiter.sentKitchen") : t("waiter.billCharges")}
                </h3>
                {can("order.edit") && order && order.paymentStatus !== "PAID" && (
                  editing ? (
                    <div className="row" style={{ gap: "0.35rem" }}>
                      <button type="button" className="btn sm" disabled={savingEdit} onClick={() => void saveEdit()}>
                        {savingEdit ? t("common.saving") : t("bills.saveEdit")}
                      </button>
                      <button type="button" className="btn ghost sm" onClick={() => setEditing(false)}>
                        {t("common.cancel")}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => {
                        const qmap: Record<string, number> = {};
                        for (const i of order.items) qmap[i.id] = i.quantity;
                        setEditQty(qmap);
                        setEditing(true);
                      }}
                    >
                      {t("bills.editOrder")}
                    </button>
                  )
                )}
              </div>
              {editing && order ? (
                <div style={{ marginTop: "0.75rem" }}>
                  {order.items.map((i) => (
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
                              [i.id]: Math.max(0, +((prev[i.id] ?? i.quantity) - step(i.sellUnit)).toFixed(3)),
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
                              [i.id]: +((prev[i.id] ?? i.quantity) + step(i.sellUnit)).toFixed(3),
                            }))
                          }
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  {billOnlyItems.length > 0 && (
                    <div className="sent-round">
                      <div className="row" style={{ justifyContent: "space-between" }}>
                        <span className="tiny muted">{t("waiter.onBill")}</span>
                      </div>
                      <ul>
                        {billOnlyItems.map((i) => (
                          <li key={i.id}>
                            <strong>
                              {i.quantity} {unitLabel(i.sellUnit)}
                            </strong>{" "}
                            {i.name}
                            <span className="tiny muted"> — {money(i.amount)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {rounds.map((r) => (
                    <div key={r.round} className="sent-round">
                      <div className="row" style={{ justifyContent: "space-between" }}>
                        <span className="tiny muted">
                          {roundTakers(r.items)
                            ? t("waiter.roundBy", { n: r.round, name: roundTakers(r.items) })
                            : t("kot.round", { n: r.round })}
                        </span>
                        {canReprintKot && (
                          <button type="button" className="btn ghost sm" onClick={() => void reprint(r.round)}>
                            {t("waiter.reprint")}
                          </button>
                        )}
                      </div>
                      <ul>
                        {r.items.map((i) => (
                          <li key={i.id}>
                            <strong>
                              {i.quantity} {unitLabel(i.sellUnit)}
                            </strong>{" "}
                            {i.name}
                            {i.notes ? <span className="tiny muted"> — {i.notes}</span> : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </>
              )}
              <div className="cart-total">
                <span>{t("waiter.billSoFar")}</span>
                <span>{money(order?.total ?? 0)}</span>
              </div>
            </div>
          )}

          <h3>{order ? t("waiter.newItems") : t("common.order")}</h3>
          {!cart.length && <div className="empty">{t("waiter.tapAdd")}</div>}
          {cart.map((l) => (
            <div className="waiter-line" key={l.cartKey}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>
                  {l.name}
                  {l.kind === "PER_HEAD" ? (
                    <span className="tiny muted"> · {t("waiter.onBill")}</span>
                  ) : null}
                </strong>
                <span>{money(l.rate * l.quantity)}</span>
              </div>
              <div className="row waiter-qty">
                <button type="button" className="qty-btn" onClick={() => setQty(l.cartKey, l.quantity - step(l.sellUnit))}>
                  −
                </button>
                <span className="qty-val">
                  {l.quantity} {unitLabel(l.sellUnit)}
                </span>
                <button type="button" className="qty-btn" onClick={() => setQty(l.cartKey, l.quantity + step(l.sellUnit))}>
                  +
                </button>
                {quickQty(l.sellUnit).map((qv) => (
                  <button
                    key={qv}
                    type="button"
                    className={`chip ${l.quantity === qv ? "active" : ""}`}
                    onClick={() => setQty(l.cartKey, qv)}
                  >
                    {qv}
                  </button>
                ))}
              </div>
              {l.kind === "MENU" &&
                (noteFor === l.cartKey || l.notes ? (
                  <input
                    className="waiter-note"
                    value={l.notes}
                    onChange={(e) => setNote(l.cartKey, e.target.value)}
                    placeholder={t("waiter.notePh")}
                    autoFocus={noteFor === l.cartKey}
                  />
                ) : (
                  <button type="button" className="btn ghost sm" onClick={() => setNoteFor(l.cartKey)}>
                    {t("waiter.addNote")}
                  </button>
                ))}
            </div>
          ))}

          {cart.length > 0 && (
            <div className="cart-total">
              <span>{t("waiter.newItems")}</span>
              <span>{money(cartTotal)}</span>
            </div>
          )}

          <button
            type="button"
            className="btn waiter-send"
            disabled={busy || !cart.length}
            onClick={() => void sendToKitchen()}
          >
            {busy
              ? t("waiter.sending")
              : cartHasMenu
                ? t("waiter.sendKitchen", { n: cart.length })
                : t("waiter.addToBill", { n: cart.length })}
          </button>
          {canReprintKot && cartHasMenu && (
            <label className="check tiny muted" style={{ marginTop: "0.5rem" }}>
              <input type="checkbox" checked={previewFirst} onChange={(e) => setPreviewFirst(e.target.checked)} />
              {t("waiter.previewKot")}
            </label>
          )}

          {order && (canReprintKot || (can("bill.request") && showTakeawayCashierBillActions)) && (
            <div className="row" style={{ marginTop: "0.6rem" }}>
              {canReprintKot && (
                <button type="button" className="btn ghost" style={{ flex: 1 }} onClick={() => void reprint()}>
                  {t("waiter.reprintFull")}
                </button>
              )}
              {can("bill.request") && showTakeawayCashierBillActions && (
                <button
                  type="button"
                  className="btn warn"
                  style={{ flex: 1 }}
                  disabled={!!order.billRequestedAt}
                  onClick={() => void requestBill()}
                >
                  {order.billRequestedAt ? t("waiter.billRequested") : t("waiter.requestBill")}
                </button>
              )}
            </div>
          )}
          {order && order.paymentStatus !== "PAID" && (can("print.bill") || can("order.pay")) && (
            <div className="row" style={{ marginTop: "0.6rem" }}>
              {can("print.bill") && showTakeawayCashierBillActions && (
                <button type="button" className="btn ghost" style={{ flex: 1 }} onClick={() => void printBillNow()}>
                  {t("waiter.printBill")}
                </button>
              )}
              {can("order.pay") && (
                <button type="button" className="btn ok" style={{ flex: 1 }} onClick={() => setPaying(true)}>
                  {t("waiter.takePayment")} {money(order.total - (order.paidAmount ?? 0))}
                </button>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
