# Install Hotel System without Setup.exe (bypasses Smart App Control Error 4551).
# Copies the local build stage into Program Files and runs the same post-install script
# the Inno installer would run. Requires Administrator.
#
# Usage (from repo, elevated PowerShell):
#   cd ...\resturent-system\releases\v1.3.0
#   powershell -ExecutionPolicy Bypass -File .\Install-BypassSAC.ps1
#   powershell -ExecutionPolicy Bypass -File .\Install-BypassSAC.ps1 -Mode client

#Requires -RunAsAdministrator
param(
  [ValidateSet("server", "client")][string]$Mode = "server",
  [string]$StageDir = "",
  [string]$AppDir = (Join-Path $env:ProgramFiles "HotelSystem")
)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$repo = (Resolve-Path (Join-Path $here "..\..")).Path
if (-not $StageDir) { $StageDir = Join-Path $repo "build\stage" }

if (-not (Test-Path (Join-Path $StageDir "scripts\install.ps1"))) {
  throw "Stage not found at $StageDir. Rebuild with packaging\windows\Build-Release.ps1 first."
}

Write-Host "Hotel System install (bypass Setup.exe) — Mode=$Mode" -ForegroundColor Cyan
Write-Host "From: $StageDir"
Write-Host "To:   $AppDir"

# Stop previous services if upgrading
foreach ($svc in "HotelSystemAPI", "HotelSystemDB") {
  $s = Get-Service $svc -ErrorAction SilentlyContinue
  if ($s -and $s.Status -ne "Stopped") {
    Write-Host "Stopping $svc..."
    Stop-Service $svc -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  }
}

New-Item -ItemType Directory -Force -Path $AppDir | Out-Null

function Sync-Tree([string]$src, [string]$dst) {
  if (-not (Test-Path $src)) { return }
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  Write-Host "Copying $(Split-Path $src -Leaf)..."
  robocopy $src $dst /MIR /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed for $src (exit $LASTEXITCODE)" }
}

if ($Mode -eq "server") {
  Sync-Tree (Join-Path $StageDir "node") (Join-Path $AppDir "node")
  Sync-Tree (Join-Path $StageDir "pgsql") (Join-Path $AppDir "pgsql")
  Sync-Tree (Join-Path $StageDir "winsw") (Join-Path $AppDir "winsw")
  Sync-Tree (Join-Path $StageDir "app") (Join-Path $AppDir "app")
}
Sync-Tree (Join-Path $StageDir "desktop") (Join-Path $AppDir "desktop")
Sync-Tree (Join-Path $StageDir "scripts") (Join-Path $AppDir "scripts")
Copy-Item (Join-Path $StageDir "VERSION") (Join-Path $AppDir "VERSION") -Force
$icon = Join-Path $repo "packaging\windows\icon.ico"
if (Test-Path $icon) { Copy-Item $icon (Join-Path $AppDir "scripts\icon.ico") -Force }

Write-Host "Running install.ps1..." -ForegroundColor Cyan
& (Join-Path $AppDir "scripts\install.ps1") -AppDir $AppDir -Mode $Mode
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "install.ps1 failed ($LASTEXITCODE)" }

Write-Host ""
Write-Host "Install finished." -ForegroundColor Green
$info = Join-Path $env:ProgramData "HotelSystem\server-info.txt"
if (Test-Path $info) {
  Write-Host "---- server-info ----"
  Get-Content $info
}
$desk = Join-Path $AppDir "desktop\Hotel System.exe"
if (Test-Path $desk) {
  Write-Host "Launching desktop app..."
  Start-Process $desk
}
