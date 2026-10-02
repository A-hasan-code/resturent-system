import { useCallback, useEffect, useMemo, useState } from "react";
import { api, money, unitLabel } from "../api";
import { useAuth } from "../auth";
import { useToast } from "../toast";
import { useSocketEvent } from "../socket";
import { serverPrint, useKotPreviewPref } from "../printing";
import { SearchField, matchesSearch } from "../components/SearchField";
import { KotPreviewModal, type KotTarget } from "../components/KotPreviewModal";
import { PayModal } from "../components/PayModal";
import { MessageKey, useI18n, useT } from "../i18n";

type TableCard = {
  id: string;
  name: string;
  area: string | null;
  seats: number;
  order: null | {
    id: string;
    orderNo: number;
    status: string;
    paymentStatus: string;
    total: number;
    billRequested: boolean;
    waiter: string | null;
    since: string;
  };
};

type MenuItem = { id: string; name: string; category: string | null; sellUnit: string; sellingPrice: number };

type OrderItem = {
  id: string;
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
  kotRounds: number;
  billRequestedAt: string | null;
  waiter: string | null;
  items: OrderItem[];
};

type CartLine = {
  menuItemId: string;
  name: string;
  sellUnit: string;
  rate: number;
  quantity: number;
  notes: string;
};

const WALK_IN = "__walkin__";

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

function tableState(t: TableCard) {
  if (!t.order) return "free";
  if (t.order.billRequested) return "bill";
  if (t.order.status === "READY") return "ready";
  return "busy";
}

