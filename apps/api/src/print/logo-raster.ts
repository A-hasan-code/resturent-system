import { inflateSync } from "zlib";
import { existsSync, readFileSync } from "fs";

export type RasterImage = { widthBytes: number; height: number; data: Buffer };

/** Build an ESC/POS GS v 0 raster from a PNG logo (other formats return null). */
export function logoRasterFromFile(
  path: string | null | undefined,
  maxDots: number,
  opts?: { centerOnPaperDots?: number; frame?: boolean; maxHeight?: number }
): RasterImage | null {
  if (!path || !existsSync(path)) return null;
  if (!path.toLowerCase().endsWith(".png")) return null;
  try {
    const png = decodePng(readFileSync(path));
    if (!png) return null;
    const max = Math.max(96, Math.min(maxDots, 576));
    let raster = toRaster(trimContent(png), max, opts?.maxHeight ?? 180);
    if (opts?.frame) raster = frameRaster(raster);
    if (opts?.centerOnPaperDots) return centerRaster(raster, opts.centerOnPaperDots);
    return raster;
  } catch {
    return null;
  }
}

/** Pad a raster with empty left columns so it prints centered on the paper. */
export function centerRaster(img: RasterImage, paperDots: number): RasterImage {
  const imgDots = img.widthBytes * 8;
  const paperBytes = Math.ceil(Math.max(paperDots, imgDots) / 8);
  if (paperBytes <= img.widthBytes) return img;
  const padBytes = Math.floor((paperBytes - img.widthBytes) / 2);
  const data = Buffer.alloc(paperBytes * img.height);
  for (let y = 0; y < img.height; y++) {
    img.data.copy(data, y * paperBytes + padBytes, y * img.widthBytes, (y + 1) * img.widthBytes);
  }
  return { widthBytes: paperBytes, height: img.height, data };
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function decodePng(buf: Buffer): { width: number; height: number; rgba: Buffer } | null {
  // Do not use "ascii": Node strips the high bit, so byte 0x89 never matches.
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) return null;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let palette: Buffer | null = null;
  const idats: Buffer[] = [];
  let offset = 8;
  while (offset + 8 <= buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    offset += 12 + len;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) return null; // compression / filter / interlace
    } else if (type === "PLTE") palette = Buffer.from(data);
    else if (type === "IDAT") idats.push(Buffer.from(data));
    else if (type === "IEND") break;
  }
  if (!(width > 0 && height > 0 && width <= 2000 && height <= 2000)) return null;
  if (bitDepth !== 8) return null;
  const inflated = inflateSync(Buffer.concat(idats));
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
  if (!channels) return null;
  const stride = width * channels;
  const rgba = Buffer.alloc(width * height * 4);
  let src = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = inflated[src++];
    const row = Buffer.alloc(stride);
    inflated.copy(row, 0, src, src + stride);
    src += stride;
    unfilter(filter, row, prev, channels);
    prev = row;
    for (let x = 0; x < width; x++) {
      const i = x * channels;
      const o = (y * width + x) * 4;
      if (colorType === 0) {
        rgba[o] = rgba[o + 1] = rgba[o + 2] = row[i];
        rgba[o + 3] = 255;
      } else if (colorType === 2) {
        rgba[o] = row[i];
        rgba[o + 1] = row[i + 1];
        rgba[o + 2] = row[i + 2];
        rgba[o + 3] = 255;
      } else if (colorType === 3) {
        const p = row[i] * 3;
        if (!palette || p + 2 >= palette.length) return null;
        rgba[o] = palette[p];
        rgba[o + 1] = palette[p + 1];
        rgba[o + 2] = palette[p + 2];
        rgba[o + 3] = 255;
      } else if (colorType === 4) {
        rgba[o] = rgba[o + 1] = rgba[o + 2] = row[i];
        rgba[o + 3] = row[i + 1];
      } else {
        rgba[o] = row[i];
        rgba[o + 1] = row[i + 1];
        rgba[o + 2] = row[i + 2];
        rgba[o + 3] = row[i + 3];
      }
    }
  }
  return { width, height, rgba };
}

