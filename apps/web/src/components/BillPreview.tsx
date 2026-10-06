import { useEffect, useState } from "react";
import { api, unitLabel } from "../api";
import { useBrand } from "../brand";
import { PoweredBy } from "./PoweredBy";
import { useT } from "../i18n";
import { apiBase, serverOrigin } from "../server";

export type BillOrder = {
  id?: string;
  orderNo: number;
  billNo?: number;
  tableNo?: string | null;
  tableName?: string | null;
  partitionName?: string | null;
  paymentStatus: string;
  total: number;
  discountAmount?: number;
  tipAmount?: number;
  paidAmount?: number;
  tenderedAmount?: number;
  createdAt?: string;
  cashier?: string | null;
  waiter?: string | null;
  orderedBy?: { id?: string; name: string; roleCode?: string; roleName: string } | null;
  servedBy?: string | null;
  servedByName?: string | null;
  creditCustomer?: { name?: string; phone?: string; address?: string } | null;
  creditName?: string | null;
  items: {
    id?: string;
    name: string;
    quantity: number;
    sellUnit: string;
    ratePerUnit?: number;
    amount: number;
    notes?: string | null;
  }[];
};

type BillDesign = {
  showLogo: boolean;
  showName: boolean;
  showTagline: boolean;
  showAddress: boolean;
  showPhone: boolean;
  title: string;
  showOrderBy: boolean;
  showServedBy: boolean;
  showCashier: boolean;
  showTip: boolean;
  showPaidStamp: boolean;
  footer: string;
};

