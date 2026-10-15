import { apiBase, hasServerAddress, reportLost } from "./server";

export type User = {
  id: string;
  name: string;
  username: string;
  roleCode: string;
  permissions: string[];
};

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: Record<string, unknown>;
  constructor(message: string, status = 400, extras?: { code?: string; details?: Record<string, unknown> }) {
    super(message);
    this.status = status;
    this.code = extras?.code;
    this.details = extras?.details;
  }
}

const OFFLINE_MESSAGE = "Cannot reach the server. Check the network connection.";

function token() {
  return localStorage.getItem("token");
}

export async function api<T>(
  path: string,
  opts: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string>),
  };
  const t = token();
  if (t) headers.Authorization = `Bearer ${t}`;

  let res: Response;
  try {
    if (!hasServerAddress()) throw new Error("No server found yet");
    res = await fetch(`${apiBase()}${path}`, { ...opts, headers });
  } catch {
    // Server moved or went offline: wait for it to be found again, then retry once.
    const back = await Promise.race([
      reportLost(),
      new Promise<boolean>((r) => setTimeout(() => r(false), 20000)),
    ]);
    if (!back) throw new ApiError(OFFLINE_MESSAGE, 0);
    try {
      res = await fetch(`${apiBase()}${path}`, { ...opts, headers });
    } catch {
      throw new ApiError(OFFLINE_MESSAGE, 0);
    }
  }

  if (res.status === 401 && t && !path.startsWith("/auth/login") && !path.startsWith("/auth/pin")) {
    window.dispatchEvent(new Event("hotel:unauthorized"));
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const raw = body.message;
    let msg: string;
    let code: string | undefined;
    let details: Record<string, unknown> | undefined;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      msg = String((raw as { message?: string }).message || body.error || "Request failed");
      code = (raw as { code?: string }).code || body.code;
      details = raw as Record<string, unknown>;
    } else {
      msg =
        body.error ||
        (Array.isArray(raw) ? raw.join(", ") : raw) ||
        res.statusText ||
        "Request failed";
      code = typeof body.code === "string" ? body.code : undefined;
      if (body.message && typeof body.message === "object") {
        details = body.message as Record<string, unknown>;
      }
    }
    throw new ApiError(String(msg), res.status, { code, details });
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

/** Multipart upload (logo, etc.). Do not set Content-Type — the browser sets the boundary. */
export async function uploadApi<T>(path: string, form: FormData): Promise<T> {
  const headers: Record<string, string> = {};
  const t = token();
  if (t) headers.Authorization = `Bearer ${t}`;
  if (!hasServerAddress()) throw new ApiError(OFFLINE_MESSAGE, 0);
  const res = await fetch(`${apiBase()}${path}`, { method: "POST", headers, body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(String(body.error || body.message || "Upload failed"), res.status);
  }
  return res.json();
}

/** Download a file the API returns (Excel/CSV, backup sheet). */
export async function downloadApi(path: string, filename: string) {
  const headers: Record<string, string> = {};
  const t = token();
  if (t) headers.Authorization = `Bearer ${t}`;
  if (!hasServerAddress()) throw new ApiError(OFFLINE_MESSAGE, 0);
  const res = await fetch(`${apiBase()}${path}`, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(String(body.error || body.message || "Download failed"), res.status);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Fetch a protected binary (e.g. purchase bill photo) as an object URL. Caller must revoke. */
export async function authBlobUrl(path: string): Promise<string> {
  const headers: Record<string, string> = {};
  const t = token();
  if (t) headers.Authorization = `Bearer ${t}`;
  if (!hasServerAddress()) throw new ApiError(OFFLINE_MESSAGE, 0);
  const res = await fetch(`${apiBase()}${path}`, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(String(body.error || body.message || "Failed to open file"), res.status);
  }
  return URL.createObjectURL(await res.blob());
}

export function money(n: number) {
  return `Rs ${Number(n || 0).toLocaleString("en-PK", {
    maximumFractionDigits: 2,
  })}`;
}

/** Finished pot weight is stored as grams in the API — show as kg in UI. */
export function gramsToKg(grams: number) {
  const g = Number(grams) || 0;
  return Math.round((g / 1000) * 1000) / 1000;
}

export function kgToGrams(kg: number) {
  const k = Number(kg) || 0;
  return Math.round(k * 1000 * 1000) / 1000;
}

/** e.g. 5 → "5 kg", 0.4 → "0.4 kg" */
export function formatKg(grams: number) {
  const kg = gramsToKg(grams);
  const text = Number.isInteger(kg) ? String(kg) : String(kg);
  return `${text} kg`;
}

export function unitLabel(u: string) {
  const map: Record<string, string> = {
    KG: "kg",
    G: "g",
    L: "liter",
    ML: "ml",
    PCS: "pcs",
  };
  return map[u] || u.toLowerCase();
}

export const PACK_UNITS = [
  "NONE",
  "BOX",
  "PACKET",
  "TRAY",
  "CRATE",
  "CARTON",
  "DOZEN",
  "BUNDLE",
  "SACK",
  "TIN",
  "BAG",
] as const;

export type PackUnitCode = (typeof PACK_UNITS)[number];

export function packUnitLabel(u: string | null | undefined) {
  const map: Record<string, string> = {
    NONE: "—",
    BOX: "box",
    PACKET: "packet",
    TRAY: "tray",
    CRATE: "crate",
    CARTON: "carton",
    DOZEN: "dozen",
    BUNDLE: "bundle",
    SACK: "sack",
    TIN: "tin",
    BAG: "bag",
  };
  if (!u) return map.NONE;
  return map[u] || u.toLowerCase();
}

export function hasPack(packUnit: string | null | undefined, unitsPerPack: number | null | undefined) {
  return Boolean(packUnit && packUnit !== "NONE" && Number(unitsPerPack) > 1.0000001);
}

/** Show on-hand as packs + leftover stock units when pack size is set. */
export function formatStockQty(
  qty: number,
  unit: string,
  packUnit?: string | null,
  unitsPerPack?: number | null
) {
  const stock = `${qty} ${unitLabel(unit)}`;
  const per = Number(unitsPerPack) || 0;
  if (!hasPack(packUnit, per)) return stock;
  const packs = Math.floor(qty / per + 1e-9);
  const rem = Number((qty - packs * per).toFixed(3));
  const packLbl = packUnitLabel(packUnit);
  if (packs <= 0) return stock;
  if (rem > 0.0001) return `${packs} ${packLbl} + ${rem} ${unitLabel(unit)}`;
  return `${packs} ${packLbl} (${stock})`;
}
