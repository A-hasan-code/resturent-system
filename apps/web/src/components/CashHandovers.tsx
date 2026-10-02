import { useCallback, useEffect, useState } from "react";
import { api, money } from "../api";
import { useT } from "../i18n";
import { useToast } from "../toast";
import { useSocketEvent } from "../socket";

export type PaymentRow = {
  id: string;
  amount: number;
  createdAt: string;
  confirmedAt: string | null;
  orderId: string;
  orderNo: number;
  tableNo: string | null;
  orderTotal: number;
  collectedBy: { id: string; name: string; roleName: string };
  handedTo: { id: string; name: string } | null;
};

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" });

/** Cash that managers handed to the signed-in cashier and that still needs a "received" confirmation. */
export function CashHandovers() {
  const toast = useToast();
  const t = useT();
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api<PaymentRow[]>("/payments/handovers")
      .then(setRows)
      .catch(() => undefined);
  }, []);

  useEffect(load, [load]);
  useSocketEvent("cash.handover", load);
  useSocketEvent("payments.changed", load);

  async function confirm(p: PaymentRow) {
    setBusy(p.id);
    try {
      await api(`/payments/${p.id}/confirm`, { method: "POST", body: "{}" });
      toast.push(t("cash.receivedToast", { amount: money(p.amount), name: p.collectedBy.name }), "ok");
      load();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("cash.confirmFailed"), "err");
    } finally {
      setBusy(null);
    }
  }

  if (!rows.length) return null;
  const total = rows.reduce((s, p) => s + p.amount, 0);

  return (
    <div className="panel panel-pad handover-panel">
      <h2>
        {t("cash.handoverTitle")} · {t("cash.handoverPending", { n: rows.length })} · {money(total)}
      </h2>
      <table>
        <thead>
          <tr>
            <th>{t("common.time")}</th>
            <th>{t("payments.bill")}</th>
            <th>{t("common.table")}</th>
            <th>{t("cash.from")}</th>
            <th>{t("common.amount")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td>{time(p.createdAt)}</td>
              <td>#{p.orderNo}</td>
              <td>{p.tableNo || "—"}</td>
              <td>
                <strong>{p.collectedBy.name}</strong>
                <span className="tiny muted"> · {p.collectedBy.roleName}</span>
              </td>
              <td>
                <strong>{money(p.amount)}</strong>
              </td>
              <td>
                <button type="button" className="btn ok sm" disabled={busy === p.id} onClick={() => void confirm(p)}>
                  {t("cash.confirmReceived")}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
