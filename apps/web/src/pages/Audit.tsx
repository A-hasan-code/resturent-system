import { useCallback, useEffect, useState } from "react";
import { api, downloadApi, money } from "../api";
import { useT } from "../i18n";
import { useToast } from "../toast";

type Day = { date: string; orders: number; billsPaid: number; paymentsIn: number; purchasesOut: number };
type Report = {
  from: string;
  to: string;
  summary: {
    orders: number;
    cancelled: number;
    billsPaid: number;
    paymentsIn: number;
    paymentCount: number;
    purchasesOut: number;
    purchaseCount: number;
    foodCost: number;
    unpaidAmount: number;
    unpaidCount: number;
  };
  days: Day[];
  byStaff: { name: string; role: string; amount: number; count: number }[];
  payments: {
    time: string;
    orderNo: number;
    tableNo: string | null;
    amount: number;
    collectedBy: string;
    role: string;
    handedTo: string | null;
    confirmedAt: string | null;
  }[];
};
type Stored = { file: string; month: string; size: number; updatedAt: string; closed: boolean };

function isoDay(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function monthBounds(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0);
  const today = isoDay(new Date());
  const from = `${ym}-01`;
  let to = isoDay(last);
  if (to > today) to = today;
  return { from, to };
}

const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-PK", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

