/** Print a count sheet (write remaining by hand, then enter closing).
 * Uses a hidden iframe so browsers do not block it as a pop-up.
 */

export type CountSheetCol = {
  key: string;
  label: string;
  width?: string;
};

export type CountSheetRow = {
  name: string;
  category: string;
  unit: string;
  values: Record<string, string | number>;
};

export function printCountSheet(opts: {
  title: string;
  subtitle?: string;
  dateLabel: string;
  columns: CountSheetCol[];
  rows: CountSheetRow[];
  blankCols?: string[];
}) {
  const blank = new Set(opts.blankCols ?? ["remaining"]);
  const colHtml = opts.columns
    .map((c) => `<th style="width:${c.width || "auto"}">${escapeHtml(c.label)}</th>`)
    .join("");
  const body = opts.rows
    .map((r) => {
      const cells = opts.columns
        .map((c) => {
          if (blank.has(c.key)) {
            return `<td class="blank">&nbsp;</td>`;
          }
          const v = r.values[c.key];
          return `<td>${escapeHtml(v == null || v === "" ? "—" : String(v))}</td>`;
        })
        .join("");
      return `<tr>
        <td><strong>${escapeHtml(r.name)}</strong><div class="cat">${escapeHtml(r.category)}</div></td>
        <td>${escapeHtml(r.unit)}</td>
        ${cells}
      </tr>`;
    })
    .join("");

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(opts.title)}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    .meta { color: #444; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #333; padding: 6px 7px; vertical-align: top; }
    th { background: #f0f0f0; text-align: left; font-size: 11px; }
    .cat { color: #666; font-size: 10px; margin-top: 2px; }
    td.blank { height: 22px; min-width: 4.5rem; }
    .foot { margin-top: 14px; font-size: 11px; color: #444; }
    .sign { display: flex; gap: 2rem; margin-top: 18px; }
    .sign div { flex: 1; border-top: 1px solid #333; padding-top: 4px; }
    @media print {
      button { display: none !important; }
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(opts.title)}</h1>
  <div class="meta">${escapeHtml(opts.subtitle || "")}${opts.subtitle ? " · " : ""}${escapeHtml(opts.dateLabel)}</div>
  <p class="meta">Write remaining / count in blank boxes, then enter closing in the system.</p>
  <table>
    <thead>
      <tr>
        <th>Item</th>
        <th>Unit</th>
        ${colHtml}
      </tr>
    </thead>
    <tbody>${body || `<tr><td colspan="${2 + opts.columns.length}">No lines</td></tr>`}</tbody>
  </table>
  <div class="sign">
    <div>Counted by</div>
    <div>Checked by</div>
    <div>Time</div>
  </div>
  <p class="foot">Print before closing · fill by hand · enter in system after count</p>
</body>
</html>`;

  return printHtmlInFrame(html);
}

/** Print HTML without opening a new tab (avoids pop-up blockers). */
function printHtmlInFrame(html: string): boolean {
  const existing = document.getElementById("hotel-count-sheet-print");
  if (existing) existing.remove();

  const iframe = document.createElement("iframe");
  iframe.id = "hotel-count-sheet-print";
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;";
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const doc = iframe.contentDocument || win?.document;
  if (!win || !doc) {
    iframe.remove();
    return false;
  }

  doc.open();
  doc.write(html);
  doc.close();

  const cleanup = () => {
    try {
      iframe.remove();
    } catch {
      /* ignore */
    }
  };

  const doPrint = () => {
    try {
      win.focus();
      win.print();
    } catch {
      cleanup();
      return;
    }
    // Remove after print dialog closes (or shortly if afterprint is unsupported).
    win.addEventListener("afterprint", cleanup, { once: true });
    setTimeout(cleanup, 60_000);
  };

  // Give the iframe a tick to finish parsing styles before print.
  if (doc.readyState === "complete") {
    setTimeout(doPrint, 50);
  } else {
    iframe.onload = () => setTimeout(doPrint, 50);
  }
  return true;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