const DEFAULT_DESIGN: BillDesign = {
  showLogo: true,
  showName: true,
  showTagline: true,
  showAddress: true,
  showPhone: true,
  title: "Customer Bill",
  showOrderBy: true,
  showServedBy: true,
  showCashier: true,
  showTip: true,
  showPaidStamp: true,
  footer: "Thank you for your visit",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function splitPlace(order: BillOrder) {
  if (order.partitionName || order.tableName) {
    return {
      partition: order.partitionName || null,
      table: order.tableName || order.tableNo || null,
    };
  }
  const raw = (order.tableNo || "").trim();
  if (!raw) return { partition: null, table: null as string | null };
  const m = raw.match(/^(.+?)\s*[·•\-–—]\s*(.+)$/);
  if (m) return { partition: m[1].trim(), table: m[2].trim() };
  return { partition: null, table: raw };
}

function brandingUrl(path: string) {
  const origin =
    apiBase().replace(/\/api\/?$/, "") ||
    serverOrigin() ||
    (typeof location !== "undefined" ? location.origin : "");
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}

function qtyPlain(q: number) {
  if (Number.isInteger(q)) return String(q);
  return q.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function amtPlain(n: number) {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}

function formatDate(d: Date) {
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function formatTime(d: Date) {
  let h = d.getHours();
  const m = d.getMinutes();
  const s = d.getSeconds();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${h}:${pad(m)}:${pad(s)}${ampm}`;
}

export function BillPreview({
  order,
  mode,
  paperWidth = 80,
  designOverride,
  kotMeta,
}: {
  order: BillOrder;
  mode: "kitchen" | "customer";
  paperWidth?: 58 | 72 | 80 | 112;
  /** Live Settings toggles. Overrides the saved design field by field. */
  designOverride?: Partial<BillDesign>;
  /** Extra kitchen-slip fields (round / reprint / station). */
  kotMeta?: {
    round?: number | null;
    reprint?: boolean;
    station?: string | null;
    notes?: string | null;
    footer?: string | null;
  };
}) {
  const t = useT();
  const { brand, logoSrc } = useBrand();
  const [saved, setSaved] = useState<BillDesign>(DEFAULT_DESIGN);
  const design: BillDesign = { ...saved, ...designOverride };
  const when = order.createdAt ? new Date(order.createdAt) : new Date();
  const tip = order.tipAmount ?? 0;
  const showTipAmt = design.showTip !== false ? tip : 0;
  const discount = Math.max(0, order.discountAmount ?? 0);
  const net = Math.max(0, order.total - discount);
  const foodPaid =
    (order.paidAmount ?? 0) > 0 ? order.paidAmount! : order.paymentStatus === "PAID" ? net : 0;
  const grand = net + showTipAmt;
  const billNo = order.billNo ?? order.orderNo;
  const { partition, table } = splitPlace(order);
  const orderedLabel = order.orderedBy
    ? order.orderedBy.roleName
      ? `${order.orderedBy.name} (${order.orderedBy.roleName})`
      : order.orderedBy.name
    : order.waiter || null;
  const servedLabel = (order.servedByName || order.servedBy || "").trim() || null;
  const isPaid = order.paymentStatus === "PAID";
  const stampSrc = brandingUrl(isPaid ? "/branding/paid-stamp.png?v=4" : "/branding/unpaid-stamp.png?v=4");
  const sizeClass =
    paperWidth <= 58
      ? "receipt--mm58"
      : paperWidth <= 72
        ? "receipt--mm72"
        : paperWidth <= 80
          ? "receipt--mm80"
          : "receipt--mm112";
  const narrow = paperWidth <= 58;
  const tableBadge = [partition, table || order.tableNo].filter(Boolean).join(" ") || "Walk-in";
  const customerPhone = order.creditCustomer?.phone || "-";
  const amountPaid = foodPaid + (foodPaid > 0 ? showTipAmt : 0);
  const cash =
    (order.tenderedAmount ?? 0) > 0
      ? order.tenderedAmount!
      : amountPaid > 0
        ? amountPaid
        : order.paymentStatus === "PAID"
          ? grand
          : 0;
  const balance = Math.max(0, grand - amountPaid);
  const change = Math.max(0, cash - amountPaid);

  useEffect(() => {
    api<{ print?: { bill?: Partial<BillDesign> } }>("/system/settings")
      .then((s) => {
        const b = s.print?.bill;
        if (!b) return;
        setSaved({
          showLogo: b.showLogo !== false,
          showName: b.showName !== false,
          showTagline: b.showTagline !== false,
          showAddress: b.showAddress !== false,
          showPhone: b.showPhone !== false,
          title: b.title || "Customer Bill",
          showOrderBy: b.showOrderBy !== false,
          showServedBy: b.showServedBy !== false,
          showCashier: b.showCashier !== false,
          showTip: b.showTip !== false,
          showPaidStamp: b.showPaidStamp !== false,
          footer: b.footer || "Thank you for your visit",
        });
      })
      .catch(() => undefined);
  }, []);

  if (mode === "kitchen") {
    return (
      <div className="receipt-wrap">
        <div className={`receipt receipt-sample receipt-kot ${sizeClass}`} id="bill-print-area">
          <div className="receipt-head">
            {design.showLogo && logoSrc && (
              <div className="receipt-logo-frame">
                <img className="receipt-logo" src={logoSrc} alt="" />
              </div>
            )}
            {design.showName && <div className="receipt-hotel">{brand.name}</div>}
            {design.showPhone && brand.phone && <div className="receipt-sub">{brand.phone}</div>}
            {design.showAddress && brand.address && <div className="receipt-sub">{brand.address}</div>}
            <div className="receipt-title">{t("bill.kitchenOrder")}</div>
            {kotMeta?.station ? <div className="receipt-sub">[ {kotMeta.station} ]</div> : null}
            {kotMeta?.reprint ? <div className="receipt-reprint">{t("kot.reprintBanner")}</div> : null}
          </div>

          <div className="receipt-datetime">
            <span>
              {t("bill.date")}: {formatDate(when)}
            </span>
            <span>
              {t("bill.time")}: {formatTime(when)}
            </span>
          </div>

          <div className="receipt-meta-grid">
            <span>
              {t("bill.orderNo")}
              {order.orderNo}
            </span>
            <span>
              {t("bill.billNo")} {billNo}
            </span>
          </div>

          <div className="receipt-token">
            {t("bill.tokenNo")}: {order.orderNo}
          </div>

          {partition && (
            <div className="receipt-serving">
              {t("bill.partition")}: {partition}
            </div>
          )}
          {(table || order.tableNo) && (
            <div className="receipt-serving">
              {t("bill.table")}: {table || order.tableNo}
            </div>
          )}

          <div className="receipt-table-badge">
            {t("bill.tableNo")} {tableBadge}
          </div>

          {kotMeta?.round ? (
            <div className="receipt-token receipt-token--sm">{t("kot.round", { n: kotMeta.round })}</div>
          ) : null}

          <div className="receipt-rule" />

          {order.items.map((i, idx) => (
            <div key={idx} className="receipt-kot-item">
              <div className="receipt-kot-qty">
                {qtyPlain(i.quantity)} {unitLabel(i.sellUnit)}
              </div>
              <div>
                <div className="receipt-item-name">{i.name}</div>
                {i.notes ? <div className="receipt-note">&gt;&gt; {i.notes}</div> : null}
              </div>
            </div>
          ))}

          <div className="receipt-rule" />

          {kotMeta?.notes ? (
            <div className="receipt-party">
              {t("kot.note")}: {kotMeta.notes}
            </div>
          ) : null}

          {kotMeta?.round && kotMeta.round > 1 ? (
            <div className="receipt-reprint">{t("kot.newItems", { n: kotMeta.round })}</div>
          ) : null}

          {design.showOrderBy && orderedLabel && (
            <div className="receipt-party">
              {t("bill.orderedBy")}: {orderedLabel}
            </div>
          )}
          {servedLabel && (
            <div className="receipt-party">
              {t("bill.servedBy")}: {servedLabel}
            </div>
          )}

          <div className="receipt-thanks receipt-thanks--kot">{t("bill.kitchenCopy")}</div>
          {kotMeta?.footer ? <div className="receipt-thanks">{kotMeta.footer}</div> : null}
        </div>
      </div>
    );
  }

  const phoneLine = customerPhone && customerPhone !== "-" ? customerPhone : "";
  const partyName = (order.creditName || order.creditCustomer?.name || "General").trim() || "General";

  return (
    <div className="receipt-wrap">
      <div
        className={`receipt receipt-sample receipt-ref ${sizeClass} ${narrow ? "receipt-ref--narrow" : "receipt-ref--wide"}`}
        id="bill-print-area"
      >
        <div className="receipt-head">
          {design.showLogo && logoSrc && (
            <div className="receipt-logo-frame">
              <img className="receipt-logo" src={logoSrc} alt="" />
            </div>
          )}
          {design.showName && <div className="receipt-hotel">{brand.name}</div>}
          {design.showPhone && brand.phone ? <div className="receipt-sub">{brand.phone}</div> : null}
          {design.showAddress && brand.address ? <div className="receipt-sub">{brand.address}</div> : null}
          {design.showTagline && brand.tagline ? <div className="receipt-sub">{brand.tagline}</div> : null}
          <div className="receipt-title">{design.title || "Customer Bill"}</div>
        </div>

        <div className="receipt-datetime">
          <span>
            Date: {formatDate(when)}
          </span>
          <span>
            Time: {formatTime(when)}
          </span>
        </div>
        <div className="receipt-meta-grid">
          <span>Order #{order.orderNo}</span>
          <span>Bill # {billNo}</span>
        </div>
        <div className="receipt-token">Token No: {billNo}</div>
        {partition ? <div className="receipt-serving">Partition: {partition}</div> : null}
        {(table || order.tableNo) ? (
          <div className="receipt-serving">Table: {table || order.tableNo}</div>
        ) : null}
        <div className="receipt-table-badge">Table No. {tableBadge}</div>
        <div className="receipt-party">Party Name: {partyName}</div>
        {phoneLine ? <div className="receipt-party">Phone: {phoneLine}</div> : null}
        {design.showCashier && order.cashier ? (
          <div className="receipt-party">Cashier: {order.cashier}</div>
        ) : null}
        {design.showOrderBy && orderedLabel ? (
          <div className="receipt-party">Order by: {orderedLabel}</div>
        ) : null}
        {design.showServedBy && servedLabel ? (
          <div className="receipt-party">Served by: {servedLabel}</div>
        ) : null}

        <div className="receipt-rule dashed" />

        {narrow ? (
          <div className="receipt-cols-3">
            <span>Product</span>
            <span>Qty</span>
            <span>Amt</span>
          </div>
        ) : (
          <div className="receipt-cols-4">
            <span>Product</span>
            <span>Qty</span>
            <span>Rate</span>
            <span>Amount</span>
          </div>
        )}
        <div className="receipt-rule dashed" />

        {order.items.map((i, idx) =>
          narrow ? (
            <div key={idx}>
              <div className="receipt-row-3">
                <span className="receipt-item-name">{i.name}</span>
                <span>{qtyPlain(i.quantity)}</span>
                <span>{amtPlain(i.amount)}</span>
              </div>
              <div className="receipt-rate-line">@{amtPlain(i.ratePerUnit ?? 0)}</div>
            </div>
          ) : (
            <div key={idx} className="receipt-row-4">
              <span className="receipt-item-name">{i.name}</span>
              <span>{qtyPlain(i.quantity)}</span>
              <span>{amtPlain(i.ratePerUnit ?? 0)}</span>
              <span>{amtPlain(i.amount)}</span>
            </div>
          ),
        )}

        <div className="receipt-rule dashed" />

        <div className="receipt-total">
          <span>Gross Total:</span>
          <strong>{Math.round(order.total).toLocaleString("en-US")}</strong>
        </div>
        {discount > 0 && (
          <>
            <div className="receipt-total">
              <span>Discount:</span>
              <strong>{Math.round(discount).toLocaleString("en-US")}</strong>
            </div>
            <div className="receipt-total">
              <span>Net Total:</span>
              <strong>{Math.round(net).toLocaleString("en-US")}</strong>
            </div>
          </>
        )}
        {design.showTip && showTipAmt > 0 && (
          <div className="receipt-total">
            <span>Tip:</span>
            <strong>{Math.round(showTipAmt).toLocaleString("en-US")}</strong>
          </div>
        )}
        {cash > 0 && (
          <div className="receipt-cash-box">
            Cash Received : {Math.round(cash).toLocaleString("en-US")}
          </div>
        )}
        {change > 0 && (
          <div className="receipt-total">
            <span>Change:</span>
            <strong>{Math.round(change).toLocaleString("en-US")}</strong>
          </div>
        )}
        {balance > 0 && (
          <div className="receipt-total">
            <span>Balance:</span>
            <strong>{Math.round(balance).toLocaleString("en-US")}</strong>
          </div>
        )}

        {design.showPaidStamp && (
          <div className="receipt-paid-stamp receipt-paid-stamp--footer" aria-hidden>
            <img src={stampSrc} alt="" />
          </div>
        )}

        <div className="receipt-thanks">{design.footer || t("bill.thanksVisit")}</div>
        <PoweredBy variant="receipt" />
      </div>
    </div>
  );
}

export function printBill() {
  window.print();
}
