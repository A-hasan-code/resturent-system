import { useEffect, useState } from "react";
import { Pagination, paginate } from "../components/Pagination";

const PAGE_SIZE = 15;
import { Link } from "react-router-dom";
import { api, money, unitLabel } from "../api";
import { useToast } from "../toast";
import { useAuth } from "../auth";
import { HotelGatePanel } from "../components/HotelGatePanel";
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
  paidAmount?: number;
  due?: number;
  createdAt: string;
  waitMinutes: number;
  stale: boolean;
  items: { name: string; quantity: number; sellUnit: string }[];
  cancelReason?: string | null;
  cancelledAt?: string | null;
  cancelledBy?: string | null;
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

type TipRow = {
  userId: string;
  name: string;
  roleCode: string;
  roleName: string;
  tip: number;
  shares: number;
};

type StaffOrderRow = {
  userId: string;
  name: string;
  roleCode: string;
  roleName: string;
  orders: number;
  amount: number;
};

type NetWindow = {
  from: string;
  to: string;
  sales: number;
  totalExpense: number;
  manualExpenses: number;
  supplierPaid: number;
  netProfit: number;
};

type Stats = {
  role: string;
  staleMinutes: number;
  pendingKitchen: number;
  preparing: number;
  ready: number;
  served?: number;
  completed: number;
  staleCount?: number;
  ordersToday: number;
  orderAmountToday: number;
  totalOrders: number;
  unpaidCount: number;
  unpaidAmount: number;
  paidCount?: number;
  cancelledToday?: number;
  cancelledCount?: number;
  cancelledOrders?: DashOrder[];
  paidTodayCount?: number;
  creditOutstanding?: number;
  creditOutstandingCount?: number;
  creditPaidToday?: number;
  creditPaidTodayCount?: number;
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
  tipsToday?: number;
  tipsCollectedToday?: number;
  myTipToday?: number;
  myOrdersToday?: number;
  myServedToday?: number;
  tipBoard?: TipRow[];
  staffOrdersToday?: StaffOrderRow[];
  netProfit?: {
    daily: NetWindow;
    monthly: NetWindow;
    yearly: NetWindow;
  } | null;
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

function itemsPreview(o: DashOrder, max = 2) {
  const parts = o.items.map(
    (i) => `${i.quantity} ${unitLabel(i.sellUnit)} ${i.name}`,
  );
  if (parts.length <= max) return { text: parts.join(" · "), more: 0 };
  return {
    text: parts.slice(0, max).join(" · "),
    more: parts.length - max,
  };
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
          : role === "SUPERVISOR"
            ? t("dash.titleSupervisor")
            : role === "MAIN_CASHIER"
              ? t("dash.titleCashier")
              : role === "WAITER"
                ? t("dash.titleWaiter")
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
      {role === "SYSTEM_MANAGER" && <AdminDash data={data} can={can} />}
      {role === "CASHIER" && <CashierDash data={data} can={can} />}
      {role === "KITCHEN" && <KitchenDash data={data} can={can} />}
      {role === "STORE" && <StoreDash data={data} can={can} />}
      {role === "WAITER" && <WaiterDash data={data} can={can} />}
      {role === "SUPERVISOR" && <ManagerDash data={data} can={can} />}
      {role === "MAIN_CASHIER" && <CashierDash data={data} can={can} />}
      {!["ADMIN", "SYSTEM_MANAGER", "CASHIER", "MAIN_CASHIER", "KITCHEN", "STORE", "WAITER", "SUPERVISOR"].includes(role) && (
        <AdminDash data={data} can={can} />
      )}
    </div>
  );
}

