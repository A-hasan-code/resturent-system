// Finds the Hotel System server on the LAN: saved address → this PC → UDP beacon/probe → mDNS → subnet scan.
const dgram = require("dgram");
const os = require("os");

const APP_ID = "hotel-system";
const BEACON_PORT = 41234;
const PROBE_PORT = 41235;
const DEFAULT_PORT = 3000;

async function probe(origin, timeoutMs = 1500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${origin}/api/health`, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) return null;
    const h = await res.json();
    return h && h.app === APP_ID ? h : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function localNets() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== "IPv4" || a.internal || a.address.startsWith("169.254.")) continue;
      const ip = a.address.split(".").map(Number);
      const mask = a.netmask.split(".").map(Number);
      const broadcast = ip.map((o, i) => (o & mask[i]) | (~mask[i] & 255)).join(".");
      out.push({ ip: a.address, prefix: ip.slice(0, 3).join("."), broadcast });
    }
  }
  return out;
}

function matches(h, wantedId) {
  return !!h && (!wantedId || h.serverId === wantedId);
}

/** Listens for beacons and sends probes for up to `ms`. Resolves the first matching server. */
function udpSearch(wantedId, ms = 3500) {
  return new Promise((resolve) => {
    let done = false;
    const sockets = [];
    const finish = (val) => {
      if (done) return;
      done = true;
      for (const s of sockets) {
        try {
          s.close();
        } catch {
          /* already closed */
        }
      }
      resolve(val);
    };
    const onMessage = (buf, rinfo) => {
      try {
        const h = JSON.parse(buf.toString());
        if (h.app !== APP_ID || !matches(h, wantedId)) return;
        finish({ origin: `http://${rinfo.address}:${h.port || DEFAULT_PORT}`, health: h });
      } catch {
        /* not ours */
      }
    };

    const listener = dgram.createSocket({ type: "udp4", reuseAddr: true });
    listener.on("error", () => undefined);
    listener.on("message", onMessage);
    listener.bind(BEACON_PORT);
    sockets.push(listener);

    const prober = dgram.createSocket({ type: "udp4", reuseAddr: true });
    prober.on("error", () => undefined);
    prober.on("message", onMessage);
    prober.bind(() => {
      prober.setBroadcast(true);
      const msg = Buffer.from(JSON.stringify({ app: APP_ID, probe: true }));
      const targets = new Set(["255.255.255.255", "127.0.0.1", ...localNets().map((n) => n.broadcast)]);
      for (const t of targets) prober.send(msg, PROBE_PORT, t, () => undefined);
    });
    sockets.push(prober);

    setTimeout(() => finish(null), ms);
  });
}

function mdnsSearch(wantedId, ms = 3000) {
  return new Promise((resolve) => {
    let Bonjour;
    try {
      ({ Bonjour } = require("bonjour-service"));
    } catch {
      return resolve(null);
    }
    const bonjour = new Bonjour();
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      try {
        browser.stop();
        bonjour.destroy();
      } catch {
        /* ignore */
      }
      resolve(val);
    };
    const browser = bonjour.find({ type: "http" }, async (svc) => {
      if (svc.txt?.app !== APP_ID) return;
      if (wantedId && svc.txt?.serverId !== wantedId) return;
      for (const addr of svc.addresses || []) {
        if (!/^\d+\.\d+\.\d+\.\d+$/.test(addr)) continue;
        const origin = `http://${addr}:${svc.port}`;
        const h = await probe(origin);
        if (matches(h, wantedId)) return finish({ origin, health: h });
      }
    });
    setTimeout(() => finish(null), ms);
  });
}

async function subnetScan(wantedId, port, onProgress) {
  for (const net of localNets()) {
    onProgress?.(`Scanning ${net.prefix}.x …`);
    const hosts = Array.from({ length: 254 }, (_, i) => `${net.prefix}.${i + 1}`);
    let found = null;
    let next = 0;
    const worker = async () => {
      while (!found && next < hosts.length) {
        const origin = `http://${hosts[next++]}:${port}`;
        const h = await probe(origin, 900);
        if (!found && matches(h, wantedId)) found = { origin, health: h };
      }
    };
    await Promise.all(Array.from({ length: 64 }, worker));
    if (found) return found;
  }
  return null;
}

/**
 * One full discovery pass. `saved` = { serverUrl, serverId, port }.
 * Returns { origin, health } or null.
 */
async function discover(saved, onProgress) {
  const wantedId = saved.serverId || null;
  const port = saved.port || DEFAULT_PORT;

  const quick = [saved.serverUrl, `http://localhost:${port}`, `http://hotel.local:${port}`].filter(Boolean);
  for (const origin of [...new Set(quick)]) {
    onProgress?.(`Checking ${origin}`);
    const h = await probe(origin);
    if (matches(h, wantedId)) return { origin, health: h };
  }

  onProgress?.("Searching the network (broadcast)…");
  const udp = await udpSearch(wantedId);
  if (udp) return udp;

  onProgress?.("Searching the network (mDNS)…");
  const md = await mdnsSearch(wantedId);
  if (md) return md;

  return subnetScan(wantedId, port, onProgress);
}

module.exports = { discover, probe };
