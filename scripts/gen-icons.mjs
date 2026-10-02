// Generates the PWA + desktop PNG icons without any image library.
// Usage: node scripts/gen-icons.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const TEAL = [15, 122, 108];
const DARK = [16, 24, 32];
const WHITE = [255, 255, 255];

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x / size, y / size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function inRoundRect(x, y, r) {
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

// Teal tile, dark plate (circle) and a white "H" mark.
function icon(x, y) {
  if (!inRoundRect(x, y, 0.2)) return [0, 0, 0, 0];
  const mix = y;
  const bg = TEAL.map((c, i) => Math.round(c * (1 - mix * 0.35) + DARK[i] * mix * 0.35));
  const d = Math.hypot(x - 0.5, y - 0.5);
  if (d < 0.34 && d > 0.3) return [...WHITE, 255];
  const inH =
    (x > 0.36 && x < 0.43 && y > 0.32 && y < 0.68) ||
    (x > 0.57 && x < 0.64 && y > 0.32 && y < 0.68) ||
    (x > 0.36 && x < 0.64 && y > 0.465 && y < 0.535);
  if (inH) return [...WHITE, 255];
  return [...bg, 255];
}

const out = [
  ["apps/web/public/icons/icon-192.png", 192],
  ["apps/web/public/icons/icon-512.png", 512],
  ["apps/desktop/assets/icon.png", 512],
];
for (const [rel, size] of out) {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, png(size, icon));
  console.log("wrote", rel);
}

// Windows .ico for the installer: PNG-compressed entries (supported since Vista).
function ico(sizes) {
  const images = sizes.map((s) => png(s, icon));
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((s, i) => {
    const e = 6 + i * 16;
    header[e] = s >= 256 ? 0 : s;
    header[e + 1] = s >= 256 ? 0 : s;
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(images[i].length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += images[i].length;
  });
  return Buffer.concat([header, ...images]);
}

const icoFile = join(root, "packaging/windows/icon.ico");
mkdirSync(dirname(icoFile), { recursive: true });
writeFileSync(icoFile, ico([16, 32, 48, 256]));
console.log("wrote packaging/windows/icon.ico");