function unfilter(filter: number, row: Buffer, prev: Buffer, bpp: number) {
  for (let i = 0; i < row.length; i++) {
    const left = i >= bpp ? row[i - bpp] : 0;
    const up = prev[i];
    const upLeft = i >= bpp ? prev[i - bpp] : 0;
    if (filter === 1) row[i] = (row[i] + left) & 255;
    else if (filter === 2) row[i] = (row[i] + up) & 255;
    else if (filter === 3) row[i] = (row[i] + ((left + up) >> 1)) & 255;
    else if (filter === 4) row[i] = (row[i] + paeth(left, up, upLeft)) & 255;
    else if (filter !== 0) throw new Error("bad png filter");
  }
}

function paeth(a: number, b: number, c: number) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Drop empty margins so a stamp fills the print area instead of shrinking inside whitespace. */
function trimContent(img: { width: number; height: number; rgba: Buffer }) {
  const ink = (i: number) => {
    if (img.rgba[i + 3] < 16) return false;
    const lum = 0.299 * img.rgba[i] + 0.587 * img.rgba[i + 1] + 0.114 * img.rgba[i + 2];
    return lum < 245;
  };
  let top = 0;
  let bottom = img.height - 1;
  let left = 0;
  let right = img.width - 1;
  const rowInk = (y: number) => {
    for (let x = 0; x < img.width; x++) if (ink((y * img.width + x) * 4)) return true;
    return false;
  };
  const colInk = (x: number) => {
    for (let y = top; y <= bottom; y++) if (ink((y * img.width + x) * 4)) return true;
    return false;
  };
  while (top < bottom && !rowInk(top)) top++;
  while (bottom > top && !rowInk(bottom)) bottom--;
  while (left < right && !colInk(left)) left++;
  while (right > left && !colInk(right)) right--;
  const pad = 2;
  top = Math.max(0, top - pad);
  left = Math.max(0, left - pad);
  bottom = Math.min(img.height - 1, bottom + pad);
  right = Math.min(img.width - 1, right + pad);
  const w = right - left + 1;
  const h = bottom - top + 1;
  if (w < 8 || h < 8 || (w === img.width && h === img.height)) return img;
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    img.rgba.copy(rgba, y * w * 4, ((top + y) * img.width + left) * 4, ((top + y) * img.width + right + 1) * 4);
  }
  return { width: w, height: h, rgba };
}

/** Black rectangle around a logo so the paper matches the boxed logo on screen. */
function frameRaster(img: RasterImage, pad = 6, thick = 2): RasterImage {
  const srcDots = img.widthBytes * 8;
  const extra = (pad + thick) * 2;
  const widthDots = srcDots + extra;
  const widthBytes = Math.ceil(widthDots / 8);
  const height = img.height + extra;
  const data = Buffer.alloc(widthBytes * height);
  const ox = pad + thick;
  const oy = pad + thick;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < srcDots; x++) {
      const on = img.data[y * img.widthBytes + (x >> 3)] & (0x80 >> (x & 7));
      if (!on) continue;
      const nx = x + ox;
      data[(y + oy) * widthBytes + (nx >> 3)] |= 0x80 >> (nx & 7);
    }
  }
  const x0 = pad;
  const y0 = pad;
  const x1 = ox + srcDots + thick - 1;
  const y1 = oy + img.height + thick - 1;
  const set = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= widthDots || y >= height) return;
    data[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
  };
  for (let t = 0; t < thick; t++) {
    for (let x = x0; x <= x1; x++) {
      set(x, y0 + t);
      set(x, y1 - t);
    }
    for (let y = y0; y <= y1; y++) {
      set(x0 + t, y);
      set(x1 - t, y);
    }
  }
  return { widthBytes, height, data };
}

function toRaster(img: { width: number; height: number; rgba: Buffer }, maxDots: number, maxHeight = 180): RasterImage {
  const scale = Math.min(1, maxDots / img.width, maxHeight / img.height);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const widthBytes = Math.ceil(w / 8);
  const data = Buffer.alloc(widthBytes * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor((x + 0.5) / scale));
      const sy = Math.min(img.height - 1, Math.floor((y + 0.5) / scale));
      const i = (sy * img.width + sx) * 4;
      const a = img.rgba[i + 3] / 255;
      const lum = (0.299 * img.rgba[i] + 0.587 * img.rgba[i + 1] + 0.114 * img.rgba[i + 2]) * a + 255 * (1 - a);
      if (lum < 160) data[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { widthBytes, height: h, data };
}
