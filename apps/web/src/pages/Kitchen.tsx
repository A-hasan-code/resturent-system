import { useEffect, useMemo, useState } from "react";
import { api, unitLabel } from "../api";
import { useAuth } from "../auth";
import { useToast } from "../toast";
import { SearchField, matchesSearch } from "../components/SearchField";
import { Pagination, paginate } from "../components/Pagination";
import { useSocketEvent } from "../socket";
import { alertBeep, serverPrint } from "../printing";
import { useI18n, useT } from "../i18n";
import { loadKitchenStations, type KitchenStationRow } from "../kitchenStations";

type Order = {
  id: string;
  orderNo: number;
  tableNo: string | null;
  status: string;
  notes: string | null;
  waiter?: string | null;
  kotRounds?: number;
  createdAt?: string;
  pendingAt?: string | null;
  preparingAt?: string | null;
  readyAt?: string | null;
  prepTargetMinutes?: number;
  items: {
    name: string;
    quantity: number;
    sellUnit: string;
    notes: string | null;
    kotRound?: number;
    lineKind?: "MENU" | "PER_HEAD";
    kitchenStation?: string | null;
    category?: string | null;
    prepMinutes?: number | null;
  }[];
};

type MenuRow = { name: string; category: string | null; kitchenStation?: string | null };

const PAGE_SIZE = 8;

function stationFromCategory(category: string | null | undefined): string | null {
  if (!category) return null;
  const c = category.toLowerCase();
  if (c.includes("beverage") || c.includes("drink") || c.includes("lassi") || c.includes("juice")) {
    return "BEVERAGES";
  }
  if (c.includes("bbq") || c.includes("grill")) return "BBQ";
  if (c.includes("cook") || c.includes("karahi") || c.includes("chinese") || c.includes("rice")) {
    return "COOKING";
  }
  return null;
}

function itemStation(
  item: Order["items"][number],
  menuByName: Map<string, MenuRow>
): string {
  if (item.kitchenStation) return item.kitchenStation;
  const fromCat = stationFromCategory(item.category);
  if (fromCat) return fromCat;
  const menu = menuByName.get(item.name.toLowerCase());
  if (menu?.kitchenStation) return menu.kitchenStation;
  return stationFromCategory(menu?.category) || "COOKING";
}

