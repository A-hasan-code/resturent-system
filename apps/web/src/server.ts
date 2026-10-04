/**
 * Finds the Hotel System server on the LAN and keeps following it if its IP changes.
 * In a browser the app is usually served by the server itself (same origin). When that
 * origin stops answering, we look for the same serverId on the saved address, then scan
 * the local subnet, and switch the API/socket base to wherever it is now.
 * In the Android app the UI is bundled, so there is no same origin: the server is found
 * by UDP beacon (native plugin) or subnet scan, and its address is always saved.
 */
import { HotelDiscovery, isNative } from "./native";

export type Health = {
  ok: boolean;
  app: string;
  serverId: string;
  name: string;
  version: string;
  port: number;
};

export type ConnStatus = "ok" | "searching" | "lost";

declare global {
  interface Window {
    hotelDesktop?: {
      isDesktop: true;
      reconnect: () => void;
      serverUrl: () => Promise<string | null>;
    };
  }
}

const APP_ID = "hotel-system";
const K_ORIGIN = "hotel.serverOrigin";
const K_ID = "hotel.serverId";
const K_HOST = "hotel.lastHost";
const K_PORT = "hotel.port";
const PROBE_TIMEOUT_MS = 1500;
const SCAN_CONCURRENCY = 48;
const RETRY_MS = 4000;

const envBase = import.meta.env.VITE_API_URL as string | undefined;

let status: ConnStatus = "ok";
const statusListeners = new Set<(s: ConnStatus) => void>();
const originListeners = new Set<(origin: string) => void>();
let searching: Promise<boolean> | null = null;
let progress = "";

/** "" means same origin as the page. */
export function serverOrigin(): string {
  return localStorage.getItem(K_ORIGIN) || "";
}

export function apiBase() {
  if (envBase) return envBase;
  return `${serverOrigin()}/api`;
}

/** False only in the Android app before a server has been found. */
export function hasServerAddress() {
  return !!envBase || !isNative || !!localStorage.getItem(K_ORIGIN);
}

export function connStatus() {
  return status;
}

export function scanProgress() {
  return progress;
}

export function onConnStatus(fn: (s: ConnStatus) => void) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

export function onServerMoved(fn: (origin: string) => void) {
  originListeners.add(fn);
  return () => originListeners.delete(fn);
}

function setStatus(s: ConnStatus) {
  if (status === s) return;
  status = s;
  statusListeners.forEach((fn) => fn(s));
}

function remember(origin: string, h: Health) {
  const prev = serverOrigin();
  const sameAsPage = !isNative && (origin === "" || origin === location.origin);
  if (sameAsPage) localStorage.removeItem(K_ORIGIN);
  else localStorage.setItem(K_ORIGIN, origin);
  localStorage.setItem(K_ID, h.serverId);
  localStorage.setItem(K_PORT, String(h.port));
  const host = new URL(origin || location.origin).hostname;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) localStorage.setItem(K_HOST, host);
  const next = sameAsPage ? "" : origin;
  if (next !== prev) originListeners.forEach((fn) => fn(next));
}

export async function probe(origin: string, timeout = PROBE_TIMEOUT_MS): Promise<Health | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${origin}/api/health`, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) return null;
    const h = (await res.json()) as Health;
    return h?.app === APP_ID ? h : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * The pinned serverId only guards servers found by scanning. The page's own origin and the
 * saved address are trusted even if the id changed (server reinstalled or database reset).
 */
function isOurs(h: Health | null, trusted = false) {
  if (!h) return false;
  const saved = localStorage.getItem(K_ID);
  return trusted || !saved || saved === h.serverId;
}

/** Called once at startup so the serverId gets pinned on first run. */
export async function initConnection() {
  if (envBase) return;

  // Browser/dev: always try this page's origin first (Vite proxies /api → :4000).
  // Clears a stale saved LAN IP that keeps showing "Connecting to server…".
  if (!isNative) {
    const page = await probe("", 3000);
    if (page) {
      remember("", page);
      setStatus("ok");
      return;
    }
  }

  if (hasServerAddress()) {
    const origin = serverOrigin();
    const h = await probe(origin, 3000);
    if (isOurs(h, true)) {
      remember(origin, h!);
      setStatus("ok");
      return;
    }
    // Saved address is dead — drop it so search can use this device again.
    if (origin) localStorage.removeItem(K_ORIGIN);
  }
  void reportLost();
}

async function subnetPrefixes(): Promise<string[]> {
  const out: string[] = [];
  const add = (ip: string | null | undefined) => {
    if (!ip || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return;
    const p = ip.split(".").slice(0, 3).join(".");
    if (!out.includes(p)) out.push(p);
  };
  if (isNative) {
    try {
      (await HotelDiscovery.localIps()).addresses.forEach((a) => add(a.ip));
    } catch {
      /* plugin unavailable: fall back to the guesses below */
    }
  }
  add(localStorage.getItem(K_HOST));
  if (!isNative) add(location.hostname);
  for (const p of ["192.168.1.1", "192.168.0.1", "192.168.10.1", "10.0.0.1", "192.168.100.1"]) add(p);
  return out;
}

/** Android only: ask the native plugin for UDP beacon replies, then confirm over HTTP. */
async function beaconSearch(lenient: boolean): Promise<{ origin: string; h: Health } | null> {
  let servers;
  try {
    servers = (await HotelDiscovery.listen({ timeout: 3000 })).servers;
  } catch {
    return null;
  }
  const saved = localStorage.getItem(K_ID);
  const ordered = [...servers].sort((a, b) => Number(b.serverId === saved) - Number(a.serverId === saved));
  for (const s of ordered) {
    // Prefer server-advertised LAN IPs (192.168…) over UDP/mDNS host which may be Hyper-V 172.x
    const hosts = [...(s.ips || []), s.host].filter(Boolean);
    const ranked = [...new Set(hosts)].sort((a, b) => {
      const score = (ip: string) => {
        if (ip.startsWith("192.168.")) return 0;
        if (/^10\./.test(ip)) return 10;
        if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return 200;
        return 50;
      };
      return score(a) - score(b) || a.localeCompare(b);
    });
    for (const host of ranked) {
      const origin = `http://${host}:${s.port}`;
      const h = await probe(origin);
      if (isOurs(h, lenient)) return { origin, h: h! };
    }
  }
  return null;
}

