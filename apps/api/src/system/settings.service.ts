import { BadRequestException, Injectable } from "@nestjs/common";
import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "fs";
import { extname, join } from "path";
import { PrismaService } from "../prisma/prisma.service";
import { dataDir } from "../config/env";
import { parseDayStart } from "../common/business-day";

export const RESTAURANT_KEYS = [
  "restaurant.name",
  "restaurant.tagline",
  "restaurant.address",
  "restaurant.phone",
  "restaurant.accent",
  "restaurant.logo",
] as const;

const ACCENT_RE = /^#[0-9a-fA-F]{6}$/;
const LOGO_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg"]);

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(key: string, fallback = ""): Promise<string> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    return row?.value ?? fallback;
  }

  async set(key: string, value: string) {
    await this.prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  async getMany(prefix: string): Promise<Record<string, string>> {
    const rows = await this.prisma.setting.findMany({
      where: { key: { startsWith: prefix } },
    });
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  brandingDir() {
    return dataDir("branding");
  }

  /** Absolute path to the uploaded logo file, if present. */
  logoFilePath(): string | null {
    const dir = this.brandingDir();
    if (!existsSync(dir)) return null;
    const file = readdirSync(dir).find((f) => f.startsWith("logo."));
    return file ? join(dir, file) : null;
  }

  /** Ensure bundled PAID stamp is available under /branding and return its path. */
  paidStampFilePath(): string | null {
    const dir = this.brandingDir();
    mkdirSync(dir, { recursive: true });
    const dest = join(dir, "paid-stamp.png");
    if (!existsSync(dest)) {
      const bundled = bundledPaidStampPath();
      if (bundled) copyFileSync(bundled, dest);
    }
    return existsSync(dest) ? dest : bundledPaidStampPath();
  }

  async restaurant() {
    const s = await this.getMany("restaurant.");
    const logo = s["restaurant.logo"] || "";
    return {
      name: s["restaurant.name"] || "PixalBotics Restaurant",
      tagline: s["restaurant.tagline"] || "",
      address: s["restaurant.address"] || "",
      phone: s["restaurant.phone"] || "",
      accent: ACCENT_RE.test(s["restaurant.accent"] || "") ? s["restaurant.accent"] : "#0f7a6c",
      logoUrl: logo || null,
      dayStart: parseDayStart(s["restaurant.dayStart"]).label,
    };
  }

  async dayStart() {
    return parseDayStart(await this.get("restaurant.dayStart", "11:00"));
  }

  /** Cover charge / person-per-head (Settings → Billing). */
  async perHead() {
    const s = await this.getMany("billing.");
    const amount = Number(s["billing.perHeadAmount"] ?? "100");
    return {
      enabled: (s["billing.perHeadEnabled"] ?? "1") !== "0",
      amount: Number.isFinite(amount) && amount >= 0 ? amount : 100,
      label: (s["billing.perHeadLabel"] || "Per head").trim() || "Per head",
    };
  }

  async saveLogo(file: { originalname: string; buffer: Buffer; mimetype: string; size: number }) {
    if (!file?.buffer?.length) throw new BadRequestException("No image uploaded");
    if (file.size > 2 * 1024 * 1024) throw new BadRequestException("Logo must be under 2 MB");
    const ext = extname(file.originalname || "").toLowerCase() || mimeExt(file.mimetype);
    if (!LOGO_EXTS.has(ext)) throw new BadRequestException("Use PNG, JPG, WEBP or SVG");
    const dir = this.brandingDir();
    for (const f of readdirSync(dir)) {
      if (f.startsWith("logo.")) unlinkSync(join(dir, f));
    }
    const name = `logo${ext}`;
    writeFileSync(join(dir, name), file.buffer);
    const url = `/branding/${name}?v=${Date.now()}`;
    await this.set("restaurant.logo", url);
    return this.restaurant();
  }

  async clearLogo() {
    const dir = this.brandingDir();
    if (existsSync(dir)) {
      for (const f of readdirSync(dir)) {
        if (f.startsWith("logo.")) unlinkSync(join(dir, f));
      }
    }
    await this.set("restaurant.logo", "");
    return this.restaurant();
  }
}

function mimeExt(mime: string) {
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/svg+xml") return ".svg";
  return "";
}

function bundledPaidStampPath(): string | null {
  const candidates = [
    join(__dirname, "..", "..", "assets", "paid-stamp.png"), // dist/system → apps/api/assets
    join(__dirname, "..", "assets", "paid-stamp.png"),
    join(process.cwd(), "assets", "paid-stamp.png"),
    join(process.cwd(), "apps", "api", "assets", "paid-stamp.png"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

// Ensure folder exists when the module loads (installers / first run).
mkdirSync(dataDir("branding"), { recursive: true });
try {
  const dest = join(dataDir("branding"), "paid-stamp.png");
  if (!existsSync(dest)) {
    const bundled = bundledPaidStampPath();
    if (bundled) copyFileSync(bundled, dest);
  }
} catch {
  /* ignore first-run copy errors */
}
