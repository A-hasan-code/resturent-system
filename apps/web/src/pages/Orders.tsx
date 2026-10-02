import { useCallback, useEffect, useMemo, useState } from "react";
import { api, money, unitLabel } from "../api";
import { useAuth } from "../auth";
import { useToast } from "../toast";
import { Modal } from "../components/Modal";
import { BillPreview, printBill, type BillOrder } from "../components/BillPreview";
import { KotPreviewModal, type KotTarget } from "../components/KotPreviewModal";
import { PickServerModal } from "../components/PickServerModal";
import { SearchField, matchesSearch } from "../components/SearchField";
import { Pagination, paginate } from "../components/Pagination";
import { serverPrint, useKotPreviewPref } from "../printing";
import { useSocketEvent } from "../socket";
import { useI18n, useT } from "../i18n";

type MenuItem = {
  id: string;
  name: string;
  category: string | null;
  sellUnit: string;
  sellingPrice: number;
};

type CartLine = {
  menuItemId: string;
  name: string;
  sellUnit: string;
  ratePerUnit: number;
  quantity: number;
};

type Order = BillOrder & {
  id: string;
  status: string;
  kotRounds: number;
  waiter: string | null;
  items: BillOrder["items"];
};

const MENU_PAGE = 12;
const ORDER_PAGE = 10;

