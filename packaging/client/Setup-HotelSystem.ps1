#Requires -RunAsAdministrator
<#
  Client pack installer — NO source code.
  Loads pre-built Docker images, starts stack, creates shortcuts.
#>
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Step($msg) {
  Write-Host ""
  Write-Host "==> $msg" -ForegroundColor Cyan
}
function Write-Ok($msg) { Write-Host "    OK: $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    WARN: $msg" -ForegroundColor Yellow }

function Test-DockerReady {
  try {
    $null = & docker info 2>$null
    return ($LASTEXITCODE -eq 0)
  } catch { return $false }
}

function Get-DockerDesktopPath {
  @(
    "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
    "${env:ProgramFiles(x86)}\Docker\Docker\Docker Desktop.exe",
    "$env:LOCALAPPDATA\Programs\Docker\Docker\Docker Desktop.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}

function Enable-VirtualizationFeatures {
  Write-Step "Checking Windows features (WSL / VM Platform)..."
  try {
    $wsl = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -ErrorAction SilentlyContinue
    if ($wsl -and $wsl.State -ne "Enabled") {
      Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -All -NoRestart | Out-Null
    }
    $vm = Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -ErrorAction SilentlyContinue
    if ($vm -and $vm.State -ne "Enabled") {
      Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -All -NoRestart | Out-Null
    }
    Write-Ok "Windows features checked"
  } catch {
    Write-Warn "Could not change Windows features: $($_.Exception.Message)"
  }
}

function Install-DockerDesktop {
  Write-Step "Docker not found — downloading Docker Desktop..."
  $tmp = Join-Path $env:TEMP "DockerDesktopInstaller.exe"
  $url = "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe"
  try {
    Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing
  } catch {
    throw "Download failed. Need internet for first Docker install. $($_.Exception.Message)"
  }
  Write-Step "Installing Docker Desktop (quiet)..."
  $p = Start-Process -FilePath $tmp -ArgumentList @("install", "--quiet", "--accept-license") -Wait -PassThru
  Write-Ok "Installer finished (exit $($p.ExitCode))"
  $dd = Get-DockerDesktopPath
  if ($dd) { Start-Process $dd }
}

function Wait-DockerReady([int]$MaxMinutes = 10) {
  Write-Step "Waiting for Docker engine..."
  $dd = Get-DockerDesktopPath
  if ($dd -and -not (Test-DockerReady)) { Start-Process $dd | Out-Null }
  $deadline = (Get-Date).AddMinutes($MaxMinutes)
  while ((Get-Date) -lt $deadline) {
    if (Test-DockerReady) {
      Write-Ok "Docker ready"
      return $true
    }
    Start-Sleep -Seconds 5
    Write-Host "." -NoNewline
  }
  Write-Host ""
  return $false
}

function Ensure-Env($Root) {
  $envFile = Join-Path $Root ".env"
  if (-not (Test-Path $envFile)) {
    $ex = Join-Path $Root ".env.example"
    if (Test-Path $ex) { Copy-Item $ex $envFile }
    else {
      @"
POSTGRES_USER=hotel
POSTGRES_PASSWORD=hotel_secret
POSTGRES_DB=hotel_db
POSTGRES_PORT=5432
API_PORT=4000
WEB_PORT=3000
JWT_SECRET=hotel-demo-secret
"@ | Set-Content $envFile -Encoding UTF8
    }
    Write-Ok ".env created"
  }
}

function Import-Images($Root) {
  $imgDir = Join-Path $Root "images"
  if (-not (Test-Path $imgDir)) {
    throw "images\ folder missing. This pack is incomplete."
  }
  Write-Step "Loading pre-built images (no source build)..."
  $tars = @(
    "postgres.tar",
    "hotel-api.tar",
    "hotel-web.tar"
  )
  foreach ($t in $tars) {
    $path = Join-Path $imgDir $t
    if (-not (Test-Path $path)) { throw "Missing $t in images\" }
    Write-Host "    Loading $t ..." -ForegroundColor Gray
    docker load -i $path
    if ($LASTEXITCODE -ne 0) { throw "docker load failed for $t" }
  }
  Write-Ok "All images loaded"
}

function New-Shortcut($LinkPath, $TargetPath, $WorkDir, $Description) {
  $w = New-Object -ComObject WScript.Shell
  $s = $w.CreateShortcut($LinkPath)
  $s.TargetPath = $TargetPath
  $s.WorkingDirectory = $WorkDir
  $s.Description = $Description
  $s.Save()
}

function Install-Shortcuts($Root) {
  Write-Step "Creating Desktop shortcuts..."
  $desktop = [Environment]::GetFolderPath("Desktop")
  $startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Hotel System"
  New-Item -ItemType Directory -Force -Path $startMenu | Out-Null
  $startBat = Join-Path $Root "Start Hotel System.bat"
  $stopBat = Join-Path $Root "Stop Hotel System.bat"
  New-Shortcut (Join-Path $desktop "Start Hotel System.lnk") $startBat $Root "Start Hotel System"
  New-Shortcut (Join-Path $desktop "Stop Hotel System.lnk") $stopBat $Root "Stop Hotel System"
  New-Shortcut (Join-Path $startMenu "Start Hotel System.lnk") $startBat $Root "Start Hotel System"
  New-Shortcut (Join-Path $startMenu "Stop Hotel System.lnk") $stopBat $Root "Stop Hotel System"
  Write-Ok "Shortcuts created"
}

function Start-Stack($Root) {
  Write-Step "Starting Hotel System (Docker network auto)..."
  Ensure-Env $Root
  Set-Location $Root
  docker compose --env-file "$Root\.env" -f "$Root\docker-compose.yml" up -d
  if ($LASTEXITCODE -ne 0) { throw "docker compose up failed" }
  Write-Ok "Containers running"
}

# ---- main ----
Clear-Host
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Hotel System — Client Setup" -ForegroundColor Cyan
Write-Host "  (Pre-built images · no source code)" -ForegroundColor DarkGray
Write-Host "  Pixalbotics · pixalbotics.com" -ForegroundColor DarkGray
Write-Host "========================================" -ForegroundColor Cyan

$Root = $PSScriptRoot
if (-not (Test-Path (Join-Path $Root "docker-compose.yml"))) {
  throw "docker-compose.yml not found. Run Setup from inside the client-pack folder."
}
if (-not (Test-Path (Join-Path $Root "images"))) {
  throw "images\ folder not found. Pack incomplete."
}

Enable-VirtualizationFeatures

if (Test-DockerReady) {
  Write-Ok "Docker already running"
} elseif (Get-DockerDesktopPath) {
  Start-Process (Get-DockerDesktopPath)
  if (-not (Wait-DockerReady 8)) {
    Write-Warn "Docker not ready. Open Docker Desktop, wait, then run Start Hotel System."
    Read-Host "Press Enter"
    exit 1
  }
} else {
  Install-DockerDesktop
  if (-not (Wait-DockerReady 10)) {
    Write-Host "Reboot required after first Docker install." -ForegroundColor Yellow
    Write-Host "After reboot, run Setup again OR Desktop → Start Hotel System"
    $r = Read-Host "Reboot now? (Y/N)"
    if ($r -match '^[Yy]') { Restart-Computer -Force }
    exit 0
  }
}

Import-Images $Root
Install-Shortcuts $Root
Start-Stack $Root

Write-Step "Opening app..."
Start-Sleep -Seconds 8
Start-Process "http://localhost:3000"

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  SETUP COMPLETE" -ForegroundColor Green
Write-Host "  http://localhost:3000" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "  admin    / admin123"
Write-Host "  cashier  / cashier123"
Write-Host "  kitchen  / kitchen123"
Write-Host "  store    / store123"
Write-Host "========================================" -ForegroundColor Green
Read-Host "Press Enter to close"
