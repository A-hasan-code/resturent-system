import { useEffect, useMemo, useState } from "react";
import { api, unitLabel } from "../api";
import { useAuth } from "../auth";
import { useToast } from "../toast";
import { SearchField, matchesSearch } from "../components/SearchField";
import { Pagination, paginate } from "../components/Pagination";
import { useSocketEvent } from "../socket";
import { alertBeep, serverPrint } from "../printing";
import { useI18n, useT } from "../i18n";

type Order = {
  id: string;
  orderNo: number;
  tableNo: string | null;
  status: string;
  notes: string | null;
  waiter?: string | null;
  kotRounds?: number;
  items: {
    name: string;
    quantity: number;
    sellUnit: string;
    notes: string | null;
    kotRound?: number;
  }[];
};

const PAGE_SIZE = 8;

export function KitchenPage() {
  const { can } = useAuth();
  const toast = useToast();
  const t = useT();
  const { ts } = useI18n();
  const [orders, setOrders] = useState<Order[]>([]);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  async function load() {
    try {
      const all = await api<Order[]>("/orders");
      setOrders(
        all.filter((o) => ["PENDING", "PREPARING", "READY"].includes(o.status))
      );
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("kitchen.loadFailed"), "err");
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, []);

  useSocketEvent("orders.changed", () => void load());
  useSocketEvent<{ orderNo: number; tableNo: string | null; reason: string }>("kitchen.new", (o) => {
    toast.push(
      `${o.reason === "items-added" ? t("kitchen.itemsAdded") : t("kitchen.newOrder")}: ${o.tableNo || t("common.walkIn")} · #${o.orderNo}`,
      "info"
    );
    alertBeep();
  });

  async function reprint(id: string) {
    try {
      await serverPrint("kot", id);
      toast.push(t("kitchen.reprinting"), "ok");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("common.printFailed"), "err");
    }
  }

  const shown = useMemo(
    () =>
      orders.filter((o) =>
        matchesSearch(
          q,
          o.orderNo,
          o.tableNo,
          o.status,
          o.notes,
          ...o.items.map((i) => i.name)
        )
      ),
    [orders, q]
  );

  useEffect(() => {
    setPage(1);
  }, [q]);

  const pageRows = paginate(shown, page, PAGE_SIZE);

  async function setStatus(id: string, status: string) {
    try {
      await api(`/orders/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      toast.push(t("kitchen.updated", { status: ts(status) }), "ok");
      await load();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("kitchen.updateFailed"), "err");
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t("kitchen.title")}</h1>
          <p>
            {t("kitchen.subtitle")} · {t("kitchen.live")}
          </p>
        </div>
        <button type="button" className="btn ghost sm" onClick={load}>
          {t("common.refresh")}
        </button>
      </div>

      <div className="row" style={{ marginBottom: "0.85rem" }}>
        <SearchField value={q} onChange={setQ} placeholder={t("kitchen.search")} />
      </div>

      {!shown.length ? (
        <div className="panel panel-pad empty">{t("kitchen.empty")}</div>
      ) : (
        <>
          <div className="kitchen-board">
            {pageRows.map((o) => (
              <div className="panel panel-pad kitchen-card" key={o.id}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <h3>
                    #{o.orderNo} · {o.tableNo || t("common.walkIn")}
                  </h3>
                  <span
                    className={`badge ${
                      o.status === "READY" ? "ready" : "pending"
                    }`}
                  >
                    {ts(o.status)}
                  </span>
                </div>
                {o.waiter && (
                  <p className="muted tiny">
                    {t("kitchen.waiter")} {o.waiter}
                  </p>
                )}
                {o.notes && <p className="muted tiny">{o.notes}</p>}
                <ul>
                  {o.items.map((i, idx) => (
                    <li key={idx}>
                      <strong>
                        {i.quantity} {unitLabel(i.sellUnit)}
                      </strong>{" "}
                      {i.name}
                      {i.notes ? ` — ${i.notes}` : ""}
                      {(o.kotRounds ?? 1) > 1 && (i.kotRound ?? 1) > 1 && (
                        <span className="badge pending" style={{ marginLeft: "0.35rem" }}>
                          R{i.kotRound}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                {can("kitchen.update") && (
                  <div className="row kitchen-actions">
                    {can("print.kot") && (
                      <button type="button" className="btn ghost sm" onClick={() => void reprint(o.id)}>
                        {t("kitchen.slip")}
                      </button>
                    )}
                    {o.status === "PENDING" && (
                      <button
                        type="button"
                        className="btn warn sm"
                        onClick={() => setStatus(o.id, "PREPARING")}
                      >
                        {t("kitchen.start")}
                      </button>
                    )}
                    {(o.status === "PENDING" || o.status === "PREPARING") && (
                      <button
                        type="button"
                        className="btn ok sm"
                        onClick={() => setStatus(o.id, "READY")}
                      >
                        {t("kitchen.markReady")}
                      </button>
                    )}
                    {o.status === "READY" && (
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => setStatus(o.id, "COMPLETED")}
                      >
                        {t("kitchen.complete")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={shown.length}
            onChange={setPage}
          />
        </>
      )}
    </div>
  );
}