export function OrdersPage() {
  const toast = useToast();
  const t = useT();
  const { ts } = useI18n();
  const { user, can } = useAuth();
  const [previewFirst, setPreviewFirst] = useKotPreviewPref(user);
  const [kot, setKot] = useState<KotTarget | null>(null);
  const closeKot = useCallback(() => setKot(null), []);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [cat, setCat] = useState("ALL");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [tableNo, setTableNo] = useState("");
  const [notes, setNotes] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [busy, setBusy] = useState(false);
  const [bill, setBill] = useState<{ order: BillOrder; mode: "kitchen" | "customer" } | null>(
    null
  );
  const [menuQ, setMenuQ] = useState("");
  const [orderQ, setOrderQ] = useState("");
  const [menuPage, setMenuPage] = useState(1);
  const [orderPage, setOrderPage] = useState(1);
  const [pickServer, setPickServer] = useState(false);

  async function load() {
    try {
      const [m, o] = await Promise.all([
        api<MenuItem[]>("/menu"),
        api<Order[]>("/orders"),
      ]);
      setMenu(m);
      setOrders(o);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("common.loadFailed"), "err");
    }
  }

  useEffect(() => {
    load();
  }, []);

  useSocketEvent("orders.changed", () => {
    api<Order[]>("/orders").then(setOrders).catch(() => undefined);
  });

  const categories = useMemo(() => {
    const set = new Set(
      menu.map((m) => m.category || "General").filter(Boolean) as string[]
    );
    return ["ALL", ...Array.from(set)];
  }, [menu]);

  const shown = menu.filter((m) => {
    if (!(cat === "ALL" || (m.category || "General") === cat)) return false;
    return matchesSearch(
      menuQ,
      m.name,
      m.category,
      m.sellUnit,
      m.sellingPrice,
      unitLabel(m.sellUnit)
    );
  });

  // POS: only pending / active orders (completed go to billing)
  const pendingOrders = orders.filter((o) =>
    ["PENDING", "PREPARING", "READY"].includes(o.status)
  );

  const recent = pendingOrders.filter((o) =>
    matchesSearch(
      orderQ,
      o.orderNo,
      o.tableNo,
      o.status,
      o.paymentStatus,
      ...o.items.map((i) => `${i.name} ${i.quantity} ${i.sellUnit}`)
    )
  );

  useEffect(() => {
    setMenuPage(1);
  }, [cat, menuQ]);

  useEffect(() => {
    setOrderPage(1);
  }, [orderQ]);

  const pageMenu = paginate(shown, menuPage, MENU_PAGE);
  const pageOrders = paginate(recent, orderPage, ORDER_PAGE);

  const total = cart.reduce((s, l) => s + l.quantity * l.ratePerUnit, 0);

  function addItem(m: MenuItem) {
    setCart((prev) => {
      const hit = prev.find((p) => p.menuItemId === m.id);
      if (hit) {
        return prev.map((p) =>
          p.menuItemId === m.id
            ? { ...p, quantity: Number((p.quantity + 0.5).toFixed(3)) }
            : p
        );
      }
      return [
        ...prev,
        {
          menuItemId: m.id,
          name: m.name,
          sellUnit: m.sellUnit,
          ratePerUnit: m.sellingPrice,
          quantity: m.sellUnit === "KG" ? 1 : 1,
        },
      ];
    });
  }

  function setQty(id: string, qty: number) {
    if (qty <= 0) {
      setCart((prev) => prev.filter((p) => p.menuItemId !== id));
      return;
    }
    setCart((prev) =>
      prev.map((p) =>
        p.menuItemId === id ? { ...p, quantity: Number(qty.toFixed(3)) } : p
      )
    );
  }

  async function sendToPrinter(orderId: string, mode: "kitchen" | "customer") {
    try {
      await serverPrint(mode === "kitchen" ? "kot" : "bill", orderId);
      toast.push(
        mode === "kitchen" ? t("orders.printingKot") : t("orders.printingBill"),
        "ok"
      );
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("common.printFailed"), "err");
    }
  }

  async function placeOrder() {
    if (!cart.length) {
      toast.push(t("orders.addItemsFirst"), "err");
      return;
    }
    setPickServer(true);
  }

  async function placeWithServer(serverName: string) {
    setPickServer(false);
    setBusy(true);
    const preview = previewFirst && can("print.kot");
    try {
      const created = await api<Order>("/orders", {
        method: "POST",
        body: JSON.stringify({
          tableNo: tableNo || undefined,
          notes: notes || undefined,
          printKot: !preview,
          servedByName: serverName,
          items: cart.map((c) => ({
            menuItemId: c.menuItemId,
            quantity: c.quantity,
          })),
        }),
      });
      setCart([]);
      setNotes("");
      await load();
      if (preview) {
        toast.push(t("orders.placed", { n: created.orderNo }), "ok");
        setKot({ orderId: created.id, round: created.kotRounds, reprint: false });
        return;
      }
      toast.push(t("orders.placedKot", { n: created.orderNo }), "ok");
      setBill({
        order: {
          id: created.id,
          orderNo: created.orderNo,
          tableNo: created.tableNo,
          paymentStatus: created.paymentStatus,
          total: Number(created.total),
          waiter: created.waiter,
          servedBy: (created as Order & { servedBy?: string | null }).servedBy ?? serverName,
          items: created.items.map((i) => ({
            name: i.name,
            quantity: Number(i.quantity),
            sellUnit: i.sellUnit,
            ratePerUnit: Number((i as { ratePerUnit?: number }).ratePerUnit ?? 0),
            amount: Number(i.amount),
            notes: i.notes,
          })),
        },
        mode: "kitchen",
      });
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("orders.failed"), "err");
    } finally {
      setBusy(false);
    }
  }

  function catLabel(c: string) {
    if (c === "ALL") return t("common.all");
    if (c === "General") return t("common.general");
    return c;
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t("orders.title")}</h1>
          <p>{t("orders.subtitle")}</p>
        </div>
      </div>

      <div className="pos">
        <section className="panel panel-pad">
          <SearchField
            value={menuQ}
            onChange={setMenuQ}
            placeholder={t("orders.searchMenu")}
          />
          <div className="chips" style={{ marginTop: "0.75rem" }}>
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                className={`chip ${cat === c ? "active" : ""}`}
                onClick={() => setCat(c)}
              >
                {catLabel(c)}
              </button>
            ))}
          </div>
          {!shown.length ? (
            <div className="empty">{t("orders.noMenu")}</div>
          ) : (
            <>
              <div className="menu-grid">
                {pageMenu.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className="menu-card"
                    onClick={() => addItem(m)}
                  >
                    <h3>{m.name}</h3>
                    <div className="tiny muted">
                      {m.category === "General" || !m.category
                        ? t("common.general")
                        : m.category}
                    </div>
                    <div className="price">
                      {money(m.sellingPrice)}
                      <span className="tiny muted"> / {unitLabel(m.sellUnit)}</span>
                    </div>
                  </button>
                ))}
              </div>
              <Pagination
                page={menuPage}
                pageSize={MENU_PAGE}
                total={shown.length}
                onChange={setMenuPage}
              />
            </>
          )}
        </section>

        <aside className="panel panel-pad cart">
          <h2 style={{ margin: "0 0 0.75rem", fontSize: "1.15rem" }}>
            {t("orders.currentOrder")}
          </h2>
          <div className="field">
            <label>{t("orders.tableToken")}</label>
            <input
              value={tableNo}
              onChange={(e) => setTableNo(e.target.value)}
              placeholder={t("orders.tablePh")}
            />
          </div>
          <div className="field">
            <label>{t("common.notes")}</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("orders.notesPh")}
            />
          </div>

          <div className="cart-lines">
            {!cart.length && <div className="empty">{t("orders.tapToAdd")}</div>}
            {cart.map((l) => (
              <div className="cart-line" key={l.menuItemId}>
                <div>
                  <strong>{l.name}</strong>
                  <div className="tiny muted">
                    {money(l.ratePerUnit)} / {unitLabel(l.sellUnit)}
                  </div>
                  <div className="qty-ctrl">
                    <button type="button" onClick={() => setQty(l.menuItemId, l.quantity - (l.sellUnit === "KG" ? 0.5 : 1))}>
                      −
                    </button>
                    <input
                      style={{ width: 64, textAlign: "center" }}
                      value={l.quantity}
                      onChange={(e) =>
                        setQty(l.menuItemId, Number(e.target.value) || 0)
                      }
                    />
                    <button type="button" onClick={() => setQty(l.menuItemId, l.quantity + (l.sellUnit === "KG" ? 0.5 : 1))}>
                      +
                    </button>
                    <span className="tiny muted">{unitLabel(l.sellUnit)}</span>
                  </div>
                </div>
                <div>
                  <strong>{money(l.quantity * l.ratePerUnit)}</strong>
                </div>
              </div>
            ))}
          </div>

          <div className="cart-total">
            <span>{t("common.total")}</span>
            <span>{money(total)}</span>
          </div>
          <button
            type="button"
            className="btn"
            style={{ width: "100%" }}
            disabled={busy}
            onClick={placeOrder}
          >
            {busy ? t("orders.placing") : t("orders.placeOrder")}
          </button>
          {can("print.kot") && (
            <label className="check tiny muted" style={{ marginTop: "0.5rem" }}>
              <input type="checkbox" checked={previewFirst} onChange={(e) => setPreviewFirst(e.target.checked)} />
              {t("orders.previewKot")}
            </label>
          )}
        </aside>
      </div>

      <div className="panel panel-pad" style={{ marginTop: "1rem" }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: "0.75rem" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "1.1rem" }}>{t("orders.pendingOrders")}</h2>
            <p className="muted tiny" style={{ margin: "0.2rem 0 0" }}>
              {t("orders.activeKitchenOnly")} · {t("orders.nPending", { n: pendingOrders.length })}
            </p>
          </div>
          <SearchField
            value={orderQ}
            onChange={setOrderQ}
            placeholder={t("orders.searchPending")}
          />
        </div>
        {!recent.length ? (
          <div className="empty">{t("orders.noPending")}</div>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t("common.items")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("orders.pay")}</th>
                  <th>{t("common.total")}</th>
                  <th>{t("orders.slips")}</th>
                </tr>
              </thead>
              <tbody>
                {pageOrders.map((o) => (
                  <tr key={o.id}>
                    <td>{o.orderNo}</td>
                    <td>
                      {o.items
                        .map((i) => `${i.quantity} ${unitLabel(i.sellUnit)} ${i.name}`)
                        .join(", ")}
                      {o.waiter && (
                        <div className="tiny muted">
                          {t("orders.orderBy")} {o.waiter}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${o.status === "PENDING" ? "pending" : "ready"}`}>
                        {ts(o.status)}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${o.paymentStatus === "PAID" ? "paid" : "unpaid"}`}>
                        {ts(o.paymentStatus)}
                      </span>
                    </td>
                    <td>{money(o.total)}</td>
                    <td className="row">
                      <button
                        type="button"
                        className="btn ghost sm"
                        onClick={() => setKot({ orderId: o.id, reprint: true })}
                      >
                        {t("orders.kitchenSlip")}
                      </button>
                      <button
                        type="button"
                        className="btn ghost sm"
                        onClick={() => setBill({ order: o, mode: "customer" })}
                      >
                        {t("orders.customerBill")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
              page={orderPage}
              pageSize={ORDER_PAGE}
              total={recent.length}
              onChange={setOrderPage}
            />
          </>
        )}
      </div>

      <Modal
        open={!!bill}
        title={bill?.mode === "kitchen" ? t("orders.kitchenSlip") : t("orders.customerBill")}
        onClose={() => setBill(null)}
      >
        {bill && (
          <>
            <BillPreview order={bill.order} mode={bill.mode} />
            <div className="row no-print" style={{ marginTop: "1rem" }}>
              {bill.order.id && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => void sendToPrinter(bill.order.id!, bill.mode)}
                >
                  {t("common.printOnPrinter")}
                </button>
              )}
              <button type="button" className="btn ghost" onClick={printBill}>
                {t("common.browserPrint")}
              </button>
              <button type="button" className="btn ghost" onClick={() => setBill(null)}>
                {t("common.close")}
              </button>
              {bill.mode === "kitchen" && (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setBill({ ...bill, mode: "customer" })}
                >
                  {t("orders.showCustomerBill")}
                </button>
              )}
            </div>
          </>
        )}
      </Modal>
      <PickServerModal
        open={pickServer}
        orderTakenBy={user?.name}
        onClose={() => setPickServer(false)}
        onPick={(name) => void placeWithServer(name)}
      />
      <KotPreviewModal target={kot} onClose={closeKot} />
    </div>
  );
}
