import { useEffect, useMemo, useState } from "react";
import { api, money, unitLabel } from "../api";
import { useAuth } from "../auth";
import { useToast } from "../toast";
import { Modal } from "../components/Modal";
import { BillPreview, printBill, type BillOrder } from "../components/BillPreview";
import { SearchField, matchesSearch } from "../components/SearchField";
import { Pagination, paginate } from "../components/Pagination";
import { downloadExcelCsv } from "../csv";

type Order = BillOrder & {
  id: string;
  status: string;
};

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
  const [filter, setFilter] = useState<"UNPAID" | "PAID" | "ALL">("UNPAID");
  const [orders, setOrders] = useState<Order[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selected, setSelected] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  async function load() {
    try {
      const query =
        filter === "ALL" ? "" : `?paymentStatus=${filter}`;
      const [list, dash] = await Promise.all([
        api<Order[]>(`/orders${query}`),
        api<Stats>("/dashboard"),
      ]);
      setOrders(list);
      setStats(dash);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Failed to load bills", "err");
    }
  }

  useEffect(() => {
    load();
  }, [filter]);

  const shown = useMemo(
    () =>
      orders.filter((o) =>
        matchesSearch(
          q,
          o.orderNo,
          o.tableNo,
          o.paymentStatus,
          o.status,
          ...o.items.map((i) => i.name)
        )
      ),
    [orders, q]
  );

  useEffect(() => {
    setPage(1);
  }, [filter, q]);

  const pageRows = paginate(shown, page, PAGE_SIZE);

  async function pay(id: string) {
    setBusy(true);
    try {
      await api(`/orders/${id}/pay`, { method: "POST", body: "{}" });
      toast.push("Payment marked paid", "ok");
      setSelected(null);
      await load();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Payment failed", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Billing</h1>
          <p>Revenue · unpaid · search · print receipt</p>
        </div>
        <div className="row">
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => {
              downloadExcelCsv(
                `billing-${filter.toLowerCase()}-${Date.now()}.csv`,
                shown.map((o) => ({
                  OrderNo: o.orderNo,
                  Table: o.tableNo || "",
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
              toast.push("Billing Excel downloaded", "ok");
            }}
          >
            Excel download
          </button>
          {(["UNPAID", "PAID", "ALL"] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={`btn ${filter === f ? "" : "ghost"} sm`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="stats">
        <div className="panel stat">
          <span>Revenue today</span>
          <strong>{stats ? money(stats.revenueToday) : "—"}</strong>
        </div>
        <div className="panel stat">
          <span>Total revenue</span>
          <strong>{stats ? money(stats.revenueAll) : "—"}</strong>
        </div>
        <div className="panel stat">
          <span>Unpaid bills</span>
          <strong>
            {stats?.unpaidCount ?? "—"}
            <span className="tiny muted" style={{ display: "block", fontWeight: 500 }}>
              {stats ? money(stats.unpaidAmount) : ""}
            </span>
          </strong>
        </div>
        <div className="panel stat">
          <span>Orders today</span>
          <strong>{stats?.ordersToday ?? "—"}</strong>
        </div>
      </div>

      <div className="stats">
        <div className="panel stat">
          <span>Pending kitchen</span>
          <strong>{stats?.pendingKitchen ?? "—"}</strong>
        </div>
        <div className="panel stat">
          <span>Preparing</span>
          <strong>{stats?.preparing ?? "—"}</strong>
        </div>
        <div className="panel stat">
          <span>Ready</span>
          <strong>{stats?.ready ?? "—"}</strong>
        </div>
        <div className="panel stat">
          <span>Completed / Paid</span>
          <strong>
            {stats?.completed ?? "—"} / {stats?.paidCount ?? "—"}
          </strong>
        </div>
      </div>

      <div className="row" style={{ marginBottom: "0.85rem" }}>
        <SearchField
          value={q}
          onChange={setQ}
          placeholder="Search bill #, table, item…"
        />
      </div>

      <div className="panel panel-pad">
        {!shown.length ? (
          <div className="empty">No bills match</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Table</th>
                <th>Items</th>
                <th>Kitchen</th>
                <th>Total</th>
                <th>Pay</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((o) => (
                <tr key={o.id}>
                  <td>{o.orderNo}</td>
                  <td>{o.tableNo || "—"}</td>
                  <td>
                    {o.items
                      .map((i) => `${i.quantity} ${unitLabel(i.sellUnit)} ${i.name}`)
                      .join(", ")}
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        o.status === "PENDING" || o.status === "PREPARING"
                          ? "pending"
                          : "ready"
                      }`}
                    >
                      {o.status}
                    </span>
                  </td>
                  <td>{money(o.total)}</td>
                  <td>
                    <span
                      className={`badge ${
                        o.paymentStatus === "PAID" ? "paid" : "unpaid"
                      }`}
                    >
                      {o.paymentStatus}
                    </span>
                  </td>
                  <td className="row">
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => setSelected(o)}
                    >
                      Open
                    </button>
                    {can("order.pay") && o.paymentStatus !== "PAID" && (
                      <button
                        type="button"
                        className="btn ok sm"
                        disabled={busy}
                        onClick={() => pay(o.id)}
                      >
                        Pay
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={shown.length}
        onChange={setPage}
      />

      <Modal
        open={!!selected}
        title={selected ? `Bill #${selected.orderNo}` : "Bill"}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <>
            <BillPreview order={selected} mode="customer" />
            <div className="row no-print" style={{ marginTop: "1rem" }}>
              <button type="button" className="btn" onClick={printBill}>
                Print
              </button>
              {can("order.pay") && selected.paymentStatus !== "PAID" && (
                <button
                  type="button"
                  className="btn ok"
                  disabled={busy}
                  onClick={() => pay(selected.id)}
                >
                  Mark paid
                </button>
              )}
              <button
                type="button"
                className="btn ghost"
                onClick={() => setSelected(null)}
              >
                Close
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
