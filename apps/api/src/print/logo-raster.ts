import { inflateSync } from "zlib";
import { existsSync, readFileSync } from "fs";

export type RasterImage = { widthBytes: number; height: number; data: Buffer };

/** Build an ESC/POS GS v 0 raster from a PNG logo (other formats return null). */
export function logoRasterFromFile(
  path: string | null | undefined,
  maxDots: number,
  opts?: { centerOnPaperDots?: number }
): RasterImage | null {
  if (!path || !existsSync(path)) return null;
  if (!path.toLowerCase().endsWith(".png")) return null;
  try {
    const png = decodePng(readFileSync(path));
    if (!png) return null;
    const raster = toRaster(png, Math.max(96, Math.min(maxDots, 576)));
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

function decodePng(buf: Buffer): { width: number; height: number; rgba: Buffer } | null {
  if (buf.length < 8 || buf.toString("ascii", 0, 8) !== "\x89PNG\r\n\x1a\n") return null;
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

function toRaster(img: { width: number; height: number; rgba: Buffer }, maxDots: number): RasterImage {
  const scale = Math.min(1, maxDots / img.width, 180 / img.height);
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
