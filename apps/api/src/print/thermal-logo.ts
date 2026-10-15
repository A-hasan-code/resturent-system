import { deflateSync } from "zlib";
import { decode as decodeJpeg } from "jpeg-js";
import { inflateSync } from "zlib";

/**
 * Convert an uploaded restaurant logo into a clean black-on-white PNG
 * suitable for 203dpi thermal printers (handles dark maroon seals).
 */
export function buildThermalLogoPng(buf: Buffer, ext: string): Buffer | null {
  const rgba = loadRgba(buf, ext);
  if (!rgba) return null;
  const prepared = toThermalSeal(rgba);
  return encodePng(prepared.width, prepared.height, prepared.rgba);
}

function loadRgba(buf: Buffer, ext: string): { width: number; height: number; rgba: Buffer } | null {
  const e = ext.toLowerCase();
  if (e === ".png") return decodePng(buf);
  if (e === ".jpg" || e === ".jpeg") {
    try {
      const decoded = decodeJpeg(buf, { useTArray: true });
      if (!(decoded.width > 0 && decoded.height > 0)) return null;
      return { width: decoded.width, height: decoded.height, rgba: Buffer.from(decoded.data) };
    } catch {
      return null;
    }
  }
  return null;
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function decodePng(buf: Buffer): { width: number; height: number; rgba: Buffer } | null {
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
      if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) return null;
    } else if (type === "PLTE") palette = Buffer.from(data);
    else if (type === "IDAT") idats.push(Buffer.from(data));
    else if (type === "IEND") break;
  }
  if (!(width > 0 && height > 0 && width <= 2000 && height <= 2000)) return null;
  if (bitDepth !== 8) return null;
  const inflated = inflateSync(Buffer.concat(idats));
  const channels =
    colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
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
    else if (filter === 4) {
      const p = left + up - upLeft;
      const pa = Math.abs(p - left);
      const pb = Math.abs(p - up);
      const pc = Math.abs(p - upLeft);
      row[i] = (row[i] + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) & 255;
    } else if (filter !== 0) throw new Error("bad png filter");
  }
}

function toThermalSeal(img: { width: number; height: number; rgba: Buffer }) {
  const { width: w, height: h, rgba } = img;
  let sum = 0;
  let n = 0;
  for (let y = Math.floor(h * 0.2); y < Math.floor(h * 0.8); y += 3) {
    for (let x = Math.floor(w * 0.2); x < Math.floor(w * 0.8); x += 3) {
      const o = (y * w + x) * 4;
      if (rgba[o + 3] < 20) continue;
      sum += 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2];
      n++;
    }
  }
  const invert = n > 0 && sum / n < 110;
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const rad = Math.min(w, h) / 2 - 1;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = i * 4;
      const inside = (x - cx) * (x - cx) + (y - cy) * (y - cy) <= rad * rad;
      if (!inside) {
        out[o] = out[o + 1] = out[o + 2] = 255;
        out[o + 3] = 255;
        continue;
      }
      let lum = 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2];
      if (rgba[o + 3] < 20) lum = 255;
      else if (invert) lum = 255 - lum;
      const v = lum < 150 ? 0 : 255;
      out[o] = out[o + 1] = out[o + 2] = v;
      out[o + 3] = 255;
    }
  }
  return { width: w, height: h, rgba: out };
}

function crc32(buf: Buffer) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  const out = Buffer.alloc(4);
  out.writeUInt32BE(~c >>> 0);
  return out;
}

function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type);
  const body = Buffer.concat([t, data]);
  return Buffer.concat([len, body, crc32(body)]);
}

function encodePng(width: number, height: number, rgba: Buffer) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
