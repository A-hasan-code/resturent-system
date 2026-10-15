import { inflateSync } from "zlib";
import { existsSync, readFileSync } from "fs";
import { decode as decodeJpeg } from "jpeg-js";

export type RasterImage = { widthBytes: number; height: number; data: Buffer };

export type LogoRasterOpts = {
  centerOnPaperDots?: number;
  /** Draw a black box around the logo (receipt header). */
  frame?: boolean;
  maxHeight?: number;
  /**
   * logo = dithered photo/brand art for thermal.
   * stamp = solid black ink (fills speckles / converts colored stamps).
   */
  mode?: "logo" | "stamp";
};

/** Build an ESC/POS GS v 0 raster from a PNG/JPEG for thermal printers. */
export function logoRasterFromFile(
  path: string | null | undefined,
  maxDots: number,
  opts?: LogoRasterOpts
): RasterImage | null {
  if (!path || !existsSync(path)) return null;
  if (!/\.(png|jpe?g)$/i.test(path)) return null;
  try {
    const png = loadRgba(path);
    if (!png) return null;
    const mode = opts?.mode ?? "logo";
    const max = Math.max(96, Math.min(maxDots, 576));
    const maxH = opts?.maxHeight ?? (mode === "stamp" ? max : Math.round(max * 0.95));
    let prepared = trimContent(png);
    if (mode === "stamp") {
      prepared = solidifyInk(prepared);
    } else {
      // Maroon/gold seals → black ink on white paper (otherwise the whole circle prints black).
      prepared = normalizeBrandLogo(prepared);
    }
    let raster =
      mode === "stamp" || isNearMono(prepared)
        ? toSolidRaster(prepared, max, maxH)
        : toDitheredRaster(prepared, max, maxH);
    // Square frames look wrong on circular restaurant seals — only when asked.
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

function loadRgba(path: string): { width: number; height: number; rgba: Buffer } | null {
  const buf = readFileSync(path);
  if (path.toLowerCase().endsWith(".png")) return decodePng(buf);
  if (/\.jpe?g$/i.test(path)) {
    const decoded = decodeJpeg(buf, { useTArray: true });
    if (!(decoded.width > 0 && decoded.height > 0)) return null;
    return { width: decoded.width, height: decoded.height, rgba: Buffer.from(decoded.data) };
  }
  return null;
}

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

/**
 * Force stamp ink to pure black on white and close tiny holes from grunge textures
 * so 203dpi thermal heads print a solid mark instead of speckles.
 */
function solidifyInk(img: { width: number; height: number; rgba: Buffer }) {
  const { width: w, height: h } = img;
  const mask = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const a = img.rgba[o + 3];
    if (a < 20) {
      mask[i] = 0;
      continue;
    }
    const r = img.rgba[o];
    const g = img.rgba[o + 1];
    const b = img.rgba[o + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    // Any saturated color (red stamps) or dark gray counts as ink.
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    mask[i] = lum < 200 || sat > 40 ? 1 : 0;
  }
  // 1px morphological close: fill single-pixel white holes inside ink.
  const closed = Buffer.from(mask);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (mask[i]) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (mask[(y + dy) * w + (x + dx)]) n++;
        }
      }
      if (n >= 5) closed[i] = 1;
    }
  }
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const v = closed[i] ? 0 : 255;
    rgba[o] = rgba[o + 1] = rgba[o + 2] = v;
    rgba[o + 3] = 255;
  }
  return { width: w, height: h, rgba };
}

/** Dark maroon/gold seals print as a black blob unless inverted to black-on-white. */
function normalizeBrandLogo(img: { width: number; height: number; rgba: Buffer }) {
  const { width: w, height: h, rgba } = img;
  let sum = 0;
  let n = 0;
  const x0 = Math.floor(w * 0.2);
  const x1 = Math.floor(w * 0.8);
  const y0 = Math.floor(h * 0.2);
  const y1 = Math.floor(h * 0.8);
  for (let y = y0; y < y1; y += 3) {
    for (let x = x0; x < x1; x += 3) {
      const o = (y * w + x) * 4;
      if (rgba[o + 3] < 20) continue;
      sum += 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2];
      n++;
    }
  }
  const avg = n ? sum / n : 255;
  const invert = avg < 110;
  const out = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const a = rgba[o + 3];
    let lum = 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2];
    if (a < 20) lum = 255;
    else if (invert) lum = 255 - lum;
    const v = lum < 145 ? 0 : 255;
    out[o] = out[o + 1] = out[o + 2] = v;
    out[o + 3] = 255;
  }
  return { width: w, height: h, rgba: out };
}

function isNearMono(img: { width: number; height: number; rgba: Buffer }) {
  let mid = 0;
  const step = Math.max(1, Math.floor((img.width * img.height) / 4000));
  for (let i = 0; i < img.width * img.height; i += step) {
    const o = i * 4;
    const lum = 0.299 * img.rgba[o] + 0.587 * img.rgba[o + 1] + 0.114 * img.rgba[o + 2];
    if (lum > 40 && lum < 220) mid++;
  }
  const samples = Math.ceil((img.width * img.height) / step);
  return mid / samples < 0.12;
}

/** Black rectangle around a logo so the paper matches the boxed logo on screen. */
function frameRaster(img: RasterImage, pad = 4, thick = 2): RasterImage {
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

function sampleSize(img: { width: number; height: number }, maxDots: number, maxHeight: number) {
  const scale = Math.min(1, maxDots / img.width, maxHeight / img.height);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  return { scale, w, h };
}

function sampleLum(img: { width: number; height: number; rgba: Buffer }, x: number, y: number, scale: number) {
  const sx = Math.min(img.width - 1, Math.floor((x + 0.5) / scale));
  const sy = Math.min(img.height - 1, Math.floor((y + 0.5) / scale));
  const i = (sy * img.width + sx) * 4;
  const a = img.rgba[i + 3] / 255;
  return (0.299 * img.rgba[i] + 0.587 * img.rgba[i + 1] + 0.114 * img.rgba[i + 2]) * a + 255 * (1 - a);
}

/** Hard threshold — best for stamps and line art. */
function toSolidRaster(img: { width: number; height: number; rgba: Buffer }, maxDots: number, maxHeight: number): RasterImage {
  const { scale, w, h } = sampleSize(img, maxDots, maxHeight);
  const widthBytes = Math.ceil(w / 8);
  const data = Buffer.alloc(widthBytes * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (sampleLum(img, x, y, scale) < 170) data[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { widthBytes, height: h, data };
}

/** Floyd–Steinberg dithering so restaurant logos keep shape on 1-bit thermal heads. */
function toDitheredRaster(img: { width: number; height: number; rgba: Buffer }, maxDots: number, maxHeight: number): RasterImage {
  const { scale, w, h } = sampleSize(img, maxDots, maxHeight);
  const widthBytes = Math.ceil(w / 8);
  const data = Buffer.alloc(widthBytes * h);
  const gray = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) gray[y * w + x] = sampleLum(img, x, y, scale);
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = gray[i];
      const val = old < 160 ? 0 : 255;
      const err = old - val;
      if (val === 0) data[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
      if (x + 1 < w) gray[i + 1] += (err * 7) / 16;
      if (y + 1 < h) {
        if (x > 0) gray[i + w - 1] += (err * 3) / 16;
        gray[i + w] += (err * 5) / 16;
        if (x + 1 < w) gray[i + w + 1] += (err * 1) / 16;
      }
    }
  }
  return { widthBytes, height: h, data };
}
