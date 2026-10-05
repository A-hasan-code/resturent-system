/**
 * Additional PC print agent: lists local USB/Windows printers, registers them
 * with the main server, and prints claimed ESC/POS jobs locally.
 */
const { execFile } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const POLL_MS = 1200;
const HEARTBEAT_MS = 20_000;
const LIST_EVERY_MS = 60_000;

const RAW_PRINT_PS1 = String.raw`param([string]$Printer, [string]$Path)
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class HotelRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool OpenPrinter(string name, out IntPtr h, IntPtr pd);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern int StartDocPrinter(IntPtr h, int level, [In] DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool WritePrinter(IntPtr h, IntPtr buf, int count, out int written);
  public static void Send(string printer, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("Printer not found: " + printer);
    try {
      var di = new DOCINFO { pDocName = "PixalBotics Restaurant", pDataType = "RAW" };
      if (StartDocPrinter(h, 1, di) == 0) throw new Exception("StartDocPrinter failed: " + Marshal.GetLastWin32Error());
      StartPagePrinter(h);
      IntPtr p = Marshal.AllocCoTaskMem(data.Length);
      Marshal.Copy(data, 0, p, data.Length);
      int written;
      bool ok = WritePrinter(h, p, data.Length, out written);
      Marshal.FreeCoTaskMem(p);
      EndPagePrinter(h);
      EndDocPrinter(h);
      if (!ok || written != data.Length) throw new Exception("WritePrinter failed: " + Marshal.GetLastWin32Error());
    } finally { ClosePrinter(h); }
  }
}
"@
[HotelRawPrinter]::Send($Printer, [IO.File]::ReadAllBytes($Path))
`;

function powershell(args, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", ...args],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const msg =
            String(stderr || err.message)
              .split(/\r?\n/)
              .find((l) => l.trim() && !l.startsWith("At ")) || err.message;
          return reject(new Error(String(msg).trim()));
        }
        resolve(stdout);
      }
    );
  });
}

function rawPrintScript(userDataDir) {
  const dir = path.join(userDataDir, "tools");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "rawprint.ps1");
  if (!fs.existsSync(file)) fs.writeFileSync(file, RAW_PRINT_PS1, "utf8");
  return file;
}

async function listLocalPrinters() {
  if (process.platform !== "win32") return [];
  try {
    const out = await powershell([
      "-Command",
      "$d=(Get-CimInstance Win32_Printer | Where-Object Default).Name; Get-Printer | ForEach-Object { [pscustomobject]@{ name=$_.Name; driver=$_.DriverName; port=$_.PortName; isDefault=($_.Name -eq $d) } } | ConvertTo-Json -Compress",
    ]);
    const trimmed = String(out || "").trim();
    if (!trimmed) return [];
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

async function sendToLocalPrinter(userDataDir, printerName, data) {
  const tmp = path.join(os.tmpdir(), `hotel-agent-print-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
  fs.writeFileSync(tmp, data);
  try {
    await powershell(["-File", rawPrintScript(userDataDir), "-Printer", printerName, "-Path", tmp]);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

function localIps() {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === "IPv4" && !a.internal) ips.push(a.address);
    }
  }
  return ips;
}

/** Skip agent when this desktop is the Main server PC (USB already via server WINDOWS). */
function isServerOnThisMachine(origin) {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
    return localIps().includes(host);
  } catch {
    return false;
  }
}

function ensureMachineKey(cfg, saveConfig) {
  if (cfg.machineKey && typeof cfg.machineKey === "string") return cfg;
  const next = { ...cfg, machineKey: crypto.randomUUID() };
  saveConfig(next);
  return next;
}

class PrintAgent {
  constructor({ getOrigin, loadConfig, saveConfig, userDataDir, onStatus }) {
    this.getOrigin = getOrigin;
    this.loadConfig = loadConfig;
    this.saveConfig = saveConfig;
    this.userDataDir = userDataDir;
    this.onStatus = onStatus || (() => {});
    this.token = null;
    this.timer = null;
    this.running = false;
    this.busy = false;
    this.lastListAt = 0;
    this.lastHeartbeatAt = 0;
    this.printers = [];
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), POLL_MS);
    void this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    this.token = null;
  }

  async tick() {
    if (this.busy) return;
    const origin = this.getOrigin();
    if (!origin) return;
    if (isServerOnThisMachine(origin)) {
      if (this.running) {
        this.running = false;
        this.token = null;
        this.onStatus("Print agent idle (this PC is the main server)");
      }
      return;
    }

    this.busy = true;
    try {
      const now = Date.now();
      if (!this.token || now - this.lastListAt > LIST_EVERY_MS) {
        await this.register(origin);
      } else if (now - this.lastHeartbeatAt > HEARTBEAT_MS) {
        await this.heartbeat(origin);
      }
      if (this.token) await this.claimAndPrint(origin);
    } catch (e) {
      this.onStatus(`Print agent: ${e.message || e}`);
      this.token = null;
    } finally {
      this.busy = false;
    }
  }

  async register(origin) {
    let cfg = ensureMachineKey(this.loadConfig(), this.saveConfig);
    this.printers = await listLocalPrinters();
    this.lastListAt = Date.now();
    const body = {
      machineKey: cfg.machineKey,
      hostname: os.hostname(),
      displayName: os.hostname(),
      printers: this.printers.map((p) => ({
        name: p.name,
        driver: p.driver || "",
        port: p.port || "",
        isDefault: !!p.isDefault,
      })),
    };
    const res = await fetch(`${origin}/api/print-agents/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`register failed (${res.status})`);
    const data = await res.json();
    this.token = data.token;
    this.running = true;
    this.lastHeartbeatAt = Date.now();
    cfg = { ...cfg, agentToken: data.token, agentId: data.agentId };
    this.saveConfig(cfg);
    this.onStatus(`Print agent: ${this.printers.length} local printer(s) on server`);
  }

  async heartbeat(origin) {
    if (!this.token) return;
    const res = await fetch(`${origin}/api/print-agents/heartbeat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        printers: this.printers.map((p) => ({
          name: p.name,
          driver: p.driver || "",
          port: p.port || "",
          isDefault: !!p.isDefault,
        })),
      }),
    });
    if (res.status === 401) {
      this.token = null;
      return;
    }
    if (!res.ok) throw new Error(`heartbeat failed (${res.status})`);
    this.lastHeartbeatAt = Date.now();
  }

  async claimAndPrint(origin) {
    const res = await fetch(`${origin}/api/print-agents/jobs/claim`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (res.status === 401) {
      this.token = null;
      return;
    }
    if (!res.ok) throw new Error(`claim failed (${res.status})`);
    const job = await res.json().catch(() => null);
    if (!job || !job.id) return;

    try {
      const buf = Buffer.from(job.dataBase64, "base64");
      await sendToLocalPrinter(this.userDataDir, job.printerName, buf);
      await fetch(`${origin}/api/print-agents/jobs/${job.id}/done`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}` },
      });
      this.onStatus(`Printed ${job.type}${job.orderNo != null ? ` #${job.orderNo}` : ""} → ${job.printerName}`);
    } catch (e) {
      await fetch(`${origin}/api/print-agents/jobs/${job.id}/fail`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({ error: e.message || "Local print failed" }),
      }).catch(() => {});
      this.onStatus(`Print failed: ${e.message || e}`);
    }
  }
}

module.exports = { PrintAgent, listLocalPrinters, isServerOnThisMachine };
