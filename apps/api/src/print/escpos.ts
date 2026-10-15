const ESC = 0x1b;
const GS = 0x1d;

const REPLACEMENTS: Array<[RegExp, string]> = [
  [/[·•]/g, "-"],
  [/[—–]/g, "-"],
  [/[“”]/g, '"'],
  [/[‘’]/g, "'"],
  [/…/g, "..."],
  [/×/g, "x"],
];

function ascii(s: string) {
  let out = s;
  for (const [re, rep] of REPLACEMENTS) out = out.replace(re, rep);
  return out.replace(/[^\x20-\x7E\n]/g, "?");
}

/**
 * Thermal paper column counts (Font A — fixed cell width, reliable columns):
 * 58mm (≈50–58 roll) ≈ 32, 72mm ≈ 42, 80mm ≈ 48, 112mm ≈ 64.
 *
 * Prefer Font A for customer bills: Font B + Font-A column math leaves a right
 * margin and many cheap printers also widen bold glyphs, so Qty/Rate/Amount drift.
 */
export function normalizePaperWidth(paperWidth: number) {
  const w = Number(paperWidth) || 80;
  if (w <= 58) return 58;
  if (w <= 72) return 72;
  if (w <= 80) return 80;
  return 112;
}

export function columnsFor(paperWidth: number) {
  const w = normalizePaperWidth(paperWidth);
  if (w <= 58) return 32;
  if (w <= 72) return 42;
  if (w <= 80) return 48;
  return 64;
}

/** Dot width used when centering logos / stamps on the roll. */
export function paperDotsFor(paperWidth: number) {
  const w = normalizePaperWidth(paperWidth);
  if (w <= 58) return 384;
  if (w <= 72) return 448;
  if (w <= 80) return 512;
  return 640;
}

/** Narrow roll (50/58mm) uses a compact slip; 80mm+ uses the full reference layout. */
export function isNarrowPaper(paperWidth: number) {
  return normalizePaperWidth(paperWidth) <= 58;
}

/**
 * Minimal ESC/POS builder. Keeps a plain-text mirror so FILE printers and the
 * UI preview show exactly what the thermal printer gets.
 */
export class EscPos {
  private chunks: Buffer[] = [];
  private textLines: string[] = [];
  private current = "";
  private wide = false;
  private alignment: "left" | "center" | "right" = "left";

  constructor(readonly cols: number) {
    this.raw(ESC, 0x40);
  }

  raw(...bytes: number[]) {
    this.chunks.push(Buffer.from(bytes));
    return this;
  }

  align(a: "left" | "center" | "right") {
    this.alignment = a;
    return this.raw(ESC, 0x61, a === "left" ? 0 : a === "center" ? 1 : 2);
  }

  bold(on = true) {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }

  /** Font A (default) or smaller Font B — better density on customer bills. */
  font(which: "A" | "B" = "A") {
    return this.raw(ESC, 0x4d, which === "B" ? 1 : 0);
  }

  /** White-on-black (GS B) — avoid on table labels; many printers fill solid black. */
  inverse(on = true) {
    return this.raw(GS, 0x42, on ? 1 : 0);
  }

  /** Double width/height text; halves usable columns while wide. */
  big(on = true) {
    this.wide = on;
    return this.raw(GS, 0x21, on ? 0x11 : 0x00);
  }

  text(s: string) {
    const clean = ascii(s);
    this.chunks.push(Buffer.from(clean, "latin1"));
    this.current += clean;
    return this;
  }

  line(s = "") {
    this.text(s);
    this.chunks.push(Buffer.from("\n", "latin1"));
    // Mirror ESC/POS alignment in plain text so UI preview matches the printer.
    this.textLines.push(this.plainAligned(this.current));
    this.current = "";
    return this;
  }

