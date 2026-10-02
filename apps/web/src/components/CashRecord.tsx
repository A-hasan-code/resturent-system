import { useCallback, useEffect, useMemo, useState } from "react";
import { api, money } from "../api";
import { useAuth } from "../auth";
import { useT } from "../i18n";
import { useSocketEvent } from "../socket";
import type { PaymentRow } from "./CashHandovers";

type Result = {
  rows: PaymentRow[];
  summary: { count: number; bills: number; total: number };
};

function isoDay(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" });

/** The signed-in cash keeper's own payments: bills they collected and cash managers handed to them. */
export function CashRecord() {
  const { user } = useAuth();
  const t = useT();
  const [day, setDay] = useState(isoDay(new Date()));
  const [data, setData] = useState<Result | null>(null);

  const load = useCallback(() => {
    api<Result>(`/payments/mine?from=${day}&to=${day}`)
      .then(setData)
      .catch(() => undefined);
  }, [day]);

  useEffect(load, [load]);
  useSocketEvent("payments.changed", load);

  const totals = useMemo(() => {
    const rows = data?.rows ?? [];
    const sum = (xs: PaymentRow[]) => xs.reduce((s, p) => s + p.amount, 0);
    const self = rows.filter((p) => p.collectedBy.id === user?.id);
    const handed = rows.filter((p) => p.handedTo?.id === user?.id && p.collectedBy.id !== user?.id);
    const confirmed = handed.filter((p) => p.confirmedAt);
    const waiting = handed.filter((p) => !p.confirmedAt);
    return {
      self: sum(self),
      selfCount: self.length,
      confirmed: sum(confirmed),
      confirmedCount: confirmed.length,
      waiting: sum(waiting),
      waitingCount: waiting.length,
      inDrawer: sum(self) + sum(confirmed),
    };
  }, [data, user?.id]);

  const rows = data?.rows ?? [];

  return (
    <div>
      <div className="row" style={{ marginBottom: "0.85rem", justifyContent: "space-between" }}>
        <p className="muted" style={{ margin: 0 }}>
          {t("cash.recordHint")}
        </p>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="cash-day">{t("cash.day")}</label>
          <input id="cash-day" type="date" value={day} max={isoDay(new Date())} onChange={(e) => setDay(e.target.value)} />
        </div>
      </div>

      <div className="stats">
        <div className="panel stat">
          <span>{t("cash.inDrawer")}</span>
          <strong>{money(totals.inDrawer)}</strong>
          <span className="tiny">{t("cash.billsPaid", { n: data?.summary.bills ?? 0 })}</span>
        </div>
        <div className="panel stat">
          <span>{t("cash.collectedByMe")}</span>
          <strong>{money(totals.self)}</strong>
          <span className="tiny">{t("cash.paymentsCount", { n: totals.selfCount })}</span>
        </div>
        <div className="panel stat">
          <span>{t("cash.fromManagers")}</span>
          <strong>{money(totals.confirmed)}</strong>
          <span className="tiny">{t("cash.handoversCount", { n: totals.confirmedCount })}</span>
        </div>
        <div className={`panel stat ${totals.waitingCount ? "alert-low" : ""}`}>
          <span>{t("cash.waitingConfirm")}</span>
          <strong>{money(totals.waiting)}</strong>
          <span className="tiny">{t("cash.handoversCount", { n: totals.waitingCount })}</span>
        </div>
      </div>

      <div className="panel panel-pad">
        {!rows.length ? (
          <div className="empty">{t("cash.noPaymentsDay")}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t("cash.paidAt")}</th>
                <th>{t("payments.bill")}</th>
                <th>{t("common.table")}</th>
                <th>{t("common.amount")}</th>
                <th>{t("cash.billTakenBy")}</th>
                <th>{t("cash.handedToMe")}</th>
                <th>{t("cash.iConfirmed")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const mine = p.collectedBy.id === user?.id;
                return (
                  <tr key={p.id}>
                    <td>{clock(p.createdAt)}</td>
                    <td>#{p.orderNo}</td>
                    <td>{p.tableNo || "—"}</td>
                    <td>
                      <strong>{money(p.amount)}</strong>
                      {p.amount < p.orderTotal && (
                        <span className="tiny muted"> {t("payments.partialOf", { amount: money(p.orderTotal) })}</span>
                      )}
                    </td>
                    <td>
                      {mine ? (
                        <span className="badge ready">{t("cash.me")}</span>
                      ) : (
                        <>
                          <strong>{p.collectedBy.name}</strong>{" "}
                          <span className="tiny muted">{p.collectedBy.roleName}</span>
                        </>
                      )}
                    </td>
                    <td>{mine ? <span className="tiny muted">—</span> : clock(p.createdAt)}</td>
                    <td>
                      {mine ? (
                        <span className="tiny muted">—</span>
                      ) : p.confirmedAt ? (
                        <span className="badge paid">{clock(p.confirmedAt)}</span>
                      ) : (
                        <span className="badge pending">{t("cash.notYet")}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