function NetProfitPanel({ data }: { data: Stats | null }) {
  const t = useT();
  const [mode, setMode] = useState<"daily" | "monthly" | "yearly">("daily");
  const win = data?.netProfit?.[mode];
  if (!data?.netProfit) return null;
  const isLoss = (win?.netProfit ?? 0) < 0;
  return (
    <div className="panel panel-pad dash-net">
      <div className="row dash-net-head">
        <div>
          <h2 className="dash-h2">
            {isLoss ? t("dash.netTitleLoss") : t("dash.netTitle")}
          </h2>
          <p className="tiny muted dash-sub">
            {isLoss ? t("dash.netLossHint") : t("dash.netHint")}
            {win ? ` · ${win.from} → ${win.to}` : ""}
          </p>
        </div>
        <div className="row dash-net-tabs">
          {(["daily", "monthly", "yearly"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`btn sm ${mode === m ? "ok" : "ghost"}`}
              onClick={() => setMode(m)}
            >
              {m === "daily" ? t("dash.netDaily") : m === "monthly" ? t("dash.netMonthly") : t("dash.netYearly")}
            </button>
          ))}
        </div>
      </div>
      <div className="stats dash-net-stats">
        <div className="stat dash-metric">
          <span>{t("dash.netSales")}</span>
          <strong>{money(win?.sales ?? 0)}</strong>
        </div>
        <div className="stat dash-metric">
          <span>{t("dash.netExpense")}</span>
          <strong>{money(win?.totalExpense ?? 0)}</strong>
          <span className="tiny muted">
            {t("expense.manualTotal")} {money(win?.manualExpenses ?? 0)} · {t("expense.supplierPaid")}{" "}
            {money(win?.supplierPaid ?? 0)}
          </span>
        </div>
        <div className={`stat dash-metric ${isLoss ? "alert-low" : ""}`}>
          <span>{isLoss ? t("dash.netLoss") : t("dash.netProfit")}</span>
          <strong style={{ color: isLoss ? "var(--danger)" : "var(--ok)" }}>
            {isLoss ? (
              <>
                {t("expense.lossTag")} · {money(Math.abs(win?.netProfit ?? 0))}
              </>
            ) : (
              <>
                {t("expense.profitTag")} · {money(win?.netProfit ?? 0)}
              </>
            )}
          </strong>
          <span className="tiny muted">
            <Link to="/expenses">{t("nav.expenses")}</Link>
          </span>
        </div>
      </div>
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
  const salesToday = data ? money(data.orderAmountToday ?? data.salesToday ?? 0) : "—";
  return (
    <>
      <HotelGatePanel />
      <StaleAlert
        orders={data?.staleOrders ?? []}
        minutes={data?.staleMinutes ?? 10}
        link="/kitchen"
        linkLabel={t("dash.openKitchen")}
      />
      {(data?.lowStockCount ?? 0) > 0 && (
        <LowStockAlert items={data?.lowStock ?? []} count={data?.lowStockCount ?? 0} />
      )}

      <p className="dash-section-title">{t("dash.sectionOrders")}</p>
      <div className="stats dash-stats-today">
        <div className="panel stat">
          <span>{t("dash.ordersToday")}</span>
          <strong>{data ? data.ordersToday ?? 0 : "—"}</strong>
          <span className="tiny muted dash-stat-hint">{t("dash.hintPlacedToday")}</span>
        </div>
        <div className="panel stat">
          <span>{t("dash.paidTodayCount")}</span>
          <strong style={{ color: (data?.paidTodayCount ?? 0) ? "var(--ok)" : undefined }}>
            {data ? data.paidTodayCount ?? 0 : "—"}
          </strong>
          <span className="tiny muted dash-stat-hint">{t("dash.hintPaidCount")}</span>
        </div>
        <div className="panel stat">
          <span>{t("dash.unpaidBills")}</span>
          <strong style={{ color: (data?.unpaidCount ?? 0) ? "var(--danger)" : undefined }}>
            {data ? data.unpaidCount ?? 0 : "—"}
            <span className="tiny muted dash-stat-sub">
              {data ? money(data.unpaidAmount) : ""}
            </span>
          </strong>
        </div>
        <div className="panel stat">
          <span>{t("dash.cancelledToday")}</span>
          <strong style={{ color: (data?.cancelledToday ?? 0) ? "var(--danger)" : undefined }}>
            {data ? data.cancelledToday ?? 0 : "—"}
          </strong>
          <span className="tiny muted dash-stat-hint">
            {t("dash.cancelledAll", { n: data?.cancelledCount ?? 0 })}
          </span>
        </div>
      </div>

      <p className="dash-section-title">{t("dash.sectionToday")}</p>
      <div className="stats dash-stats-today">
        <div className="panel stat stat-sales">
          <span>{t("dash.salesToday")}</span>
          <strong>{salesToday}</strong>
          <span className="tiny muted dash-stat-hint">{t("dash.hintBillTotal")}</span>
        </div>
        <div className="panel stat">
          <span>{t("dash.collectedToday")}</span>
          <strong>{data ? money(data.revenueToday) : "—"}</strong>
          <span className="tiny muted dash-stat-hint">{t("dash.hintPaidToday")}</span>
        </div>
        <div className="panel stat">
          <span>{t("dash.tipsToday")}</span>
          <strong>{data ? money(data.tipsToday ?? 0) : "—"}</strong>
          <span className="tiny muted dash-stat-hint">{t("dash.hintTips")}</span>
        </div>
        <div className="panel stat">
          <span>{t("dash.creditTotal")}</span>
          <strong style={{ color: (data?.creditOutstanding ?? 0) ? "var(--danger)" : undefined }}>
            {data ? money(data.creditOutstanding ?? 0) : "—"}
          </strong>
          <span className="tiny muted dash-stat-hint">
            {t("dash.creditDueHint", { n: data?.creditOutstandingCount ?? 0 })}
          </span>
        </div>
        <div className="panel stat">
          <span>{t("dash.creditPaidToday")}</span>
          <strong>{data ? money(data.creditPaidToday ?? 0) : "—"}</strong>
          <span className="tiny muted dash-stat-hint">
            {t("dash.creditPaidHint", { n: data?.creditPaidTodayCount ?? 0 })}
          </span>
        </div>
      </div>

      <NetProfitPanel data={data} />

      <p className="dash-section-title">{t("dash.sectionOverview")}</p>
      <div className="stats">
        <div className="panel stat">
          <span>{t("dash.paidAll")}</span>
          <strong>{data ? data.paidCount ?? 0 : "—"}</strong>
          <span className="tiny muted dash-stat-hint">{t("dash.hintPaidAll")}</span>
        </div>
        <div className="panel stat">
          <span>{t("dash.pendingKitchen")}</span>
          <strong>{data?.pendingKitchen ?? "—"}</strong>
        </div>
        <div className="panel stat">
          <span>{t("dash.ready")}</span>
          <strong style={{ color: (data?.ready ?? 0) ? "var(--ok)" : undefined }}>
            {data?.ready ?? "—"}
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
        <div className="panel stat">
          <span>{t("dash.totalOrders")}</span>
          <strong>{data?.totalOrders ?? "—"}</strong>
          <span className="tiny muted dash-stat-hint">{t("dash.hintAllTime")}</span>
        </div>
      </div>

      <TipAndStaffPanels data={data} />

      <div className="dash-grid">
        <OrderList
          title={t("dash.activeKitchen")}
          empty={t("dash.emptyKitchen")}
          orders={(data?.kitchenQueue ?? []).slice(0, 8)}
          showTotal
          linkTo="/kitchen"
        />
        <OrderList
          title={t("dash.unpaidBills")}
          empty={t("dash.emptyUnpaid")}
          orders={(data?.unpaidOrders ?? [])
            .filter((o) => o.status !== "CANCELLED" && o.paymentStatus !== "VOID")
            .slice(0, 8)}
          showTotal
          showPayment
          linkTo="/bills"
        />
      </div>
      {(data?.cancelledOrders?.length ?? 0) > 0 && (
        <OrderList
          title={t("dash.cancelledOrders")}
          empty={t("dash.emptyCancelled")}
          orders={(data?.cancelledOrders ?? []).slice(0, 8)}
          showTotal
          showCancelReason
          linkTo="/bills"
        />
      )}

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
        link="/kitchen"
        linkLabel={t("dash.openKitchen")}
        message={t("dash.delayedWaiting")}
      />

      <p className="dash-section-title">{t("dash.sectionOrders")}</p>
      <div className="stats dash-stats-today">
        <div className="panel stat">
          <span>{t("dash.ordersToday")}</span>
          <strong>{data ? data.ordersToday ?? 0 : "—"}</strong>
          <span className="tiny muted dash-stat-hint">{t("dash.hintPlacedToday")}</span>
        </div>
        <div className="panel stat">
          <span>{t("dash.paidTodayCount")}</span>
          <strong style={{ color: (data?.paidTodayCount ?? 0) ? "var(--ok)" : undefined }}>
            {data ? data.paidTodayCount ?? 0 : "—"}
          </strong>
          <span className="tiny muted dash-stat-hint">{t("dash.hintPaidCount")}</span>
        </div>
        <div className="panel stat">
          <span>{t("dash.unpaidBills")}</span>
          <strong style={{ color: (data?.unpaidCount ?? 0) ? "var(--danger)" : undefined }}>
            {data ? data.unpaidCount ?? 0 : "—"}
            <span className="tiny muted dash-stat-sub">
              {data ? money(data.unpaidAmount) : ""}
            </span>
          </strong>
        </div>
        <div className="panel stat">
          <span>{t("dash.cancelledToday")}</span>
          <strong style={{ color: (data?.cancelledToday ?? 0) ? "var(--danger)" : undefined }}>
            {data ? data.cancelledToday ?? 0 : "—"}
          </strong>
          <span className="tiny muted dash-stat-hint">
            {t("dash.cancelledAll", { n: data?.cancelledCount ?? 0 })}
          </span>
        </div>
      </div>

      <p className="dash-section-title">{t("dash.sectionToday")}</p>
      <div className="stats dash-stats-today">
        <div className="panel stat stat-sales">
          <span>{t("dash.salesToday")}</span>
          <strong>
            {data ? money(data.salesToday || data.orderAmountToday || data.revenueToday) : "—"}
          </strong>
          <span className="tiny muted dash-stat-hint">
            {t("dash.hintNOrders", { n: data?.ordersToday ?? 0 })} · {t("dash.hintBillTotal")}
          </span>
        </div>
        <div className="panel stat">
          <span>{t("dash.creditDue")}</span>
          <strong style={{ color: (data?.creditOutstanding ?? 0) ? "var(--danger)" : undefined }}>
            {data ? money(data.creditOutstanding ?? 0) : "—"}
            <span className="tiny muted dash-stat-sub">
              {t("dash.creditDueHint", { n: data?.creditOutstandingCount ?? 0 })}
            </span>
          </strong>
        </div>
        <div className="panel stat">
          <span>{t("dash.creditPaidToday")}</span>
          <strong>{data ? money(data.creditPaidToday ?? 0) : "—"}</strong>
          <span className="tiny muted dash-stat-hint">
            {t("dash.creditPaidHint", { n: data?.creditPaidTodayCount ?? 0 })}
          </span>
        </div>
        <div className="panel stat">
          <span>{t("dash.readyToServe")}</span>
          <strong style={{ color: (data?.ready ?? 0) ? "var(--ok)" : undefined }}>
            {data?.ready ?? "—"}
          </strong>
        </div>
        <div className="panel stat">
          <span>{t("dash.tipsToday")}</span>
          <strong>{data ? money(data.tipsToday ?? data.tipsCollectedToday ?? 0) : "—"}</strong>
        </div>
      </div>

      <TipAndStaffPanels data={data} />

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
          <span>{t("dash.served")}</span>
          <strong>{data?.served ?? "—"}</strong>
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
          orders={(data?.unpaidOrders ?? []).filter((o) => o.status !== "CANCELLED" && o.paymentStatus !== "VOID")}
          showTotal
          showPayment
          linkTo="/bills"
        />
        <OrderList
          title={t("dash.longWaits")}
          empty={t("dash.emptyDelayed")}
          orders={data?.staleOrders ?? []}
          linkTo="/waiter"
        />
      </div>
      {(data?.cancelledOrders?.length ?? 0) > 0 && (
        <OrderList
          title={t("dash.cancelledOrders")}
          empty={t("dash.emptyCancelled")}
          orders={data?.cancelledOrders ?? []}
          showTotal
          showCancelReason
          linkTo="/bills"
        />
      )}

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
          <span>{t("dash.served")}</span>
          <strong>{data?.served ?? "—"}</strong>
        </div>
        <div className="panel stat">
          <span>{t("dash.delayed", { n: data?.staleMinutes ?? 10 })}</span>
          <strong style={{ color: (data?.staleCount ?? data?.staleOrders.length ?? 0) ? "var(--danger)" : undefined }}>
            {data?.staleCount ?? data?.staleOrders.length ?? "—"}
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
  const [usagePage, setUsagePage] = useState(1);

  useEffect(() => {
    setUsagePage(1);
  }, [usage.length]);

  const pageUsage = paginate(usage, usagePage, PAGE_SIZE);

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
          <>
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
              {pageUsage.map((u) => (
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
          <Pagination page={usagePage} pageSize={PAGE_SIZE} total={usage.length} onChange={setUsagePage} />
          </>
        )}
      </div>

      <Shortcuts can={can} focus={["store"]} />
    </>
  );
}

function WaiterDash({
  data,
  can,
}: {
  data: Stats | null;
  can: (...p: string[]) => boolean;
}) {
  const t = useT();
  return (
    <>
      <div className="stats">
        <div className="panel stat">
          <span>{t("dash.myTipToday")}</span>
          <strong>{data ? money(data.myTipToday ?? data.tipsToday ?? 0) : "—"}</strong>
        </div>
        <div className="panel stat">
          <span>{t("dash.myOrdersToday")}</span>
          <strong>{data?.myOrdersToday ?? "—"}</strong>
        </div>
        <div className="panel stat">
          <span>{t("dash.myServedToday")}</span>
          <strong>{data?.myServedToday ?? "—"}</strong>
        </div>
        <div className="panel stat">
          <span>{t("dash.readyToServe")}</span>
          <strong style={{ color: (data?.ready ?? 0) ? "var(--ok)" : undefined }}>
            {data?.ready ?? "—"}
          </strong>
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
          <span>{t("dash.served")}</span>
          <strong>{data?.served ?? "—"}</strong>
        </div>
        <div className="panel stat">
          <span>{t("dash.completed")}</span>
          <strong>{data?.completed ?? "—"}</strong>
        </div>
      </div>

      <TipAndStaffPanels data={data} personal />
      <Shortcuts can={can} focus={["orders"]} />
    </>
  );
}

function ManagerDash({
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

      <div className="stats dash-stats-today">
        <div className="panel stat stat-sales">
          <span>{t("dash.salesToday")}</span>
          <strong>{data ? money(data.orderAmountToday ?? data.salesToday ?? 0) : "—"}</strong>
          <span className="tiny muted dash-stat-hint">{t("dash.hintBillTotal")}</span>
        </div>
        <div className="panel stat">
          <span>{t("dash.ordersToday")}</span>
          <strong>{data?.ordersToday ?? "—"}</strong>
        </div>
        <div className="panel stat">
          <span>{t("dash.tipsToday")}</span>
          <strong>{data ? money(data.tipsToday ?? 0) : "—"}</strong>
        </div>
        <div className="panel stat">
          <span>{t("dash.myTipToday")}</span>
          <strong>{data ? money(data.myTipToday ?? 0) : "—"}</strong>
        </div>
        <div className="panel stat">
          <span>{t("dash.creditDue")}</span>
          <strong style={{ color: (data?.creditOutstanding ?? 0) ? "var(--danger)" : undefined }}>
            {data ? money(data.creditOutstanding ?? 0) : "—"}
            <span className="tiny muted dash-stat-sub">
              {t("dash.creditDueHint", { n: data?.creditOutstandingCount ?? 0 })}
            </span>
          </strong>
        </div>
      </div>

      <TipAndStaffPanels data={data} />

      <div className="dash-grid">
        <OrderList
          title={t("dash.activeKitchen")}
          empty={t("dash.emptyKitchen")}
          orders={(data?.kitchenQueue ?? []).slice(0, 8)}
          showTotal
          linkTo="/kitchen"
        />
        <OrderList
          title={t("dash.unpaidBills")}
          empty={t("dash.emptyUnpaid")}
          orders={(data?.unpaidOrders ?? [])
            .filter((o) => o.status !== "CANCELLED" && o.paymentStatus !== "VOID")
            .slice(0, 8)}
          showTotal
          showPayment
          linkTo="/bills"
        />
      </div>

      <Shortcuts can={can} />
    </>
  );
}

function TipAndStaffPanels({ data, personal }: { data: Stats | null; personal?: boolean }) {
  const t = useT();
  const tips = data?.tipBoard ?? [];
  const staff = data?.staffOrdersToday ?? [];
  const [tipsPage, setTipsPage] = useState(1);
  const [staffPage, setStaffPage] = useState(1);
  const showTips = tips.length > 0 || !!personal;
  const showStaff = !personal && staff.length > 0;

  useEffect(() => {
    setTipsPage(1);
  }, [tips.length]);

  useEffect(() => {
    setStaffPage(1);
  }, [staff.length]);

  const pageTips = paginate(tips, tipsPage, PAGE_SIZE);
  const pageStaff = paginate(staff, staffPage, PAGE_SIZE);

  if (!showTips && !showStaff) return null;

  const sole = (showTips && !showStaff) || (!showTips && showStaff);

  return (
    <div className={`dash-grid${sole ? " dash-grid-solo" : ""}`} style={{ marginBottom: "1rem" }}>
      {showTips && (
        <div className="panel panel-pad dash-panel">
          <div className="dash-panel-head">
            <h2 className="dash-h2">
              {personal ? t("dash.myTipBreakdown") : t("dash.tipBoard")}
            </h2>
            {tips.length > 0 && (
              <span className="tiny muted">{tips.length}</span>
            )}
          </div>
          {!tips.length ? (
            <div className="empty empty-compact">{t("dash.emptyTips")}</div>
          ) : (
            <>
              <table className="dash-table">
                <thead>
                  <tr>
                    <th>{t("common.name")}</th>
                    <th>{t("common.role")}</th>
                    <th>{t("dash.tip")}</th>
                  </tr>
                </thead>
                <tbody>
                  {pageTips.map((r) => (
                    <tr key={r.userId}>
                      <td>{r.name}</td>
                      <td className="muted">{r.roleName || r.roleCode}</td>
                      <td className="dash-num">{money(r.tip)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination page={tipsPage} pageSize={PAGE_SIZE} total={tips.length} onChange={setTipsPage} />
            </>
          )}
        </div>
      )}
      {showStaff && (
        <div className="panel panel-pad dash-panel">
          <div className="dash-panel-head">
            <h2 className="dash-h2">{t("dash.staffOrdersToday")}</h2>
            <span className="tiny muted">{staff.length}</span>
          </div>
          <table className="dash-table">
            <thead>
              <tr>
                <th>{t("common.name")}</th>
                <th>{t("common.role")}</th>
                <th>{t("dash.ordersCol")}</th>
                <th>{t("common.amount")}</th>
              </tr>
            </thead>
            <tbody>
              {pageStaff.map((r) => (
                <tr key={r.userId}>
                  <td>{r.name}</td>
                  <td className="muted">{r.roleName || r.roleCode}</td>
                  <td className="dash-num">{r.orders}</td>
                  <td className="dash-num">{money(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={staffPage} pageSize={PAGE_SIZE} total={staff.length} onChange={setStaffPage} />
        </div>
      )}
    </div>
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
  showCancelReason,
  showPayment,
  linkTo,
}: {
  title: string;
  empty: string;
  orders: DashOrder[];
  showTotal?: boolean;
  highlightNew?: boolean;
  showCancelReason?: boolean;
  showPayment?: boolean;
  linkTo?: string;
}) {
  const t = useT();
  const { ts } = useI18n();
  return (
    <div className="panel panel-pad dash-panel">
      <div className="dash-panel-head">
        <h2 className="dash-h2">{title}</h2>
        <div className="dash-panel-meta">
          {orders.length > 0 && (
            <span className="tiny muted">{orders.length}</span>
          )}
          {linkTo && (
            <Link className="tiny dash-panel-link" to={linkTo}>
              {t("common.view")}
            </Link>
          )}
        </div>
      </div>
      {!orders.length ? (
        <div className="empty empty-compact">{empty}</div>
      ) : (
        <ul className="dash-order-list">
          {orders.map((o) => {
            const preview = itemsPreview(o);
            const statusKey = showPayment ? o.paymentStatus : o.status;
            const statusClass =
              statusKey === "CANCELLED"
                ? "cancelled"
                : statusKey === "READY" || statusKey === "PAID"
                  ? "ready"
                  : statusKey === "UNPAID" || statusKey === "PARTIAL"
                    ? "unpaid"
                    : "pending";
            return (
              <li
                key={o.id}
                className={
                  o.stale ? "is-stale" : highlightNew ? "is-new" : o.status === "CANCELLED" ? "is-cancelled" : ""
                }
              >
                <div className="dash-order-top">
                  <div className="dash-order-title">
                    <strong>#{o.orderNo}</strong>
                    <span className="dash-order-table">
                      {o.tableNo || t("common.walkIn")}
                    </span>
                  </div>
                  <span className="tiny muted dash-order-wait">
                    {showCancelReason && o.cancelledBy
                      ? o.cancelledBy
                      : waitLabel(o.waitMinutes, t)}
                  </span>
                </div>
                <div className="dash-order-items" title={itemsLine(o)}>
                  {preview.text}
                  {preview.more > 0 && (
                    <span className="dash-order-more">
                      {" "}
                      {t("dash.moreItems", { n: preview.more })}
                    </span>
                  )}
                </div>
                {showCancelReason && o.cancelReason && (
                  <div className="dash-order-reason">
                    {t("bills.cancelReason")}: {o.cancelReason}
                  </div>
                )}
                <div className="dash-order-foot">
                  <div className="dash-order-badges">
                    <span className={`badge ${statusClass}`}>{ts(statusKey)}</span>
                    {o.stale && <span className="badge delayed">{ts("DELAYED")}</span>}
                  </div>
                  {showTotal && (
                    <span className="dash-order-total">
                      {money(
                        showPayment && o.due != null
                          ? o.due
                          : o.total
                      )}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
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
    <div className="panel panel-pad dash-panel dash-shortcuts">
      <div className="dash-panel-head">
        <h2 className="dash-h2">{t("dash.shortcuts")}</h2>
      </div>
      <div className="dash-shortcut-row">
        {show("orders") && can("order.create", "order.addItems", "order.viewOwn") && (
          <Link className="btn" to="/waiter">
            {t("nav.waiter")}
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
