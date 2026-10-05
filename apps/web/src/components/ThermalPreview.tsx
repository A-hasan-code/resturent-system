import { useMemo } from "react";
import { serverOrigin } from "../server";

export type ThermalPreviewData = {
  text: string;
  paperWidth?: number;
  logoUrl?: string | null;
  paidStampUrl?: string | null;
  unpaidStampUrl?: string | null;
  cancelledStampUrl?: string | null;
};

function brandingUrl(path: string | null | undefined) {
  if (!path) return null;
  const origin = serverOrigin() || (typeof location !== "undefined" ? location.origin : "");
  const withSlash = path.startsWith("/") ? path : `/${path}`;
  const sep = withSlash.includes("?") ? "&" : "?";
  return `${origin}${withSlash}${sep}v=2`;
}

type Segment =
  | { kind: "text"; value: string }
  | { kind: "logo" }
  | { kind: "paid" }
  | { kind: "unpaid" }
  | { kind: "cancelled" };

/** Same characters the thermal printer gets — images stand in for raster markers. */
export function ThermalPreview({
  text,
  paperWidth = 80,
  logoUrl,
  paidStampUrl,
  unpaidStampUrl,
  cancelledStampUrl,
}: ThermalPreviewData) {
  const mm =
    paperWidth <= 58 ? 58 : paperWidth <= 72 ? 72 : paperWidth <= 80 ? 80 : 112;
  const segments = useMemo(() => splitThermalText(text), [text]);
  const logo = brandingUrl(logoUrl);
  const paid = brandingUrl(paidStampUrl || "/branding/paid-stamp.png");
  const unpaid = brandingUrl(unpaidStampUrl || "/branding/unpaid-stamp.png");
  const cancelled = brandingUrl(cancelledStampUrl || "/branding/cancelled-stamp.png");

  return (
    <div className="receipt-wrap">
      <div
        className={`thermal-slip receipt--mm${mm}`}
        id="bill-print-area"
        style={{ ["--preview-mm" as string]: `${mm}mm` }}
      >
        {segments.map((seg, i) => {
          if (seg.kind === "logo") {
            return logo ? (
              <div key={i} className="thermal-slip-img thermal-slip-logo">
                <img src={logo} alt="" />
              </div>
            ) : null;
          }
          if (seg.kind === "paid") {
            return paid ? (
              <div key={i} className="thermal-slip-img thermal-slip-stamp">
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
              <div key={i} className="thermal-slip-img thermal-slip-stamp">
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
            <pre key={i} className="thermal-slip-text">
              {seg.value}
            </pre>
          );
        })}
      </div>
    </div>
  );
}

function splitThermalText(text: string): Segment[] {
  const lines = (text || "").replace(/\r\n/g, "\n").split("\n");
  const out: Segment[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (!buf.length) return;
    // Keep trailing blank lines so spacing matches the printer feed.
    out.push({ kind: "text", value: buf.join("\n") });
    buf = [];
  };
  for (const line of lines) {
    if (line === "[LOGO]") {
      flush();
      out.push({ kind: "logo" });
    } else if (line === "[PAID STAMP]") {
      flush();
      out.push({ kind: "paid" });
    } else if (line === "[UNPAID STAMP]") {
      flush();
      out.push({ kind: "unpaid" });
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
