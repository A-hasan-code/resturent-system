import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api";
import { apiBase, hasServerAddress, onConnStatus } from "./server";

export type Branding = {
  name: string;
  tagline: string;
  address: string;
  phone: string;
  logoUrl: string | null;
  accent: string;
};

const DEFAULT: Branding = {
  name: "Hotel System",
  tagline: "Offline POS · Store · Kitchen",
  address: "",
  phone: "",
  logoUrl: null,
  accent: "#0f7a6c",
};

type BrandCtx = {
  brand: Branding;
  refresh: () => Promise<void>;
  logoSrc: string | null;
};

const Ctx = createContext<BrandCtx | null>(null);

function mixHex(hex: string, withWhite: number) {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * withWhite);
  const to = (c: number) => c.toString(16).padStart(2, "0");
  return `#${to(mix(n(0)))}${to(mix(n(2)))}${to(mix(n(4)))}`;
}

function darkenHex(hex: string, amount: number) {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  const d = (c: number) => Math.max(0, Math.round(c * (1 - amount)));
  const to = (c: number) => c.toString(16).padStart(2, "0");
  return `#${to(d(n(0)))}${to(d(n(2)))}${to(d(n(4)))}`;
}

export function applyAccent(accent: string) {
  const root = document.documentElement;
  const a = /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : DEFAULT.accent;
  root.style.setProperty("--accent", a);
  root.style.setProperty("--accent-2", mixHex(a, 0.12));
  root.style.setProperty("--accent-soft", mixHex(a, 0.88));
  root.style.setProperty("--sidebar", darkenHex(a, 0.82));
  root.style.setProperty("--sidebar-2", darkenHex(a, 0.72));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", a);
}

function absoluteLogo(path: string | null | undefined) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path) || path.startsWith("data:")) return path;
  const origin = apiBase().replace(/\/api\/?$/, "") || (typeof location !== "undefined" ? location.origin : "");
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}

export function BrandProvider({ children }: { children: ReactNode }) {
  const [brand, setBrand] = useState<Branding>(DEFAULT);

  const refresh = useCallback(async () => {
    if (!hasServerAddress()) return;
    try {
      // Public on /system/info so login / overlay also get the logo and theme.
      const info = await api<{ restaurant?: Branding }>("/system/info");
      if (info.restaurant) {
        const next = { ...DEFAULT, ...info.restaurant };
        setBrand(next);
        applyAccent(next.accent);
        return;
      }
    } catch {
      /* fall through */
    }
    try {
      const s = await api<{ restaurant: Branding }>("/system/settings");
      const next = { ...DEFAULT, ...s.restaurant };
      setBrand(next);
      applyAccent(next.accent);
    } catch {
      /* offline */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const off = onConnStatus((st) => {
      if (st === "ok") void refresh();
    });
    return () => {
      off();
    };
  }, [refresh]);

  const value = useMemo(
    () => ({ brand, refresh, logoSrc: absoluteLogo(brand.logoUrl) }),
    [brand, refresh]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBrand() {
  const v = useContext(Ctx);
  if (!v) throw new Error("BrandProvider missing");
  return v;
}

export const THEME_PRESETS: { id: string; label: string; accent: string }[] = [
  { id: "teal", label: "Teal", accent: "#0f7a6c" },
  { id: "navy", label: "Navy", accent: "#1e4d7b" },
  { id: "forest", label: "Forest", accent: "#1f6b45" },
  { id: "wine", label: "Wine", accent: "#8b2e3b" },
  { id: "amber", label: "Amber", accent: "#a05a12" },
  { id: "slate", label: "Slate", accent: "#3d4f5f" },
];
