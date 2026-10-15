/**
 * Mail-merge style bill template.
 * - Block tokens on their own line expand to full sections (logo, items, …).
 * - Inline {{fields}} substitute values into free text lines.
 * - Prefix a line with >> to center it.
 */

export type BillTemplateField = {
  token: string;
  label: string;
  group: "block" | "restaurant" | "order" | "money" | "staff" | "text";
  /** True = whole-line section expander */
  block?: boolean;
};

export const BILL_TEMPLATE_FIELDS: BillTemplateField[] = [
  { token: "logo", label: "Logo", group: "block", block: true },
  { token: "name", label: "Restaurant name (block)", group: "block", block: true },
  { token: "phone", label: "Phone (block)", group: "block", block: true },
  { token: "address", label: "Address (block)", group: "block", block: true },
  { token: "tagline", label: "Tagline (block)", group: "block", block: true },
  { token: "title", label: "Bill title (block)", group: "block", block: true },
  { token: "meta", label: "Order details (block)", group: "block", block: true },
  { token: "staff", label: "Staff lines (block)", group: "block", block: true },
  { token: "items", label: "Items table", group: "block", block: true },
  { token: "totals", label: "Totals", group: "block", block: true },
  { token: "stamp", label: "Paid / unpaid stamp", group: "block", block: true },
  { token: "footer", label: "Footer (block)", group: "block", block: true },
  { token: "vendor", label: "Powered-by line", group: "block", block: true },
  { token: "rule", label: "Divider line —", group: "block", block: true },
  { token: "rule_eq", label: "Divider line ===", group: "block", block: true },

  { token: "restaurant.name", label: "Restaurant name", group: "restaurant" },
  { token: "restaurant.phone", label: "Restaurant phone", group: "restaurant" },
  { token: "restaurant.address", label: "Restaurant address", group: "restaurant" },
  { token: "restaurant.tagline", label: "Restaurant tagline", group: "restaurant" },
  { token: "restaurant.ntn", label: "NTN", group: "restaurant" },
  { token: "restaurant.strn", label: "STRN", group: "restaurant" },

  { token: "bill_title", label: "Bill title text", group: "text" },
  { token: "footer_text", label: "Footer text", group: "text" },

  { token: "order_no", label: "Order number", group: "order" },
  { token: "bill_no", label: "Bill number", group: "order" },
  { token: "table", label: "Table label", group: "order" },
  { token: "partition", label: "Partition / wall", group: "order" },
  { token: "table_name", label: "Table name", group: "order" },
  { token: "date", label: "Date", group: "order" },
  { token: "time", label: "Time", group: "order" },
  { token: "order_type", label: "Order type", group: "order" },
  { token: "payment_mode", label: "Payment mode", group: "order" },
  { token: "payment_status", label: "Payment status", group: "order" },
  { token: "customer_name", label: "Customer / party", group: "order" },
  { token: "customer_phone", label: "Customer phone", group: "order" },

  { token: "gross_total", label: "Gross total", group: "money" },
  { token: "discount", label: "Discount", group: "money" },
  { token: "tax", label: "Tax", group: "money" },
  { token: "tip", label: "Tip", group: "money" },
  { token: "grand_total", label: "Grand total", group: "money" },
  { token: "amount_paid", label: "Amount paid", group: "money" },
  { token: "balance", label: "Balance", group: "money" },
  { token: "change", label: "Change", group: "money" },

  { token: "cashier", label: "Cashier", group: "staff" },
  { token: "ordered_by", label: "Order by", group: "staff" },
  { token: "served_by", label: "Served by", group: "staff" },
  { token: "received_by", label: "Received by", group: "staff" },
];

/**
 * Default customer-bill layout (always in code).
 * Print rendering for each {{block}} lives in receipts.ts — this template is used
 * even when Grapes/seed is empty or unset.
 */
/** SoftInfinity-style layout — logo is restaurant branding; vendor = PixalBotics. */
export const DEFAULT_BILL_TEMPLATE = `{{logo}}
{{name}}
{{phone}}
{{address}}
{{title}}
{{meta}}
{{items}}
{{totals}}
{{staff}}
{{footer}}
{{vendor}}
`;

const BLOCK_TOKENS = new Set(
  BILL_TEMPLATE_FIELDS.filter((f) => f.block).map((f) => f.token)
);

export function normalizeBillTemplate(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_BILL_TEMPLATE;
  let t = raw.replace(/\r\n/g, "\n").trimEnd();
  if (!t.trim()) return DEFAULT_BILL_TEMPLATE;
  // Older saves had staff inside {{meta}} — ensure a dedicated {{staff}} block exists
  if (/\{\{\s*meta\s*\}\}/i.test(t) && !/\{\{\s*staff\s*\}\}/i.test(t)) {
    t = t.replace(/(\{\{\s*meta\s*\}\})/i, "$1\n{{staff}}");
  }
  // SoftInfinity order: Order Taker / Login sit under Cash Received (after totals).
  if (/\{\{\s*staff\s*\}\}/i.test(t) && /\{\{\s*totals\s*\}\}/i.test(t)) {
    t = t.replace(/\n?\{\{\s*staff\s*\}\}\n?/gi, "\n");
    t = t.replace(/(\{\{\s*totals\s*\}\})/i, "$1\n{{staff}}");
  }
  return `${t}\n`;
}

export function isBlockOnlyLine(line: string): string | null {
  const m = line.trim().match(/^\{\{\s*([a-z0-9_.]+)\s*\}\}$/i);
  if (!m) return null;
  const token = m[1]!.toLowerCase();
  return BLOCK_TOKENS.has(token) ? token : null;
}

export type BillTemplateVars = Record<string, string>;

export function fillInlineTokens(line: string, vars: BillTemplateVars): string {
  return line.replace(/\{\{\s*([a-z0-9_.]+)\s*\}\}/gi, (_full, key: string) => {
    const k = key.toLowerCase();
    if (BLOCK_TOKENS.has(k)) return "";
    return vars[k] ?? "";
  });
}
