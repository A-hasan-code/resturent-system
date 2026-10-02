import { useMemo } from "react";
import { QRCodeSVG } from "qrcode.react";
import { money, unitLabel } from "../api";
import { useBrand } from "../brand";
import { useI18n, useT } from "../i18n";

export type BillOrder = {
  id?: string;
  orderNo: number;
  tableNo?: string | null;
  paymentStatus: string;
  total: number;
  tipAmount?: number;
  paidAmount?: number;
  createdAt?: string;
  cashier?: string | null;
  waiter?: string | null;
  orderedBy?: { id?: string; name: string; roleCode?: string; roleName: string } | null;
  servedBy?: string | null;
  servedByName?: string | null;
  items: {
    name: string;
    quantity: number;
    sellUnit: string;
    ratePerUnit?: number;
    amount: number;
    notes?: string | null;
  }[];
};

export function BillPreview({
  order,
  mode,
}: {
  order: BillOrder;
  mode: "kitchen" | "customer";
}) {
  const t = useT();
  const { ts, locale } = useI18n();
  const dateLocale = locale === "ur" ? "ur-PK" : "en-PK";
  const { brand, logoSrc } = useBrand();
  const when = order.createdAt ? new Date(order.createdAt) : new Date();
  const tip = order.tipAmount ?? 0;
  const grand = order.total + tip;
  const orderedLabel = order.orderedBy
    ? `${order.orderedBy.name} (${order.orderedBy.roleName})`
    : order.waiter || null;
  const servedLabel = (order.servedByName || order.servedBy || "").trim() || null;

  const qrPayload = useMemo(() => {
    return JSON.stringify({
      h: brand.name,
      o: order.orderNo,
      t: grand,
      tip,
      p: order.paymentStatus,
      d: when.toISOString().slice(0, 10),
    });
  }, [order.orderNo, grand, tip, order.paymentStatus, when, brand.name]);

  return (
    <div className="receipt-wrap">
      <div className="receipt" id="bill-print-area">
        <div className="receipt-head">
          {logoSrc && <img className="receipt-logo" src={logoSrc} alt="" />}
          <div className="receipt-hotel">{brand.name}</div>
          <div className="receipt-sub">{brand.tagline}</div>
          <div className="receipt-sub">{brand.address}</div>
          <div className="receipt-sub">
            {t("bill.tel")} {brand.phone}
          </div>
        </div>

        <div className="receipt-rule" />

        <div className="receipt-meta">
          <div>
            <strong>{mode === "kitchen" ? t("bill.kitchen") : t("bill.taxInvoice")}</strong>
          </div>
          <div>
            {t("bill.orderNo")} {order.orderNo}
          </div>
          <div>
            {t("bill.tableToken")} {order.tableNo || "—"}
          </div>
          <div>
            {when.toLocaleDateString(dateLocale)}{" "}
            {when.toLocaleTimeString(dateLocale, {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
          {orderedLabel && (
            <div>
              {t("bill.orderedBy")} {orderedLabel}
            </div>
          )}
          {servedLabel && (
            <div>
              {t("bill.servedBy")} {servedLabel}
            </div>
          )}
          {order.cashier && (
            <div>
              {t("bill.cashier")} {order.cashier}
            </div>
          )}
        </div>

        <div className="receipt-rule" />

        <div className={`receipt-cols ${mode === "kitchen" ? "kitchen" : ""}`}>
          <span>{t("bill.item")}</span>
          <span>{t("bill.qty")}</span>
          {mode === "customer" && <span>{t("bill.rate")}</span>}
          {mode === "customer" && <span>{t("bill.amt")}</span>}
        </div>
        <div className="receipt-rule dashed" />

        {order.items.map((i, idx) => (
          <div key={idx} className="receipt-item">
            <div className="receipt-item-name">
              {i.name}
              {i.notes ? <div className="receipt-note">* {i.notes}</div> : null}
            </div>
            <div className={`receipt-item-row ${mode === "kitchen" ? "kitchen" : ""}`}>
              <span>
                {i.quantity} {unitLabel(i.sellUnit)}
              </span>
              {mode === "customer" && (
                <>
                  <span>{money(i.ratePerUnit ?? 0)}</span>
                  <span>{money(i.amount)}</span>
                </>
              )}
            </div>
          </div>
        ))}

        <div className="receipt-rule" />

        {mode === "customer" ? (
          <>
            <div className="receipt-total">
              <span>{t("bill.subtotal")}</span>
              <strong>{money(order.total)}</strong>
            </div>
            {tip > 0 && (
              <div className="receipt-total">
                <span>{t("bill.tip")}</span>
                <strong>{money(tip)}</strong>
              </div>
            )}
            <div className="receipt-total">
              <span>{t("bill.total")}</span>
              <strong>{money(grand)}</strong>
            </div>
            <div className="receipt-pay">
              {t("bill.payment")} {ts(order.paymentStatus)}
            </div>
            <div className="receipt-rule dashed" />
            <div className="receipt-qr">
              <QRCodeSVG value={qrPayload} size={96} level="M" includeMargin={false} />
              <div className="receipt-sub">{t("bill.scanVerify")}</div>
              <div className="receipt-sub">#{order.orderNo}</div>
            </div>
            <div className="receipt-thanks">
              {t("bill.thankYou")} · {t("bill.comeAgain")}
            </div>
          </>
        ) : (
          <div className="receipt-sub" style={{ textAlign: "center" }}>
            {t("bill.kitchenCopy")}
          </div>
        )}

        <div className="receipt-rule dashed" />
        <div className="receipt-sub" style={{ textAlign: "center" }}>
          {t("bill.thermalHint")}
        </div>
      </div>
    </div>
  );
}

export function printBill() {
  window.print();
}
