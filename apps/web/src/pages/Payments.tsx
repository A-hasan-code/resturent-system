import { useCallback, useEffect, useMemo, useState } from "react";
import { api, money } from "../api";
import { useT, type MessageKey } from "../i18n";
import { useToast } from "../toast";
import { useSocketEvent } from "../socket";
import { SearchField, matchesSearch } from "../components/SearchField";
import { Pagination, paginate } from "../components/Pagination";
import { DateField } from "../components/DateField";
import { downloadExcelCsv } from "../csv";
import type { PaymentRow } from "../components/CashHandovers";

type Status = "" | "direct" | "pending" | "received";

type Result = {
  rows: PaymentRow[];
  summary: {
    count: number;
    total: number;
    tips?: number;
    direct: number;
    handedOver: number;
    pending: number;
    pendingCount: number;
  };
};

const PAGE_SIZE = 15;

const STATUS_KEYS: Record<Exclude<Status, "">, MessageKey> = {
  direct: "payments.filterKept",
  pending: "payments.filterUnconfirmed",
  received: "payments.filterConfirmed",
};

function isoDay(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-PK", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

function statusOf(p: PaymentRow): Exclude<Status, ""> {
  if (!p.handedTo) return "direct";
  return p.confirmedAt ? "received" : "pending";
}

export function PaymentsPage() {
  const toast = useToast();
  const t = useT();
  const today = isoDay(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [status, setStatus] = useState<Status>("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Result | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (status) params.set("status", status);
    try {
      setData(await api<Result>(`/payments?${params}`));
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("payments.loadFailed"), "err");
    }
  }, [from, to, status, toast, t]);

  useEffect(() => {
    void load();
  }, [load]);
  useSocketEvent("payments.changed", () => void load());
  useEffect(() => setPage(1), [from, to, status, q]);

  const rows = useMemo(
    () =>
      (data?.rows ?? []).filter((p) =>
        matchesSearch(q, p.orderNo, p.tableNo, p.collectedBy.name, p.handedTo?.name, p.orderedBy, p.servedBy)
      ),
    [data, q]
  );

  const byStaff = useMemo(() => {
    const m = new Map<string, { name: string; role: string; collected: number; handedOver: number; pending: number }>();
    for (const p of rows) {
      const s = m.get(p.collectedBy.id) ?? {
        name: p.collectedBy.name,
        role: p.collectedBy.roleName,
        collected: 0,
        handedOver: 0,
        pending: 0,
      };
      s.collected += p.amount;
      if (p.handedTo) s.handedOver += p.amount;
      if (p.handedTo && !p.confirmedAt) s.pending += p.amount;
      m.set(p.collectedBy.id, s);
    }
    return [...m.values()].sort((a, b) => b.collected - a.collected);
  }, [rows]);

  const received = useMemo(() => {
    const m = new Map<string, { name: string; confirmed: number; pending: number }>();
    for (const p of rows) {
      if (!p.handedTo) continue;
      const s = m.get(p.handedTo.id) ?? { name: p.handedTo.name, confirmed: 0, pending: 0 };
      if (p.confirmedAt) s.confirmed += p.amount;
      else s.pending += p.amount;
      m.set(p.handedTo.id, s);
    }
    return [...m.values()];
  }, [rows]);

  function exportCsv() {
    downloadExcelCsv(
      `payments-${from || "all"}-${to || "all"}.csv`,
      rows.map((p) => ({
        Time: new Date(p.createdAt).toLocaleString("en-PK"),
        Bill: p.orderNo,
        Table: p.tableNo || "",
        OrderedBy: p.orderedBy || "",
        ServedBy: p.servedBy || "",
        Amount: p.amount,
        Tip: p.tipAmount ?? 0,
        ReceivedBy: p.collectedBy.name,
        Role: p.collectedBy.roleName,
        HandedTo: p.handedTo?.name ?? "",
        Status: t(STATUS_KEYS[statusOf(p)]),
        ConfirmedAt: p.confirmedAt ? new Date(p.confirmedAt).toLocaleString("en-PK") : "",
      }))
    );
    toast.push(t("payments.excelOk"), "ok");
  }

  const s = data?.summary;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t("payments.title")}</h1>
          <p>{t("payments.subtitle")}</p>
        </div>
        <div className="row">
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="pay-from">{t("payments.from")}</label>
            <DateField id="pay-from" value={from} max={to || undefined} onChange={setFrom} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="pay-to">{t("payments.to")}</label>
            <DateField id="pay-to" value={to} min={from || undefined} onChange={setTo} />
          </div>
          <button type="button" className="btn ghost" style={{ alignSelf: "flex-end", minHeight: "2.6rem" }} onClick={exportCsv}>
            {t("common.excel")}
          </button>
        </div>
      </div>

      <div className="stats">
        <div className="panel stat">
          <span>{t("payments.totalReceived")}</span>
          <strong>{s ? money(s.total) : "—"}</strong>
          <span className="tiny">{t("payments.nPayments", { n: s?.count ?? 0 })}</span>
        </div>
        <div className="panel stat">
          <span>{t("payments.tipsTotal")}</span>
          <strong>{s ? money(s.tips ?? 0) : "—"}</strong>
        </div>
        <div className="panel stat">
          <span>{t("payments.keptCashier")}</span>
          <strong>{s ? money(s.direct) : "—"}</strong>
        </div>
        <div className="panel stat">
          <span>{t("payments.handedManagers")}</span>
          <strong>{s ? money(s.handedOver) : "—"}</strong>
        </div>
        <div className={`panel stat ${s?.pending ? "alert-low" : ""}`}>
          <span>{t("payments.notConfirmed")}</span>
          <strong>{s ? money(s.pending) : "—"}</strong>
          <span className="tiny">{t("payments.nHandovers", { n: s?.pendingCount ?? 0 })}</span>
        </div>
      </div>

      {(byStaff.length > 0 || received.length > 0) && (
        <div className="grid-2">
          <div className="panel panel-pad">
            <h3 style={{ marginTop: 0 }}>{t("payments.byStaff")}</h3>
            <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("payments.staff")}</th>
                  <th>{t("payments.received")}</th>
                  <th>{t("payments.handedOver")}</th>
                  <th>{t("payments.unconfirmed")}</th>
                </tr>
              </thead>
              <tbody>
                {byStaff.map((r) => (
                  <tr key={r.name}>
                    <td>
                      <strong>{r.name}</strong>
                      <div className="tiny muted">{r.role}</div>
                    </td>
                    <td>{money(r.collected)}</td>
                    <td>{r.handedOver ? money(r.handedOver) : "—"}</td>
                    <td>{r.pending ? <span className="badge pending">{money(r.pending)}</span> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
          <div className="panel panel-pad">
            <h3 style={{ marginTop: 0 }}>{t("payments.cashToCashiers")}</h3>
            {received.length ? (
              <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("payments.cashier")}</th>
                    <th>{t("payments.confirmed")}</th>
                    <th>{t("payments.waiting")}</th>
                  </tr>
                </thead>
                <tbody>
                  {received.map((r) => (
                    <tr key={r.name}>
                      <td>
                        <strong>{r.name}</strong>
                      </td>
                      <td>{money(r.confirmed)}</td>
                      <td>{r.pending ? <span className="badge pending">{money(r.pending)}</span> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            ) : (
              <div className="empty">{t("payments.noHandovers")}</div>
            )}
          </div>
        </div>
      )}

      <div className="row" style={{ marginBottom: "0.85rem" }}>
        <SearchField value={q} onChange={setQ} placeholder={t("payments.search")} />
        {(["", "direct", "pending", "received"] as const).map((k) => (
          <button
            key={k || "all"}
            type="button"
            className={`btn ${status === k ? "" : "ghost"} sm`}
            onClick={() => setStatus(k)}
          >
            {k ? t(STATUS_KEYS[k]) : t("payments.filterAll")}
          </button>
        ))}
      </div>

      <div className="panel panel-pad">
        {!rows.length ? (
          <div className="empty">{t("payments.empty")}</div>
        ) : (
          <div className="table-wrap wide">
          <table>
            <thead>
              <tr>
                <th>{t("common.time")}</th>
                <th>{t("payments.bill")}</th>
                <th>{t("common.table")}</th>
                <th>{t("payments.orderedBy")}</th>
                <th>{t("common.amount")}</th>
                <th>{t("payments.tip")}</th>
                <th>{t("payments.receivedBy")}</th>
                <th>{t("payments.handedTo")}</th>
                <th>{t("common.status")}</th>
              </tr>
            </thead>
            <tbody>
              {paginate(rows, page, PAGE_SIZE).map((p) => {
                const st = statusOf(p);
                return (
                  <tr key={p.id}>
                    <td>{stamp(p.createdAt)}</td>
                    <td>#{p.orderNo}</td>
                    <td>{p.tableNo || "—"}</td>
                    <td className="tiny">
                      {p.orderedBy || "—"}
                      {p.servedBy && p.servedBy !== p.orderedBy && (
                        <div className="muted">{t("payments.servedBy")} {p.servedBy}</div>
                      )}
                    </td>
                    <td>
                      <strong>{money(p.amount)}</strong>
                      {p.amount < p.orderTotal && (
                        <span className="tiny muted">
                          {" "}
                          {t("payments.partialOf", { amount: money(p.orderTotal) })}
                        </span>
                      )}
                    </td>
                    <td>{(p.tipAmount ?? 0) > 0 ? money(p.tipAmount ?? 0) : "—"}</td>
                    <td>
                      <strong>{p.collectedBy.name}</strong> <span className="tiny muted">{p.collectedBy.roleName}</span>
                    </td>
                    <td>{p.handedTo?.name ?? <span className="tiny muted">—</span>}</td>
                    <td>
                      <span className={`badge ${st === "pending" ? "pending" : st === "received" ? "paid" : "ready"}`}>
                        {t(STATUS_KEYS[st])}
                      </span>
                      {p.confirmedAt && <div className="tiny muted">{stamp(p.confirmedAt)}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>
      <Pagination page={page} pageSize={PAGE_SIZE} total={rows.length} onChange={setPage} />
    </div>
  );
}
