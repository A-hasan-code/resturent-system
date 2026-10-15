import { useEffect, useMemo, useState } from "react";
import { api, money } from "../api";
import { useAuth } from "../auth";
import { DateField } from "../components/DateField";
import { Pagination, paginate } from "../components/Pagination";
import { PoweredBy } from "../components/PoweredBy";
import { useBusinessDay } from "../hotel-gate";
import { MessageKey, useT } from "../i18n";
import { useToast } from "../toast";

type DayPnl = {
  businessDate: string;
  locked: boolean;
  sales: { gross: number; discounts: number; netFood: number; tax: number; tips: number; paidFood: number };
  tender: Record<string, number>;
  costs: {
    cogs: number;
    stockUsedValue: number | null;
    specialsLoss: number;
    hotelExpenses: number;
    supplierPaid: number;
    selfExtra?: number;
  };
  netProfit: number;
  drawer: {
    expectedCash: number;
    collectedCash: number;
    missCash: number;
    cardTotal: number;
    walletTotal: number;
    bankTotal: number;
  } | null;
};

type Exceptions = {
  from: string;
  to: string;
  cancels: { orderNo: number; tableNo: string | null; total: number; reason: string | null; by: string | null; at: string | null }[];
  billEdits: { orderNo: number; reason: string; beforeNet: number; afterNet: number; by: string; at: string }[];
  bigDiscounts: { orderNo: number; discount: number; percent: number; total: number; cashier: string | null }[];
  voids: { orderNo: number; total: number; reason: string | null }[];
};

type Aging = {
  summary: Record<string, number>;
  rows: { name: string; phone: string; outstanding: number; days: number; bucket: string }[];
};

type ExTab = "cancels" | "edits" | "discounts";

const PAGE_SIZE = 12;

const METHOD_KEY: Record<string, MessageKey> = {
  CASH: "pay.method.CASH",
  CARD: "pay.method.CARD",
  WALLET: "pay.method.WALLET",
  BANK: "pay.method.BANK",
};

const BUCKET_KEY: Record<string, MessageKey> = {
  "0-30": "finance.bucket.0-30",
  "31-60": "finance.bucket.31-60",
  "61-90": "finance.bucket.61-90",
  "90+": "finance.bucket.90+",
};

