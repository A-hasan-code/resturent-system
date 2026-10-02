// Finds the Hotel System server on the LAN: saved address → this PC → UDP beacon/probe → mDNS → subnet scan.
// Prefer real Wi-Fi/Ethernet (192.168.x) over Hyper-V / WSL / Docker virtual adapters (often 172.28.x).
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

/** Lower = better for restaurant LAN tablets / cashier PCs. */
function lanRank(ip, iface = "") {
  let score = 0;
  const name = String(iface).toLowerCase();
  if (
    /vethernet|hyper-?v|wsl|vmware|virtualbox|vbox|docker|vpn|zerotier|hamachi|tap-windows|bluetooth|loopback|pseudo|isatap|teredo|wi-?fi direct|hosted network|virtual/.test(
      name
    )
  ) {
    score += 1000;
  }
  if (ip.startsWith("192.168.")) score += 0;
  else if (/^10\./.test(ip)) score += 10;
  else if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) score += 200; // often Hyper-V Default Switch
  else score += 50;
  if (/wi-?fi|wlan|wireless|ethernet|local area connection|^eth\d|^en\d/.test(name)) score -= 5;
  return score;
}

function sortHosts(hosts) {
  return [...new Set(hosts.filter((h) => /^\d+\.\d+\.\d+\.\d+$/.test(h)))].sort(
    (a, b) => lanRank(a) - lanRank(b) || a.localeCompare(b)
  );
}

function localNets() {
  const out = [];
  for (const [iface, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== "IPv4" || a.internal || a.address.startsWith("169.254.")) continue;
      const ip = a.address.split(".").map(Number);
      const mask = a.netmask.split(".").map(Number);
      const broadcast = ip.map((o, i) => (o & mask[i]) | (~mask[i] & 255)).join(".");
      out.push({
        ip: a.address,
        iface,
        prefix: ip.slice(0, 3).join("."),
        broadcast,
        rank: lanRank(a.address, iface),
      });
    }
  }
  return out.sort((a, b) => a.rank - b.rank || a.ip.localeCompare(b.ip));
}

function matches(h, wantedId) {
  return !!h && (!wantedId || h.serverId === wantedId);
}

/** Try HTTP health on candidate hosts (best LAN IP first). */
async function pickReachable(hosts, port, wantedId, timeoutMs = 1500) {
  for (const host of sortHosts(hosts)) {
    const origin = `http://${host}:${port || DEFAULT_PORT}`;
    const health = await probe(origin, timeoutMs);
    if (matches(health, wantedId)) return { origin, health };
  }
  return null;
}

/** Listens for beacons and sends probes for up to `ms`. Resolves the first matching server. */
function udpSearch(wantedId, ms = 3500) {
  return new Promise((resolve) => {
    let done = false;
    let busy = false;
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
      if (done || busy) return;
      let h;
      try {
        h = JSON.parse(buf.toString());
      } catch {
        return;
      }
      if (h.app !== APP_ID || !matches(h, wantedId)) return;
      busy = true;
      const port = h.port || DEFAULT_PORT;
      // Prefer IPs advertised by the server (already ranked), not the UDP source
      // (source is often Hyper-V / WSL 172.x when the server has virtual adapters).
      const hosts = [...(Array.isArray(h.ips) ? h.ips : []), rinfo.address];
      pickReachable(hosts, port, wantedId)
        .then((hit) => {
          if (hit) finish(hit);
          else busy = false;
        })
        .catch(() => {
          busy = false;
        });
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
      const hit = await pickReachable(svc.addresses || [], svc.port, wantedId);
      if (hit) finish(hit);
    });
    setTimeout(() => finish(null), ms);
  });
}

async function subnetScan(wantedId, port, onProgress) {
  // Real LAN first; skip very virtual-looking prefixes when a better net exists.
  const nets = localNets();
  const hasGoodLan = nets.some((n) => n.rank < 100);
  for (const net of nets) {
    if (hasGoodLan && net.rank >= 200) continue; // skip Hyper-V-style 172.16/12 when 192.168/10 exists
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
    if (matches(h, wantedId)) {
      // If saved URL is a virtual IP but beacon/health lists a better LAN IP, upgrade.
      const upgraded = await pickReachable([...(h.ips || []), new URL(origin).hostname], h.port || port, wantedId);
      return upgraded || { origin, health: h };
    }
  }

  onProgress?.("Searching the network (broadcast)…");
  const udp = await udpSearch(wantedId);
  if (udp) return udp;

  onProgress?.("Searching the network (mDNS)…");
  const md = await mdnsSearch(wantedId);
  if (md) return md;

  return subnetScan(wantedId, port, onProgress);
}

module.exports = { discover, probe, lanRank, sortHosts };
