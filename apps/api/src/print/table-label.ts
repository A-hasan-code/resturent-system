/** Split "Hall · T-5" style labels into partition + table for bills / KOT. */
export function splitTableLabel(
  tableNo: string | null | undefined,
  partitionName?: string | null,
  tableName?: string | null
): { partition: string | null; table: string | null } {
  const part = (partitionName || "").trim() || null;
  const tbl = (tableName || "").trim() || null;
  if (part || tbl) {
    return { partition: part, table: tbl || (tableNo || "").trim() || null };
  }
  const raw = (tableNo || "").trim();
  if (!raw) return { partition: null, table: null };
  const m = raw.match(/^(.+?)\s*[·•\-–—]\s*(.+)$/);
  if (m) return { partition: m[1].trim(), table: m[2].trim() };
  return { partition: null, table: raw };
}
