import { useMemo } from "react";
import { apiBase, serverOrigin } from "../server";

export type ThermalPreviewData = {
  text: string;
  paperWidth?: number;
  logoUrl?: string | null;
  paidStampUrl?: string | null;
  unpaidStampUrl?: string | null;
  cancelledStampUrl?: string | null;
};

/** Normalize to the same buckets the ESC/POS renderer uses. */
export function normalizePreviewMm(paperWidth?: number) {
  const w = Number(paperWidth) || 80;
  if (w <= 58) return 58;
  if (w <= 72) return 72;
  if (w <= 80) return 80;
  return 112;
}

/** Branding assets are served by the API (/branding/...), not the Vite page origin. */
function brandingUrl(path: string | null | undefined) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path) || path.startsWith("data:")) return path;
  const origin =
    apiBase().replace(/\/api\/?$/, "") ||
    serverOrigin() ||
    (typeof location !== "undefined" ? location.origin : "");
  const withSlash = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${withSlash}`;
}

type Segment =
  | { kind: "text"; value: string }
  | { kind: "tableBadge"; value: string }
  | { kind: "staffBlock"; value: string }
  | { kind: "logo" }
  | { kind: "paid"; size?: "large" | "small" }
  | { kind: "unpaid"; size?: "large" | "small" }
  | { kind: "cancelled" };

type ViewBlock =
  | Segment
  | { kind: "stampOverlay"; stamp: "paid" | "unpaid"; text: string; where: "items" | "totals" };

/** Same characters the thermal printer gets — images stand in for raster markers. */
export function ThermalPreview({
  text,
  paperWidth = 80,
  logoUrl,
  paidStampUrl,
  unpaidStampUrl,
  cancelledStampUrl,
}: ThermalPreviewData) {
  const mm = normalizePreviewMm(paperWidth);
  const blocks = useMemo(() => {
    const parts = splitThermalText(text);
    const withTable = extractTableBadges(parts);
    const withStaff = extractStaffBlocks(withTable);
    const withOverlay = mergeStampOverlays(withStaff);
    const logoPath = brandingUrl(logoUrl);
    if (logoPath && !withOverlay.some((p) => p.kind === "logo") && !text.includes("[LOGO]")) {
      return [{ kind: "logo" as const }, ...withOverlay];
    }
    return withOverlay;
  }, [text, logoUrl]);
  const logo = brandingUrl(logoUrl);
  const paid = brandingUrl(paidStampUrl || "/branding/paid-stamp.png");
  const unpaid = brandingUrl(unpaidStampUrl || "/branding/unpaid-stamp.png");
  const cancelled = brandingUrl(cancelledStampUrl || "/branding/cancelled-stamp.png");

  return (
    <div className="receipt-wrap">
      <div className="thermal-slip-meta no-print">
        <span className="thermal-slip-size">{mm} mm slip</span>
      </div>
      <div
        className={`thermal-slip receipt--mm${mm} thermal-slip--${mm <= 58 ? "narrow" : "wide"}`}
        id="bill-print-area"
        style={{ ["--preview-mm" as string]: `${mm}mm` }}
      >
        {blocks.map((seg, i) => {
          if (seg.kind === "logo") {
            return logo ? (
              <div key={`logo-${logo}`} className="thermal-slip-img thermal-slip-logo">
                <img src={logo} alt="" />
              </div>
            ) : null;
          }
          if (seg.kind === "stampOverlay") {
            const src = seg.stamp === "paid" ? paid : unpaid;
            const label = seg.stamp === "paid" ? "PAID" : "UNPAID";
            return (
              <div
                key={i}
                className={`thermal-slip-items-overlay thermal-slip-stamp-on-${seg.where}`}
              >
                <pre className="thermal-slip-text">{seg.text}</pre>
                {src ? (
                  <div className="thermal-slip-stamp-overlay" aria-hidden>
                    <img src={src} alt="" />
                  </div>
                ) : (
                  <div className="thermal-slip-stamp-overlay thermal-slip-stamp-overlay--text" aria-hidden>
                    {label}
                  </div>
                )}
              </div>
            );
          }
          if (seg.kind === "paid") {
            return paid ? (
              <div key={i} className="thermal-slip-img thermal-slip-stamp thermal-slip-stamp--small">
                <img src={paid} alt="PAID" />
              </div>
            ) : (
              <pre key={i} className="thermal-slip-text">
                *** PAID ***
              </pre>
            );
          }
          if (seg.kind === "unpaid") {
            return unpaid ? (
              <div key={i} className="thermal-slip-img thermal-slip-stamp thermal-slip-stamp--small">
                <img src={unpaid} alt="UNPAID" />
              </div>
            ) : (
              <pre key={i} className="thermal-slip-text">
                *** UNPAID ***
              </pre>
            );
          }
          if (seg.kind === "cancelled") {
            return cancelled ? (
              <div key={i} className="thermal-slip-img thermal-slip-stamp">
                <img src={cancelled} alt="CANCELLED" />
              </div>
            ) : (
              <pre key={i} className="thermal-slip-text">
                *** CANCELLED ***
              </pre>
            );
          }
          if (seg.kind === "tableBadge") {
            return (
              <pre key={i} className="thermal-slip-text thermal-slip-table-badge">
                {seg.value.trim()}
              </pre>
            );
          }
          if (seg.kind === "staffBlock") {
            return (
              <div key={i} className="thermal-slip-staff-block">
                <pre className="thermal-slip-text thermal-slip-staff-block__body">{seg.value}</pre>
              </div>
            );
          }
          return (
            <pre key={i} className="thermal-slip-text">
              {seg.value}
            </pre>
          );
        })}
      </div>
    </div>
  );
}

/** Split "Table No. …" onto its own segment so black badge CSS always applies. */
function extractTableBadges(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const seg of segments) {
    if (seg.kind !== "text") {
      out.push(seg);
      continue;
    }
    const lines = seg.value.replace(/\r\n/g, "\n").split("\n");
    let buf: string[] = [];
    const flush = () => {
      if (!buf.length) return;
      out.push({ kind: "text", value: buf.join("\n") });
      buf = [];
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // SoftInfinity: "Table No." label then next line is the black pill (table name).
      if (/^\s*Table No\.?\s*$/i.test(line) && i + 1 < lines.length) {
        flush();
        out.push({ kind: "tableBadge", value: lines[i + 1]!.trim() || line });
        i += 1;
      } else if (/^\s*Table No\./i.test(line) || /^\s*TABLE NO\./i.test(line)) {
        flush();
        out.push({ kind: "tableBadge", value: line });
      } else {
        buf.push(line);
      }
    }
    flush();
  }
  return out;
}

function extractStaffBlocks(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const seg of segments) {
    if (seg.kind !== "text") {
      out.push(seg);
      continue;
    }
    const lines = seg.value.replace(/\r\n/g, "\n").split("\n");
    let buf: string[] = [];
    const flushBuf = () => {
      if (!buf.length) return;
      out.push({ kind: "text", value: buf.join("\n") });
      buf = [];
    };
    let i = 0;
    while (i < lines.length) {
      const isRule = /^[-=]{3,}\s*$/.test(lines[i]!.trim());
      const nextIsStaff = i + 1 < lines.length && /^\s*STAFF\s*$/i.test(lines[i + 1]!.trim());
      if (isRule && nextIsStaff) {
        flushBuf();
        const staffLines: string[] = [lines[i]!];
        i += 1;
        while (i < lines.length) {
          staffLines.push(lines[i]!);
          if (i > 0 && /^[-=]{3,}\s*$/.test(lines[i]!.trim()) && staffLines.length > 2) {
            i += 1;
            break;
          }
          i += 1;
        }
        out.push({ kind: "staffBlock", value: staffLines.join("\n").trim() });
        continue;
      }
      buf.push(lines[i]!);
      i += 1;
    }
    flushBuf();
  }
  return out;
}

/**
 * Sit PAID/UNPAID on the charges (totals) block when stamp follows totals text.
 * Fallback: stamp before item lines → overlay on items.
 */
function mergeStampOverlays(segments: Segment[]): ViewBlock[] {
  const out: ViewBlock[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const next = segments[i + 1];

    // text then stamp → peel totals/charges only (not the whole slip)
    if (seg.kind === "text" && next && (next.kind === "paid" || next.kind === "unpaid")) {
      const { before, totals } = peelTotalsBlock(seg.value);
      if (totals.trim()) {
        if (before) out.push({ kind: "text", value: before });
        out.push({
          kind: "stampOverlay",
          stamp: next.kind,
          text: totals,
          where: "totals",
        });
        i += 1;
        continue;
      }
    }

    // stamp then items text (legacy)
    const isStamp = seg.kind === "paid" || seg.kind === "unpaid";
    if (isStamp && next?.kind === "text") {
      const { items, rest } = peelItemLines(next.value);
      if (items.trim()) {
        out.push({
          kind: "stampOverlay",
          stamp: seg.kind,
          text: items,
          where: "items",
        });
        if (rest) out.push({ kind: "text", value: rest });
        i += 1;
        continue;
      }
    }

    out.push(seg);
  }
  return out;
}

/** Split trailing Gross/Grand/Discount… lines so stamp sits only on charges. */
function peelTotalsBlock(text: string): { before: string; totals: string } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const isTotals = (l: string) =>
    /^(Gross Total|Net Total|Discount|DISC|Tax\b|Tip\b|Grand Total|Cash Received|Amount paid|Paid\b|Change|Balance|Payment:|SUBTOTAL|TOTAL:?)/i.test(
      l.trim(),
    );
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isTotals(lines[i]!)) {
      start = i;
      break;
    }
  }
  if (start < 0) return { before: text, totals: "" };
  // Include a blank line just above totals if present
  if (start > 0 && lines[start - 1]!.trim() === "") start -= 1;
  return {
    before: lines.slice(0, start).join("\n"),
    totals: lines.slice(start).join("\n"),
  };
}

function peelItemLines(text: string): { items: string; rest: string } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let cut = lines.findIndex((l) =>
    /^(SUBTOTAL:?|TOTAL:?|Gross Total:?|Net Total:?|Discount:?|DISC:?|GRAND TOTAL:?|Amount paid|Paid\b|Balance|Change|Payment|Mode\b)/i.test(
      l.trim(),
    ),
  );
  if (cut < 0) cut = lines.length;
  let itemEnd = cut;
  if (itemEnd > 0 && /^[-=]{3,}$/.test(lines[itemEnd - 1]!.trim())) itemEnd -= 1;
  return {
    items: lines.slice(0, itemEnd).join("\n"),
    rest: lines.slice(itemEnd).join("\n"),
  };
}

function splitThermalText(text: string): Segment[] {
  const lines = (text || "").replace(/\r\n/g, "\n").split("\n");
  const out: Segment[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (!buf.length) return;
    out.push({ kind: "text", value: buf.join("\n") });
    buf = [];
  };
  for (const line of lines) {
    if (line === "[LOGO]") {
      flush();
      out.push({ kind: "logo" });
    } else if (line === "[PAID STAMP]") {
      flush();
      out.push({ kind: "paid", size: "large" });
    } else if (line === "[PAID STAMP SMALL]") {
      flush();
      out.push({ kind: "paid", size: "small" });
    } else if (line === "[UNPAID STAMP]") {
      flush();
      out.push({ kind: "unpaid", size: "large" });
    } else if (line === "[UNPAID STAMP SMALL]") {
      flush();
      out.push({ kind: "unpaid", size: "small" });
    } else if (line === "[CANCELLED STAMP]") {
      flush();
      out.push({ kind: "cancelled" });
    } else {
      buf.push(line);
    }
  }
  flush();
  return out;
}
