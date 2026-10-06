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
  const sep = withSlash.includes("?") ? "&" : "?";
  return `${origin}${withSlash}${sep}v=5`;
}

type Segment =
  | { kind: "text"; value: string }
  | { kind: "logo" }
  | { kind: "paid"; size?: "large" | "small" }
  | { kind: "unpaid"; size?: "large" | "small" }
  | { kind: "cancelled" };

type ViewBlock =
  | Segment
  | { kind: "itemsOverlay"; stamp: "paid" | "unpaid"; text: string };

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
    const withOverlay = mergeItemOverlays(parts);
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
              <div key={i} className="thermal-slip-img thermal-slip-logo">
                <img src={logo} alt="" />
              </div>
            ) : null;
          }
          if (seg.kind === "itemsOverlay") {
            const src = seg.stamp === "paid" ? paid : unpaid;
            const label = seg.stamp === "paid" ? "PAID" : "UNPAID";
            return (
              <div key={i} className="thermal-slip-items-overlay">
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
            ) : null;
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
          return (
            <pre key={i} className={`thermal-slip-text${thermalTableBadgeClass(seg.value)}`}>
              {seg.value}
            </pre>
          );
        })}
      </div>
    </div>
  );
}

/** Only style a one-line table badge — never a whole slip body that mentions "Table No.". */
function thermalTableBadgeClass(block: string) {
  const lines = block.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim());
  if (lines.length === 1 && /^\s*Table No\./i.test(lines[0])) return " thermal-slip-table-badge";
  return "";
}

/** Place the main PAID/UNPAID stamp as an overlay on the item lines only (not totals). */
function mergeItemOverlays(segments: Segment[]): ViewBlock[] {
  const out: ViewBlock[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isMainStamp =
      (seg.kind === "paid" || seg.kind === "unpaid") && seg.size !== "small";
    if (isMainStamp) {
      const next = segments[i + 1];
      if (next?.kind === "text") {
        const { items, rest } = peelItemLines(next.value);
        out.push({ kind: "itemsOverlay", stamp: seg.kind, text: items || next.value });
        if (rest) out.push({ kind: "text", value: rest });
        i++;
        continue;
      }
    }
    out.push(seg);
  }
  return out;
}

/** Keep totals / cash / footer out of the stamp overlay. */
function peelItemLines(text: string): { items: string; rest: string } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let cut = lines.findIndex((l) =>
    /^(SUBTOTAL:?|TOTAL:?|Gross Total:?|Net Total:?|Discount:?|DISC:?|GRAND TOTAL:?|Amount paid|Paid\b|Balance|Change|Payment|Mode\b)/i.test(
      l.trim(),
    ),
  );
  if (cut < 0) cut = lines.length;
  let itemEnd = cut;
  if (itemEnd > 0 && /^[-=]{3,}$/.test(lines[itemEnd - 1].trim())) itemEnd -= 1;
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
