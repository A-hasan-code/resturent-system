import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, money, unitLabel } from "../api";
import { useToast } from "../toast";
import { useAuth } from "../auth";

type LowItem = {
  name: string;
  category: string;
  quantityOnHand: number;
  reorderLevel: number;
  unit: string;
};

type DashOrder = {
  id: string;
  orderNo: number;
  tableNo: string | null;
  status: string;
  paymentStatus: string;
  total: number;
  createdAt: string;
  waitMinutes: number;
  stale: boolean;
  items: { name: string; quantity: number; sellUnit: string }[];
};

type UsageRow = {
  id: string;
  itemName: string;
  category: string;
  quantity: number;
  unit: string;
  orderNo: number | null;
  createdAt: string;
};

type Stats = {
  role: string;
  staleMinutes: number;
  pendingKitchen: number;
  preparing: number;
  ready: number;
  completed: number;
  ordersToday: number;
  orderAmountToday: number;
  totalOrders: number;
  unpaidCount: number;
  unpaidAmount: number;
  revenueToday: number;
  revenueAll: number;
  profitToday: number;
  profitAll: number;
  costToday: number;
  stockUsedToday: number;
  salesToday: number;
  lowStockCount: number;
  lowStock: LowItem[];
  stockValue: number;
  itemCount: number;
  recentUsage: UsageRow[];
  staleOrders: DashOrder[];
  kitchenQueue: DashOrder[];
  newOrders: DashOrder[];
  unpaidOrders: DashOrder[];
};

function waitLabel(mins: number) {
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function itemsLine(o: DashOrder) {
  return o.items
    .map((i) => `${i.quantity} ${unitLabel(i.sellUnit)} ${i.name}`)
    .join(", ");
}

export function DashboardPage() {
  const { user, can } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<Stats | null>(null);
  const role = (user?.roleCode || data?.role || "").toUpperCase();

  async function load() {
    try {
      setData(await api<Stats>("/dashboard"));
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Dashboard failed", "err");
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 12000);
    return () => clearInterval(t);
  }, []);

  const title =
    role === "CASHIER"
      ? "Cashier dashboard"
      : role === "KITCHEN"
        ? "Kitchen dashboard"
        : role === "STORE"
          ? "Store dashboard"
          : "Admin dashboard";

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          <p>
            {user?.name} · {user?.roleCode}
            {data ? ` · auto refresh` : ""}
          </p>
        </div>
        <button type="button" className="btn ghost sm" onClick={load}>
          Refresh
        </button>
      </div>

      {role === "ADMIN" && <AdminDash data={data} can={can} />}
      {role === "CASHIER" && <CashierDash data={data} can={can} />}
      {role === "KITCHEN" && <KitchenDash data={data} can={can} />}
      {role === "STORE" && <StoreDash data={data} can={can} />}
      {!["ADMIN", "CASHIER", "KITCHEN", "STORE"].includes(role) && (
        <AdminDash data={data} can={can} />
      )}
    </div>
  );
}