function Bars({ days }: { days: Day[] }) {
  const t = useT();
  const max = Math.max(1, ...days.flatMap((d) => [d.paymentsIn, d.purchasesOut]));
  const w = 34;
  return (
    <div className="audit-chart">
      <svg width={Math.max(days.length * w, 200)} height={190} role="img" aria-label={t("audit.chartAria")}>
        {days.map((d, i) => {
          const x = i * w;
          const hIn = (d.paymentsIn / max) * 140;
          const hOut = (d.purchasesOut / max) * 140;
          return (
            <g key={d.date}>
              <rect x={x + 3} y={150 - hIn} width={12} height={Math.max(hIn, d.paymentsIn ? 2 : 0)} rx={2} className="bar-in">
                <title>{`${d.date}: ${t("audit.paymentsIn")} ${money(d.paymentsIn)}, ${d.orders} ${t("store.orders")}`}</title>
              </rect>
              <rect x={x + 17} y={150 - hOut} width={12} height={Math.max(hOut, d.purchasesOut ? 2 : 0)} rx={2} className="bar-out">
                <title>{`${d.date}: ${t("audit.purchasesOut")} ${money(d.purchasesOut)}`}</title>
              </rect>
              <text x={x + w / 2} y={168} textAnchor="middle" className="bar-label">
                {d.date.slice(8)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function AuditPage() {
  const toast = useToast();
  const t = useT();
  const thisMonth = isoDay(new Date()).slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [from, setFrom] = useState(monthBounds(thisMonth).from);
  const [to, setTo] = useState(monthBounds(thisMonth).to);
  const [report, setReport] = useState<Report | null>(null);
  const [stored, setStored] = useState<Stored[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, files] = await Promise.all([
        api<Report>(`/audit?from=${from}&to=${to}`),
        api<{ files: Stored[] }>("/audit/files"),
      ]);
      setReport(r);
      setStored(files.files);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("audit.loadFailed"), "err");
    }
  }, [from, to, toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  function pickMonth(ym: string) {
    const b = monthBounds(ym);
    setMonth(ym);
    setFrom(b.from);
    setTo(b.to);
  }

  async function downloadRange() {
    setBusy(true);
    try {
      await downloadApi(`/audit/export?from=${from}&to=${to}`, `audit-${from}-to-${to}.pdf`);
      toast.push(t("audit.excelOk"), "ok");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("common.failed"), "err");
    } finally {
      setBusy(false);
    }
  }

  async function downloadStored(f: Stored) {
    try {
      await downloadApi(`/audit/files/${f.file}`, f.file);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("common.failed"), "err");
    }
  }

  const s = report?.summary;
  const cashLeft = s ? s.paymentsIn - s.purchasesOut : 0;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t("audit.title")}</h1>
          <p>{t("audit.subtitle")}</p>
        </div>
        <div className="row">
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="audit-month">{t("audit.month")}</label>
            <input id="audit-month" type="month" value={month} max={thisMonth} onChange={(e) => pickMonth(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="audit-from">{t("payments.from")}</label>
            <input id="audit-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="audit-to">{t("payments.to")}</label>
            <input id="audit-to" type="date" value={to} min={from} max={isoDay(new Date())} onChange={(e) => setTo(e.target.value)} />
          </div>
          <button type="button" className="btn sm" style={{ alignSelf: "flex-end" }} disabled={busy} onClick={() => void downloadRange()}>
            {busy ? t("common.loading") : t("audit.excel")}
          </button>
        </div>
      </div>

      <div className="stats">
        <div className="panel stat">
          <span>{t("store.orders")}</span>
          <strong>{s?.orders ?? "—"}</strong>
          <span className="tiny">
            {s ? t("audit.ordersHint", { cancelled: s.cancelled, paid: s.billsPaid }) : ""}
          </span>
        </div>
        <div className="panel stat">
          <span>{t("audit.paymentsIn")}</span>
          <strong>{s ? money(s.paymentsIn) : "—"}</strong>
          <span className="tiny">{t("payments.nPayments", { n: s?.paymentCount ?? 0 })}</span>
        </div>
        <div className="panel stat">
          <span>{t("audit.purchasesOut")}</span>
          <strong>{s ? money(s.purchasesOut) : "—"}</strong>
          <span className="tiny">{s ? t("audit.purchasesHint", { n: s.purchaseCount }) : ""}</span>
        </div>
        <div className="panel stat">
          <span>{t("audit.cashLeft")}</span>
          <strong>{s ? money(cashLeft) : "—"}</strong>
          <span className="tiny">{t("audit.cashLeftHint")}</span>
        </div>
      </div>

      <div className="grid-2">
        <div className="panel panel-pad">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>{t("audit.byDay")}</h3>
            <span className="tiny muted">
              <span className="legend-in">{t("audit.paymentsIn")}</span>
              <span className="legend-out">{t("audit.purchasesOut")}</span>
            </span>
          </div>
          {report && report.days.some((d) => d.paymentsIn || d.purchasesOut || d.orders) ? (
            <Bars days={report.days} />
          ) : (
            <div className="empty">{t("common.noMatch")}</div>
          )}
          {s && s.unpaidCount > 0 && (
            <p className="tiny muted" style={{ marginBottom: 0 }}>
              {t("dash.unpaid")}: {s.unpaidCount} · {money(s.unpaidAmount)}. {t("menu.cost")}:{" "}
              {money(s.foodCost)}.
            </p>
          )}
        </div>
        <div className="panel panel-pad">
          <h3 style={{ marginTop: 0 }}>{t("payments.byStaff")}</h3>
          {report?.byStaff.length ? (
            <table>
              <thead>
                <tr>
                  <th>{t("payments.staff")}</th>
                  <th>{t("audit.paymentsCol")}</th>
                  <th>{t("common.amount")}</th>
                </tr>
              </thead>
              <tbody>
                {report.byStaff.map((r) => (
                  <tr key={r.name}>
                    <td>
                      <strong>{r.name}</strong> <span className="tiny muted">{r.role}</span>
                    </td>
                    <td>{r.count}</td>
                    <td>{money(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">{t("payments.empty")}</div>
          )}
        </div>
      </div>

      <div className="panel panel-pad" style={{ marginBottom: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>{t("nav.payments")}</h3>
        {report?.payments.length ? (
          <table>
            <thead>
              <tr>
                <th>{t("common.time")}</th>
                <th>{t("payments.bill")}</th>
                <th>{t("common.table")}</th>
                <th>{t("common.amount")}</th>
                <th>{t("payments.receivedBy")}</th>
                <th>{t("payments.handedTo")}</th>
                <th>{t("payments.confirmed")}</th>
              </tr>
            </thead>
            <tbody>
              {report.payments.map((p, i) => (
                <tr key={`${p.orderNo}-${i}`}>
                  <td>{stamp(p.time)}</td>
                  <td>#{p.orderNo}</td>
                  <td>{p.tableNo || "—"}</td>
                  <td>
                    <strong>{money(p.amount)}</strong>
                  </td>
                  <td>
                    {p.collectedBy} <span className="tiny muted">{p.role}</span>
                  </td>
                  <td>{p.handedTo || "—"}</td>
                  <td>{p.confirmedAt ? stamp(p.confirmedAt) : p.handedTo ? t("cash.notYet") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">{t("payments.empty")}</div>
        )}
      </div>

      <div className="panel panel-pad">
        <h3 style={{ marginTop: 0 }}>{t("audit.savedTitle")}</h3>
        <p className="tiny muted">{t("audit.savedHint")}</p>
        {stored.length ? (
          <table>
            <thead>
              <tr>
                <th>{t("audit.month")}</th>
                <th>{t("common.when")}</th>
                <th>{t("settings.size")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {stored.map((f) => (
                <tr key={f.file}>
                  <td>
                    <strong>{f.month}</strong>{" "}
                    <span className={`badge ${f.closed ? "ready" : "pending"}`}>
                      {f.closed ? t("audit.closed") : t("audit.updating")}
                    </span>
                  </td>
                  <td className="tiny">{new Date(f.updatedAt).toLocaleString("en-PK")}</td>
                  <td>{(f.size / 1024).toFixed(0)} KB</td>
                  <td>
                    <button type="button" className="btn ghost sm" onClick={() => void downloadStored(f)}>
                      {t("audit.excel")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">{t("audit.savedEmpty")}</div>
        )}
      </div>
    </div>
  );
}
