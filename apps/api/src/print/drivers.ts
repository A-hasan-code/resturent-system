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
      var di = new DOCINFO { pDocName = "Hotel System", pDataType = "RAW" };
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

export async function listWindowsPrinters(): Promise<SystemPrinter[]> {
  if (process.platform !== "win32") return [];
  const out = await powershell([
    "-Command",
    "$d=(Get-CimInstance Win32_Printer | Where-Object Default).Name; Get-Printer | ForEach-Object { [pscustomobject]@{ name=$_.Name; driver=$_.DriverName; port=$_.PortName; status=[string]$_.PrinterStatus; isDefault=($_.Name -eq $d) } } | ConvertTo-Json -Compress",
  ]);
  const trimmed = out.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  return Array.isArray(parsed) ? parsed : [parsed];
}
