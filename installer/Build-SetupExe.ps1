# Builds HotelSystem-Setup.exe launcher (runs Setup bat as Admin).
# Uses .NET Framework csc.exe on Windows — no extra tools required.
$ErrorActionPreference = "Stop"
$Here = $PSScriptRoot
$OutExe = Join-Path $Here "HotelSystem-Setup.exe"
$Cs = Join-Path $env:TEMP "HotelSystemSetupLauncher.cs"

$batName = "Setup Hotel System.bat"
$source = @"
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

sealed class Program {
  [STAThread]
  static void Main() {
    try {
      string dir = AppDomain.CurrentDomain.BaseDirectory;
      string bat = Path.Combine(dir, "$batName");
      if (!File.Exists(bat)) {
        MessageBox.Show(
          "Setup Hotel System.bat not found next to this .exe.\nKeep the full installer folder together.",
          "Hotel System Setup",
          MessageBoxButtons.OK,
          MessageBoxIcon.Error);
        return;
      }
      var psi = new ProcessStartInfo {
        FileName = bat,
        WorkingDirectory = dir,
        UseShellExecute = true,
        Verb = "runas"
      };
      Process.Start(psi);
    } catch (Exception ex) {
      MessageBox.Show(ex.Message, "Hotel System Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
  }
}
"@

Set-Content -Path $Cs -Value $source -Encoding UTF8

$cscCandidates = @(
  "${env:WINDIR}\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
  "${env:WINDIR}\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)
$csc = $cscCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $csc) {
  throw "csc.exe not found. .NET Framework 4 is required to build the .exe."
}

Write-Host "Compiling HotelSystem-Setup.exe ..." -ForegroundColor Cyan
& $csc /nologo /target:winexe /r:System.Windows.Forms.dll /out:"$OutExe" "$Cs"
if ($LASTEXITCODE -ne 0) { throw "Compile failed" }

Write-Host "Built: $OutExe" -ForegroundColor Green
Write-Host ""
Write-Host "Demo pack: copy entire project folder (or at least keep installer\ next to docker\ apps\ scripts\)."
Write-Host "Client runs: installer\HotelSystem-Setup.exe"
