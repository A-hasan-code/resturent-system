import { FormEvent, useEffect, useState } from "react";
import { api, money } from "../api";
import { useAuth } from "../auth";
import { useT } from "../i18n";
import { useToast } from "../toast";
import { serverPrint } from "../printing";
import { Modal } from "./Modal";

export type PayTarget = {
  id: string;
  orderNo: number;
  tableNo?: string | null;
  total: number;
  paidAmount?: number;
  tipAmount?: number;
  servedByName?: string | null;
  servedBy?: string | null;
  orderedBy?: { id?: string; name: string; roleCode?: string; roleName: string } | null;
};

type Cashier = { id: string; name: string; roleName: string };

export function PayModal({
  order,
  onClose,
  onPaid,
}: {
  order: PayTarget | null;
  onClose: () => void;
  onPaid: () => void;
}) {
  const { user, can } = useAuth();
  const toast = useToast();
  const t = useT();
  const keepsCash = can("cash.keep");
  const due = order ? Math.max(0, order.total - (order.paidAmount ?? 0)) : 0;
  const [amount, setAmount] = useState("");
  const [tip, setTip] = useState("");
  const [cashiers, setCashiers] = useState<Cashier[]>([]);
  const [handedTo, setHandedTo] = useState("");
  const [servedByName, setServedByName] = useState("");
  const [busy, setBusy] = useState(false);
  const [handedOver, setHandedOver] = useState(false);

  useEffect(() => {
    if (!order) return;
    setAmount(String(due));
    setTip("");
    setHandedOver(false);
    setServedByName((order.servedByName || order.servedBy || "").trim());
    if (keepsCash) return;
    api<Cashier[]>("/payments/cashiers")
      .then((list) => {
        setCashiers(list);
        const remembered = localStorage.getItem(`handover:${user?.id}`);
        const pick = list.find((c) => c.id === remembered) ?? (list.length === 1 ? list[0] : undefined);
        setHandedTo(pick?.id ?? "");
      })
      .catch((e) => toast.push(e instanceof Error ? e.message : t("pay.loadCashiersFailed"), "err"));
  }, [order?.id]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!order) return;
    const value = Number(amount);
    const tipValue = Math.max(0, Number(tip) || 0);
    if (!(value > 0) && !(tipValue > 0)) return toast.push(t("pay.enterAmount"), "err");
    if (due > 0 && !(value > 0)) return toast.push(t("pay.enterAmount"), "err");
    if (!keepsCash && !handedTo) return toast.push(t("pay.selectCashier"), "err");
    if (!keepsCash && !handedOver) return toast.push(t("pay.confirmGave"), "err");
    setBusy(true);
    const payAmount = Math.min(Math.max(0, value), due);
    const fullyPaid = due <= 0 || payAmount >= due;
    try {
      await api(`/orders/${order.id}/pay`, {
        method: "POST",
        body: JSON.stringify({
          amount: payAmount,
          tip: tipValue,
          servedByName: servedByName.trim() || undefined,
          ...(keepsCash ? {} : { handedToId: handedTo }),
        }),
      });
      if (!keepsCash) localStorage.setItem(`handover:${user?.id}`, handedTo);
      const to = cashiers.find((c) => c.id === handedTo)?.name;
      toast.push(to ? t("pay.savedHanded", { name: to }) : t("pay.saved"), "ok");

      // Fully paid → auto-print customer receipt with PAID status for the guest.
      if (fullyPaid && can("print.bill")) {
        try {
          await serverPrint("bill", order.id);
          toast.push(t("pay.paidReceiptPrinted"), "ok");
        } catch (printErr) {
          toast.push(
            printErr instanceof Error ? printErr.message : t("pay.paidReceiptFailed"),
            "err"
          );
        }
      }

      onPaid();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("pay.failed"), "err");
    } finally {
      setBusy(false);
    }
  }

  const value = Number(amount) || 0;
  const tipValue = Math.max(0, Number(tip) || 0);
  const foodPay = Math.min(value, due);
  const collect = foodPay + tipValue;
  const payTitle = order ? `${t("pay.title")} · ${t("pay.billNo", { n: order.orderNo })}` : t("pay.title");

  return (
    <Modal open={!!order} title={payTitle} onClose={onClose}>
      {order && (
        <form onSubmit={submit}>
          <div className="modal-scroll">
          <div className="pay-summary">
            <span>{t("pay.table")}</span>
            <strong>{order.tableNo || "—"}</strong>
            <span>{t("pay.billTotal")}</span>
            <strong>{money(order.total)}</strong>
            {(order.paidAmount ?? 0) > 0 && (
              <>
                <span>{t("pay.alreadyPaid")}</span>
                <strong>{money(order.paidAmount ?? 0)}</strong>
              </>
            )}
            {(order.tipAmount ?? 0) > 0 && (
              <>
                <span>{t("pay.tipAlready")}</span>
                <strong>{money(order.tipAmount ?? 0)}</strong>
              </>
            )}
            <span>{t("pay.amountDue")}</span>
            <strong className="due">{money(due)}</strong>
            {order.orderedBy && (
              <>
                <span>{t("pay.orderedBy")}</span>
                <strong>
                  {order.orderedBy.name} ({order.orderedBy.roleName})
                </strong>
              </>
            )}
          </div>

          <div className="field">
            <label htmlFor="pay-server">{t("pay.servedBy")}</label>
            <input
              id="pay-server"
              value={servedByName}
              onChange={(e) => setServedByName(e.target.value)}
              placeholder={t("serve.namePh")}
              maxLength={80}
              autoComplete="off"
            />
          </div>

          <div className="field">
            <label htmlFor="pay-amount">{t("pay.amountReceived")}</label>
            <input
              id="pay-amount"
              type="number"
              inputMode="decimal"
              min={0}
              max={due || undefined}
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required={due > 0}
            />
            {value > 0 && value < due && (
              <span className="hint">{t("pay.partial", { amount: money(due - value) })}</span>
            )}
          </div>

          <div className="field">
            <label htmlFor="pay-tip">{t("pay.tip")}</label>
            <input
              id="pay-tip"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={tip}
              onChange={(e) => setTip(e.target.value)}
              placeholder="0"
            />
            <span className="hint">{t("pay.tipHint")}</span>
          </div>

          {tipValue > 0 && (
            <div className="pay-summary">
              <span>{t("pay.collectTotal")}</span>
              <strong className="due">{money(collect)}</strong>
            </div>
          )}

          {!keepsCash && (
            <div className="field">
              <label>{t("pay.handedTo")}</label>
              {cashiers.length ? (
                <div className="cashier-picker" role="radiogroup" aria-label={t("pay.handedTo")}>
                  {cashiers.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      role="radio"
                      aria-checked={handedTo === c.id}
                      className={`role-option ${handedTo === c.id ? "selected" : ""}`}
                      onClick={() => {
                        if (c.id !== handedTo) setHandedOver(false);
                        setHandedTo(c.id);
                      }}
                    >
                      <strong>{c.name}</strong>
                      <span>{c.roleName}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <span className="hint">{t("pay.noCashier")}</span>
              )}
              <span className="hint">{t("pay.cashierNotify")}</span>
            </div>
          )}

          {!keepsCash && handedTo && (
            <label className={`switch-row handover-confirm ${handedOver ? "done" : ""}`}>
              <input type="checkbox" checked={handedOver} onChange={(e) => setHandedOver(e.target.checked)} />
              <span>
                <strong>
                  {t("pay.confirmHanded", {
                    amount: money(collect),
                    name: cashiers.find((c) => c.id === handedTo)?.name ?? t("pay.theCashier"),
                  })}
                </strong>
                <small>{t("pay.confirmSelf")}</small>
              </span>
            </label>
          )}

          </div>
          <div className="form-footer">
            <button type="button" className="btn ghost" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn ok" disabled={busy || (!keepsCash && (!handedTo || !handedOver))}>
              {busy ? t("common.saving") : `${t("pay.markPaid")} ${money(collect)}`}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
