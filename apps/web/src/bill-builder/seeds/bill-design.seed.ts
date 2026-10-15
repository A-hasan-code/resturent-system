/**
 * Bill design seed — standalone professional sample layout.
 * Edit THIS file to change the default design used by Reset / first open.
 * Builder loads it once; saved grapes project + print template apply everywhere.
 */

export type BillDesignSeedBrand = {
  name?: string;
  phone?: string;
  address?: string;
  tagline?: string;
  logoUrl?: string | null;
  title?: string;
  footer?: string;
};

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(d: Date) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(d.getDate()).padStart(2, "0")} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function fmtTime(d: Date) {
  let h = d.getHours();
  const m = d.getMinutes();
  const s = d.getSeconds();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${h}:${pad(m)}:${pad(s)}${ampm}`;
}

function itemRow(name: string, qty: string, rate: string, amt: string) {
  return `<tr>
  <td class="bill-td-product"><div data-gjs-type="text">${escapeHtml(name)}</div></td>
  <td class="bill-td-num"><div data-gjs-type="text">${escapeHtml(qty)}</div></td>
  <td class="bill-td-num"><div data-gjs-type="text">${escapeHtml(rate)}</div></td>
  <td class="bill-td-num"><div data-gjs-type="text">${escapeHtml(amt)}</div></td>
</tr>`;
}

function totalRow(label: string, value: string, bold = false) {
  return `<tr class="${bold ? "bill-tr-bold" : ""}">
  <td class="bill-td-label"><div data-gjs-type="text">${escapeHtml(label)}</div></td>
  <td class="bill-td-value"><div data-gjs-type="text">${escapeHtml(value)}</div></td>
</tr>`;
}

export function logoBlockInnerHtml(logoUrl?: string | null) {
  if (logoUrl) {
    return `<img class="bill-logo-img" src="${logoUrl.replace(/"/g, "&quot;")}" alt="Logo" data-gjs-editable="false" />`;
  }
  return `<div class="bill-logo-placeholder" data-gjs-type="text">[LOGO]</div>`;
}

export function logoBlockHtml(logoUrl?: string | null) {
  return `<div class="bill-block bill-block--center" data-bill-block="logo" data-gjs-name="Logo">${logoBlockInnerHtml(logoUrl)}</div>`;
}

/** Paid + unpaid stamps — high z-index overlays. */
export function stampOverlayHtml(kind: "paid" | "unpaid") {
  const isPaid = kind === "paid";
  const label = isPaid ? "PAID" : "UNPAID";
  const block = isPaid ? "stamp" : "stamp-unpaid";
  // Middle gap only (between labels & amounts) — totals stay readable
  const top = isPaid ? "64%" : "68%";
  const rotate = isPaid ? "-12deg" : "10deg";
  const color = isPaid ? "#c0392b" : "#1a5276";
  return `<div class="bill-block bill-stamp-overlay bill-stamp-overlay--${kind}" data-bill-block="${block}" data-stamp="${kind}" data-free-move="1" data-gjs-name="${label} stamp" style="position:absolute;top:${top};left:34%;width:32%;z-index:${isPaid ? 90 : 91};text-align:center;margin:0;padding:0;opacity:0.55;">
  <div class="bill-stamp-badge bill-stamp-badge--${kind}" data-gjs-type="text" style="transform:rotate(${rotate});border-color:${color};color:${color};font-size:12px;padding:2px 6px;">${label}</div>
</div>`;
}

