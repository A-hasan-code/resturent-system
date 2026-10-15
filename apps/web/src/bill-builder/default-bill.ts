/**
 * Bill builder helpers + palette blocks.
 * Default layout seed lives in: ./seeds/bill-design.seed.ts
 */

import {
  BILL_DESIGN_SEED_CSS,
  buildBillDesignSeedHtml,
  logoBlockHtml,
  logoBlockInnerHtml,
  stampOverlayHtml,
  type BillDesignSeedBrand,
} from "./seeds/bill-design.seed";

export type BillBrandPreview = BillDesignSeedBrand;

export { logoBlockHtml, logoBlockInnerHtml, stampOverlayHtml };

/** Loads the separate seed file (Reset design / empty project). */
export function buildDefaultBillHtml(brand?: BillBrandPreview) {
  return buildBillDesignSeedHtml(brand);
}

/** @deprecated use buildDefaultBillHtml() */
export const DEFAULT_BILL_HTML = buildDefaultBillHtml();

export const DEFAULT_BILL_CSS = BILL_DESIGN_SEED_CSS;

export type BillBlockDef = {
  id: string;
  label: string;
  category: string;
  media?: string;
  content: string;
};

export function billBlockDefs(logoUrl?: string | null): BillBlockDef[] {
  return [
    {
      id: "bill-logo",
      label: "Logo",
      category: "Bill sections",
      content: logoBlockHtml(logoUrl),
    },
    {
      id: "bill-name",
      label: "Restaurant name",
      category: "Bill sections",
      content:
        '<div class="bill-block bill-block--center bill-block--bold bill-header-name" data-bill-block="name" data-gjs-name="Restaurant name"><div data-gjs-type="text">{{restaurant.name}}</div></div>',
    },
    {
      id: "bill-phone",
      label: "Phone",
      category: "Bill sections",
      content:
        '<div class="bill-block bill-block--center" data-bill-block="phone" data-gjs-name="Phone"><div data-gjs-type="text">Tel: {{restaurant.phone}}</div></div>',
    },
    {
      id: "bill-address",
      label: "Address",
      category: "Bill sections",
      content:
        '<div class="bill-block bill-block--center" data-bill-block="address" data-gjs-name="Address"><div data-gjs-type="text">{{restaurant.address}}</div></div>',
    },
    {
      id: "bill-tagline",
      label: "Tagline",
      category: "Bill sections",
      content:
        '<div class="bill-block bill-block--center bill-tagline" data-bill-block="tagline" data-gjs-name="Tagline"><div data-gjs-type="text">{{restaurant.tagline}}</div></div>',
    },
    {
      id: "bill-title",
      label: "Bill title",
      category: "Bill sections",
      content:
        '<div class="bill-block bill-block--center bill-block--bold" data-bill-block="title" data-gjs-name="Bill title"><div data-gjs-type="text" class="bill-rule">================================</div><div data-gjs-type="text">{{bill_title}}</div><div data-gjs-type="text" class="bill-rule">================================</div></div>',
    },
    {
      id: "bill-meta",
      label: "Order details (table)",
      category: "Bill sections",
      content: `<div class="bill-block" data-bill-block="meta" data-gjs-name="Order details">
  <table class="bill-table bill-table--meta"><tbody>
    <tr><td class="bill-td-label"><div data-gjs-type="text">Date</div></td><td class="bill-td-value"><div data-gjs-type="text">{{date}}</div></td></tr>
    <tr><td class="bill-td-label"><div data-gjs-type="text">Order #</div></td><td class="bill-td-value"><div data-gjs-type="text">{{order_no}}</div></td></tr>
    <tr><td class="bill-td-label"><div data-gjs-type="text">Table</div></td><td class="bill-td-value"><div data-gjs-type="text">{{table}}</div></td></tr>
  </tbody></table>
</div>`,
    },
    {
      id: "bill-staff",
      label: "Staff lines (block)",
      category: "Bill sections",
      content: `<div class="bill-block" data-bill-block="staff" data-gjs-name="Staff lines">
  <table class="bill-table bill-table--staff-pairs"><tbody>
    <tr><td class="bill-td-pair"><div data-gjs-type="text">Cashier: {{cashier}}          Order by: {{ordered_by}}</div></td></tr>
    <tr><td class="bill-td-pair"><div data-gjs-type="text">Served by: {{served_by}}       Recv by: {{received_by}}</div></td></tr>
  </tbody></table>
</div>`,
    },
    {
      id: "bill-items",
      label: "Items table",
      category: "Bill sections",
      content: `<div class="bill-block" data-bill-block="items" data-gjs-name="Items table">
  <table class="bill-table bill-table--items">
    <thead><tr>
      <th class="bill-th-product"><div data-gjs-type="text">Product</div></th>
      <th class="bill-th-num"><div data-gjs-type="text">Qty</div></th>
      <th class="bill-th-num"><div data-gjs-type="text">Rate</div></th>
      <th class="bill-th-num"><div data-gjs-type="text">Amt</div></th>
    </tr></thead>
    <tbody>
      <tr>
        <td class="bill-td-product"><div data-gjs-type="text">Sample item</div></td>
        <td class="bill-td-num"><div data-gjs-type="text">1</div></td>
        <td class="bill-td-num"><div data-gjs-type="text">100</div></td>
        <td class="bill-td-num"><div data-gjs-type="text">100</div></td>
      </tr>
    </tbody>
  </table>
</div>`,
    },
    {
      id: "bill-totals",
      label: "Totals table",
      category: "Bill sections",
      content: `<div class="bill-block" data-bill-block="totals" data-gjs-name="Totals">
  <table class="bill-table bill-table--totals"><tbody>
    <tr><td class="bill-td-label"><div data-gjs-type="text">Gross Total</div></td><td class="bill-td-value"><div data-gjs-type="text">{{gross_total}}</div></td></tr>
    <tr class="bill-tr-bold"><td class="bill-td-label"><div data-gjs-type="text">Grand Total</div></td><td class="bill-td-value"><div data-gjs-type="text">{{grand_total}}</div></td></tr>
  </tbody></table>
</div>`,
    },
    {
      id: "bill-stamp-paid",
      label: "PAID stamp",
      category: "Stamps (overlay)",
      content: stampOverlayHtml("paid"),
    },
    {
      id: "bill-stamp-unpaid",
      label: "UNPAID stamp",
      category: "Stamps (overlay)",
      content: stampOverlayHtml("unpaid"),
    },
    {
      id: "bill-footer",
      label: "Footer",
      category: "Bill sections",
      content:
        '<div class="bill-block bill-block--center" data-bill-block="footer" data-gjs-name="Footer"><div data-gjs-type="text">{{footer_text}}</div></div>',
    },
    {
      id: "bill-vendor",
      label: "Vendor line",
      category: "Bill sections",
      content:
        '<div class="bill-block bill-block--center" data-bill-block="vendor" data-gjs-name="Vendor"><div data-gjs-type="text" class="bill-muted">Powered by PixalBotics</div></div>',
    },
    {
      id: "bill-rule",
      label: "Divider ===",
      category: "Bill sections",
      content:
        '<div class="bill-block bill-block--center" data-bill-block="rule" data-gjs-name="Divider"><div data-gjs-type="text" class="bill-rule">================================</div></div>',
    },
    {
      id: "bill-text",
      label: "Text line",
      category: "Basic",
      content: '<div class="bill-text" data-gjs-type="text" data-gjs-name="Text">Custom text here</div>',
    },
  ];
}

