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

/** 80mm paper ≈ 48 columns (Font A), 58mm ≈ 32. */
export function columnsFor(paperWidth: number) {
  return paperWidth <= 58 ? 32 : 48;
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

  constructor(readonly cols: number) {
    this.raw(ESC, 0x40);
  }

  raw(...bytes: number[]) {
    this.chunks.push(Buffer.from(bytes));
    return this;
  }

  align(a: "left" | "center" | "right") {
    return this.raw(ESC, 0x61, a === "left" ? 0 : a === "center" ? 1 : 2);
  }

  bold(on = true) {
    return this.raw(ESC, 0x45, on ? 1 : 0);
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
    this.textLines.push(this.current);
    this.current = "";
    return this;
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