function AdminDash({
  data,
  can,
}: {
  data: Stats | null;
  can: (...p: string[]) => boolean;
}) {
  return (
    <>
      <StaleAlert
        orders={data?.staleOrders ?? []}
        minutes={data?.staleMinutes ?? 10}
        link="/kitchen"
        linkLabel="Open kitchen"
      />
      {(data?.lowStockCount ?? 0) > 0 && (
        <LowStockAlert items={data?.lowStock ?? []} count={data?.lowStockCount ?? 0} />
      )}

      <div className="stats">
        <div className="panel stat">
          <span>Orders today</span>
          <strong>{data?.ordersToday ?? "—"}</strong>
          <span className="tiny muted" style={{ display: "block", marginTop: "0.25rem" }}>
            placed today
          </span>
        </div>
        <div className="panel stat">
          <span>Order amount today</span>
          <strong>
            {data ? money(data.orderAmountToday ?? data.salesToday) : "—"}
          </strong>
          <span className="tiny muted" style={{ display: "block", marginTop: "0.25rem" }}>
            bill total of those orders
          </span>
        </div>
        <div className="panel stat">
          <span>Stock used today</span>
          <strong>
            {data ? money(data.stockUsedToday ?? data.costToday) : "—"}
          </strong>
          <span className="tiny muted" style={{ display: "block", marginTop: "0.25rem" }}>
            recipe cost from inventory
          </span>
        </div>
        <div className="panel stat">
          <span>Profit today</span>
          <strong
            style={{
              color:
                (data?.profitToday ?? 0) >= 0 ? "var(--ok)" : "var(--danger)",
            }}
          >
            {data ? money(data.profitToday) : "—"}
          </strong>
          <span className="tiny muted" style={{ display: "block", marginTop: "0.25rem" }}>
            amount − stock used
          </span>
        </div>
      </div>

      <div className="stats">
        <div className="panel stat">
          <span>Total orders</span>
          <strong>{data?.totalOrders ?? "—"}</strong>
          <span className="tiny muted" style={{ display: "block", marginTop: "0.25rem" }}>
            all time
          </span>
        </div>
        <div className="panel stat">
          <span>Collected today</span>
          <strong>{data ? money(data.revenueToday) : "—"}</strong>
          <span className="tiny muted" style={{ display: "block", marginTop: "0.25rem" }}>
            paid bills today
          </span>
        </div>
        <div className="panel stat">
          <span>Unpaid</span>
          <strong>
            {data?.unpaidCount ?? "—"}
            <span className="tiny muted" style={{ display: "block", fontWeight: 500 }}>
              {data ? money(data.unpaidAmount) : ""}
            </span>
          </strong>
        </div>
        <div className="panel stat">
          <span>Low stock</span>
          <strong
            style={{
              color: (data?.lowStockCount ?? 0) ? "var(--danger)" : undefined,
            }}
          >
            {data?.lowStockCount ?? "—"}
          </strong>
        </div>
      </div>

      <div className="dash-grid">
        <OrderList
          title="Active kitchen"
          empty="No active kitchen orders"
          orders={(data?.kitchenQueue ?? []).slice(0, 8)}
          showTotal
        />
        <OrderList
          title="Unpaid bills"
          empty="No unpaid bills"
          orders={(data?.unpaidOrders ?? []).slice(0, 8)}
          showTotal
        />
      </div>

      <Shortcuts can={can} />
    </>
  );
}

function CashierDash({
  data,
  can,
}: {
  data: Stats | null;
  can: (...p: string[]) => boolean;
}) {
  return (
    <>
      <StaleAlert
        orders={data?.staleOrders ?? []}
        minutes={data?.staleMinutes ?? 10}
        link="/orders"
        linkLabel="Open POS"
        message="These orders have been waiting a long time — check kitchen / payment."
      />

      <div className="stats">
        <div className="panel stat">
          <span>Unpaid bills</span>
          <strong style={{ color: (data?.unpaidCount ?? 0) ? "var(--danger)" : undefined }}>
            {data?.unpaidCount ?? "—"}
            <span className="tiny muted" style={{ display: "block", fontWeight: 500 }}>
              {data ? money(data.unpaidAmount) : ""}
            </span>
          </strong>
        </div>
        <div className="panel stat">
          <span>Ready to serve</span>
          <strong style={{ color: (data?.ready ?? 0) ? "var(--ok)" : undefined }}>
            {data?.ready ?? "—"}
          </strong>
        </div>
        <div className="panel stat">
          <span>Orders today</span>
          <strong>{data?.ordersToday ?? "—"}</strong>
        </div>
        <div className="panel stat">
          <span>Sales today</span>
          <strong>{data ? money(data.salesToday || data.orderAmountToday || data.revenueToday) : "—"}</strong>
          <span className="tiny muted" style={{ display: "block", marginTop: "0.25rem" }}>
            {data?.ordersToday ?? 0} orders · order amount
          </span>
        </div>
      </div>

      <div className="stats">
        <div className="panel stat">
          <span>Pending kitchen</span>
          <strong>{data?.pendingKitchen ?? "—"}</strong>
        </div>
        <div className="panel stat">
          <span>Preparing</span>
          <strong>{data?.preparing ?? "—"}</strong>
        </div>
        <div className="panel stat">
          <span>Ready</span>
          <strong>{data?.ready ?? "—"}</strong>
        </div>
        <div className="panel stat">
          <span>Completed</span>
          <strong>{data?.completed ?? "—"}</strong>
        </div>
      </div>

      <div className="dash-grid">
        <OrderList
          title="Collect payment"
          empty="No unpaid orders"
          orders={data?.unpaidOrders ?? []}
          showTotal
        />
        <OrderList
          title="Long waits"
          empty="No delayed orders"
          orders={data?.staleOrders ?? []}
        />
      </div>

      <Shortcuts can={can} focus={["orders", "bills"]} />
    </>
  );
}

