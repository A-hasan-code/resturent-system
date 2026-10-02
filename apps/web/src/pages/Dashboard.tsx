import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, money, unitLabel } from "../api";
import { useToast } from "../toast";
import { useAuth } from "../auth";
import { MessageKey, useI18n, useT } from "../i18n";

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

function waitLabel(
  mins: number,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
) {
  if (mins < 1) return t("dash.justNow");
  if (mins === 1) return t("dash.min1");
  if (mins < 60) return t("dash.minN", { n: mins });
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? t("dash.hm", { h, m }) : t("dash.hOnly", { h });
}

function itemsLine(o: DashOrder) {
  return o.items
    .map((i) => `${i.quantity} ${unitLabel(i.sellUnit)} ${i.name}`)
    .join(", ");
}

export function DashboardPage() {
  const { user, can } = useAuth();
  const toast = useToast();
  const t = useT();
  const [data, setData] = useState<Stats | null>(null);
  const role = (user?.roleCode || data?.role || "").toUpperCase();

  async function load() {
    try {
      setData(await api<Stats>("/dashboard"));
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("dash.failed"), "err");
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 12000);
    return () => clearInterval(timer);
  }, []);

  const title =
    role === "CASHIER"
      ? t("dash.titleCashier")
      : role === "KITCHEN"
        ? t("dash.titleKitchen")
        : role === "STORE"
          ? t("dash.titleStore")
          : role === "MANAGER"
            ? t("dash.titleManager")
            : t("dash.titleAdmin");

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          <p>
            {user?.name} · {user?.roleCode}
            {data ? ` · ${t("dash.autoRefresh")}` : ""}
          </p>
        </div>
        <button type="button" className="btn ghost sm" onClick={load}>
          {t("common.refresh")}
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
  const t = useT();
  return (
    <>
      <StaleAlert
        orders={data?.staleOrders ?? []}
        minutes={data?.staleMinutes ?? 10}
        link="/kitchen"
        linkLabel={t("dash.openKitchen")}
      />
      {(data?.lowStockCount ?? 0) > 0 && (
        <LowStockAlert items={data?.lowStock ?? []} count={data?.lowStockCount ?? 0} />
      )}

      <div className="stats">
        <div className="panel stat">
          <span>{t("dash.ordersToday")}</span>
          <strong>{data?.ordersToday ?? "—"}</strong>
          <span className="tiny muted" style={{ display: "block", marginTop: "0.25rem" }}>
            {t("dash.hintPlacedToday")}
          </span>
        </div>
        <div className="panel stat">
          <span>{t("dash.orderAmountToday")}</span>
          <strong>
            {data ? money(data.orderAmountToday ?? data.salesToday) : "—"}
          </strong>
          <span className="tiny muted" style={{ display: "block", marginTop: "0.25rem" }}>
            {t("dash.hintBillTotal")}
          </span>
        </div>
        <div className="panel stat">
          <span>{t("dash.stockUsedToday")}</span>
          <strong>
            {data ? money(data.stockUsedToday ?? data.costToday) : "—"}
          </strong>
          <span className="tiny muted" style={{ display: "block", marginTop: "0.25rem" }}>
            {t("dash.hintRecipeCost")}
          </span>
        </div>
        <div className="panel stat">
          <span>{t("dash.profitToday")}</span>
          <strong
            style={{
              color:
                (data?.profitToday ?? 0) >= 0 ? "var(--ok)" : "var(--danger)",
            }}
          >
            {data ? money(data.profitToday) : "—"}
          </strong>
          <span className="tiny muted" style={{ display: "block", marginTop: "0.25rem" }}>
            {t("dash.hintProfit")}
          </span>
        </div>
      </div>

      <div className="stats">
        <div className="panel stat">
          <span>{t("dash.totalOrders")}</span>
          <strong>{data?.totalOrders ?? "—"}</strong>
          <span className="tiny muted" style={{ display: "block", marginTop: "0.25rem" }}>
            {t("dash.hintAllTime")}
          </span>
        </div>
        <div className="panel stat">
          <span>{t("dash.collectedToday")}</span>
          <strong>{data ? money(data.revenueToday) : "—"}</strong>
          <span className="tiny muted" style={{ display: "block", marginTop: "0.25rem" }}>
            {t("dash.hintPaidToday")}
          </span>
        </div>
        <div className="panel stat">
          <span>{t("dash.unpaid")}</span>
          <strong>
            {data?.unpaidCount ?? "—"}
            <span className="tiny muted" style={{ display: "block", fontWeight: 500 }}>
              {data ? money(data.unpaidAmount) : ""}
            </span>
          </strong>
        </div>
        <div className="panel stat">
          <span>{t("dash.lowStock")}</span>
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
          title={t("dash.activeKitchen")}
          empty={t("dash.emptyKitchen")}
          orders={(data?.kitchenQueue ?? []).slice(0, 8)}
          showTotal
        />
        <OrderList
          title={t("dash.unpaidBills")}
          empty={t("dash.emptyUnpaid")}
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
  const t = useT();
  return (
    <>
      <StaleAlert
        orders={data?.staleOrders ?? []}
        minutes={data?.staleMinutes ?? 10}
        link="/orders"
        linkLabel={t("dash.openPos")}
        message={t("dash.delayedWaiting")}
      />

      <div className="stats">
        <div className="panel stat">
          <span>{t("dash.unpaidBills")}</span>
          <strong style={{ color: (data?.unpaidCount ?? 0) ? "var(--danger)" : undefined }}>
            {data?.unpaidCount ?? "—"}
            <span className="tiny muted" style={{ display: "block", fontWeight: 500 }}>
              {data ? money(data.unpaidAmount) : ""}
            </span>
          </strong>
        </div>
        <div className="panel stat">
          <span>{t("dash.readyToServe")}</span>
          <strong style={{ color: (data?.ready ?? 0) ? "var(--ok)" : undefined }}>
            {data?.ready ?? "—"}
          </strong>
        </div>
        <div className="panel stat">
          <span>{t("dash.ordersToday")}</span>
          <strong>{data?.ordersToday ?? "—"}</strong>
        </div>
        <div className="panel stat">
          <span>{t("dash.salesToday")}</span>
          <strong>{data ? money(data.salesToday || data.orderAmountToday || data.revenueToday) : "—"}</strong>
          <span className="tiny muted" style={{ display: "block", marginTop: "0.25rem" }}>
            {t("dash.hintNOrders", { n: data?.ordersToday ?? 0 })} · {t("dash.hintOrderAmount")}
          </span>
        </div>
      </div>

      <div className="stats">
        <div className="panel stat">
          <span>{t("dash.pendingKitchen")}</span>
          <strong>{data?.pendingKitchen ?? "—"}</strong>
        </div>
        <div className="panel stat">
          <span>{t("dash.preparing")}</span>
          <strong>{data?.preparing ?? "—"}</strong>
        </div>
        <div className="panel stat">
          <span>{t("dash.ready")}</span>
          <strong>{data?.ready ?? "—"}</strong>
        </div>
        <div className="panel stat">
          <span>{t("dash.completed")}</span>
          <strong>{data?.completed ?? "—"}</strong>
        </div>
      </div>

      <div className="dash-grid">
        <OrderList
          title={t("dash.collectPayment")}
          empty={t("dash.emptyUnpaidOrders")}
          orders={data?.unpaidOrders ?? []}
          showTotal
        />
        <OrderList
          title={t("dash.longWaits")}
          empty={t("dash.emptyDelayed")}
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
  const t = useT();
  return (
    <>
      <StaleAlert
        orders={data?.staleOrders ?? []}
        minutes={data?.staleMinutes ?? 10}
        link="/kitchen"
        linkLabel={t("dash.openKitchenBoard")}
        message={t("dash.delayedWaiting")}
      />

      {(data?.newOrders?.length ?? 0) > 0 && (
        <div className="panel panel-pad alert-new" style={{ marginBottom: "1rem" }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <strong style={{ color: "var(--accent)" }}>
                {t("dash.newOrders")} · {data?.newOrders.length}
              </strong>
              <p className="muted" style={{ margin: "0.25rem 0 0" }}>
                {t("dash.newTickets")}
              </p>
            </div>
            <Link className="btn sm" to="/kitchen">
              {t("dash.openKitchen")}
            </Link>
          </div>
        </div>
      )}

      <div className="stats">
        <div className="panel stat">
          <span>{t("dash.newPending")}</span>
          <strong style={{ color: (data?.pendingKitchen ?? 0) ? "var(--danger)" : undefined }}>
            {data?.pendingKitchen ?? "—"}
          </strong>
        </div>
        <div className="panel stat">
          <span>{t("dash.preparing")}</span>
          <strong>{data?.preparing ?? "—"}</strong>
        </div>
        <div className="panel stat">
          <span>{t("dash.ready")}</span>
          <strong style={{ color: (data?.ready ?? 0) ? "var(--ok)" : undefined }}>
            {data?.ready ?? "—"}
          </strong>
        </div>
        <div className="panel stat">
          <span>{t("dash.delayed", { n: data?.staleMinutes ?? 10 })}</span>
          <strong style={{ color: (data?.staleOrders.length ?? 0) ? "var(--danger)" : undefined }}>
            {data?.staleOrders.length ?? "—"}
          </strong>
        </div>
      </div>

      <div className="dash-grid">
        <OrderList
          title={t("dash.newOrders")}
          empty={t("dash.emptyNew")}
          orders={data?.newOrders ?? []}
          highlightNew
        />
        <OrderList
          title={t("dash.kitchenQueue")}
          empty={t("dash.queueClear")}
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
  const t = useT();
  const usage = data?.recentUsage ?? [];
  return (
    <>
      {(data?.lowStockCount ?? 0) > 0 ? (
        <LowStockAlert items={data?.lowStock ?? []} count={data?.lowStockCount ?? 0} />
      ) : (
        <div className="panel panel-pad" style={{ marginBottom: "1rem" }}>
          <strong style={{ color: "var(--ok)" }}>{t("dash.stockOk")}</strong>
          <p className="muted" style={{ margin: "0.25rem 0 0" }}>
            {t("dash.stockOkBody")}
          </p>
        </div>
      )}

      <div className="stats">
        <div className="panel stat">
          <span>{t("dash.lowStockItems")}</span>
          <strong style={{ color: (data?.lowStockCount ?? 0) ? "var(--danger)" : undefined }}>
            {data?.lowStockCount ?? "—"}
          </strong>
        </div>
        <div className="panel stat">
          <span>{t("dash.inventoryValue")}</span>
          <strong>{data ? money(data.stockValue) : "—"}</strong>
        </div>
        <div className="panel stat">
          <span>{t("dash.activeItems")}</span>
          <strong>{data?.itemCount ?? "—"}</strong>
        </div>
        <div className="panel stat">
          <span>{t("dash.recentUsage")}</span>
          <strong>{usage.length}</strong>
        </div>
      </div>

      <div className="panel panel-pad" style={{ marginBottom: "1rem" }}>
        <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>{t("dash.recentStockUsed")}</h2>
        {!usage.length ? (
          <div className="empty">{t("dash.emptyUsage")}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t("common.when")}</th>
                <th>{t("common.item")}</th>
                <th>{t("common.qty")}</th>
                <th>{t("common.order")}</th>
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
  const t = useT();
  const { ts } = useI18n();
  if (!orders.length) return null;
  return (
    <div className="panel panel-pad alert-stale" style={{ marginBottom: "1rem" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <strong style={{ color: "var(--danger)" }}>
            {t("dash.delayedAlert")} · {orders.length}
          </strong>
          <p className="muted" style={{ margin: "0.25rem 0 0" }}>
            {message || t("dash.delayedBody", { n: minutes })}
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
              #{o.orderNo} · {o.tableNo || t("common.walkIn")}
            </strong>
            <span className="muted">
              {" "}
              — {ts(o.status)} · {t("dash.waiting")} {waitLabel(o.waitMinutes, t)} · {itemsLine(o)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LowStockAlert({ items, count }: { items: LowItem[]; count: number }) {
  const t = useT();
  return (
    <div className="panel panel-pad alert-low" style={{ marginBottom: "1rem" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <strong style={{ color: "var(--danger)" }}>
            {t("dash.lowStockAlert")} · {t("dash.lowStockCount", { n: count })}
          </strong>
          <p className="muted" style={{ margin: "0.25rem 0 0" }}>
            {t("dash.lowStockBody")}
          </p>
        </div>
        <Link className="btn warn sm" to="/store">
          {t("dash.openInventory")}
        </Link>
      </div>
      <ul className="low-list">
        {items.slice(0, 8).map((i) => (
          <li key={`${i.category}-${i.name}`}>
            <strong>{i.name}</strong>
            <span className="muted">
              {" "}
              ({i.category}) — {i.quantityOnHand} {unitLabel(i.unit)}{" "}
              {t("dash.leftReorder", { n: i.reorderLevel })}
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
  const t = useT();
  const { ts } = useI18n();
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
                  #{o.orderNo} · {o.tableNo || t("common.walkIn")}
                </strong>
                <span className="tiny muted">{waitLabel(o.waitMinutes, t)}</span>
              </div>
              <div className="tiny muted">{itemsLine(o)}</div>
              <div className="row" style={{ marginTop: "0.25rem", gap: "0.35rem" }}>
                <span
                  className={`badge ${
                    o.status === "READY" ? "ready" : "pending"
                  }`}
                >
                  {ts(o.status)}
                </span>
                {showTotal && <span className="tiny">{money(o.total)}</span>}
                {o.stale && <span className="badge unpaid">{ts("DELAYED")}</span>}
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
  const t = useT();
  const show = (key: "orders" | "bills" | "kitchen" | "store") =>
    !focus || focus.includes(key);

  return (
    <div className="panel panel-pad">
      <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>{t("dash.shortcuts")}</h2>
      <div className="row">
        {show("orders") && can("order.create") && (
          <Link className="btn" to="/orders">
            {t("dash.newOrder")}
          </Link>
        )}
        {show("bills") && can("bill.view") && (
          <Link className="btn ghost" to="/bills">
            {t("dash.billing")}
          </Link>
        )}
        {show("kitchen") && can("kitchen.view") && (
          <Link className="btn ghost" to="/kitchen">
            {t("dash.kitchen")}
          </Link>
        )}
        {show("store") && can("store.view", "store.manage") && (
          <Link className="btn ghost" to="/store">
            {t("dash.inventory")}
          </Link>
        )}
      </div>
    </div>
  );
}
