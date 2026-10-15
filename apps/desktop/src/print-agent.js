/**
 * Additional PC print agent: lists local USB/Windows printers, registers them
 * with the main server, and prints claimed ESC/POS jobs locally.
 *
 * Each Windows PC gets a stable machineKey from MachineGuid so cloned/copied
 * installs still register as separate counters on the server.
 */
const { execFile } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const POLL_MS = 1200;
const HEARTBEAT_MS = 15_000;
const LIST_EVERY_MS = 45_000;

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
  fs.writeFileSync(file, RAW_PRINT_PS1, "utf8");
  return file;
}

const VIRTUAL_PRINTER =
  /microsoft print to pdf|fax|onenote|xps document writer|send to onenote|adobe pdf|microsoft xps|root port/i;

function isLikelyVirtualPrinter(name) {
  return VIRTUAL_PRINTER.test(String(name || ""));
}

const USB_DEVICE_SKIP =
  /USB Root Hub|Generic USB Hub|USB Composite Device|HID-compliant|USB Input Device|USB Keyboard|USB Mouse|Bluetooth|Webcam|Camera|Audio|Headset|Microphone|Mass Storage|Disk Drive|CD-ROM/i;

async function listUsbDevices() {
  if (process.platform !== "win32") return [];
  const cmd = String.raw`$ErrorActionPreference='SilentlyContinue';
$skip='USB Root Hub|Generic USB Hub|USB Composite Device|HID-compliant|USB Input Device|USB Keyboard|USB Mouse|Bluetooth|Webcam|Camera|Audio|Headset|Microphone|Mass Storage|Disk Drive|CD-ROM';
$rows=@()
try {
  $rows = @(Get-PnpDevice -PresentOnly | Where-Object {
    $id=[string]$_.InstanceId; $cls=[string]$_.Class; $n=[string]$_.FriendlyName; $st=[string]$_.Status
    if ($n -match $skip) { return $false }
    if ($id -like 'USB*' -or $cls -in @('USB','USBDevice','Printer','PrintQueue','Image','Ports','SoftwareDevice') -or $st -in @('Error','Unknown','Degraded') -or $n -match 'Unknown|USB Printing|POS|Thermal|Receipt|ESC/POS') { return $true }
    $false
  } | ForEach-Object {
    $n=$_.FriendlyName; if (-not $n) { $n=$_.InstanceId }
    $st=[string]$_.Status; $cls=[string]$_.Class
    $problem = ($st -ne 'OK') -or ($n -match 'Unknown') -or ($cls -match 'Unknown') -or ([string]$_.Problem -ne '' -and [string]$_.Problem -ne 'CM_PROB_NONE' -and $_.Problem -ne 0)
    [pscustomobject]@{ name=$n; className=$cls; status=$st; instanceId=[string]$_.InstanceId; problem=[bool]$problem }
  })
} catch {}
if (-not $rows.Count) {
  $rows = @(Get-CimInstance Win32_PnPEntity | Where-Object {
    $id=[string]$_.PNPDeviceID; $n=[string]$_.Name; $st=[string]$_.Status
    if ($n -match $skip) { return $false }
    if ($id -like 'USB*' -or $n -match 'Unknown|USB Printing|Printer|POS|Thermal|Receipt') { return $true }
    $false
  } | Select-Object -First 80 | ForEach-Object {
    $n=$_.Name; $st=[string]$_.Status
    $problem = ($st -ne 'OK') -or ($n -match 'Unknown')
    [pscustomobject]@{ name=$n; className=([string]$_.PNPClass); status=$st; instanceId=[string]$_.PNPDeviceID; problem=[bool]$problem }
  })
}
$rows | Select-Object -First 80 | ConvertTo-Json -Compress`;
  try {
    const out = await powershell(["-Command", cmd], 45_000);
    const trimmed = String(out || "").trim();
    if (!trimmed) return [];
    const parsed = JSON.parse(trimmed);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list
      .filter((d) => d && d.name && !USB_DEVICE_SKIP.test(d.name))
      .map((d) => ({
        name: String(d.name).slice(0, 200),
        className: String(d.className || "").slice(0, 80),
        status: String(d.status || "").slice(0, 40),
        instanceId: String(d.instanceId || "").slice(0, 260),
        problem: !!d.problem,
      }));
  } catch {
    return [];
  }
}

async function listLocalPrinters() {
  if (process.platform !== "win32") return [];
  // Prefer Win32_Printer — Get-Printer needs PrintManagement and often fails
  // on cashier PCs (empty list → Additional PC USB never appears in Settings).
  const commands = [
    "Get-CimInstance Win32_Printer | ForEach-Object { [pscustomobject]@{ name=$_.Name; driver=$_.DriverName; port=$_.PortName; isDefault=[bool]$_.Default } } | ConvertTo-Json -Compress",
    "Get-WmiObject Win32_Printer | ForEach-Object { [pscustomobject]@{ name=$_.Name; driver=$_.DriverName; port=$_.PortName; isDefault=[bool]$_.Default } } | ConvertTo-Json -Compress",
    "$d=(Get-CimInstance Win32_Printer | Where-Object Default).Name; Get-Printer | ForEach-Object { [pscustomobject]@{ name=$_.Name; driver=$_.DriverName; port=$_.PortName; isDefault=($_.Name -eq $d) } } | ConvertTo-Json -Compress",
  ];
  for (const cmd of commands) {
    try {
      const out = await powershell(["-Command", cmd]);
      const trimmed = String(out || "").trim();
      if (!trimmed) continue;
      const parsed = JSON.parse(trimmed);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      const all = list.filter((p) => p && p.name);
      if (!all.length) continue;
      const real = all.filter((p) => !isLikelyVirtualPrinter(p.name));
      return real.length ? real : all;
    } catch {
      /* try next */
    }
  }
  return [];
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

/** Stable per Windows install — survives app reinstall; unique across PCs. */
function windowsMachineGuid() {
  if (process.platform !== "win32") return null;
  try {
    const out = require("child_process").execFileSync(
      "reg",
      ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"],
      { windowsHide: true, encoding: "utf8", timeout: 5000 }
    );
    const m = /MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/.exec(out);
    return m ? m[1].trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

function primaryMac() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== "IPv4" || a.internal) continue;
      const mac = (a.mac || "").toLowerCase();
      if (mac && mac !== "00:00:00:00:00:00") return mac;
    }
  }
  return "";
}