function parseTime(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function orderClock(o: Order, now: number) {
  const pendingMs = parseTime(o.pendingAt) ?? parseTime(o.createdAt);
  const preparingMs = parseTime(o.preparingAt);
  const targetMin = o.prepTargetMinutes ?? 15;

  if (o.status === "PENDING") {
    const start = pendingMs ?? now;
    const elapsed = now - start;
    const late = elapsed >= 60_000;
    return {
      labelKey: "kitchen.waiting" as const,
      elapsedLabel: formatElapsed(elapsed),
      targetLabel: null as string | null,
      lateByLabel: null as string | null,
      late,
      urgent: late,
    };
  }

  if (o.status === "PREPARING") {
    const start = preparingMs ?? pendingMs ?? now;
    const elapsed = now - start;
    const targetMs = targetMin * 60_000;
    const late = elapsed > targetMs;
    const lateBy = late ? formatElapsed(elapsed - targetMs) : null;
    return {
      labelKey: "kitchen.cooking" as const,
      elapsedLabel: formatElapsed(elapsed),
      targetLabel: `${targetMin}m`,
      lateByLabel: lateBy,
      late,
      urgent: late,
    };
  }

  if (o.status === "READY") {
    const start = preparingMs ?? pendingMs;
    const ready = parseTime(o.readyAt) ?? now;
    const elapsed = start != null ? ready - start : 0;
    return {
      labelKey: "kitchen.cookedIn" as const,
      elapsedLabel: formatElapsed(elapsed),
      targetLabel: `${targetMin}m`,
      lateByLabel: null as string | null,
      late: false,
      urgent: false,
    };
  }

  return null;
}

export function KitchenPage() {
  const { can } = useAuth();
  const toast = useToast();
  const t = useT();
  const { ts } = useI18n();
  const [orders, setOrders] = useState<Order[]>([]);
  const [menuByName, setMenuByName] = useState<Map<string, MenuRow>>(new Map());
  const [stations, setStations] = useState<KitchenStationRow[]>([]);
  const [q, setQ] = useState("");
  const [station, setStation] = useState<string>("ALL");
  const [page, setPage] = useState(1);
  const [now, setNow] = useState(() => Date.now());

  async function load() {
    try {
      const all = await api<Order[]>("/orders/kitchen");
      setOrders(all);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("kitchen.loadFailed"), "err");
    }
  }

  useEffect(() => {
    load();
    loadKitchenStations()
      .then(setStations)
      .catch(() => undefined);
    api<MenuRow[]>("/menu")
      .then((rows) => {
        const map = new Map<string, MenuRow>();
        for (const r of rows) map.set(r.name.toLowerCase(), r);
        setMenuByName(map);
      })
      .catch(() => undefined);
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  useSocketEvent("orders.changed", () => void load());
  useSocketEvent<{ orderNo: number; tableNo: string | null; reason: string }>("kitchen.new", (o) => {
    const kind =
      o.reason === "items-added"
        ? t("kitchen.itemsAdded")
        : o.reason === "cancelled"
          ? t("kitchen.orderCancelled")
          : o.reason === "edited"
            ? t("kitchen.orderEdited")
            : t("kitchen.newOrder");
    toast.push(`${kind}: ${o.tableNo || t("common.walkIn")} · #${o.orderNo}`, "info");
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

  const shown = useMemo(() => {
    return orders
      .map((o) => {
        const kitchenItems = o.items.filter((i) => i.lineKind !== "PER_HEAD");
        const items =
          station === "ALL"
            ? kitchenItems
            : kitchenItems.filter((i) => itemStation(i, menuByName) === station);
        return { ...o, items };
      })
      .filter((o) => o.items.length > 0)
      .filter((o) =>
        matchesSearch(
          q,
          o.orderNo,
          o.tableNo,
          o.status,
          o.notes,
          ...o.items.map((i) => i.name)
        )
      );
  }, [orders, q, station, menuByName]);

  useEffect(() => {
    setPage(1);
  }, [q, station]);

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

      <div className="row" style={{ marginBottom: "0.85rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <SearchField value={q} onChange={setQ} placeholder={t("kitchen.search")} />
        <div className="chips">
          <button
            type="button"
            className={`chip ${station === "ALL" ? "active" : ""}`}
            onClick={() => setStation("ALL")}
          >
            {t("kitchen.stationAll")}
          </button>
          {stations.map((s) => (
            <button
              key={s.code}
              type="button"
              className={`chip ${station === s.code ? "active" : ""}`}
              onClick={() => setStation(s.code)}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>

      {!shown.length ? (
        <div className="panel panel-pad empty">{t("kitchen.empty")}</div>
      ) : (
        <>
          <div className="kitchen-board">
            {pageRows.map((o) => {
              const clock = orderClock(o, now);
              const badgeClass =
                o.status === "READY"
                  ? "ready"
                  : o.status === "PREPARING"
                    ? clock?.late
                      ? "delayed"
                      : "preparing"
                    : clock?.late
                      ? "delayed"
                      : "pending";
              return (
                <div
                  className={`panel panel-pad kitchen-card${clock?.urgent ? " kitchen-card-late" : ""}`}
                  key={o.id}
                >
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <h3>
                      #{o.orderNo} · {o.tableNo || t("common.walkIn")}
                    </h3>
                    <span className={`badge ${badgeClass}`}>{ts(o.status)}</span>
                  </div>
                  {clock && (
                    <div className={`kitchen-timer${clock.late ? " late" : ""}`}>
                      <span className="kitchen-timer-main">
                        {t(clock.labelKey)} <strong>{clock.elapsedLabel}</strong>
                      </span>
                      {clock.targetLabel && (
                        <span className="kitchen-timer-meta">
                          {t("kitchen.target")}: {clock.targetLabel}
                        </span>
                      )}
                      {clock.lateByLabel && (
                        <span className="kitchen-timer-late">
                          {t("kitchen.lateBy", { time: clock.lateByLabel })}
                        </span>
                      )}
                      {o.status === "PENDING" && clock.late && (
                        <span className="kitchen-timer-late">{t("kitchen.startNow")}</span>
                      )}
                    </div>
                  )}
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
                        {i.prepMinutes != null && (
                          <span className="muted tiny"> · {i.prepMinutes}m</span>
                        )}
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
                          className={`btn warn sm${clock?.late ? " kitchen-start-pulse" : ""}`}
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
                          onClick={() => setStatus(o.id, "SERVED")}
                        >
                          {t("kitchen.complete")}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
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
