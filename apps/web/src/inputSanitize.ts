/**
 * Characters never allowed in typed fields (qty, notes, names, etc.).
 * Includes: - + " ; | ! @ # $ % ^ & * ( ) _
 */
const FORBIDDEN_CHARS = /[-+"';|!@#$%^&*()_]+/g;

/** Strip forbidden symbols from free-text inputs. */
export function sanitizePlainText(value: string): string {
  return value.replace(FORBIDDEN_CHARS, "");
}

/**
 * Positive quantity / amount only: digits and at most one `.`
 * Blocks -, +, e, and all forbidden symbols.
 */
export function sanitizeQty(value: string): string {
  const cleaned = value.replace(/[^0-9.]/g, "");
  const dot = cleaned.indexOf(".");
  if (dot === -1) return cleaned;
  return cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, "");
}
