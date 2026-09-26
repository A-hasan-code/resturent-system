import { useEffect, useMemo, useState } from "react";
import { api, unitLabel } from "../api";
import { useAuth } from "../auth";
import { useToast } from "../toast";
import { SearchField, matchesSearch } from "../components/SearchField";
import { Pagination, paginate } from "../components/Pagination";

type Order = {
  id: string;
  orderNo: number;
  tableNo: string | null;
  status: string;
  notes: string | null;
  items: {
    name: string;
    quantity: number;
    sellUnit: string;
    notes: string | null;
  }[];
};

const PAGE_SIZE = 8;

export function KitchenPage() {
  const { can } = useAuth();
  const toast = useToast();
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
      toast.push(e instanceof Error ? e.message : "Kitchen load failed", "err");
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 7000);
    return () => clearInterval(t);
  }, []);

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
      toast.push(`Order → ${status}`, "ok");
      await load();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Update failed", "err");
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Kitchen</h1>
          <p>Pending tickets — prices hidden · auto refresh</p>
        </div>
        <button type="button" className="btn ghost sm" onClick={load}>
          Refresh
        </button>
      </div>

      <div className="row" style={{ marginBottom: "0.85rem" }}>
        <SearchField value={q} onChange={setQ} placeholder="Search kitchen orders…" />
      </div>

      {!shown.length ? (
        <div className="panel panel-pad empty">No active kitchen orders</div>
      ) : (
        <>
          <div className="kitchen-board">
            {pageRows.map((o) => (
              <div className="panel panel-pad kitchen-card" key={o.id}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <h3>
                    #{o.orderNo} · {o.tableNo || "Walk-in"}
                  </h3>
                  <span
                    className={`badge ${
                      o.status === "READY" ? "ready" : "pending"
                    }`}
                  >
                    {o.status}
                  </span>
                </div>
                {o.notes && <p className="muted tiny">{o.notes}</p>}
                <ul>
                  {o.items.map((i, idx) => (
                    <li key={idx}>
                      <strong>
                        {i.quantity} {unitLabel(i.sellUnit)}
                      </strong>{" "}
                      {i.name}
                      {i.notes ? ` — ${i.notes}` : ""}
                    </li>
                  ))}
                </ul>
                {can("kitchen.update") && (
                  <div className="row">
                    {o.status === "PENDING" && (
                      <button
                        type="button"
                        className="btn warn sm"
                        onClick={() => setStatus(o.id, "PREPARING")}
                      >
                        Start cooking
                      </button>
                    )}
                    {(o.status === "PENDING" || o.status === "PREPARING") && (
                      <button
                        type="button"
                        className="btn ok sm"
                        onClick={() => setStatus(o.id, "READY")}
                      >
                        Mark ready
                      </button>
                    )}
                    {o.status === "READY" && (
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => setStatus(o.id, "COMPLETED")}
                      >
                        Complete
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
