import { useEffect, useState } from "react";
import { api, unitLabel } from "../api";
import { useBrand } from "../brand";
import { PoweredBy } from "./PoweredBy";
import { useI18n, useT } from "../i18n";
import { serverOrigin } from "../server";

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
  creditCustomer?: { name?: string } | null;
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
  footer: "Thanks for your Visit..",
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
  const origin = serverOrigin() || (typeof location !== "undefined" ? location.origin : "");
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
  const { ts } = useI18n();
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
  const stampSrc = brandingUrl(
    order.paymentStatus === "PAID" ? "/branding/paid-stamp.png?v=2" : "/branding/unpaid-stamp.png?v=2",
  );
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
  const party =
    order.creditName || order.creditCustomer?.name || t("bill.partyGeneral");
  const cash =
    (order.tenderedAmount ?? 0) > 0
      ? order.tenderedAmount!
      : foodPaid > 0
        ? foodPaid + showTipAmt
        : order.paymentStatus === "PAID"
          ? grand
          : 0;
  const change = Math.max(0, cash - foodPaid - showTipAmt);

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
          footer: b.footer || "Thanks for your Visit..",
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

  return (
    <div className="receipt-wrap">
      <div className={`receipt receipt-sample ${sizeClass}`} id="bill-print-area">
        <div className="receipt-head">
          {design.showLogo && logoSrc && (
            <div className="receipt-logo-frame">
              <img className="receipt-logo" src={logoSrc} alt="" />
            </div>
          )}
          {design.showName && <div className="receipt-hotel">{brand.name}</div>}
          {design.showPhone && brand.phone && <div className="receipt-sub">{brand.phone}</div>}
          {design.showAddress && brand.address && <div className="receipt-sub">{brand.address}</div>}
          {design.showTagline && brand.tagline && <div className="receipt-sub">{brand.tagline}</div>}
        </div>

        <div className="receipt-title">{design.title || t("bill.customerBill")}</div>

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

        <div className="receipt-token">{t("bill.tokenNo")}: {billNo}</div>

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

        <div className="receipt-party">
          {t("bill.partyName")}: {party}
        </div>

        {design.showCashier && order.cashier && (
          <div className="receipt-party">
            {t("bill.cashier")}: {order.cashier}
          </div>
        )}
        {design.showOrderBy && orderedLabel && (
          <div className="receipt-party">
            {t("bill.orderedBy")}: {orderedLabel}
          </div>
        )}
        {design.showServedBy && servedLabel && (
          <div className="receipt-party">
            {t("bill.servedBy")}: {servedLabel}
          </div>
        )}

        <div className="receipt-rule" />
        <div className={`receipt-cols-4 ${narrow ? "narrow" : ""}`}>
          <span>{t("bill.product")}</span>
          <span>{t("bill.qty")}</span>
          <span>{t("bill.rate")}</span>
          <span>{t("bill.amt")}</span>
        </div>
        <div className="receipt-rule" />

        {order.items.map((i, idx) => (
          <div key={idx} className={`receipt-row-4 ${narrow ? "narrow" : ""}`}>
            <span className="receipt-item-name">{i.name}</span>
            <span>{qtyPlain(i.quantity)}</span>
            <span>{amtPlain(i.ratePerUnit ?? 0)}</span>
            <span>{amtPlain(i.amount)}</span>
          </div>
        ))}

        <div className="receipt-rule" />

        <div className="receipt-total">
          <span>{t("bill.grossTotal")}</span>
          <strong>{Math.round(order.total).toLocaleString("en-US")}</strong>
        </div>
        {discount > 0 && (
          <div className="receipt-total">
            <span>{t("bill.discount")}</span>
            <strong>{Math.round(discount).toLocaleString("en-US")}</strong>
          </div>
        )}
        {discount > 0 && (
          <div className="receipt-total">
            <span>{t("bill.netTotal")}</span>
            <strong>{Math.round(net).toLocaleString("en-US")}</strong>
          </div>
        )}
        {design.showTip && showTipAmt > 0 && (
          <div className="receipt-total">
            <span>{t("bill.tip")}</span>
            <strong>{Math.round(showTipAmt).toLocaleString("en-US")}</strong>
          </div>
        )}

        {cash > 0 ? (
          <>
            <div className="receipt-cash-box">
              <span>{t("bill.cashReceived")}</span>
              <strong>{Math.round(cash).toLocaleString("en-US")}</strong>
            </div>
            {change > 0 && (
              <div className="receipt-total">
                <span>{t("bill.change")}</span>
                <strong>{Math.round(change).toLocaleString("en-US")}</strong>
              </div>
            )}
          </>
        ) : (
          <div className="receipt-pay">
            {t("bill.payment")} {ts(order.paymentStatus)}
          </div>
        )}

        {design.showPaidStamp && (
          <div className="receipt-paid-stamp">
            <img src={stampSrc} alt={order.paymentStatus === "PAID" ? ts("PAID") : ts("UNPAID")} />
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