export function WaiterPage() {
  const { can, user } = useAuth();
  const toast = useToast();
  const t = useT();
  const { ts } = useI18n();
  const [previewFirst, setPreviewFirst] = useKotPreviewPref(user);
  const [kot, setKot] = useState<KotTarget | null>(null);
  const closeKot = useCallback(() => setKot(null), []);
  const [tables, setTables] = useState<TableCard[]>([]);
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

  const selectedTable = tables.find((tbl) => tbl.name === selected) ?? null;

  const loadTables = useCallback(async () => {
    try {
      setTables(await api<TableCard[]>("/tables"));
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
    void loadOrder(selectedTable?.order?.id);
  }, [selectedTable?.order?.id, loadOrder]);

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

  function open(name: string) {
    setSelected(name);
    setCart([]);
    setQ("");
    setNoteFor(null);
  }

  function back() {
    setSelected(null);
    setOrder(null);
    setCart([]);
    setWalkInName("");
  }

  function add(m: MenuItem) {
    setCart((prev) => {
      const hit = prev.find((p) => p.menuItemId === m.id);
      if (hit) {
        return prev.map((p) =>
          p.menuItemId === m.id ? { ...p, quantity: +(p.quantity + step(m.sellUnit)).toFixed(3) } : p
        );
      }
      return [...prev, { menuItemId: m.id, name: m.name, sellUnit: m.sellUnit, rate: m.sellingPrice, quantity: 1, notes: "" }];
    });
  }

  function setQty(id: string, qty: number) {
    setCart((prev) =>
      qty <= 0 ? prev.filter((p) => p.menuItemId !== id) : prev.map((p) => (p.menuItemId === id ? { ...p, quantity: +qty.toFixed(3) } : p))
    );
  }

  function setNote(id: string, notes: string) {
    setCart((prev) => prev.map((p) => (p.menuItemId === id ? { ...p, notes } : p)));
  }

  async function sendToKitchen() {
    if (!cart.length) return;
    setBusy(true);
    const items = cart.map((c) => ({ menuItemId: c.menuItemId, quantity: c.quantity, notes: c.notes || undefined }));
    const preview = previewFirst && can("print.kot");
    try {
      const isWalkIn = selected === WALK_IN;
      const tableNo = isWalkIn ? walkInName.trim() || "Takeaway" : selected!;
      const body = { items, printKot: !preview };
      const res = order
        ? await api<Order>(`/orders/${order.id}/items`, { method: "POST", body: JSON.stringify(body) })
        : await api<Order>("/orders", { method: "POST", body: JSON.stringify({ ...body, tableNo }) });
      if (preview) {
        toast.push(t("waiter.sent", { n: res.orderNo }), "ok");
        setKot({ orderId: res.id, round: res.kotRounds, reprint: false });
      } else {
        toast.push(t("waiter.sentPrint", { n: res.orderNo }), "ok");
      }
      setCart([]);
      if (isWalkIn) back();
      else setOrder(res);
      void loadTables();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("waiter.sendFailed"), "err");
    } finally {
      setBusy(false);
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

  const kotModal = (
    <>
      <KotPreviewModal target={kot} onClose={closeKot} />
      <PayModal order={paying ? order : null} onClose={() => setPaying(false)} onPaid={paid} />
    </>
  );

  // ---------- table grid ----------
  if (!selected) {
    const busyCount = tables.filter((tbl) => tbl.order).length;
    return (
      <div className="waiter">
        {kotModal}
        <div className="page-head">
          <div>
            <h1>{t("waiter.title")}</h1>
            <p>
              {t("waiter.occupied", { n: busyCount })} ·{" "}
              {t("waiter.freeCount", { n: tables.length - busyCount })} · {t("waiter.hint")}
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
        <div className="table-grid">
          {tables.map((tbl) => (
            <button key={tbl.id} type="button" className={`table-card ${tableState(tbl)}`} onClick={() => open(tbl.name)}>
              <strong>{tbl.name}</strong>
              <span className="tiny">{tbl.area || ""}</span>
              {tbl.order ? (
                <>
                  <span className="tiny">
                    #{tbl.order.orderNo} · {minutesSince(tbl.order.since, t)}
                  </span>
                  <span className="tiny">
                    {tbl.order.billRequested ? t("waiter.billRequested") : ts(tbl.order.status)}
                    {tbl.order.waiter ? ` · ${tbl.order.waiter}` : ""}
                  </span>
                </>
              ) : (
                <span className="tiny">{t("waiter.free")}</span>
              )}
            </button>
          ))}
          <button type="button" className="table-card walkin" onClick={() => open(WALK_IN)}>
            <strong>{t("waiter.takeaway")}</strong>
            <span className="tiny">{t("waiter.walkInParcel")}</span>
          </button>
        </div>
      </div>
    );
  }

  // ---------- order screen ----------
  const rounds = order
    ? Array.from({ length: order.kotRounds }, (_, i) => i + 1).map((r) => ({
        round: r,
        items: order.items.filter((i) => i.kotRound === r),
      })).filter((r) => r.items.length)
    : [];

  return (
    <div className="waiter">
      {kotModal}
      <div className="page-head">
        <div className="row">
          <button type="button" className="btn ghost" onClick={back}>
            {t("waiter.backTables")}
          </button>
          <div>
            <h1 style={{ margin: 0 }}>{selected === WALK_IN ? t("waiter.takeaway") : selected}</h1>
            <p style={{ margin: 0 }}>
              {order
                ? `${t("common.order")} #${order.orderNo} · ${ts(order.status)}${order.billRequestedAt ? ` · ${t("waiter.billRequested")}` : ""}`
                : t("waiter.newOrder")}
            </p>
          </div>
        </div>
        {selected === WALK_IN && (
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
            {shownMenu.map((m) => {
              const inCart = cart.find((c) => c.menuItemId === m.id);
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
            {!shownMenu.length && <div className="empty">{t("waiter.noItems")}</div>}
          </div>
        </section>

        <aside className="panel panel-pad waiter-cart">
          {rounds.length > 0 && (
            <div className="sent-items">
              <h3>{t("waiter.sentKitchen")}</h3>
              {rounds.map((r) => (
                <div key={r.round} className="sent-round">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="tiny muted">
                      {roundTakers(r.items)
                        ? t("waiter.roundBy", { n: r.round, name: roundTakers(r.items) })
                        : t("kot.round", { n: r.round })}
                    </span>
                    {can("print.kot") && (
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
              <div className="cart-total">
                <span>{t("waiter.billSoFar")}</span>
                <span>{money(order?.total ?? 0)}</span>
              </div>
            </div>
          )}

          <h3>{order ? t("waiter.newItems") : t("common.order")}</h3>
          {!cart.length && <div className="empty">{t("waiter.tapAdd")}</div>}
          {cart.map((l) => (
            <div className="waiter-line" key={l.menuItemId}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>{l.name}</strong>
                <span>{money(l.rate * l.quantity)}</span>
              </div>
              <div className="row waiter-qty">
                <button type="button" className="qty-btn" onClick={() => setQty(l.menuItemId, l.quantity - step(l.sellUnit))}>
                  −
                </button>
                <span className="qty-val">
                  {l.quantity} {unitLabel(l.sellUnit)}
                </span>
                <button type="button" className="qty-btn" onClick={() => setQty(l.menuItemId, l.quantity + step(l.sellUnit))}>
                  +
                </button>
                {quickQty(l.sellUnit).map((qv) => (
                  <button
                    key={qv}
                    type="button"
                    className={`chip ${l.quantity === qv ? "active" : ""}`}
                    onClick={() => setQty(l.menuItemId, qv)}
                  >
                    {qv}
                  </button>
                ))}
              </div>
              {noteFor === l.menuItemId || l.notes ? (
                <input
                  className="waiter-note"
                  value={l.notes}
                  onChange={(e) => setNote(l.menuItemId, e.target.value)}
                  placeholder={t("waiter.notePh")}
                  autoFocus={noteFor === l.menuItemId}
                />
              ) : (
                <button type="button" className="btn ghost sm" onClick={() => setNoteFor(l.menuItemId)}>
                  {t("waiter.addNote")}
                </button>
              )}
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
            {busy ? t("waiter.sending") : t("waiter.sendKitchen", { n: cart.length })}
          </button>
          {can("print.kot") && (
            <label className="check tiny muted" style={{ marginTop: "0.5rem" }}>
              <input type="checkbox" checked={previewFirst} onChange={(e) => setPreviewFirst(e.target.checked)} />
              {t("waiter.previewKot")}
            </label>
          )}

          {order && (
            <div className="row" style={{ marginTop: "0.6rem" }}>
              {can("print.kot") && (
                <button type="button" className="btn ghost" style={{ flex: 1 }} onClick={() => void reprint()}>
                  {t("waiter.reprintFull")}
                </button>
              )}
              {can("bill.request") && (
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
              {can("print.bill") && (
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
