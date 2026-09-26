function escapeCsv(value: unknown) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Excel-friendly CSV (UTF-8 BOM). */
export function downloadExcelCsv(
  filename: string,
  rows: Record<string, unknown>[]
) {
  if (!rows.length) {
    const blob = new Blob(["\ufeffNo data"], {
      type: "text/csv;charset=utf-8;",
    });
    trigger(blob, filename);
    return;
  }
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escapeCsv(r[h])).join(",")),
  ];
  const blob = new Blob(["\ufeff" + lines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  trigger(blob, filename.endsWith(".csv") ? filename : `${filename}.csv`);
}

function trigger(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
