import { useEffect, useMemo, useState } from "react";
import { api, money, unitLabel } from "../api";
import { useAuth } from "../auth";
import { useToast } from "../toast";
import { Modal } from "../components/Modal";
import { BillPreview, printBill, type BillOrder } from "../components/BillPreview";
import { SearchField, matchesSearch } from "../components/SearchField";
import { Pagination, paginate } from "../components/Pagination";
import { downloadExcelCsv } from "../csv";
import { serverPrint } from "../printing";
import { useSocketEvent } from "../socket";
import { PayModal } from "../components/PayModal";
import { CashHandovers } from "../components/CashHandovers";
import { CashRecord } from "../components/CashRecord";
import { useI18n, useT } from "../i18n";

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
  status: string;
  paidAmount: number;
  tipAmount?: number;
  waiter?: string | null;
  orderedBy?: { id?: string; name: string; roleCode?: string; roleName: string } | null;
  servedBy?: string | null;
  servedByName?: string | null;
  billRequestedAt?: string | null;
  payments?: OrderPayment[];
};

const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-PK", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

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
          <div className="seg">
            <button type="button" className={view === "bills" ? "active" : ""} onClick={() => setView("bills")}>
              {t("bills.tabBills")}
            </button>
            <button type="button" className={view === "cash" ? "active" : ""} onClick={() => setView("cash")}>
              {t("bills.tabCash")}
            </button>
          </div>
        )}
        <div className="row" style={view === "cash" ? { display: "none" } : undefined}>
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
                <th>{t("bills.orderedBy")}</th>
                <th>{t("common.items")}</th>
                <th>{t("bills.kitchen")}</th>
                <th>{t("common.total")}</th>
                <th>{t("bills.tip")}</th>
                <th>{t("bills.pay")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((o) => (
                <tr key={o.id}>
                  <td>{o.orderNo}</td>
                  <td>
                    {o.tableNo || "—"}
                    {o.billRequestedAt && o.paymentStatus !== "PAID" && (
                      <span className="badge pending" style={{ marginLeft: "0.35rem" }}>
                        {t("bills.billRequested")}
                      </span>
                    )}
                  </td>
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
                      onClick={() => setSelected(o)}
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
              ))}
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
        onClose={() => setSelected(null)}
      >
        {selected && (
          <>
            <div className="modal-scroll">
              <BillPreview order={selected} mode="customer" />
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
              {can("print.bill") && (
                <button type="button" className="btn" onClick={() => void printOnServer(selected.id)}>
                  {t("common.printOnPrinter")}
                </button>
              )}
              <button type="button" className="btn ghost" onClick={printBill}>
                {t("common.browserPrint")}
              </button>
              {can("order.pay") && selected.paymentStatus !== "PAID" && (
                <button type="button" className="btn ok" onClick={() => setPaying(selected)}>
                  {t("bills.takePayment")}
                </button>
              )}
              <button
                type="button"
                className="btn ghost"
                onClick={() => setSelected(null)}
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