async function scanSubnet(prefix: string, port: number, lenient = false): Promise<{ origin: string; h: Health } | null> {
  const hosts = Array.from({ length: 254 }, (_, i) => `${prefix}.${i + 1}`);
  let found: { origin: string; h: Health } | null = null;
  let next = 0;
  const worker = async () => {
    while (!found && next < hosts.length) {
      const host = hosts[next++];
      const origin = `http://${host}:${port}`;
      const h = await probe(origin);
      if (!found && isOurs(h, lenient)) found = { origin, h: h! };
    }
  };
  await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, worker));
  return found;
}

/**
 * One search pass. `lenient` accepts a server with a different serverId (reinstalled server or
 * reset database); the Android app uses it after a strict pass found nothing.
 */
async function findServer(lenient: boolean): Promise<boolean> {
  const saved = serverOrigin();
  const trusted = isNative ? (saved ? [saved] : []) : ["", saved];
  const uiPort = Number(location.port || localStorage.getItem(K_PORT) || 3000);
  const apiPort = Number(localStorage.getItem(K_PORT) || 4000);
  const host = location.hostname || "localhost";
  const candidates = [
    ...trusted,
    `http://localhost:${uiPort}`,
    `http://127.0.0.1:${uiPort}`,
    `http://localhost:4000`,
    `http://127.0.0.1:4000`,
    `http://${host}:${uiPort}`,
    `http://${host}:4000`,
    `http://hotel.local:${uiPort}`,
    `http://hotel.local:4000`,
    apiPort !== uiPort && apiPort !== 4000 ? `http://localhost:${apiPort}` : "",
  ].filter(Boolean) as string[];
  for (const origin of [...new Set(candidates)]) {
    progress = origin ? `Checking ${origin}` : "Checking this address";
    const h = await probe(origin);
    if (isOurs(h, lenient || trusted.includes(origin) || origin === "")) {
      remember(origin, h!);
      return true;
    }
  }

  if (window.hotelDesktop) {
    progress = "Desktop app is searching the network…";
    window.hotelDesktop.reconnect();
    return false;
  }

  if (isNative) {
    progress = "Searching the network (broadcast)…";
    const hit = await beaconSearch(lenient);
    if (hit) {
      remember(hit.origin, hit.h);
      return true;
    }
  }

  for (const prefix of await subnetPrefixes()) {
    progress = `Scanning ${prefix}.x`;
    for (const scanPort of [...new Set([uiPort, 4000, apiPort])]) {
      const hit = await scanSubnet(prefix, scanPort, lenient);
      if (hit) {
        remember(hit.origin, hit.h);
        return true;
      }
    }
  }
  return false;
}

/**
 * Starts (or joins) the search for the server. Resolves true once it is reachable.
 * Keeps retrying in the background until found.
 */
export function reportLost(): Promise<boolean> {
  if (envBase) return Promise.resolve(false);
  if (searching) return searching;
  setStatus("searching");
  searching = (async () => {
    let first = true;
    for (;;) {
      if (await findServer(isNative && !first)) {
        setStatus("ok");
        return true;
      }
      if (first) {
        setStatus("lost");
        first = false;
      }
      await new Promise((r) => setTimeout(r, RETRY_MS));
    }
  })().finally(() => {
    searching = null;
  });
  return searching;
}

/** Manual override from the "connect by IP" box. */
export async function connectManually(address: string) {
  const raw = address.trim().replace(/\/+$/, "");
  const origin = /^https?:\/\//.test(raw) ? raw : `http://${raw.includes(":") ? raw : `${raw}:3000`}`;
  const h = await probe(origin, 4000);
  if (!h) return false;
  localStorage.setItem(K_ID, h.serverId);
  remember(origin, h);
  setStatus("ok");
  return true;
}
