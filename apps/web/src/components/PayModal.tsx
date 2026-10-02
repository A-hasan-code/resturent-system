import { FormEvent, useEffect, useState } from "react";
import { api, money } from "../api";
import { useAuth } from "../auth";
import { useT } from "../i18n";
import { useToast } from "../toast";
import { Modal } from "./Modal";

export type PayTarget = {
  id: string;
  orderNo: number;
  tableNo?: string | null;
  total: number;
  paidAmount?: number;
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
  const [cashiers, setCashiers] = useState<Cashier[]>([]);
  const [handedTo, setHandedTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [handedOver, setHandedOver] = useState(false);

  useEffect(() => {
    if (!order) return;
    setAmount(String(due));
    setHandedOver(false);
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
    if (!(value > 0)) return toast.push(t("pay.enterAmount"), "err");
    if (!keepsCash && !handedTo) return toast.push(t("pay.selectCashier"), "err");
    if (!keepsCash && !handedOver) return toast.push(t("pay.confirmGave"), "err");
    setBusy(true);
    try {
      await api(`/orders/${order.id}/pay`, {
        method: "POST",
        body: JSON.stringify({ amount: Math.min(value, due), ...(keepsCash ? {} : { handedToId: handedTo }) }),
      });
      if (!keepsCash) localStorage.setItem(`handover:${user?.id}`, handedTo);
      const to = cashiers.find((c) => c.id === handedTo)?.name;
      toast.push(to ? t("pay.savedHanded", { name: to }) : t("pay.saved"), "ok");
      onPaid();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("pay.failed"), "err");
    } finally {
      setBusy(false);
    }
  }

  const value = Number(amount) || 0;
  const payTitle = order ? `${t("pay.title")} · ${t("pay.billNo", { n: order.orderNo })}` : t("pay.title");

  return (
    <Modal open={!!order} title={payTitle} onClose={onClose}>
      {order && (
        <form onSubmit={submit}>
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
            <span>{t("pay.amountDue")}</span>
            <strong className="due">{money(due)}</strong>
          </div>

          <div className="field">
            <label htmlFor="pay-amount">{t("pay.amountReceived")}</label>
            <input
              id="pay-amount"
              type="number"
              inputMode="decimal"
              min={1}
              max={due}
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
            {value > 0 && value < due && (
              <span className="hint">{t("pay.partial", { amount: money(due - value) })}</span>
            )}
          </div>

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
                    amount: money(Math.min(value, due)),
                    name: cashiers.find((c) => c.id === handedTo)?.name ?? t("pay.theCashier"),
                  })}
                </strong>
                <small>{t("pay.confirmSelf")}</small>
              </span>
            </label>
          )}

          <div className="form-footer">
            <button type="button" className="btn ghost" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn ok" disabled={busy || (!keepsCash && (!handedTo || !handedOver))}>
              {busy ? t("common.saving") : `${t("pay.markPaid")} ${money(Math.min(value, due))}`}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