  private plainAligned(s: string) {
    const w = this.width();
    if (!s || s.length >= w || this.alignment === "left") return s;
    if (this.alignment === "center") {
      const pad = Math.floor((w - s.length) / 2);
      return " ".repeat(pad) + s;
    }
    return s.padStart(w);
  }

  width() {
    return this.wide ? Math.floor(this.cols / 2) : this.cols;
  }

  rule(ch = "-") {
    return this.line(ch.repeat(this.width()));
  }

  /** Left text and right text on one line; left wraps if too long. */
  pair(left: string, right: string) {
    const w = this.width();
    const room = w - right.length - 1;
    const parts = wrap(left, Math.max(room, 8));
    parts.forEach((p, i) => {
      if (i === parts.length - 1) this.line(p.padEnd(w - right.length) + right);
      else this.line(p);
    });
    return this;
  }

  /**
   * Fixed columns on one line. Widths are packed with no gaps so headers and
   * numbers always share the same character columns (critical for thermal preview).
   */
  columns(parts: string[], widths: number[]) {
    const w = this.width();
    const cols = widths.map((x) => Math.max(1, x));
    const sum = cols.reduce((a, b) => a + b, 0);
    if (sum < w) cols[0] += w - sum;
    else if (sum > w) cols[0] = Math.max(8, cols[0] - (sum - w));
    let line = "";
    parts.forEach((p, i) => {
      const width = cols[i] ?? 8;
      const s = ascii(p ?? "").slice(0, width);
      line += i === 0 ? s.padEnd(width) : s.padStart(width);
    });
    if (line.length < w) line = line.padEnd(w);
    return this.line(line.slice(0, w));
  }

  /** A simple bordered one-line box (Cash Received style). */
  boxLine(label: string, value: string) {
    const w = this.width();
    const inner = w - 2;
    const text = `${label} ${value}`.slice(0, inner);
    const pad = Math.max(0, inner - text.length);
    const left = Math.floor(pad / 2);
    const right = pad - left;
    this.line(`+${"-".repeat(inner)}+`);
    this.line(`|${" ".repeat(left)}${text}${" ".repeat(right)}|`);
    this.line(`+${"-".repeat(inner)}+`);
    return this;
  }

  wrapped(s: string, indent = 0) {
    for (const p of wrap(s, this.width() - indent)) this.line(" ".repeat(indent) + p);
    return this;
  }

  feed(n = 3) {
    for (let i = 0; i < n; i++) this.textLines.push("");
    return this.raw(ESC, 0x64, n);
  }

  cut() {
    return this.raw(GS, 0x56, 0x42, 0x00);
  }

  beep() {
    return this.raw(ESC, 0x42, 0x02, 0x02);
  }

  /** Plain-text marker for UI preview when raster bytes are not sent (e.g. logo file unreadable). */
  rasterMarker(label = "[LOGO]") {
    this.textLines.push(label);
    return this;
  }

  /** GS v 0 raster bitmap (monochrome). Also mirrors a label in plain text. */
  raster(img: { widthBytes: number; height: number; data: Buffer }, label = "[LOGO]") {
    const xL = img.widthBytes & 0xff;
    const xH = (img.widthBytes >> 8) & 0xff;
    const yL = img.height & 0xff;
    const yH = (img.height >> 8) & 0xff;
    this.raw(GS, 0x76, 0x30, 0x00, xL, xH, yL, yH);
    this.chunks.push(Buffer.from(img.data));
    this.textLines.push(label);
    return this;
  }

  buffer() {
    return Buffer.concat(this.chunks);
  }

  plain() {
    return [...this.textLines, this.current].join("\n").trimEnd() + "\n";
  }
}

export function wrap(s: string, width: number): string[] {
  const words = ascii(s).split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= width) cur += " " + w;
    else {
      out.push(cur);
      cur = w;
    }
    while (cur.length > width) {
      out.push(cur.slice(0, width));
      cur = cur.slice(width);
    }
  }
  if (cur || !out.length) out.push(cur);
  return out;
}
