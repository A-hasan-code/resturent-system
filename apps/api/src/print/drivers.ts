import { execFile } from "child_process";
import { existsSync, unlinkSync, writeFileSync } from "fs";
import { Socket } from "net";
import { tmpdir } from "os";
import { join } from "path";
import { dataDir } from "../config/env";

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

function powershell(args: string[], timeoutMs = 30_000) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", ...args],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const msg = (stderr || err.message).split(/\r?\n/).find((l) => l.trim() && !l.startsWith("At ")) || err.message;
          return reject(new Error(msg.replace(/^.*Exception calling "Send".*?: "?/, "").replace(/"$/, "").trim()));
        }
        resolve(stdout);
      }
    );
  });
}

function rawPrintScript() {
  const file = join(dataDir("tools"), "rawprint.ps1");
  if (!existsSync(file)) writeFileSync(file, RAW_PRINT_PS1, "utf8");
  return file;
}

/** Sends raw ESC/POS bytes to an installed Windows printer (USB / shared). */
export async function sendToWindowsPrinter(printerName: string, data: Buffer) {
  if (process.platform !== "win32") throw new Error("Windows printers only work on Windows server");
  const tmp = join(tmpdir(), `hotel-print-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
  writeFileSync(tmp, data);
  try {
    await powershell(["-File", rawPrintScript(), "-Printer", printerName, "-Path", tmp]);
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      /* temp file already gone */
    }
  }
}

/**
 * Print a PDF buffer to a Windows printer via the shell PrintTo verb
 * (uses the server’s default PDF app / driver — office/A4 printers).
 */
export async function printPdfToWindowsPrinter(printerName: string, pdf: Buffer) {
  if (process.platform !== "win32") throw new Error("PDF Other print only works on Windows server");
  if (!printerName.trim()) throw new Error("Printer name required");
  if (!pdf?.length) throw new Error("PDF is empty");

  const tmp = join(tmpdir(), `hotel-report-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  writeFileSync(tmp, pdf);
  const printer = printerName.replace(/'/g, "''");
  const pathEsc = tmp.replace(/'/g, "''");
  try {
    // PrintTo uses the registered PDF handler; wait briefly then release the temp file.
    await powershell(
      [
        "-Command",
        `$ErrorActionPreference='Stop'; ` +
          `$p = Start-Process -FilePath '${pathEsc}' -Verb PrintTo -ArgumentList '${printer}' -PassThru -WindowStyle Hidden; ` +
          `if ($p) { Wait-Process -Id $p.Id -Timeout 90 -ErrorAction SilentlyContinue }; ` +
          `Start-Sleep -Seconds 3`,
      ],
      120_000
    );
  } finally {
    // Handler may still hold the file briefly
    for (let i = 0; i < 5; i++) {
      try {
        unlinkSync(tmp);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }
}

/** LAN thermal printers accept raw ESC/POS on TCP 9100. */
export function sendToNetworkPrinter(target: string, data: Buffer, timeoutMs = 6000) {
  const [host, portStr] = target.trim().split(":");
  const port = Number(portStr || 9100);
  return new Promise<void>((resolve, reject) => {
    const sock = new Socket();
    const fail = (msg: string) => {
      sock.destroy();
      reject(new Error(msg));
    };
    sock.setTimeout(timeoutMs, () => fail(`Printer ${host}:${port} not responding`));
    sock.once("error", (e) => fail(`Printer ${host}:${port}: ${e.message}`));
    sock.connect(port, host, () => {
      sock.write(data, () => sock.end());
    });
    sock.once("close", (hadError) => {
      if (!hadError) resolve();
    });
  });
}

export function writePreviewFile(folder: string, name: string, text: string) {
  const dir = folder?.trim() ? folder : dataDir("prints");
  const file = join(dir, `${name}.txt`);
  writeFileSync(file, text, "utf8");
  return file;
}

export type SystemPrinter = { name: string; driver: string; port: string; status: string; isDefault: boolean };

export type SystemUsbDevice = {
  name: string;
  className: string;
  status: string;
  instanceId: string;
  problem: boolean;
};

export async function listWindowsPrinters(): Promise<SystemPrinter[]> {
  if (process.platform !== "win32") return [];
  // Win32_Printer first — Get-Printer needs PrintManagement and can return empty on some PCs.
  const commands = [
    "Get-CimInstance Win32_Printer | ForEach-Object { [pscustomobject]@{ name=$_.Name; driver=$_.DriverName; port=$_.PortName; status=[string]$_.PrinterStatus; isDefault=[bool]$_.Default } } | ConvertTo-Json -Compress",
    "Get-WmiObject Win32_Printer | ForEach-Object { [pscustomobject]@{ name=$_.Name; driver=$_.DriverName; port=$_.PortName; status=[string]$_.PrinterStatus; isDefault=[bool]$_.Default } } | ConvertTo-Json -Compress",
    "$d=(Get-CimInstance Win32_Printer | Where-Object Default).Name; Get-Printer | ForEach-Object { [pscustomobject]@{ name=$_.Name; driver=$_.DriverName; port=$_.PortName; status=[string]$_.PrinterStatus; isDefault=($_.Name -eq $d) } } | ConvertTo-Json -Compress",
  ];
  for (const cmd of commands) {
    try {
      const out = await powershell(["-Command", cmd]);
      const trimmed = out.trim();
      if (!trimmed) continue;
      const parsed = JSON.parse(trimmed);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      if (list.length) return list;
    } catch {
      /* try next */
    }
  }
  return [];
}

/** USB / PnP devices on this PC — includes Unknown USB (missing driver) so admins see attached hardware. */
export async function listUsbDevices(): Promise<SystemUsbDevice[]> {
  if (process.platform !== "win32") return [];
  const commands = [
    String.raw`$ErrorActionPreference='SilentlyContinue';
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
$rows | Select-Object -First 80 | ConvertTo-Json -Compress`,
  ];
  for (const cmd of commands) {
    try {
      const out = await powershell(["-Command", cmd], 45_000);
      const trimmed = out.trim();
      if (!trimmed) continue;
      const parsed = JSON.parse(trimmed);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return list
        .filter((d) => d && d.name)
        .map((d) => ({
          name: String(d.name).slice(0, 200),
          className: String(d.className || "").slice(0, 80),
          status: String(d.status || "").slice(0, 40),
          instanceId: String(d.instanceId || "").slice(0, 260),
          problem: !!d.problem,
        }));
    } catch {
      /* try next */
    }
  }
  return [];
}
