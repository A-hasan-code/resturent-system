import { useMemo } from "react";
import { QRCodeSVG } from "qrcode.react";
import { money, unitLabel } from "../api";

export type BillOrder = {
  id?: string;
  orderNo: number;
  tableNo?: string | null;
  paymentStatus: string;
  total: number;
  createdAt?: string;
  cashier?: string | null;
  items: {
    name: string;
    quantity: number;
    sellUnit: string;
    ratePerUnit?: number;
    amount: number;
    notes?: string | null;
  }[];
};

const HOTEL = {
  name: "Hotel System",
  tagline: "Fine Dining · BBQ · Karahi",
  phone: "0300-0000000",
  address: "Pakistan",
};

export function BillPreview({
  order,
  mode,
}: {
  order: BillOrder;
  mode: "kitchen" | "customer";
}) {
  const when = order.createdAt
    ? new Date(order.createdAt)
    : new Date();

  const qrPayload = useMemo(() => {
    return JSON.stringify({
      h: HOTEL.name,
      o: order.orderNo,
      t: order.total,
      p: order.paymentStatus,
      d: when.toISOString().slice(0, 10),
    });
  }, [order.orderNo, order.total, order.paymentStatus, when]);

  return (
    <div className="receipt-wrap">
      <div className="receipt" id="bill-print-area">
        <div className="receipt-head">
          <div className="receipt-hotel">{HOTEL.name}</div>
          <div className="receipt-sub">{HOTEL.tagline}</div>
          <div className="receipt-sub">{HOTEL.address}</div>
          <div className="receipt-sub">Tel: {HOTEL.phone}</div>
        </div>

        <div className="receipt-rule" />

        <div className="receipt-meta">
          <div>
            <strong>
              {mode === "kitchen" ? "KITCHEN" : "TAX INVOICE"}
            </strong>
          </div>
          <div>Order #: {order.orderNo}</div>
          <div>Table/Token: {order.tableNo || "—"}</div>
          <div>
            {when.toLocaleDateString("en-PK")}{" "}
            {when.toLocaleTimeString("en-PK", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
          {order.cashier && <div>Cashier: {order.cashier}</div>}
        </div>

        <div className="receipt-rule" />

        <div className={`receipt-cols ${mode === "kitchen" ? "kitchen" : ""}`}>
          <span>Item</span>
          <span>Qty</span>
          {mode === "customer" && <span>Rate</span>}
          {mode === "customer" && <span>Amt</span>}
        </div>
        <div className="receipt-rule dashed" />

        {order.items.map((i, idx) => (
          <div key={idx} className="receipt-item">
            <div className="receipt-item-name">
              {i.name}
              {i.notes ? <div className="receipt-note">* {i.notes}</div> : null}
            </div>
            <div
              className={`receipt-item-row ${
                mode === "kitchen" ? "kitchen" : ""
              }`}
            >
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
              <span>TOTAL</span>
              <strong>{money(order.total)}</strong>
            </div>
            <div className="receipt-pay">Payment: {order.paymentStatus}</div>
            <div className="receipt-rule dashed" />
            <div className="receipt-qr">
              <QRCodeSVG value={qrPayload} size={96} level="M" includeMargin={false} />
              <div className="receipt-sub">Scan for order verify</div>
              <div className="receipt-sub">#{order.orderNo}</div>
            </div>
            <div className="receipt-thanks">Thank you · Come again</div>
          </>
        ) : (
          <div className="receipt-sub" style={{ textAlign: "center" }}>
            *** Kitchen copy — no prices ***
          </div>
        )}

        <div className="receipt-rule dashed" />
        <div className="receipt-sub" style={{ textAlign: "center" }}>
          80mm thermal receipt
        </div>
      </div>
    </div>
  );
}

export function printBill() {
  window.print();
}
