import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "fs";
import { extname, join } from "path";
import { PrismaService } from "../prisma/prisma.service";
import { dataDir } from "../config/env";
import { parseDayStart } from "../common/business-day";
import { AuthUser } from "../common/decorators";
import { buildThermalLogoPng } from "../print/thermal-logo";

export type PerHeadPackageSaved = {
  menuItemId: string;
  /** Qty in the menu item's sellUnit. */
  qty: number;
  /** Waiter chooses qty when adding per head (at most one). */
  variable: boolean;
};

function parsePerHeadPackage(raw: string | undefined): PerHeadPackageSaved[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: PerHeadPackageSaved[] = [];
    for (const row of parsed) {
      if (!row || typeof row !== "object") continue;
      const menuItemId = String((row as PerHeadPackageSaved).menuItemId || "").trim();
      const qty = Number((row as PerHeadPackageSaved).qty);
      if (!menuItemId || !Number.isFinite(qty) || qty <= 0) continue;
      out.push({
        menuItemId,
        qty: Math.round(qty * 1000) / 1000,
        variable: !!(row as PerHeadPackageSaved).variable,
      });
    }
    const variableIdx = out.findIndex((x) => x.variable);
    return out.map((x, i) => ({ ...x, variable: variableIdx >= 0 && i === variableIdx }));
  } catch {
    return [];
  }
}

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

  /** Absolute path to uploaded logo (PNG/JPG for thermal raster; not SVG). */
  logoFilePath(): string | null {
    const dir = this.brandingDir();
    if (!existsSync(dir)) return null;
    const files = readdirSync(dir);
    const pick =
      files.find((f) => /^logo\.png$/i.test(f)) ||
      files.find((f) => /^logo\.jpe?g$/i.test(f)) ||
      files.find((f) => /^logo\.webp$/i.test(f));
    return pick ? join(dir, pick) : null;
  }

  /** Keep restaurant.logo URL matching the file on disk (fixes stale .png after JPG upload). */
  async syncLogoUrl(): Promise<string | null> {
    const path = this.logoFilePath();
    if (!path) {
      await this.set("restaurant.logo", "");
      return null;
    }
    const name = path.split(/[/\\]/).pop()!;
    const current = await this.get("restaurant.logo", "");
    // Prefer the on-disk file name (e.g. thermal logo.png after converting a dark JPEG seal).
    if (!current.includes(name) || /logo\.jpe?g/i.test(current)) {
      const url = `/branding/${name}?v=${Date.now()}`;
      await this.set("restaurant.logo", url);
      return url;
    }
    return current || `/branding/${name}`;
  }

  /** Bundled PAID stamp, refreshed when the shipped graphic changes. */
  paidStampFilePath(): string | null {
    return installBundledAsset("paid-stamp.png");
  }

  /** Bundled UNPAID stamp, refreshed when the shipped graphic changes. */
  unpaidStampFilePath(): string | null {
    return installBundledAsset("unpaid-stamp.png");
  }

  /** Bundled CANCELLED stamp for kitchen cancel slips. */
  cancelledStampFilePath(): string | null {
    return installBundledAsset("cancelled-stamp.png");
  }

  async restaurant() {
    await this.syncLogoUrl();
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

  /**
   * Close time is the server time saved in Settings (business day start).
   * Only a manual close stops new orders. Open works at any time, so a mistaken close can be undone.
   * closedAt / closedBy is the record admin keeps of when the hotel was closed.
   */
  async hotelStatus() {
    const s = await this.getMany("hotel.");
    const close = await this.dayStart();
    const manuallyClosed = (s["hotel.manuallyClosed"] ?? "0") === "1";
    return {
      closeTime: close.label,
      manuallyClosed,
      closedAt: s["hotel.closedAt"] || null,
      closedBy: s["hotel.closedBy"] || null,
      openedAt: s["hotel.openedAt"] || null,
      openedBy: s["hotel.openedBy"] || null,
      acceptingOrders: !manuallyClosed,
    };
  }

  async closeHotel(user: AuthUser) {
    this.assertHotelManager(user);
    await this.set("hotel.manuallyClosed", "1");
    await this.set("hotel.closedAt", new Date().toISOString());
    await this.set("hotel.closedBy", user.name);
    return this.hotelStatus();
  }

  async openHotel(user: AuthUser) {
    this.assertHotelManager(user);
    await this.set("hotel.manuallyClosed", "0");
    await this.set("hotel.openedAt", new Date().toISOString());
    await this.set("hotel.openedBy", user.name);
    return this.hotelStatus();
  }

  private assertHotelManager(user: AuthUser) {
    if (user.roleCode !== "ADMIN" && user.roleCode !== "SYSTEM_MANAGER") {
      throw new ForbiddenException("Only Admin or System Manager can open or close the hotel");
    }
  }

  /** Cover charge / person-per-head (Settings → Billing). */
  async perHead() {
    const s = await this.getMany("billing.");
    const amount = Number(s["billing.perHeadAmount"] ?? "100");
    const packageRaw = parsePerHeadPackage(s["billing.perHeadPackage"]);
    const ids = packageRaw.map((p) => p.menuItemId);
    const menus =
      ids.length === 0
        ? []
        : await this.prisma.menuItem.findMany({
            where: { id: { in: ids }, active: true },
            select: { id: true, name: true, sellUnit: true, kind: true, minQty: true, maxQty: true, qtyStep: true, allowCustomQty: true, listPortionQty: true },
          });
    const byId = new Map(menus.map((m) => [m.id, m]));
    const items = packageRaw
      .map((p) => {
        const m = byId.get(p.menuItemId);
        if (!m) return null;
        return {
          menuItemId: m.id,
          name: m.name,
          sellUnit: m.sellUnit,
          kind: m.kind,
          qty: p.qty,
          variable: p.variable,
          minQty: Number(m.minQty) || 0,
          maxQty: m.maxQty != null ? Number(m.maxQty) : null,
          qtyStep: m.qtyStep != null ? Number(m.qtyStep) : null,
          allowCustomQty: m.allowCustomQty !== false,
          listPortionQty: Number(m.listPortionQty) || 1,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);
    return {
      enabled: (s["billing.perHeadEnabled"] ?? "1") !== "0",
      amount: Number.isFinite(amount) && amount >= 0 ? amount : 100,
      label: (s["billing.perHeadLabel"] || "Per head").trim() || "Per head",
      items,
    };
  }

  /** Admin saves which menu items come with per-head (fixed qty; at most one variable). */
  async savePerHeadPackage(items: { menuItemId: string; qty: number; variable: boolean }[]) {
    if (items.length > 12) throw new BadRequestException("At most 12 per-head package items");
    const variableCount = items.filter((i) => i.variable).length;
    if (variableCount > 1) throw new BadRequestException("Only one package item can be variable (waiter chooses qty)");
    const ids = [...new Set(items.map((i) => i.menuItemId))];
    if (ids.length !== items.length) throw new BadRequestException("Duplicate menu items in per-head package");
    if (ids.length) {
      const menus = await this.prisma.menuItem.findMany({
        where: { id: { in: ids }, active: true },
        select: { id: true, kind: true },
      });
      if (menus.length !== ids.length) throw new BadRequestException("All package items must be active menu items");
    }
    const cleaned = items.map((i) => ({
      menuItemId: i.menuItemId,
      qty: Math.round(Math.max(0.001, Number(i.qty) || 0) * 1000) / 1000,
      variable: !!i.variable,
    }));
    await this.set("billing.perHeadPackage", JSON.stringify(cleaned));
    return this.perHead();
  }

  async saveLogo(file: { originalname: string; buffer: Buffer; mimetype: string; size: number }) {
    if (!file?.buffer?.length) throw new BadRequestException("No image uploaded");
    if (file.size > 2 * 1024 * 1024) throw new BadRequestException("Logo must be under 2 MB");
    const ext = extname(file.originalname || "").toLowerCase() || mimeExt(file.mimetype);
    if (!LOGO_EXTS.has(ext)) throw new BadRequestException("Use PNG, JPG, WEBP or SVG");
    const dir = this.brandingDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    for (const f of readdirSync(dir)) {
      if (f.startsWith("logo.") || f.startsWith("logo-color.")) unlinkSync(join(dir, f));
    }
    // Keep original colour file for reference; thermal print always uses logo.png.
    writeFileSync(join(dir, `logo-color${ext === ".svg" ? ".png" : ext}`), file.buffer);
    const thermal = ext === ".svg" ? null : buildThermalLogoPng(file.buffer, ext);
    if (thermal) writeFileSync(join(dir, "logo.png"), thermal);
    else writeFileSync(join(dir, ext === ".svg" ? "logo.svg" : `logo${ext}`), file.buffer);
    const url = `/branding/logo.png?v=${Date.now()}`;
    await this.set("restaurant.logo", existsSync(join(dir, "logo.png")) ? url : `/branding/logo${ext}?v=${Date.now()}`);
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

function bundledAsset(fileName: string): string | null {
  const candidates = [
    join(__dirname, "..", "..", "assets", fileName), // dist/system → apps/api/assets
    join(__dirname, "..", "assets", fileName),
    join(process.cwd(), "assets", fileName),
    join(process.cwd(), "apps", "api", "assets", fileName),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/** Copy a shipped PNG into /branding when it is missing or the bundle was replaced. */
function installBundledAsset(fileName: string): string | null {
  const bundled = bundledAsset(fileName);
  const dest = join(dataDir("branding"), fileName);
  try {
    if (bundled) {
      const src = statSync(bundled);
      const stale =
        !existsSync(dest) || statSync(dest).size !== src.size || src.mtimeMs > statSync(dest).mtimeMs + 500;
      if (stale) copyFileSync(bundled, dest);
    }
  } catch {
    /* ignore first-run copy errors */
  }
  if (existsSync(dest)) return dest;
  return bundled;
}

try {
  installBundledAsset("paid-stamp.png");
  installBundledAsset("unpaid-stamp.png");
  installBundledAsset("cancelled-stamp.png");
} catch {
  /* ignore first-run copy errors */
}