function KitchenDash({
  data,
  can,
}: {
  data: Stats | null;
  can: (...p: string[]) => boolean;
}) {
  return (
    <>
      <StaleAlert
        orders={data?.staleOrders ?? []}
        minutes={data?.staleMinutes ?? 10}
        link="/kitchen"
        linkLabel="Open kitchen board"
        message="Orders waiting too long — start or finish them now."
      />

      {(data?.newOrders?.length ?? 0) > 0 && (
        <div className="panel panel-pad alert-new" style={{ marginBottom: "1rem" }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <strong style={{ color: "var(--accent)" }}>
                New orders · {data?.newOrders.length}
              </strong>
              <p className="muted" style={{ margin: "0.25rem 0 0" }}>
                Fresh tickets waiting in kitchen.
              </p>
            </div>
            <Link className="btn sm" to="/kitchen">
              Open kitchen
            </Link>
          </div>
        </div>
      )}

      <div className="stats">
        <div className="panel stat">
          <span>New / pending</span>
          <strong style={{ color: (data?.pendingKitchen ?? 0) ? "var(--danger)" : undefined }}>
            {data?.pendingKitchen ?? "—"}
          </strong>
        </div>
        <div className="panel stat">
          <span>Preparing</span>
          <strong>{data?.preparing ?? "—"}</strong>
        </div>
        <div className="panel stat">
          <span>Ready</span>
          <strong style={{ color: (data?.ready ?? 0) ? "var(--ok)" : undefined }}>
            {data?.ready ?? "—"}
          </strong>
        </div>
        <div className="panel stat">
          <span>Delayed (&gt;{data?.staleMinutes ?? 10}m)</span>
          <strong style={{ color: (data?.staleOrders.length ?? 0) ? "var(--danger)" : undefined }}>
            {data?.staleOrders.length ?? "—"}
          </strong>
        </div>
      </div>

      <div className="dash-grid">
        <OrderList
          title="New tickets"
          empty="No new pending orders"
          orders={data?.newOrders ?? []}
          highlightNew
        />
        <OrderList
          title="Kitchen queue"
          empty="Queue clear"
          orders={data?.kitchenQueue ?? []}
        />
      </div>

      <Shortcuts can={can} focus={["kitchen"]} />
    </>
  );
}

function StoreDash({
  data,
  can,
}: {
  data: Stats | null;
  can: (...p: string[]) => boolean;
}) {
  const usage = data?.recentUsage ?? [];
  return (
    <>
      {(data?.lowStockCount ?? 0) > 0 ? (
        <LowStockAlert items={data?.lowStock ?? []} count={data?.lowStockCount ?? 0} />
      ) : (
        <div className="panel panel-pad" style={{ marginBottom: "1rem" }}>
          <strong style={{ color: "var(--ok)" }}>Stock levels OK</strong>
          <p className="muted" style={{ margin: "0.25rem 0 0" }}>
            No items below reorder level right now.
          </p>
        </div>
      )}

      <div className="stats">
        <div className="panel stat">
          <span>Low stock items</span>
          <strong style={{ color: (data?.lowStockCount ?? 0) ? "var(--danger)" : undefined }}>
            {data?.lowStockCount ?? "—"}
          </strong>
        </div>
        <div className="panel stat">
          <span>Inventory value</span>
          <strong>{data ? money(data.stockValue) : "—"}</strong>
        </div>
        <div className="panel stat">
          <span>Active items</span>
          <strong>{data?.itemCount ?? "—"}</strong>
        </div>
        <div className="panel stat">
          <span>Recent usage rows</span>
          <strong>{usage.length}</strong>
        </div>
      </div>

      <div className="panel panel-pad" style={{ marginBottom: "1rem" }}>
        <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Recent stock used by orders</h2>
        {!usage.length ? (
          <div className="empty">No recent order usage</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Item</th>
                <th>Qty</th>
                <th>Order</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((u) => (
                <tr key={u.id}>
                  <td className="tiny">
                    {new Date(u.createdAt).toLocaleString("en-PK")}
                  </td>
                  <td>
                    {u.itemName}
                    <div className="tiny muted">{u.category}</div>
                  </td>
                  <td>
                    {u.quantity} {unitLabel(u.unit)}
                  </td>
                  <td>{u.orderNo != null ? `#${u.orderNo}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Shortcuts can={can} focus={["store"]} />
    </>
  );
}

function StaleAlert({
  orders,
  minutes,
  link,
  linkLabel,
  message,
}: {
  orders: DashOrder[];
  minutes: number;
  link: string;
  linkLabel: string;
  message?: string;
}) {
  if (!orders.length) return null;
  return (
    <div className="panel panel-pad alert-stale" style={{ marginBottom: "1rem" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <strong style={{ color: "var(--danger)" }}>
            Delayed order alert · {orders.length}
          </strong>
          <p className="muted" style={{ margin: "0.25rem 0 0" }}>
            {message ||
              `Orders pending / preparing for more than ${minutes} minutes.`}
          </p>
        </div>
        <Link className="btn warn sm" to={link}>
          {linkLabel}
        </Link>
      </div>
      <ul className="low-list">
        {orders.slice(0, 6).map((o) => (
          <li key={o.id}>
            <strong>
              #{o.orderNo} · {o.tableNo || "Walk-in"}
            </strong>
            <span className="muted">
              {" "}
              — {o.status} · waiting {waitLabel(o.waitMinutes)} · {itemsLine(o)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LowStockAlert({ items, count }: { items: LowItem[]; count: number }) {
  return (
    <div className="panel panel-pad alert-low" style={{ marginBottom: "1rem" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <strong style={{ color: "var(--danger)" }}>
            Low stock alert · {count} item(s)
          </strong>
          <p className="muted" style={{ margin: "0.25rem 0 0" }}>
            These items are at or below reorder level — stock them in.
          </p>
        </div>
        <Link className="btn warn sm" to="/store">
          Open inventory
        </Link>
      </div>
      <ul className="low-list">
        {items.slice(0, 8).map((i) => (
          <li key={`${i.category}-${i.name}`}>
            <strong>{i.name}</strong>
            <span className="muted">
              {" "}
              ({i.category}) — {i.quantityOnHand} {unitLabel(i.unit)} left
              (reorder ≤ {i.reorderLevel})
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OrderList({
  title,
  empty,
  orders,
  showTotal,
  highlightNew,
}: {
  title: string;
  empty: string;
  orders: DashOrder[];
  showTotal?: boolean;
  highlightNew?: boolean;
}) {
  return (
    <div className="panel panel-pad">
      <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>{title}</h2>
      {!orders.length ? (
        <div className="empty">{empty}</div>
      ) : (
        <ul className="dash-order-list">
          {orders.map((o) => (
            <li key={o.id} className={o.stale ? "is-stale" : highlightNew ? "is-new" : ""}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>
                  #{o.orderNo} · {o.tableNo || "Walk-in"}
                </strong>
                <span className="tiny muted">{waitLabel(o.waitMinutes)}</span>
              </div>
              <div className="tiny muted">{itemsLine(o)}</div>
              <div className="row" style={{ marginTop: "0.25rem", gap: "0.35rem" }}>
                <span
                  className={`badge ${
                    o.status === "READY" ? "ready" : "pending"
                  }`}
                >
                  {o.status}
                </span>
                {showTotal && <span className="tiny">{money(o.total)}</span>}
                {o.stale && <span className="badge unpaid">DELAYED</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Shortcuts({
  can,
  focus,
}: {
  can: (...p: string[]) => boolean;
  focus?: Array<"orders" | "bills" | "kitchen" | "store">;
}) {
  const show = (key: "orders" | "bills" | "kitchen" | "store") =>
    !focus || focus.includes(key);

  return (
    <div className="panel panel-pad">
      <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Shortcuts</h2>
      <div className="row">
        {show("orders") && can("order.create") && (
          <Link className="btn" to="/orders">
            New order
          </Link>
        )}
        {show("bills") && can("bill.view") && (
          <Link className="btn ghost" to="/bills">
            Billing
          </Link>
        )}
        {show("kitchen") && can("kitchen.view") && (
          <Link className="btn ghost" to="/kitchen">
            Kitchen
          </Link>
        )}
        {show("store") && can("store.view", "store.manage") && (
          <Link className="btn ghost" to="/store">
            Inventory
          </Link>
        )}
      </div>
    </div>
  );
}
