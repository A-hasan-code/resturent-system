import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, downloadApi, money } from "../api";
import { useT } from "../i18n";
import { useToast } from "../toast";
import { SearchField, matchesSearch } from "../components/SearchField";
import { Pagination, paginate } from "../components/Pagination";

type Day = {
  date: string;
  orders: number;
  billsPaid: number;
  paymentsIn: number;
  purchasesOut: number;
  sales: number;
  tips: number;
};

type ChartBucket = {
  key: string;
  label: string;
  paymentsIn: number;
  purchasesOut: number;
  sales: number;
};

/** Long ranges → monthly buckets so the chart stays readable (no endless horizontal day axis). */
function chartBuckets(days: Day[]): { buckets: ChartBucket[]; grain: "day" | "month" } {
  if (days.length <= 45) {
    return {
      grain: "day",
      buckets: days.map((d) => ({
        key: d.date,
        label: d.date.slice(8),
        paymentsIn: d.paymentsIn,
        purchasesOut: d.purchasesOut,
        sales: d.sales,
      })),
    };
  }
  const map = new Map<string, ChartBucket>();
  for (const d of days) {
    const key = d.date.slice(0, 7);
    const cur = map.get(key) ?? { key, label: key.slice(5), paymentsIn: 0, purchasesOut: 0, sales: 0 };
    cur.paymentsIn += d.paymentsIn;
    cur.purchasesOut += d.purchasesOut;
    cur.sales += d.sales;
    map.set(key, cur);
  }
  const buckets = [...map.values()].map((b) => ({
    ...b,
    label: (() => {
      const [y, m] = b.key.split("-").map(Number);
      return new Date(y, m - 1, 1).toLocaleString("en-PK", { month: "short", year: "2-digit" });
    })(),
  }));
  return { grain: "month", buckets };
}
type Report = {
  from: string;
  to: string;
  firstSaleDate: string | null;
  summary: {
    orders: number;
    cancelled: number;
    billsPaid: number;
    salesTotal: number;
    tipsTotal: number;
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
  byOrderTaker: { name: string; role: string; orders: number; sales: number; tips: number }[];
  sales: {
    time: string;
    orderNo: number;
    tableNo: string | null;
    total: number;
    tipAmount: number;
    orderedBy: string | null;
    servedBy: string | null;
    cashier: string | null;
    paymentStatus: string;
  }[];
  payments: {
    time: string;
    orderNo: number;
    tableNo: string | null;
    amount: number;
    tipAmount: number;
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

const SALE_PAGE = 20;

function Bars({ days }: { days: Day[] }) {
  const t = useT();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(480);
  const { buckets, grain } = useMemo(() => chartBuckets(days), [days]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const sync = () => setWidth(Math.max(el.clientWidth, 240));
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = Math.max(buckets.length, 1);
  const padX = 8;
  const slot = Math.min(56, Math.max(28, (width - padX * 2) / n));
  const svgW = Math.max(width, n * slot + padX * 2);
  const chartH = 150;
  const labelY = 172;
  const svgH = 190;
  const max = Math.max(1, ...buckets.flatMap((b) => [b.paymentsIn, b.purchasesOut, b.sales]));
  const barPair = Math.min(22, slot * 0.55);
  const barW = Math.max(6, (barPair - 2) / 2);

  return (
    <div className="audit-chart" ref={wrapRef}>
      <p className="tiny muted audit-chart-grain">
        {grain === "month" ? t("audit.chartByMonth") : t("audit.chartByDay")}
      </p>
      <svg
        width="100%"
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={t("audit.chartAria")}
      >
        {buckets.map((b, i) => {
          const cx = padX + i * slot + slot / 2;
          const hIn = (b.paymentsIn / max) * chartH;
          const hOut = (b.purchasesOut / max) * chartH;
          return (
            <g key={b.key}>
              <rect
                x={cx - barPair / 2}
                y={chartH - hIn}
                width={barW}
                height={Math.max(hIn, b.paymentsIn ? 2 : 0)}
                rx={2}
                className="bar-in"
              >
                <title>{`${b.key}: ${t("audit.paymentsIn")} ${money(b.paymentsIn)}, ${t("audit.sales")} ${money(b.sales)}`}</title>
              </rect>
              <rect
                x={cx - barPair / 2 + barW + 2}
                y={chartH - hOut}
                width={barW}
                height={Math.max(hOut, b.purchasesOut ? 2 : 0)}
                rx={2}
                className="bar-out"
              >
                <title>{`${b.key}: ${t("audit.purchasesOut")} ${money(b.purchasesOut)}`}</title>
              </rect>
              <text x={cx} y={labelY} textAnchor="middle" className="bar-label">
                {b.label}
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
  const today = isoDay(new Date());
  const thisMonth = today.slice(0, 7);
  const initial = monthBounds(thisMonth);

  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [staff, setStaff] = useState("");
  const [month, setMonth] = useState(thisMonth);
  const [applied, setApplied] = useState({ from: initial.from, to: initial.to, staff: "" });
  const [firstSale, setFirstSale] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [stored, setStored] = useState<Stored[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    api<{ firstSaleDate: string | null }>("/audit/meta")
      .then((m) => setFirstSale(m.firstSaleDate))
      .catch(() => undefined);
  }, []);

  const load = useCallback(
    async (range: { from: string; to: string; staff: string }) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ from: range.from, to: range.to });
        if (range.staff.trim()) params.set("staff", range.staff.trim());
        const [r, files] = await Promise.all([
          api<Report>(`/audit?${params}`),
          api<{ files: Stored[] }>("/audit/files"),
        ]);
        setReport(r);
        setStored(files.files);
        if (r.firstSaleDate) setFirstSale(r.firstSaleDate);
        setApplied(range);
      } catch (e) {
        toast.push(e instanceof Error ? e.message : t("audit.loadFailed"), "err");
      } finally {
        setLoading(false);
      }
    },
    [toast, t]
  );

  useEffect(() => {
    void load({ from: initial.from, to: initial.to, staff: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => setPage(1), [applied, q]);

  function commit(next: { from: string; to: string; staff: string }) {
    if (next.from > next.to) {
      toast.push(t("audit.badRange"), "err");
      return;
    }
    setFrom(next.from);
    setTo(next.to);
    setStaff(next.staff);
    setMonth(next.to.slice(0, 7));
    void load(next);
  }

  function pickMonth(ym: string) {
    const b = monthBounds(ym);
    commit({ from: b.from, to: b.to, staff });
  }

  function preset(kind: "today" | "month" | "year" | "all") {
    const now = new Date();
    if (kind === "today") return commit({ from: today, to: today, staff });
    if (kind === "month") {
      const b = monthBounds(thisMonth);
      return commit({ from: b.from, to: b.to, staff });
    }
    if (kind === "year") return commit({ from: `${now.getFullYear()}-01-01`, to: today, staff });
    return commit({ from: firstSale || today, to: today, staff });
  }

  function applyFilters(e?: { preventDefault(): void }) {
    e?.preventDefault();
    commit({ from, to, staff });
  }

  const activePreset =
    applied.from === today && applied.to === today
      ? "today"
      : applied.from === monthBounds(thisMonth).from && applied.to === monthBounds(thisMonth).to
        ? "month"
        : applied.from === `${new Date().getFullYear()}-01-01` && applied.to === today
          ? "year"
          : firstSale && applied.from === firstSale && applied.to === today
            ? "all"
            : null;

  async function downloadPdf() {
    setBusy(true);
    try {
      const params = new URLSearchParams({ from: applied.from, to: applied.to });
      if (applied.staff.trim()) params.set("staff", applied.staff.trim());
      await downloadApi(`/audit/export?${params}`, `sales-report-${applied.from}-to-${applied.to}.pdf`);
      toast.push(t("audit.pdfOk"), "ok");
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
  const salesRows = useMemo(
    () =>
      (report?.sales ?? []).filter((o) =>
        matchesSearch(q, o.orderNo, o.tableNo, o.orderedBy, o.servedBy, o.cashier, o.paymentStatus)
      ),
    [report, q]
  );

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t("audit.title")}</h1>
          <p>
            {t("audit.subtitle")}
            {firstSale ? ` · ${t("audit.since", { date: firstSale })}` : ""}
          </p>
        </div>
        <button type="button" className="btn" disabled={busy || loading} onClick={() => void downloadPdf()}>
          {busy ? t("common.loading") : t("audit.pdf")}
        </button>
      </div>

      <form className="panel panel-pad audit-filters" style={{ marginBottom: "1rem" }} onSubmit={applyFilters}>
        <div className="audit-filter-block">
          <span className="audit-filter-label">{t("audit.quickRange")}</span>
          <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
            {(
              [
                ["today", "audit.presetToday"],
                ["month", "audit.presetMonth"],
                ["year", "audit.presetYear"],
                ["all", "audit.presetAll"],
              ] as const
            ).map(([kind, key]) => (
              <button
                key={kind}
                type="button"
                className={`btn sm ${activePreset === kind ? "" : "ghost"}`}
                disabled={kind === "all" && !firstSale}
                onClick={() => preset(kind)}
              >
                {t(key)}
              </button>
            ))}
          </div>
        </div>

        <div className="audit-filter-block">
          <span className="audit-filter-label">{t("audit.customRange")}</span>
          <div className="audit-filter-grid">
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="audit-from">{t("payments.from")}</label>
              <input id="audit-from" type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="audit-to">{t("payments.to")}</label>
              <input id="audit-to" type="date" value={to} min={from || undefined} max={today} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="audit-month">{t("audit.jumpMonth")}</label>
              <input id="audit-month" type="month" value={month} max={thisMonth} onChange={(e) => pickMonth(e.target.value)} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="audit-staff">{t("audit.staffFilter")}</label>
              <input
                id="audit-staff"
                value={staff}
                onChange={(e) => setStaff(e.target.value)}
                placeholder={t("audit.staffPh")}
              />
            </div>
            <button type="submit" className="btn audit-apply-btn" disabled={loading}>
              {loading ? t("common.loading") : t("audit.apply")}
            </button>
          </div>
          <p className="tiny muted" style={{ marginBottom: 0 }}>{t("audit.filterHint")}</p>
        </div>

        <p className="audit-showing">
          {t("audit.showing", { from: applied.from, to: applied.to })}
          {applied.staff ? ` · ${applied.staff}` : ""}
        </p>
      </form>

      <div className="stats">
        <div className="panel stat">
          <span>{t("audit.sales")}</span>
          <strong>{s ? money(s.salesTotal) : "—"}</strong>
          <span className="tiny">{s ? t("audit.salesHint", { n: s.billsPaid }) : ""}</span>
        </div>
        <div className="panel stat">
          <span>{t("audit.tips")}</span>
          <strong>{s ? money(s.tipsTotal) : "—"}</strong>
        </div>
        <div className="panel stat">
          <span>{t("audit.paymentsIn")}</span>
          <strong>{s ? money(s.paymentsIn) : "—"}</strong>
          <span className="tiny">{t("payments.nPayments", { n: s?.paymentCount ?? 0 })}</span>
        </div>
        <div className="panel stat">
          <span>{t("store.orders")}</span>
          <strong>{s?.orders ?? "—"}</strong>
          <span className="tiny">
            {s ? t("audit.ordersHint", { cancelled: s.cancelled, paid: s.billsPaid }) : ""}
          </span>
        </div>
      </div>

      <div className="stats">
        <div className="panel stat">
          <span>{t("audit.purchasesOut")}</span>
          <strong>{s ? money(s.purchasesOut) : "—"}</strong>
        </div>
        <div className="panel stat">
          <span>{t("audit.cashLeft")}</span>
          <strong>{s ? money(cashLeft) : "—"}</strong>
          <span className="tiny">{t("audit.cashLeftHint")}</span>
        </div>
        <div className="panel stat">
          <span>{t("menu.cost")}</span>
          <strong>{s ? money(s.foodCost) : "—"}</strong>
        </div>
        <div className="panel stat">
          <span>{t("dash.unpaid")}</span>
          <strong>
            {s?.unpaidCount ?? "—"}
            <span className="tiny muted" style={{ display: "block", fontWeight: 500 }}>
              {s ? money(s.unpaidAmount) : ""}
            </span>
          </strong>
        </div>
      </div>

      <div className="grid-2 audit-split">
        <div className="panel panel-pad">
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "0.4rem" }}>
            <h3 style={{ margin: 0 }}>{t("audit.byDay")}</h3>
            <span className="tiny muted audit-legend">
              <span className="legend-in">{t("audit.paymentsIn")}</span>
              <span className="legend-out">{t("audit.purchasesOut")}</span>
            </span>
          </div>
          {report && report.days.some((d) => d.paymentsIn || d.purchasesOut || d.orders || d.sales) ? (
            <Bars days={report.days} />
          ) : (
            <div className="empty">{t("common.noMatch")}</div>
          )}
        </div>
        <div className="panel panel-pad">
          <h3 style={{ marginTop: 0 }}>{t("audit.byOrderTaker")}</h3>
          {report?.byOrderTaker.length ? (
            <table>
              <thead>
                <tr>
                  <th>{t("payments.staff")}</th>
                  <th>{t("dash.ordersCol")}</th>
                  <th>{t("audit.sales")}</th>
                  <th>{t("audit.tips")}</th>
                </tr>
              </thead>
              <tbody>
                {report.byOrderTaker.map((r) => (
                  <tr key={r.name}>
                    <td>
                      <strong>{r.name}</strong> <span className="tiny muted">{r.role}</span>
                    </td>
                    <td>{r.orders}</td>
                    <td>{money(r.sales)}</td>
                    <td>{money(r.tips)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">{t("common.noMatch")}</div>
          )}
        </div>
      </div>

      <div className="panel panel-pad" style={{ marginBottom: "1rem" }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: "0.75rem" }}>
          <h3 style={{ margin: 0 }}>{t("audit.salesRegister")}</h3>
          <SearchField value={q} onChange={setQ} placeholder={t("audit.searchSales")} />
        </div>
        {salesRows.length ? (
          <>
            <table>
              <thead>
                <tr>
                  <th>{t("common.time")}</th>
                  <th>{t("payments.bill")}</th>
                  <th>{t("common.table")}</th>
                  <th>{t("audit.sales")}</th>
                  <th>{t("audit.tips")}</th>
                  <th>{t("payments.orderedBy")}</th>
                  <th>{t("payments.servedBy")}</th>
                  <th>{t("common.status")}</th>
                </tr>
              </thead>
              <tbody>
                {paginate(salesRows, page, SALE_PAGE).map((o) => (
                  <tr key={`${o.orderNo}-${o.time}`}>
                    <td>{stamp(o.time)}</td>
                    <td>#{o.orderNo}</td>
                    <td>{o.tableNo || "—"}</td>
                    <td>
                      <strong>{money(o.total)}</strong>
                    </td>
                    <td>{o.tipAmount ? money(o.tipAmount) : "—"}</td>
                    <td className="tiny">{o.orderedBy || "—"}</td>
                    <td className="tiny">{o.servedBy || "—"}</td>
                    <td>
                      <span className={`badge ${o.paymentStatus === "PAID" ? "paid" : "unpaid"}`}>
                        {o.paymentStatus}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} pageSize={SALE_PAGE} total={salesRows.length} onChange={setPage} />
          </>
        ) : (
          <div className="empty">{t("common.noMatch")}</div>
        )}
      </div>

      <div className="grid-2" style={{ marginBottom: "1rem" }}>
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
        <div className="panel panel-pad">
          <h3 style={{ marginTop: 0 }}>{t("nav.payments")}</h3>
          {report?.payments.length ? (
            <table>
              <thead>
                <tr>
                  <th>{t("common.time")}</th>
                  <th>{t("payments.bill")}</th>
                  <th>{t("common.amount")}</th>
                  <th>{t("payments.receivedBy")}</th>
                </tr>
              </thead>
              <tbody>
                {report.payments.slice(0, 12).map((p, i) => (
                  <tr key={`${p.orderNo}-${i}`}>
                    <td>{stamp(p.time)}</td>
                    <td>#{p.orderNo}</td>
                    <td>
                      <strong>{money(p.amount)}</strong>
                      {p.tipAmount > 0 && <span className="tiny muted"> +{money(p.tipAmount)}</span>}
                    </td>
                    <td>
                      {p.collectedBy} <span className="tiny muted">{p.role}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">{t("payments.empty")}</div>
          )}
        </div>
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
                      {t("audit.pdf")}
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
