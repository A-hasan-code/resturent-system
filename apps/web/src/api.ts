const API_BASE = import.meta.env.VITE_API_URL || "/api";

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
    res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  } catch {
    throw new ApiError("Server unreachable. Check Docker / network.", 0);
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
