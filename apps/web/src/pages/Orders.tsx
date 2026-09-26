import { useEffect, useMemo, useState } from "react";
import { api, money, unitLabel } from "../api";
import { useToast } from "../toast";
import { Modal } from "../components/Modal";
import { BillPreview, printBill, type BillOrder } from "../components/BillPreview";
import { SearchField, matchesSearch } from "../components/SearchField";
import { Pagination, paginate } from "../components/Pagination";

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
  items: BillOrder["items"];
};

const MENU_PAGE = 12;
const ORDER_PAGE = 10;

export function OrdersPage() {
  const toast = useToast();
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

  async function load() {
    try {
      const [m, o] = await Promise.all([
        api<MenuItem[]>("/menu"),
        api<Order[]>("/orders"),
      ]);
      setMenu(m);
      setOrders(o);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Load failed", "err");
    }
  }

  useEffect(() => {
    load();
  }, []);

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

  async function placeOrder() {
    if (!cart.length) {
      toast.push("Add items from the menu first", "err");
      return;
    }
    setBusy(true);
    try {
      const created = await api<Order>("/orders", {
        method: "POST",
        body: JSON.stringify({
          tableNo: tableNo || undefined,
          notes: notes || undefined,
          items: cart.map((c) => ({
            menuItemId: c.menuItemId,
            quantity: c.quantity,
          })),
        }),
      });
      toast.push(`Order #${created.orderNo} placed`, "ok");
      setCart([]);
      setNotes("");
      await load();
      setBill({
        order: {
          orderNo: created.orderNo,
          tableNo: created.tableNo,
          paymentStatus: created.paymentStatus,
          total: Number(created.total),
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
      toast.push(e instanceof Error ? e.message : "Order failed", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Orders / POS</h1>
          <p>Left: menu · Right: cart · Bills open inside app</p>
        </div>
      </div>

      <div className="pos">
        <section className="panel panel-pad">
          <SearchField
            value={menuQ}
            onChange={setMenuQ}
            placeholder="Search menu (karahi, lassi…)"
          />
          <div className="chips" style={{ marginTop: "0.75rem" }}>
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                className={`chip ${cat === c ? "active" : ""}`}
                onClick={() => setCat(c)}
              >
                {c}
              </button>
            ))}
          </div>
          {!shown.length ? (
            <div className="empty">No menu items</div>
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
                    <div className="tiny muted">{m.category || "General"}</div>
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
          <h2 style={{ margin: "0 0 0.75rem", fontSize: "1.15rem" }}>Current order</h2>
          <div className="field">
            <label>Table / token</label>
            <input
              value={tableNo}
              onChange={(e) => setTableNo(e.target.value)}
              placeholder="e.g. T-4 / 21"
            />
          </div>
          <div className="field">
            <label>Notes</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Less oil, spicy…"
            />
          </div>

          <div className="cart-lines">
            {!cart.length && <div className="empty">Tap menu items to add</div>}
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
            <span>Total</span>
            <span>{money(total)}</span>
          </div>
          <button
            type="button"
            className="btn"
            style={{ width: "100%" }}
            disabled={busy}
            onClick={placeOrder}
          >
            {busy ? "Placing…" : "Place order"}
          </button>
        </aside>
      </div>

      <div className="panel panel-pad" style={{ marginTop: "1rem" }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: "0.75rem" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Pending orders</h2>
            <p className="muted tiny" style={{ margin: "0.2rem 0 0" }}>
              Active kitchen orders only · {pendingOrders.length} pending
            </p>
          </div>
          <SearchField
            value={orderQ}
            onChange={setOrderQ}
            placeholder="Search pending orders…"
          />
        </div>
        {!recent.length ? (
          <div className="empty">No pending orders</div>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Items</th>
                  <th>Status</th>
                  <th>Pay</th>
                  <th>Total</th>
                  <th>Slips</th>
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
                    </td>
                    <td>
                      <span className={`badge ${o.status === "PENDING" ? "pending" : "ready"}`}>
                        {o.status}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${o.paymentStatus === "PAID" ? "paid" : "unpaid"}`}>
                        {o.paymentStatus}
                      </span>
                    </td>
                    <td>{money(o.total)}</td>
                    <td className="row">
                      <button
                        type="button"
                        className="btn ghost sm"
                        onClick={() => setBill({ order: o, mode: "kitchen" })}
                      >
                        Kitchen
                      </button>
                      <button
                        type="button"
                        className="btn ghost sm"
                        onClick={() => setBill({ order: o, mode: "customer" })}
                      >
                        Customer
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
        title={bill?.mode === "kitchen" ? "Kitchen slip" : "Customer bill"}
        onClose={() => setBill(null)}
      >
        {bill && (
          <>
            <BillPreview order={bill.order} mode={bill.mode} />
            <div className="row no-print" style={{ marginTop: "1rem" }}>
              <button type="button" className="btn" onClick={printBill}>
                Print
              </button>
              <button type="button" className="btn ghost" onClick={() => setBill(null)}>
                Close
              </button>
              {bill.mode === "kitchen" && (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setBill({ ...bill, mode: "customer" })}
                >
                  Show customer bill
                </button>
              )}
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
