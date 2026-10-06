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
  taxAmount?: number;
  taxPercent?: number;
  paidAmount?: number;
  tenderedAmount?: number;
  tipAmount?: number;
  servedByName?: string | null;
  servedBy?: string | null;
  orderedBy?: { id?: string; name: string; roleCode?: string; roleName: string } | null;
};

type Cashier = { id: string; name: string; roleName: string };
type PayMethod = "CASH" | "CARD" | "WALLET" | "BANK";

const round2 = (n: number) => Math.round(n * 100) / 100;

export function PayModal({
  order,
  onClose,
  onPaid,
}: {
  order: PayTarget | null;
  onClose: () => void;
  onPaid: (fullyPaid?: boolean) => void;
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
  const [method, setMethod] = useState<PayMethod>("CASH");
  const [taxPercent, setTaxPercent] = useState(0);
  const [cashiers, setCashiers] = useState<Cashier[]>([]);
  const [handedTo, setHandedTo] = useState("");
  const [servedByName, setServedByName] = useState("");
  const [busy, setBusy] = useState(false);
  const [handedOver, setHandedOver] = useState(false);

  const discountValue = Math.min(Math.max(0, round2(Number(discount) || 0)), Math.max(0, round2(gross)));
  const foodNet = Math.max(0, round2(gross - discountValue));
  const taxAmount = taxPercent > 0 ? round2((foodNet * taxPercent) / 100) : 0;
  const dueBase = round2(foodNet + taxAmount);
  const due = Math.max(0, round2(dueBase - prevPaid));
  const needsHandover = method === "CASH" && !keepsCash;

  useEffect(() => {
    if (!order) return;
    const startDiscount = Math.max(0, order.discountAmount ?? 0);
    setDiscount(startDiscount > 0 ? String(startDiscount) : "");
    setTip("");
    setMethod("CASH");
    setHandedOver(false);
    setServedByName((order.servedByName || order.servedBy || "").trim());
    api<{ billing?: { taxEnabled?: boolean; taxPercent?: number } }>("/system/settings")
      .then((s) => {
        const pct = s.billing?.taxEnabled ? Number(s.billing.taxPercent) || 0 : 0;
        setTaxPercent(pct);
        const net = Math.max(0, round2(order.total - startDiscount));
        const tax = pct > 0 ? round2((net * pct) / 100) : 0;
        const startDue = Math.max(0, round2(net + tax - (order.paidAmount ?? 0)));
        setAmount(startDue > 0 ? String(startDue) : "");
      })
      .catch(() => {
        setTaxPercent(0);
        const startNet = Math.max(0, round2(order.total - startDiscount));
        setAmount(Math.max(0, round2(startNet - (order.paidAmount ?? 0))) > 0
          ? String(Math.max(0, round2(startNet - (order.paidAmount ?? 0))))
          : "");
      });
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
    if (due > 0 && tipValue > 0 && !(value > 0)) return toast.push(t("pay.payBeforeTip"), "err");
    if (needsHandover && (Math.min(Math.max(0, value), due) > 0 || tipValue > 0) && !handedTo) {
      return toast.push(t("pay.selectCashier"), "err");
    }
    if (needsHandover && (Math.min(Math.max(0, value), due) > 0 || tipValue > 0) && !handedOver) {
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
          method,
          servedByName: servedByName.trim() || undefined,
          ...(needsHandover && (payAmount > 0 || tipValue > 0) ? { handedToId: handedTo } : {}),
        }),
      });
      if (needsHandover && handedTo) localStorage.setItem(`handover:${user?.id}`, handedTo);
      const to = cashiers.find((c) => c.id === handedTo)?.name;
      toast.push(to ? t("pay.savedHanded", { name: to }) : t("pay.saved"), "ok");
      if (fullyPaid && can("print.bill")) {
        try {
          await serverPrint("bill", order.id);
          toast.push(t("pay.paidReceiptPrinted"), "ok");
        } catch (printErr) {
          toast.push(printErr instanceof Error ? printErr.message : t("pay.paidReceiptFailed"), "err");
        }
      }
      onPaid(fullyPaid);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (/locked after day close/i.test(msg)) toast.push(t("pay.dayLocked"), "err");
      else toast.push(msg || t("pay.failed"), "err");
    } finally {
      setBusy(false);
    }
  }

  const value = Number(amount) || 0;
  const tipValue = Math.max(0, Number(tip) || 0);
  const foodPay = Math.min(value, due);
  const change = method === "CASH" ? Math.max(0, round2(value - foodPay - tipValue)) : 0;
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
                  <strong>{money(foodNet)}</strong>
                </>
              )}
              {taxAmount > 0 && (
                <>
                  <span>
                    {t("pay.tax")} ({taxPercent}%)
                  </span>
                  <strong>{money(taxAmount)}</strong>
                </>
              )}
              {prevPaid > 0 && (
                <>
                  <span>{t("pay.alreadyPaid")}</span>
                  <strong>{money(prevPaid)}</strong>
                </>
              )}
              <span>{t("pay.amountDue")}</span>
              <strong className="due">{money(due)}</strong>
            </div>

            <div className="field">
              <label>{t("pay.method")}</label>
              <div className="btn-row" style={{ flexWrap: "wrap", gap: 6 }}>
                {(["CASH", "CARD", "WALLET", "BANK"] as PayMethod[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`btn sm ${method === m ? "" : "ghost"}`}
                    onClick={() => {
                      setMethod(m);
                      setHandedOver(false);
                      if (m !== "CASH") setAmount(due > 0 ? String(due) : "");
                    }}
                  >
                    {t(`pay.method.${m}` as "pay.method.CASH")}
                  </button>
                ))}
              </div>
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
                step="any"
                value={discount}
                onChange={(e) => {
                  const next = e.target.value;
                  const nextDisc = Math.min(Math.max(0, round2(Number(next) || 0)), Math.max(0, round2(gross)));
                  const nextNet = Math.max(0, round2(gross - nextDisc));
                  const nextTax = taxPercent > 0 ? round2((nextNet * taxPercent) / 100) : 0;
                  const nextDue = Math.max(0, round2(nextNet + nextTax - prevPaid));
                  const prevDue = due;
                  setDiscount(next);
                  if (!amount || round2(Number(amount) || 0) === prevDue) {
                    setAmount(nextDue > 0 ? String(nextDue) : "");
                  }
                }}
                placeholder="0"
              />
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
              {change > 0 && (
                <span className="hint pay-change-hint">{t("pay.changeReturn", { amount: money(change) })}</span>
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
            </div>

            {needsHandover && collect > 0 && (
              <div className="field">
                <label>{t("pay.handedTo")}</label>
                {cashiers.length ? (
                  <div className="cashier-picker" role="radiogroup">
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
              </div>
            )}

            {needsHandover && handedTo && collect > 0 && (
              <label className={`switch-row handover-confirm ${handedOver ? "done" : ""}`}>
                <input type="checkbox" checked={handedOver} onChange={(e) => setHandedOver(e.target.checked)} />
                <span>
                  <strong>
                    {t("pay.confirmHanded", {
                      amount: money(collect),
                      name: cashiers.find((c) => c.id === handedTo)?.name ?? t("pay.theCashier"),
                    })}
                  </strong>
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
              disabled={busy || (needsHandover && collect > 0 && (!handedTo || !handedOver))}
            >
              {busy ? t("common.saving") : `${t("pay.markPaid")} ${money(collect)}`}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
