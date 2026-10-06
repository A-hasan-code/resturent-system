import { useCallback, useEffect, useMemo, useState } from "react";
import { api, money } from "../api";
import { useT, type MessageKey } from "../i18n";
import { useToast } from "../toast";
import { useSocketEvent } from "../socket";
import { SearchField, matchesSearch } from "../components/SearchField";
import { Pagination, paginate } from "../components/Pagination";
import { DateField } from "../components/DateField";
import { downloadExcelCsv } from "../csv";
import { cashOf, type PayMethod, type PaymentRow } from "../components/CashHandovers";

type Status = "" | "direct" | "pending" | "received";
type MethodFilter = "" | PayMethod;

type Result = {
  rows: PaymentRow[];
  summary: {
    count: number;
    total: number;
    tips?: number;
    cashInDrawer?: number;
    byMethod?: Record<PayMethod, number>;
    direct: number;
    handedOver: number;
    pending: number;
    pendingCount: number;
    creditSettlements?: number;
  };
};

const PAGE_SIZE = 15;

const STATUS_KEYS: Record<Exclude<Status, "">, MessageKey> = {
  direct: "payments.filterKept",
  pending: "payments.filterUnconfirmed",
  received: "payments.filterConfirmed",
};

const METHOD_KEYS: Record<PayMethod, MessageKey> = {
  CASH: "pay.method.CASH",
  CARD: "pay.method.CARD",
  WALLET: "pay.method.WALLET",
  BANK: "pay.method.BANK",
};

