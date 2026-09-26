# Builds HotelSystem-Setup.exe into -OutDir (client-pack)
param(
  [Parameter(Mandatory = $true)]
  [string]$OutDir
)

$ErrorActionPreference = "Stop"
$OutExe = Join-Path $OutDir "HotelSystem-Setup.exe"
$Cs = Join-Path $env:TEMP "HotelClientSetupLauncher.cs"
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
          "Setup Hotel System.bat not found.\nKeep all files in this folder together.",
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
$csc = @(
  "${env:WINDIR}\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
  "${env:WINDIR}\Microsoft.NET\Framework\v4.0.30319\csc.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $csc) { throw "csc.exe not found" }
& $csc /nologo /target:winexe /r:System.Windows.Forms.dll /out:"$OutExe" "$Cs"
if ($LASTEXITCODE -ne 0) { throw "Compile failed" }
Write-Host "Built $OutExe" -ForegroundColor Green