export const BILL_FIELD_CHIPS: { token: string; label: string; category: string }[] = [
  { token: "restaurant.name", label: "Restaurant name", category: "Values" },
  { token: "restaurant.phone", label: "Phone", category: "Values" },
  { token: "restaurant.address", label: "Address", category: "Values" },
  { token: "restaurant.tagline", label: "Tagline", category: "Values" },
  { token: "restaurant.ntn", label: "NTN", category: "Values" },
  { token: "restaurant.strn", label: "STRN", category: "Values" },
  { token: "order_no", label: "Order #", category: "Values" },
  { token: "bill_no", label: "Bill #", category: "Values" },
  { token: "table", label: "Table", category: "Values" },
  { token: "date", label: "Date", category: "Values" },
  { token: "time", label: "Time", category: "Values" },
  { token: "order_type", label: "Order type", category: "Values" },
  { token: "payment_mode", label: "Payment mode", category: "Values" },
  { token: "payment_status", label: "Payment status", category: "Values" },
  { token: "customer_name", label: "Customer", category: "Values" },
  { token: "customer_phone", label: "Customer phone", category: "Values" },
  { token: "gross_total", label: "Gross total", category: "Values" },
  { token: "discount", label: "Discount", category: "Values" },
  { token: "tax", label: "Tax", category: "Values" },
  { token: "tip", label: "Tip", category: "Values" },
  { token: "grand_total", label: "Grand total", category: "Values" },
  { token: "amount_paid", label: "Amount paid", category: "Values" },
  { token: "change", label: "Change", category: "Values" },
  { token: "balance", label: "Balance", category: "Values" },
  { token: "cashier", label: "Cashier", category: "Values" },
  { token: "ordered_by", label: "Order by", category: "Values" },
  { token: "served_by", label: "Served by", category: "Values" },
  { token: "received_by", label: "Received by", category: "Values" },
  { token: "bill_title", label: "Bill title text", category: "Values" },
  { token: "footer_text", label: "Footer text", category: "Values" },
];
