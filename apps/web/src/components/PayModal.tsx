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
  status?: string;
  paymentStatus?: string;
  total: number;
  discountAmount?: number;
  paidAmount?: number;
  tenderedAmount?: number;
  tipAmount?: number;
  servedByName?: string | null;
  servedBy?: string | null;
  orderedBy?: { id?: string; name: string; roleCode?: string; roleName: string } | null;
};

type Cashier = { id: string; name: string; roleName: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

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
  const gross = order?.total ?? 0;
  const prevPaid = order?.paidAmount ?? 0;
  const [amount, setAmount] = useState("");
  const [discount, setDiscount] = useState("");
  const [tip, setTip] = useState("");
  const [cashiers, setCashiers] = useState<Cashier[]>([]);
  const [handedTo, setHandedTo] = useState("");
  const [servedByName, setServedByName] = useState("");
  const [busy, setBusy] = useState(false);
  const [handedOver, setHandedOver] = useState(false);

  const discountValue = Math.min(
    Math.max(0, round2(Number(discount) || 0)),
    Math.max(0, round2(gross - prevPaid)),
  );
  const net = Math.max(0, round2(gross - discountValue));
  const due = Math.max(0, round2(net - prevPaid));

  useEffect(() => {
    if (!order) return;
    const startDiscount = Math.max(0, order.discountAmount ?? 0);
    const startNet = Math.max(0, round2(order.total - startDiscount));
    const startDue = Math.max(0, round2(startNet - (order.paidAmount ?? 0)));
    setDiscount(startDiscount > 0 ? String(startDiscount) : "");
    setAmount(startDue > 0 ? String(startDue) : "");
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
    if (order.status === "CANCELLED" || order.paymentStatus === "VOID") {
      return toast.push(t("bills.payCancelledBlocked"), "err");
    }
    const value = Number(amount);
    const tipValue = Math.max(0, Number(tip) || 0);
    if (due > 0 && !(value > 0) && tipValue <= 0) return toast.push(t("pay.enterAmount"), "err");
    if (!keepsCash && (Math.min(Math.max(0, value), due) > 0 || tipValue > 0) && !handedTo) {
      return toast.push(t("pay.selectCashier"), "err");
    }
    if (!keepsCash && (Math.min(Math.max(0, value), due) > 0 || tipValue > 0) && !handedOver) {
      return toast.push(t("pay.confirmGave"), "err");
    }
    setBusy(true);
    const tendered = Math.max(0, round2(value || 0));
    const payAmount = Math.min(tendered, due);
    const fullyPaid = due <= 0 || payAmount >= due;
    try {
      await api(`/orders/${order.id}/pay`, {
        method: "POST",
        body: JSON.stringify({
          amount: tendered,
          discount: discountValue,
          tip: tipValue,
          servedByName: servedByName.trim() || undefined,
          ...(keepsCash ? {} : payAmount > 0 || tipValue > 0 ? { handedToId: handedTo } : {}),
        }),
      });
      if (!keepsCash && handedTo) localStorage.setItem(`handover:${user?.id}`, handedTo);
      const to = cashiers.find((c) => c.id === handedTo)?.name;
      toast.push(to ? t("pay.savedHanded", { name: to }) : t("pay.saved"), "ok");

      if (fullyPaid && can("print.bill")) {
        try {
          await serverPrint("bill", order.id);
          toast.push(t("pay.paidReceiptPrinted"), "ok");
        } catch (printErr) {
          toast.push(
            printErr instanceof Error ? printErr.message : t("pay.paidReceiptFailed"),
            "err",
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
  const change = Math.max(0, round2(value - foodPay - tipValue));
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
            <strong>{money(gross)}</strong>
            {discountValue > 0 && (
              <>
                <span>{t("pay.discount")}</span>
                <strong>−{money(discountValue)}</strong>
                <span>{t("pay.netTotal")}</span>
                <strong>{money(net)}</strong>
              </>
            )}
            {prevPaid > 0 && (
              <>
                <span>{t("pay.alreadyPaid")}</span>
                <strong>{money(prevPaid)}</strong>
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
            <label htmlFor="pay-discount">{t("pay.discount")}</label>
            <input
              id="pay-discount"
              type="number"
              inputMode="decimal"
              min={0}
              max={Math.max(0, gross - prevPaid) || undefined}
              step="any"
              value={discount}
              onChange={(e) => {
                const next = e.target.value;
                const nextDisc = Math.min(
                  Math.max(0, round2(Number(next) || 0)),
                  Math.max(0, round2(gross - prevPaid)),
                );
                const nextDue = Math.max(0, round2(gross - nextDisc - prevPaid));
                const prevDue = due;
                setDiscount(next);
                // Keep cash field in sync when it still matches the previous due.
                if (!amount || round2(Number(amount) || 0) === prevDue) {
                  setAmount(nextDue > 0 ? String(nextDue) : "");
                }
              }}
              placeholder="0"
            />
            <span className="hint">{t("pay.discountHint")}</span>
          </div>

          <div className="field">
            <label htmlFor="pay-amount">{t("pay.amountReceived")}</label>
            <input
              id="pay-amount"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required={due > 0}
            />
            {value > 0 && value < due && (
              <span className="hint">{t("pay.partial", { amount: money(due - value) })}</span>
            )}
            {change > 0 && (
              <span className="hint pay-change-hint">{t("pay.changeReturn", { amount: money(change) })}</span>
            )}
          </div>

          {change > 0 && (
            <div className="pay-summary pay-change-box">
              <span>{t("pay.change")}</span>
              <strong className="due">{money(change)}</strong>
            </div>
          )}

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

          {(tipValue > 0 || change > 0) && (
            <div className="pay-summary">
              <span>{t("pay.collectTotal")}</span>
              <strong className="due">{money(collect)}</strong>
            </div>
          )}

          {!keepsCash && (collect > 0) && (
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

          {!keepsCash && handedTo && collect > 0 && (
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
            <button
              type="submit"
              className="btn ok"
              disabled={busy || (!keepsCash && collect > 0 && (!handedTo || !handedOver))}
            >
              {busy ? t("common.saving") : `${t("pay.markPaid")} ${money(collect)}`}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