export function FinancePage() {
  const t = useT();
  const toast = useToast();
  const { can } = useAuth();
  const { businessDate, dayStart } = useBusinessDay();
  const [date, setDate] = useState(businessDate);
  const [dateTouched, setDateTouched] = useState(false);
  const [pnl, setPnl] = useState<DayPnl | null>(null);
  const [ex, setEx] = useState<Exceptions | null>(null);
  const [aging, setAging] = useState<Aging | null>(null);
  const [busy, setBusy] = useState(false);
  const [exTab, setExTab] = useState<ExTab>("cancels");
  const [agingPage, setAgingPage] = useState(1);

  useEffect(() => {
    if (!dateTouched) setDate(businessDate);
  }, [businessDate, dateTouched]);

  async function load() {
    setBusy(true);
    try {
      const monthStart = `${date.slice(0, 7)}-01`;
      const [p, e, a] = await Promise.all([
        api<DayPnl>(`/finance/day-pnl?date=${date}`),
        api<Exceptions>(`/finance/exceptions?from=${monthStart}&to=${date}`),
        api<Aging>("/credit-customers/aging"),
      ]);
      setPnl(p);
      setEx(e);
      setAging(a);
      setAgingPage(1);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("common.failed"), "err");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, [date]);

  async function unlock() {
    if (!can("system.manage") || !pnl) return;
    try {
      await api("/finance/unlock-day", { method: "POST", body: JSON.stringify({ businessDate: pnl.businessDate }) });
      toast.push(t("finance.unlocked"), "ok");
      void load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("common.failed"), "err");
    }
  }

  const expenseTotal = pnl
    ? pnl.costs.hotelExpenses +
      pnl.costs.supplierPaid +
      pnl.costs.specialsLoss +
      (pnl.costs.selfExtra ?? 0)
    : 0;

  const agingRows = aging?.rows ?? [];
  const pageAging = useMemo(() => paginate(agingRows, agingPage, PAGE_SIZE), [agingRows, agingPage]);

  const exCounts = {
    cancels: ex?.cancels.length ?? 0,
    edits: ex?.billEdits.length ?? 0,
    discounts: ex?.bigDiscounts.length ?? 0,
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t("finance.title")}</h1>
          <p>
            {t("finance.hint")}
            <span className="tiny muted" style={{ display: "block" }}>
              {t("cash.businessDayHint", { start: dayStart })}
            </span>
            {pnl?.locked ? (
              <>
                {" · "}
                <span className="badge pending">{t("finance.locked")}</span>
              </>
            ) : null}
          </p>
        </div>
        <div className="page-head-actions">
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="finance-date">{t("finance.date")}</label>
            <DateField
              id="finance-date"
              value={date}
              max={businessDate}
              onChange={(v) => {
                setDateTouched(true);
                setDate(v);
              }}
            />
          </div>
          <button
            type="button"
            className="btn ghost"
            style={{ alignSelf: "flex-end", minHeight: "2.6rem" }}
            onClick={() => void load()}
            disabled={busy}
          >
            {busy ? t("common.loading") : t("common.refresh")}
          </button>
          {pnl?.locked && can("system.manage") && (
            <button
              type="button"
              className="btn"
              style={{ alignSelf: "flex-end", minHeight: "2.6rem" }}
              onClick={() => void unlock()}
            >
              {t("finance.unlock")}
            </button>
          )}
        </div>
      </div>

      <div className="stats">
        <div className={`panel stat ${pnl && pnl.netProfit < 0 ? "alert-low" : ""}`}>
          <span>{t("finance.netProfit")}</span>
          <strong style={{ color: pnl && pnl.netProfit < 0 ? "var(--danger)" : "var(--ok)" }}>
            {pnl ? money(pnl.netProfit) : "—"}
          </strong>
          <span className="tiny">{pnl?.businessDate || date}</span>
        </div>
        <div className="panel stat">
          <span>{t("finance.gross")}</span>
          <strong>{pnl ? money(pnl.sales.gross) : "—"}</strong>
          <span className="tiny">
            {t("finance.discounts")}: {pnl ? money(pnl.sales.discounts) : "—"}
          </span>
        </div>
        <div className="panel stat">
          <span>{t("finance.netFood")}</span>
          <strong>{pnl ? money(pnl.sales.netFood) : "—"}</strong>
          <span className="tiny">
            {t("finance.paidFood")}: {pnl ? money(pnl.sales.paidFood) : "—"}
          </span>
        </div>
        <div className="panel stat">
          <span>{t("finance.tax")}</span>
          <strong>{pnl ? money(pnl.sales.tax) : "—"}</strong>
          <span className="tiny">
            {t("finance.tips")}: {pnl ? money(pnl.sales.tips) : "—"}
          </span>
        </div>
        <div className="panel stat">
          <span>{t("finance.expenses")}</span>
          <strong>{pnl ? money(expenseTotal) : "—"}</strong>
          <span className="tiny">
            {t("finance.cogs")}: {pnl ? money(pnl.costs.cogs) : "—"}
          </span>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: "1rem" }}>
        <div className="panel panel-pad">
          <h3 style={{ marginTop: 0 }}>{t("finance.salesBreakdown")}</h3>
          {pnl ? (
            <div className="table-wrap">
              <table>
                <tbody>
                  <tr>
                    <td>{t("finance.gross")}</td>
                    <td style={{ textAlign: "right" }}>{money(pnl.sales.gross)}</td>
                  </tr>
                  <tr>
                    <td>{t("finance.discounts")}</td>
                    <td style={{ textAlign: "right" }}>−{money(pnl.sales.discounts)}</td>
                  </tr>
                  <tr>
                    <td>{t("finance.netFood")}</td>
                    <td style={{ textAlign: "right" }}>
                      <strong>{money(pnl.sales.netFood)}</strong>
                    </td>
                  </tr>
                  <tr>
                    <td>{t("finance.tax")}</td>
                    <td style={{ textAlign: "right" }}>{money(pnl.sales.tax)}</td>
                  </tr>
                  <tr>
                    <td>{t("finance.tips")}</td>
                    <td style={{ textAlign: "right" }}>{money(pnl.sales.tips)}</td>
                  </tr>
                  <tr>
                    <td>{t("finance.paidFood")}</td>
                    <td style={{ textAlign: "right" }}>{money(pnl.sales.paidFood)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">{busy ? t("common.loading") : t("finance.noData")}</div>
          )}
        </div>

        <div className="panel panel-pad">
          <h3 style={{ marginTop: 0 }}>{t("finance.costBreakdown")}</h3>
          {pnl ? (
            <div className="table-wrap">
              <table>
                <tbody>
                  <tr>
                    <td>{t("finance.cogs")}</td>
                    <td style={{ textAlign: "right" }}>{money(pnl.costs.cogs)}</td>
                  </tr>
                  <tr>
                    <td>{t("finance.specialsLoss")}</td>
                    <td style={{ textAlign: "right" }}>{money(pnl.costs.specialsLoss)}</td>
                  </tr>
                  <tr>
                    <td>{t("finance.hotelExpenses")}</td>
                    <td style={{ textAlign: "right" }}>{money(pnl.costs.hotelExpenses)}</td>
                  </tr>
                  <tr>
                    <td>{t("finance.supplierPaid")}</td>
                    <td style={{ textAlign: "right" }}>{money(pnl.costs.supplierPaid)}</td>
                  </tr>
                  <tr>
                    <td>{t("finance.selfExtra")}</td>
                    <td style={{ textAlign: "right" }}>{money(pnl.costs.selfExtra ?? 0)}</td>
                  </tr>
                  <tr>
                    <td>{t("finance.netProfit")}</td>
                    <td style={{ textAlign: "right" }}>
                      <strong style={{ color: pnl.netProfit < 0 ? "var(--danger)" : "var(--ok)" }}>
                        {money(pnl.netProfit)}
                      </strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">{busy ? t("common.loading") : t("finance.noData")}</div>
          )}
        </div>
      </div>

      <h3 style={{ margin: "0 0 0.65rem" }}>{t("finance.tender")}</h3>
      <div className="stats">
        {(["CASH", "CARD", "WALLET", "BANK"] as const).map((m) => (
          <div key={m} className="panel stat">
            <span>{t(METHOD_KEY[m])}</span>
            <strong>{money(pnl?.tender?.[m] ?? 0)}</strong>
          </div>
        ))}
      </div>

      {pnl?.drawer && (
        <>
          <h3 style={{ margin: "0 0 0.65rem" }}>{t("finance.drawer")}</h3>
          <div className="stats">
            <div className="panel stat">
              <span>{t("finance.expectedCash")}</span>
              <strong>{money(pnl.drawer.expectedCash)}</strong>
            </div>
            <div className="panel stat">
              <span>{t("finance.collectedCash")}</span>
              <strong>{money(pnl.drawer.collectedCash)}</strong>
            </div>
            <div className={`panel stat ${pnl.drawer.missCash ? "alert-low" : ""}`}>
              <span>{t("finance.missCash")}</span>
              <strong>{money(pnl.drawer.missCash)}</strong>
            </div>
            <div className="panel stat">
              <span>{t("pay.method.CARD")}</span>
              <strong>{money(pnl.drawer.cardTotal)}</strong>
            </div>
            <div className="panel stat">
              <span>{t("pay.method.WALLET")} / {t("pay.method.BANK")}</span>
              <strong>{money(pnl.drawer.walletTotal + pnl.drawer.bankTotal)}</strong>
            </div>
          </div>
        </>
      )}

      <div className="panel panel-pad" style={{ marginBottom: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>{t("finance.creditAging")}</h3>
        <div className="stats" style={{ marginBottom: "0.85rem" }}>
          {(["0-30", "31-60", "61-90", "90+", "total"] as const).map((k) => (
            <div key={k} className={`panel stat ${k === "90+" && (aging?.summary[k] ?? 0) > 0 ? "alert-low" : ""}`}>
              <span>{k === "total" ? t("finance.total") : t(BUCKET_KEY[k])}</span>
              <strong>{money(aging?.summary[k] ?? 0)}</strong>
            </div>
          ))}
        </div>
        {agingRows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("common.name")}</th>
                  <th>{t("finance.days")}</th>
                  <th>{t("finance.bucket")}</th>
                  <th style={{ textAlign: "right" }}>{t("finance.outstanding")}</th>
                </tr>
              </thead>
              <tbody>
                {pageAging.map((r) => (
                  <tr key={r.name + r.phone}>
                    <td>
                      <strong>{r.name}</strong>
                      <div className="tiny muted">{r.phone}</div>
                    </td>
                    <td>{r.days}</td>
                    <td>
                      <span className={`badge ${r.bucket === "90+" ? "unpaid" : r.bucket === "61-90" ? "pending" : "paid"}`}>
                        {t(BUCKET_KEY[r.bucket] ?? "finance.bucket")}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>{money(r.outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={agingPage} pageSize={PAGE_SIZE} total={agingRows.length} onChange={setAgingPage} />
          </div>
        ) : (
          <div className="empty">{t("finance.noCredit")}</div>
        )}
      </div>

      <div className="panel panel-pad">
        <h3 style={{ marginTop: 0 }}>{t("finance.exceptions")}</h3>
        <p className="tiny muted" style={{ marginTop: 0 }}>
          {t("finance.exceptionsHint")}
        </p>
        <div className="seg" style={{ marginBottom: "0.85rem" }}>
          {(
            [
              ["cancels", "finance.cancels", exCounts.cancels],
              ["edits", "finance.edits", exCounts.edits],
              ["discounts", "finance.bigDiscounts", exCounts.discounts],
            ] as const
          ).map(([id, key, n]) => (
            <button key={id} type="button" className={exTab === id ? "active" : ""} onClick={() => setExTab(id)}>
              {t(key)} ({n})
            </button>
          ))}
        </div>

        {exTab === "cancels" &&
          (exCounts.cancels ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("finance.bill")}</th>
                    <th>{t("finance.table")}</th>
                    <th>{t("finance.reason")}</th>
                    <th>{t("finance.by")}</th>
                    <th style={{ textAlign: "right" }}>{t("finance.amount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(ex?.cancels ?? []).slice(0, 40).map((c) => (
                    <tr key={`c-${c.orderNo}-${c.at}`}>
                      <td>#{c.orderNo}</td>
                      <td>{c.tableNo || "—"}</td>
                      <td>{c.reason || "—"}</td>
                      <td>{c.by || "—"}</td>
                      <td style={{ textAlign: "right" }}>{money(c.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">{t("finance.noExceptions")}</div>
          ))}

        {exTab === "edits" &&
          (exCounts.edits ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("finance.bill")}</th>
                    <th>{t("finance.reason")}</th>
                    <th>{t("finance.by")}</th>
                    <th style={{ textAlign: "right" }}>{t("finance.before")}</th>
                    <th style={{ textAlign: "right" }}>{t("finance.after")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(ex?.billEdits ?? []).slice(0, 40).map((e, i) => (
                    <tr key={`e-${e.orderNo}-${i}`}>
                      <td>#{e.orderNo}</td>
                      <td>{e.reason}</td>
                      <td>{e.by}</td>
                      <td style={{ textAlign: "right" }}>{money(e.beforeNet)}</td>
                      <td style={{ textAlign: "right" }}>{money(e.afterNet)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">{t("finance.noExceptions")}</div>
          ))}

        {exTab === "discounts" &&
          (exCounts.discounts ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("finance.bill")}</th>
                    <th>{t("finance.by")}</th>
                    <th style={{ textAlign: "right" }}>{t("finance.discount")}</th>
                    <th style={{ textAlign: "right" }}>{t("finance.billTotal")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(ex?.bigDiscounts ?? []).slice(0, 40).map((d) => (
                    <tr key={`d-${d.orderNo}`}>
                      <td>#{d.orderNo}</td>
                      <td>{d.cashier || "—"}</td>
                      <td style={{ textAlign: "right" }}>
                        {money(d.discount)} ({d.percent}%)
                      </td>
                      <td style={{ textAlign: "right" }}>{money(d.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">{t("finance.noExceptions")}</div>
          ))}
      </div>

      <PoweredBy />
    </div>
  );
}
