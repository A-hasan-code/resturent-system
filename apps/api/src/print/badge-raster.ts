import type { RasterImage } from "./logo-raster";
import { centerRaster } from "./logo-raster";

/**
 * 5×7 glyphs — each value is 5 column bitmasks, bit0 = top row.
 * Tuned for “TABLE NO. …” on 203dpi thermal heads.
 */
const GLYPHS: Record<string, number[]> = {
  " ": [0, 0, 0, 0, 0],
  "-": [0, 0, 0x08, 0, 0],
  ".": [0, 0, 0, 0, 0x40],
  "0": [0x3e, 0x51, 0x49, 0x45, 0x3e],
  "1": [0, 0x42, 0x7f, 0x40, 0],
  "2": [0x42, 0x61, 0x51, 0x49, 0x46],
  "3": [0x21, 0x41, 0x45, 0x4b, 0x31],
  "4": [0x18, 0x14, 0x12, 0x7f, 0x10],
  "5": [0x27, 0x45, 0x45, 0x45, 0x39],
  "6": [0x3c, 0x4a, 0x49, 0x49, 0x30],
  "7": [0x01, 0x71, 0x09, 0x05, 0x03],
  "8": [0x36, 0x49, 0x49, 0x49, 0x36],
  "9": [0x06, 0x49, 0x49, 0x29, 0x1e],
  A: [0x7e, 0x11, 0x11, 0x11, 0x7e],
  B: [0x7f, 0x49, 0x49, 0x49, 0x36],
  C: [0x3e, 0x41, 0x41, 0x41, 0x22],
  D: [0x7f, 0x41, 0x41, 0x22, 0x1c],
  E: [0x7f, 0x49, 0x49, 0x49, 0x41],
  F: [0x7f, 0x09, 0x09, 0x09, 0x01],
  G: [0x3e, 0x41, 0x49, 0x49, 0x7a],
  H: [0x7f, 0x08, 0x08, 0x08, 0x7f],
  I: [0x41, 0x41, 0x7f, 0x41, 0x41],
  J: [0x20, 0x40, 0x41, 0x3f, 0x01],
  K: [0x7f, 0x08, 0x14, 0x22, 0x41],
  L: [0x7f, 0x40, 0x40, 0x40, 0x40],
  M: [0x7f, 0x02, 0x0c, 0x02, 0x7f],
  N: [0x7f, 0x04, 0x08, 0x10, 0x7f],
  O: [0x3e, 0x41, 0x41, 0x41, 0x3e],
  P: [0x7f, 0x09, 0x09, 0x09, 0x06],
  Q: [0x3e, 0x41, 0x51, 0x21, 0x5e],
  R: [0x7f, 0x09, 0x19, 0x29, 0x46],
  S: [0x46, 0x49, 0x49, 0x49, 0x31],
  T: [0x01, 0x01, 0x7f, 0x01, 0x01],
  U: [0x3f, 0x40, 0x40, 0x40, 0x3f],
  V: [0x1f, 0x20, 0x40, 0x20, 0x1f],
  W: [0x3f, 0x40, 0x38, 0x40, 0x3f],
  X: [0x63, 0x14, 0x08, 0x14, 0x63],
  Y: [0x07, 0x08, 0x70, 0x08, 0x07],
  Z: [0x61, 0x51, 0x49, 0x45, 0x43],
};

const COL_W = 5;
const ROW_H = 7;

export type TableBadgeOpts = {
  /** When false, only the table name (SoftInfinity pill). Default: include "TABLE NO. ". */
  withPrefix?: boolean;
};

/**
 * White letters cut out of a solid black bar (GS v 0 raster).
 * Avoids GS B inverse, which on many heads prints dim / black-on-black.
 */
export function tableBadgeRaster(
  label: string,
  paperDots: number,
  opts?: TableBadgeOpts,
): RasterImage {
  const name = asciiUpper(label) || "WALK-IN";
  const withPrefix = opts?.withPrefix !== false;
  const raw = withPrefix ? `TABLE NO. ${name}` : name;
  const chars = [...raw].map((c) => GLYPHS[c] || GLYPHS[" "]!);

  // Prefer large glyphs (scale 4) so kitchen / SoftInfinity badge is readable.
  let scale = 4;
  let gap = 2;
  let padX = 12;
  let padY = 8;
  const fits = (s: number, g: number, px: number) => {
    const contentW = chars.length * (COL_W * s + g) - g;
    return contentW + px * 2 <= paperDots;
  };
  if (!fits(scale, gap, padX)) {
    scale = 3;
    padX = 10;
    padY = 6;
  }
  if (!fits(scale, gap, padX)) {
    scale = 2;
    gap = 1;
    padX = 8;
    padY = 5;
  }

  const contentW = chars.length * (COL_W * scale + gap) - gap;
  const contentH = ROW_H * scale;
  const widthDots = Math.min(
    paperDots,
    Math.max(contentW + padX * 2, Math.floor(paperDots * 0.92)),
  );
  const height = contentH + padY * 2;
  const widthBytes = Math.ceil(widthDots / 8);
  const data = Buffer.alloc(widthBytes * height, 0xff); // solid black

  let x = Math.max(padX, Math.floor((widthDots - contentW) / 2));
  const y0 = padY;
  for (const cols of chars) {
    for (let cx = 0; cx < COL_W; cx++) {
      const bits = cols[cx] ?? 0;
      for (let cy = 0; cy < ROW_H; cy++) {
        if (!(bits & (1 << cy))) continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            clearDot(data, widthBytes, widthDots, height, x + cx * scale + sx, y0 + cy * scale + sy);
          }
        }
      }
    }
    x += COL_W * scale + gap;
  }

  return centerRaster({ widthBytes, height, data }, paperDots);
}

function clearDot(
  data: Buffer,
  widthBytes: number,
  widthDots: number,
  height: number,
  x: number,
  y: number,
) {
  if (x < 0 || y < 0 || x >= widthDots || y >= height) return;
  data[y * widthBytes + (x >> 3)] &= ~(0x80 >> (x & 7));
}

function asciiUpper(s: string) {
  return s
    .replace(/[·•]/g, " ")
    .replace(/[—–]/g, "-")
    .toUpperCase()
    .replace(/[^A-Z0-9 .\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 28);
}