/** Seed HTML — professional tables + every section. */
export function buildBillDesignSeedHtml(brand?: BillDesignSeedBrand) {
  const now = new Date();
  const name = brand?.name?.trim() || "Restaurant Name";
  const phone = brand?.phone?.trim() || "0300-0000000";
  const address = brand?.address?.trim() || "Main Boulevard, City";
  const tagline = brand?.tagline?.trim() || "Fine Dining · Fresh Daily";
  const title = brand?.title?.trim() || "Customer Bill";
  const footer = brand?.footer?.trim() || "Thanks for your Visit..";
  const date = fmtDate(now);
  const time = fmtTime(now);

  return `
<div class="bill-slip">
  ${logoBlockHtml(brand?.logoUrl)}

  <div class="bill-block bill-block--center bill-block--bold bill-header-name" data-bill-block="name" data-gjs-name="Restaurant name">
    <div data-gjs-type="text" data-gjs-name="Name text">${escapeHtml(name)}</div>
  </div>

  <div class="bill-block bill-block--center" data-bill-block="phone" data-gjs-name="Phone">
    <div data-gjs-type="text" data-gjs-name="Phone text">Tel: ${escapeHtml(phone)}</div>
  </div>

  <div class="bill-block bill-block--center" data-bill-block="address" data-gjs-name="Address">
    <div data-gjs-type="text" data-gjs-name="Address text">${escapeHtml(address)}</div>
    <div data-gjs-type="text" class="bill-muted" data-gjs-name="NTN">NTN: 1234567-8 &nbsp; STRN: 09-00-0000-000-00</div>
  </div>

  <div class="bill-block bill-block--center bill-tagline" data-bill-block="tagline" data-gjs-name="Tagline">
    <div data-gjs-type="text" data-gjs-name="Tagline text">${escapeHtml(tagline)}</div>
  </div>

  <div class="bill-block bill-block--center" data-bill-block="rule" data-gjs-name="Divider top">
    <div data-gjs-type="text" class="bill-rule">================================</div>
  </div>

  <div class="bill-block bill-block--center bill-block--bold" data-bill-block="title" data-gjs-name="Bill title">
    <div data-gjs-type="text" data-gjs-name="Title text">${escapeHtml(title)}</div>
  </div>

  <div class="bill-block bill-block--center" data-gjs-name="Divider mid">
    <div data-gjs-type="text" class="bill-rule">================================</div>
  </div>

  <div class="bill-block" data-bill-block="meta" data-gjs-name="Order details">
    <table class="bill-table bill-table--meta">
      <tbody>
        <tr>
          <td colspan="2" class="bill-td-pair">
            <div data-gjs-type="text">Date: ${escapeHtml(date)}          Time: ${escapeHtml(time)}</div>
          </td>
        </tr>
        <tr>
          <td colspan="2" class="bill-td-pair">
            <div data-gjs-type="text">Order #206               Bill # 206</div>
          </td>
        </tr>
        <tr>
          <td colspan="2" class="bill-block--center bill-block--bold">
            <div data-gjs-type="text">Token No: 206</div>
          </td>
        </tr>
      </tbody>
    </table>
    <div class="bill-table-badge" data-gjs-type="text"> Table No. Roof Top Table 1 </div>
    <table class="bill-table bill-table--meta">
      <tbody>
        <tr>
          <td colspan="2" class="bill-td-pair">
            <div data-gjs-type="text">Order type: DINE IN       Payment mode: Cash</div>
          </td>
        </tr>
        <tr>
          <td colspan="2" class="bill-td-pair">
            <div data-gjs-type="text">Party Name: General       Phone: 0300-1112233</div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="bill-block" data-bill-block="staff" data-gjs-name="Staff lines">
    <table class="bill-table bill-table--staff-pairs">
      <tbody>
        <tr>
          <td class="bill-td-pair">
            <div data-gjs-type="text">Cashier: Cashier          Order by: Ali (Waiter)</div>
          </td>
        </tr>
        <tr>
          <td class="bill-td-pair">
            <div data-gjs-type="text">Served by: Hassan         Recv by: Front Desk</div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="bill-block" data-bill-block="items" data-gjs-name="Items table">
    <div data-gjs-type="text" class="bill-rule">--------------------------------</div>
    <table class="bill-table bill-table--items">
      <thead>
        <tr>
          <th class="bill-th-product"><div data-gjs-type="text">Product</div></th>
          <th class="bill-th-num"><div data-gjs-type="text">Qty</div></th>
          <th class="bill-th-num"><div data-gjs-type="text">Rate</div></th>
          <th class="bill-th-num"><div data-gjs-type="text">Amt</div></th>
        </tr>
      </thead>
      <tbody>
        ${itemRow("Beef Karahi", "0.75", "2,500", "1,875")}
        ${itemRow("Special Kheer", "1", "150", "150")}
        ${itemRow("Per Head", "3", "120", "360")}
        ${itemRow("Gur Chaye", "3", "100", "300")}
        ${itemRow("Raita Extra", "1", "100", "100")}
        ${itemRow("Naan (plain)", "4", "40", "160")}
      </tbody>
    </table>
    <div data-gjs-type="text" class="bill-rule">--------------------------------</div>
  </div>

  <div class="bill-block" data-bill-block="totals" data-gjs-name="Totals">
    <table class="bill-table bill-table--totals">
      <tbody>
        ${totalRow("Gross Total", "2,945")}
        ${totalRow("Discount", "85")}
        ${totalRow("Net Total", "2,860")}
        ${totalRow("Tax (5%)", "143")}
        ${totalRow("Tip", "50")}
        ${totalRow("Grand Total", "3,053", true)}
        ${totalRow("Cash Received", "3,100")}
        ${totalRow("Change", "47")}
        ${totalRow("Balance", "0")}
      </tbody>
    </table>
  </div>

  ${stampOverlayHtml("paid")}
  ${stampOverlayHtml("unpaid")}

  <div class="bill-block bill-block--center" data-gjs-name="Divider foot">
    <div data-gjs-type="text" class="bill-rule">================================</div>
  </div>

  <div class="bill-block bill-block--center" data-bill-block="footer" data-gjs-name="Footer">
    <div data-gjs-type="text" data-gjs-name="Footer text">${escapeHtml(footer)}</div>
    <div data-gjs-type="text" class="bill-muted">Please come again</div>
  </div>

  <div class="bill-block bill-block--center" data-bill-block="vendor" data-gjs-name="Vendor">
    <div data-gjs-type="text" class="bill-muted">Powered by PixalBotics</div>
  </div>
</div>
`.trim();
}