/** One UUID per desktop install — do not copy AppData between cashier PCs. */
function loadOrCreateInstanceId(userDataDir) {
  const idFile = path.join(userDataDir, "agent-instance-id");
  try {
    const raw = fs.readFileSync(idFile, "utf8").trim();
    if (raw.length >= 16 && raw.length <= 80) return raw;
  } catch {
    /* first run */
  }
  const id = crypto.randomUUID().replace(/-/g, "");
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(idFile, id, "utf8");
  } catch {
    /* ignore */
  }
  return id;
}

function computeMachineKey(userDataDir) {
  const instance = loadOrCreateInstanceId(userDataDir);
  const mac = primaryMac();
  const host = os.hostname();
  const guid = windowsMachineGuid() || "";
  return crypto
    .createHash("sha256")
    .update(`hotel-agent-v2|${instance}|${mac}|${host}|${guid}`)
    .digest("hex")
    .slice(0, 48);
}

/** Call from desktop menu when a cloned PC stole another counter's identity. */
function resetAgentIdentity(userDataDir, saveConfig, loadConfig) {
  const idFile = path.join(userDataDir, "agent-instance-id");
  try {
    fs.unlinkSync(idFile);
  } catch {
    /* ignore */
  }
  const cfg = loadConfig();
  delete cfg.machineKey;
  delete cfg.agentToken;
  delete cfg.agentId;
  delete cfg.agentHostname;
  saveConfig(cfg);
}

function ensureMachineKey(cfg, saveConfig, userDataDir) {
  const host = os.hostname();
  const key = computeMachineKey(userDataDir);
  const changed = cfg.machineKey !== key || cfg.agentHostname !== host;
  if (!changed) return cfg;
  const next = {
    ...cfg,
    machineKey: key,
    agentHostname: host,
  };
  delete next.agentToken;
  delete next.agentId;
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
    this.devices = [];
    this.lastStatus = "";
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

  status(text) {
    this.lastStatus = text;
    this.onStatus(text);
  }

  async tick() {
    if (this.busy) return;
    const origin = this.getOrigin();
    if (!origin) return;
    if (isServerOnThisMachine(origin)) {
      if (this.running) {
        this.running = false;
        this.token = null;
      }
      this.status("Print agent idle (this PC is the main server)");
      return;
    }

    this.busy = true;
    try {
      const now = Date.now();
      if (!this.token || now - this.lastListAt > LIST_EVERY_MS) {
        await this.register(origin);
      } else if (now - this.lastHeartbeatAt > HEARTBEAT_MS) {
        this.printers = await listLocalPrinters();
        this.devices = await listUsbDevices();
        this.lastListAt = Date.now();
        await this.heartbeat(origin);
      }
      if (this.token) await this.claimAndPrint(origin);
    } catch (e) {
      this.status(`Print agent: ${e.message || e}`);
      this.token = null;
    } finally {
      this.busy = false;
    }
  }

  async register(origin) {
    let cfg = ensureMachineKey(this.loadConfig(), this.saveConfig, this.userDataDir);
    this.printers = await listLocalPrinters();
    this.devices = await listUsbDevices();
    this.lastListAt = Date.now();
    const host = os.hostname();
    const body = {
      machineKey: cfg.machineKey,
      hostname: host,
      displayName: host,
      printers: this.printers.map((p) => ({
        name: p.name,
        driver: p.driver || "",
        port: p.port || "",
        isDefault: !!p.isDefault,
      })),
      devices: this.devices,
    };
    const res = await fetch(`${origin}/api/print-agents/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 404) {
      throw new Error("register failed (404) — update MAIN server to latest release (print agents)");
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`register failed (${res.status})${detail ? `: ${detail.slice(0, 120)}` : ""}`);
    }
    const data = await res.json();
    this.token = data.token;
    this.running = true;
    this.lastHeartbeatAt = Date.now();
    cfg = { ...cfg, agentToken: data.token, agentId: data.agentId, agentHostname: host };
    this.saveConfig(cfg);
    const n = this.printers.length;
    const problems = this.devices.filter((d) => d.problem).length;
    const deviceHint =
      problems > 0
        ? ` · ${problems} USB need driver (Unknown)`
        : this.devices.length
          ? ` · ${this.devices.length} USB device(s)`
          : "";
    this.status(
      n > 0
        ? `Print agent OK · ${host} · ${n} printer(s) → server${deviceHint}`
        : `Print agent OK · ${host} · no USB printers in Windows (add driver)${deviceHint}`,
    );
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
        devices: this.devices,
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
      this.status(`Printed ${job.type}${job.orderNo != null ? ` #${job.orderNo}` : ""} → ${job.printerName}`);
    } catch (e) {
      await fetch(`${origin}/api/print-agents/jobs/${job.id}/fail`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({ error: e.message || "Local print failed" }),
      }).catch(() => {});
      this.status(`Print failed: ${e.message || e}`);
    }
  }
}

module.exports = {
  PrintAgent,
  listLocalPrinters,
  listUsbDevices,
  isServerOnThisMachine,
  computeMachineKey,
  resetAgentIdentity,
};