function isoDay(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-PK", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

function statusOf(p: PaymentRow): Exclude<Status, ""> {
  if ((p.method || "CASH") !== "CASH") return "direct";
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
  const [method, setMethod] = useState<MethodFilter>("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [staffPage, setStaffPage] = useState(1);
  const [receivedPage, setReceivedPage] = useState(1);
  const [data, setData] = useState<Result | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (status) params.set("status", status);
    if (method) params.set("method", method);
    try {
      setData(await api<Result>(`/payments?${params}`));
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("payments.loadFailed"), "err");
    }
  }, [from, to, status, method, toast, t]);

  useEffect(() => {
    void load();
  }, [load]);
  useSocketEvent("payments.changed", () => void load());
  useEffect(() => {
    setPage(1);
    setStaffPage(1);
    setReceivedPage(1);
  }, [from, to, status, method, q]);

  const rows = useMemo(
    () =>
      (data?.rows ?? []).filter((p) =>
        matchesSearch(
          q,
          p.orderNo,
          p.tableNo,
          p.collectedBy.name,
          p.handedTo?.name,
          p.orderedBy,
          p.servedBy,
          p.creditCustomerName,
          p.method
        )
      ),
    [data, q]
  );

  const byStaff = useMemo(() => {
    const m = new Map<
      string,
      { name: string; role: string; collected: number; handedOver: number; pending: number }
    >();
    for (const p of rows) {
      if ((p.method || "CASH") !== "CASH") continue;
      const cash = cashOf(p);
      const s = m.get(p.collectedBy.id) ?? {
        name: p.collectedBy.name,
        role: p.collectedBy.roleName,
        collected: 0,
        handedOver: 0,
        pending: 0,
      };
      s.collected += cash;
      if (p.handedTo) s.handedOver += cash;
      if (p.handedTo && !p.confirmedAt) s.pending += cash;
      m.set(p.collectedBy.id, s);
    }
    return [...m.values()].sort((a, b) => b.collected - a.collected);
  }, [rows]);

  const received = useMemo(() => {
    const m = new Map<string, { name: string; confirmed: number; pending: number }>();
    for (const p of rows) {
      if ((p.method || "CASH") !== "CASH" || !p.handedTo) continue;
      const cash = cashOf(p);
      const s = m.get(p.handedTo.id) ?? { name: p.handedTo.name, confirmed: 0, pending: 0 };
      if (p.confirmedAt) s.confirmed += cash;
      else s.pending += cash;
      m.set(p.handedTo.id, s);
    }
    return [...m.values()];
  }, [rows]);

  const pageByStaff = paginate(byStaff, staffPage, PAGE_SIZE);
  const pageReceived = paginate(received, receivedPage, PAGE_SIZE);

  function exportCsv() {
    downloadExcelCsv(
      `payments-${from || "all"}-${to || "all"}.csv`,
      rows.map((p) => ({
        Time: new Date(p.createdAt).toLocaleString("en-PK"),
        Bill: p.orderNo,
        Table: p.tableNo || "",
        Method: p.method || "CASH",
        Credit: p.isCredit ? p.creditCustomerName || "Yes" : "",
        OrderedBy: p.orderedBy || "",
        ServedBy: p.servedBy || "",
        Amount: p.amount,
        Tip: p.tipAmount ?? 0,
        CashTotal: cashOf(p),
        ReceivedBy: p.collectedBy.name,
        Role: p.collectedBy.roleName,
        HandedTo: p.handedTo?.name ?? "",
        Status: (p.method || "CASH") === "CASH" ? t(STATUS_KEYS[statusOf(p)]) : t(METHOD_KEYS[p.method || "CASH"]),
        ConfirmedAt: p.confirmedAt ? new Date(p.confirmedAt).toLocaleString("en-PK") : "",
      }))
    );
    toast.push(t("payments.excelOk"), "ok");
  }

  const s = data?.summary;
  const byMethod = s?.byMethod;

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
          <span>{t("payments.cashInDrawer")}</span>
          <strong>{s ? money(s.cashInDrawer ?? 0) : "—"}</strong>
          <span className="tiny">{t("payments.cashInDrawerHint")}</span>
        </div>
        <div className="panel stat">
          <span>{t("payments.keptCashier")}</span>
          <strong>{s ? money(s.direct) : "—"}</strong>
          <span className="tiny">{t("pay.method.CASH")}</span>
        </div>
        <div className="panel stat">
          <span>{t("payments.handedManagers")}</span>
          <strong>{s ? money(s.handedOver) : "—"}</strong>
          <span className="tiny">{t("pay.method.CASH")}</span>
        </div>
        <div className={`panel stat ${s?.pending ? "alert-low" : ""}`}>
          <span>{t("payments.notConfirmed")}</span>
          <strong>{s ? money(s.pending) : "—"}</strong>
          <span className="tiny">{t("payments.nHandovers", { n: s?.pendingCount ?? 0 })}</span>
        </div>
        {(s?.creditSettlements ?? 0) > 0 && (
          <div className="panel stat">
            <span>{t("payments.creditSettlements")}</span>
            <strong>{money(s!.creditSettlements!)}</strong>
          </div>
        )}
      </div>

      <h3 style={{ margin: "0.85rem 0 0.5rem" }}>{t("payments.tenderTitle")}</h3>
      <div className="stats">
        {(["CASH", "CARD", "WALLET", "BANK"] as PayMethod[]).map((m) => (
          <div key={m} className="panel stat">
            <span>{t(METHOD_KEYS[m])}</span>
            <strong>{money(byMethod?.[m] ?? 0)}</strong>
            <span className="tiny">{m === "CASH" ? t("payments.tenderCashHint") : t("payments.tenderNonCashHint")}</span>
          </div>
        ))}
      </div>

      {(byStaff.length > 0 || received.length > 0) && (
        <div className="grid-2">
          <div className="panel panel-pad">
            <h3 style={{ marginTop: 0 }}>{t("payments.byStaff")}</h3>
            <p className="tiny muted" style={{ marginTop: 0 }}>
              {t("payments.byStaffHint")}
            </p>
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
                  {pageByStaff.map((r) => (
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
              <Pagination page={staffPage} pageSize={PAGE_SIZE} total={byStaff.length} onChange={setStaffPage} />
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
                    {pageReceived.map((r) => (
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
                <Pagination page={receivedPage} pageSize={PAGE_SIZE} total={received.length} onChange={setReceivedPage} />
              </div>
            ) : (
              <div className="empty">{t("payments.noHandovers")}</div>
            )}
          </div>
        </div>
      )}

      <div className="row" style={{ marginBottom: "0.5rem", flexWrap: "wrap" }}>
        <SearchField value={q} onChange={setQ} placeholder={t("payments.search")} />
      </div>
      <div className="row" style={{ marginBottom: "0.5rem", flexWrap: "wrap", gap: "0.35rem" }}>
        <span className="tiny muted" style={{ alignSelf: "center" }}>
          {t("payments.method")}:
        </span>
        {(["", "CASH", "CARD", "WALLET", "BANK"] as const).map((k) => (
          <button
            key={k || "all-m"}
            type="button"
            className={`btn ${method === k ? "" : "ghost"} sm`}
            onClick={() => {
              setMethod(k);
              if (k && k !== "CASH") setStatus("");
            }}
          >
            {k ? t(METHOD_KEYS[k]) : t("payments.filterAll")}
          </button>
        ))}
      </div>
      <div className="row" style={{ marginBottom: "0.85rem", flexWrap: "wrap", gap: "0.35rem" }}>
        <span className="tiny muted" style={{ alignSelf: "center" }}>
          {t("payments.cashHandover")}:
        </span>
        {(["", "direct", "pending", "received"] as const).map((k) => (
          <button
            key={k || "all"}
            type="button"
            className={`btn ${status === k ? "" : "ghost"} sm`}
            disabled={!!method && method !== "CASH"}
            onClick={() => {
              setStatus(k);
              if (k) setMethod("CASH");
            }}
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
                  <th>{t("payments.method")}</th>
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
                  const due = p.orderDue ?? p.orderTotal;
                  const isCash = (p.method || "CASH") === "CASH";
                  return (
                    <tr key={p.id}>
                      <td>{stamp(p.createdAt)}</td>
                      <td>
                        #{p.orderNo}
                        {p.isCredit ? (
                          <div className="tiny">
                            <span className="badge credit" title={p.creditCustomerName || undefined}>
                              {t("payments.credit")}
                              {p.creditCustomerName ? ` · ${p.creditCustomerName}` : ""}
                            </span>
                          </div>
                        ) : null}
                      </td>
                      <td>{p.tableNo || "—"}</td>
                      <td>
                        <span className="badge ready">{t(METHOD_KEYS[p.method || "CASH"])}</span>
                      </td>
                      <td className="tiny">
                        {p.orderedBy || "—"}
                        {p.servedBy && p.servedBy !== p.orderedBy && (
                          <div className="muted">
                            {t("payments.servedBy")} {p.servedBy}
                          </div>
                        )}
                      </td>
                      <td>
                        <strong>{money(p.amount)}</strong>
                        {p.amount + 0.001 < due && (
                          <span className="tiny muted"> {t("payments.partialOf", { amount: money(due) })}</span>
                        )}
                      </td>
                      <td>{(p.tipAmount ?? 0) > 0 ? money(p.tipAmount ?? 0) : "—"}</td>
                      <td>
                        <strong>{p.collectedBy.name}</strong>{" "}
                        <span className="tiny muted">{p.collectedBy.roleName}</span>
                      </td>
                      <td>{isCash ? p.handedTo?.name ?? <span className="tiny muted">—</span> : <span className="tiny muted">—</span>}</td>
                      <td>
                        {isCash ? (
                          <>
                            <span
                              className={`badge ${st === "pending" ? "pending" : st === "received" ? "paid" : "ready"}`}
                            >
                              {t(STATUS_KEYS[st])}
                            </span>
                            {p.confirmedAt && <div className="tiny muted">{stamp(p.confirmedAt)}</div>}
                          </>
                        ) : (
                          <span className="tiny muted">{t("payments.nonCashStatus")}</span>
                        )}
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