/** Seed CSS — tables, stamps, thermal slip look. */
export const BILL_DESIGN_SEED_CSS = `
.bill-slip {
  position: relative;
  font-family: "Courier New", Courier, monospace;
  font-size: 10px;
  line-height: 1.25;
  color: #111;
  background: #fff;
  padding: 6px 6px 12px;
  min-height: 0;
  box-sizing: border-box;
}
.bill-block {
  padding: 4px 2px;
  margin: 0;
  border: 1px dashed transparent;
  border-radius: 3px;
  background: transparent;
  cursor: default;
  color: #111;
}
.bill-block:hover {
  border-color: #9ad5cb;
  background: rgba(15, 118, 110, 0.04);
}
.bill-block [data-gjs-type="text"],
.bill-text {
  cursor: text;
  min-height: 1em;
  color: inherit;
}
.bill-block--center { text-align: center; }
.bill-block--bold { font-weight: 700; }
.bill-header-name {
  font-size: 14px;
  letter-spacing: 0.02em;
  margin-top: 2px;
}
.bill-tagline {
  font-size: 10px;
  font-style: italic;
  opacity: 0.85;
  margin-bottom: 2px;
}
.bill-rule {
  letter-spacing: 0;
  opacity: 0.65;
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-align: center;
  line-height: 1.1;
}
.bill-logo-img {
  display: block;
  margin: 0 auto 6px;
  max-width: 70%;
  max-height: 80px;
  object-fit: contain;
}
.bill-logo-placeholder {
  padding: 14px 8px;
  border: 1px dashed #bbb;
  border-radius: 6px;
  color: #666;
  font-size: 10px;
  text-align: center;
  margin-bottom: 4px;
}
.bill-muted {
  opacity: 0.6;
  font-size: 10px;
  display: block;
  margin-top: 2px;
}

/* —— Real HTML tables —— */
.bill-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 11px;
  color: #111;
  margin: 2px 0;
}
.bill-table th,
.bill-table td {
  padding: 2px 3px;
  vertical-align: top;
  word-wrap: break-word;
}
.bill-table--meta {
  font-size: 11px;
}
.bill-table--meta .bill-td-label {
  width: 42%;
  text-align: left;
  opacity: 0.85;
}
.bill-table--meta .bill-td-value {
  width: 58%;
  text-align: right;
  font-weight: 600;
}
.bill-section-label {
  font-weight: 700;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.75;
  margin: 4px 0 2px;
}
.bill-table--staff {
  border-top: 1px dotted #ccc;
  padding-top: 2px;
}
.bill-table--items thead th {
  font-weight: 700;
  border-bottom: 1px solid #222;
  padding-bottom: 3px;
  font-size: 10px;
  text-transform: uppercase;
}
.bill-table--items tbody td {
  padding-top: 3px;
  padding-bottom: 3px;
  border-bottom: 1px dotted #ddd;
  font-size: 10px;
}
.bill-table--items tbody tr:last-child td {
  border-bottom: none;
}
.bill-th-product,
.bill-td-product {
  width: 46%;
  text-align: left;
}
.bill-th-num,
.bill-td-num {
  width: 18%;
  text-align: right;
}
.bill-table--totals .bill-td-label {
  width: 62%;
  text-align: left;
}
.bill-table--totals .bill-td-value {
  width: 38%;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.bill-table--totals .bill-tr-bold td {
  font-weight: 800;
  font-size: 12px;
  border-top: 1px solid #222;
  padding-top: 4px;
  margin-top: 2px;
}
.bill-table-badge,
.bill-table-badge--outline {
  display: block;
  text-align: center;
  font-weight: 800;
  font-size: 11px;
  /* Solid black + white text (matches ESC/POS inverse print) */
  background: #111 !important;
  color: #fff !important;
  border: none;
  padding: 5px 8px;
  margin: 4px 0;
  letter-spacing: 0.02em;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.bill-td-pair {
  text-align: left;
  font-size: 10px;
  white-space: pre-wrap;
}
.bill-table--staff-pairs {
  width: 100%;
  margin: 2px 0 4px;
  font-size: 10px;
}

/* Stamps above content */
.bill-stamp-overlay {
  position: absolute !important;
  z-index: 90 !important;
  pointer-events: auto;
  background: transparent !important;
  box-shadow: none !important;
  border: 1px dashed transparent;
}
.bill-stamp-overlay:hover {
  border-color: rgba(15, 118, 110, 0.5);
  background: rgba(255, 255, 255, 0.12) !important;
}
.bill-stamp-overlay--paid { z-index: 90 !important; }
.bill-stamp-overlay--unpaid { z-index: 91 !important; }
.bill-stamp-badge {
  display: inline-block;
  margin: 0 auto;
  padding: 3px 8px;
  border: 2px solid #c0392b;
  color: #c0392b;
  font-weight: 800;
  font-size: 12px;
  letter-spacing: 1px;
  opacity: 0.7;
  background: transparent;
}
.bill-stamp-badge--unpaid {
  border-color: #1a5276;
  color: #1a5276;
}
.bill-block[data-free-move="1"] {
  position: absolute !important;
  z-index: 80;
  cursor: move;
}
.bill-text {
  padding: 3px 2px;
  min-height: 1.2em;
}
.bill-field {
  display: inline-block;
  padding: 1px 5px;
  margin: 0 1px;
  border-radius: 3px;
  background: #e6f4f1;
  color: #0f766e;
  font-size: 11px;
  border: 1px solid #9ad5cb;
}
`.trim();
