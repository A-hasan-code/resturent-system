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
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
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
    const msg =
      body.error ||
      (Array.isArray(body.message) ? body.message.join(", ") : body.message) ||
      res.statusText ||
      "Request failed";
    throw new ApiError(String(msg), res.status);
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
