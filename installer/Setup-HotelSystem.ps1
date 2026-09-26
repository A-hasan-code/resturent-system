#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Hotel System demo installer — Docker + network + app + shortcuts.
#>
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Step($msg) {
  Write-Host ""
  Write-Host "==> $msg" -ForegroundColor Cyan
}

function Write-Ok($msg) {
  Write-Host "    OK: $msg" -ForegroundColor Green
}

function Write-Warn($msg) {
  Write-Host "    WARN: $msg" -ForegroundColor Yellow
}

function Test-DockerReady {
  try {
    $null = & docker info 2>$null
    return ($LASTEXITCODE -eq 0)
  } catch {
    return $false
  }
}

function Get-DockerDesktopPath {
  @(
    "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
    "${env:ProgramFiles(x86)}\Docker\Docker\Docker Desktop.exe",
    "$env:LOCALAPPDATA\Programs\Docker\Docker\Docker Desktop.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}

function Ensure-ProjectRoot {
  # installer/ is next to project, or we are already in project
  $here = $PSScriptRoot
  if (Test-Path (Join-Path $here "docker\docker-compose.yml")) {
    return (Resolve-Path $here).Path
  }
  $parent = Split-Path -Parent $here
  if (Test-Path (Join-Path $parent "docker\docker-compose.yml")) {
    return (Resolve-Path $parent).Path
  }
  throw "Hotel System project not found. Keep installer folder next to docker\ and apps\."
}

function Ensure-EnvFile($Root) {
  $envFile = Join-Path $Root ".env"
  $example = Join-Path $Root ".env.example"
  if (-not (Test-Path $envFile)) {
    if (Test-Path $example) {
      Copy-Item $example $envFile
      Write-Ok ".env created from .env.example"
    } else {
      @"
POSTGRES_USER=hotel
POSTGRES_PASSWORD=hotel_secret
POSTGRES_DB=hotel_db
POSTGRES_PORT=5432
API_PORT=4000
WEB_PORT=3000
JWT_SECRET=hotel-demo-secret
DATABASE_URL=postgresql://hotel:hotel_secret@localhost:5432/hotel_db
"@ | Set-Content -Path $envFile -Encoding UTF8
      Write-Ok ".env created"
    }
  }
}

function Enable-VirtualizationFeatures {
  Write-Step "Checking Windows features (WSL / Virtual Machine Platform)..."
  try {
    $wsl = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -ErrorAction SilentlyContinue
    if ($wsl -and $wsl.State -ne "Enabled") {
      Write-Warn "Enabling WSL (may need reboot later)..."
      Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -All -NoRestart | Out-Null
    }
    $vm = Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -ErrorAction SilentlyContinue
    if ($vm -and $vm.State -ne "Enabled") {
      Write-Warn "Enabling Virtual Machine Platform..."
      Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -All -NoRestart | Out-Null
    }
    Write-Ok "Windows features checked"
  } catch {
    Write-Warn "Could not change Windows features automatically: $($_.Exception.Message)"
    Write-Warn "If Docker fails, enable WSL2 from Windows Features manually."
  }
}

function Install-DockerDesktop {
  Write-Step "Docker Desktop not found — downloading installer..."
  $tmp = Join-Path $env:TEMP "DockerDesktopInstaller.exe"
  $url = "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe"

  Write-Host "    Downloading from Docker (needs internet)..." -ForegroundColor Gray
  try {
    Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing
  } catch {
    throw "Docker download failed. Connect internet and run Setup again. $($_.Exception.Message)"
  }

  Write-Step "Installing Docker Desktop (quiet) — please wait..."
  $p = Start-Process -FilePath $tmp -ArgumentList @("install", "--quiet", "--accept-license") -Wait -PassThru
  if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) {
    Write-Warn "Docker installer exit code: $($p.ExitCode). Trying to continue..."
  } else {
    Write-Ok "Docker Desktop installed (exit $($p.ExitCode))"
  }

  # Start Docker Desktop
  $dd = Get-DockerDesktopPath
  if ($dd) {
    Write-Step "Starting Docker Desktop..."
    Start-Process $dd
  } else {
    Write-Warn "Docker Desktop path not found yet — you may need to reboot, then run Start Hotel System."
  }
}

function Wait-DockerReady([int]$MaxMinutes = 8) {
  Write-Step "Waiting for Docker engine (up to $MaxMinutes min)..."
  $dd = Get-DockerDesktopPath
  if ($dd -and -not (Test-DockerReady)) {
    Start-Process $dd | Out-Null
  }

  $deadline = (Get-Date).AddMinutes($MaxMinutes)
  $n = 0
  while ((Get-Date) -lt $deadline) {
    if (Test-DockerReady) {
      Write-Host ""
      Write-Ok "Docker is ready"
      return $true
    }
    Start-Sleep -Seconds 5
    $n++
    if ($n % 2 -eq 0) { Write-Host "." -NoNewline }
  }
  Write-Host ""
  return $false
}

function New-Shortcut($LinkPath, $TargetPath, $Arguments, $WorkDir, $Description) {
  $w = New-Object -ComObject WScript.Shell
  $s = $w.CreateShortcut($LinkPath)
  $s.TargetPath = $TargetPath
  if ($Arguments) { $s.Arguments = $Arguments }
  if ($WorkDir) { $s.WorkingDirectory = $WorkDir }
  $s.Description = $Description
  $s.Save()
}

function Install-Shortcuts($Root) {
  Write-Step "Creating Desktop & Start Menu shortcuts..."
  $desktop = [Environment]::GetFolderPath("Desktop")
  $startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Hotel System"
  New-Item -ItemType Directory -Force -Path $startMenu | Out-Null

  $startBat = Join-Path $Root "scripts\Start Hotel System.bat"
  $stopBat = Join-Path $Root "scripts\Stop Hotel System.bat"

  New-Shortcut (Join-Path $desktop "Start Hotel System.lnk") $startBat $null (Join-Path $Root "scripts") "Start Hotel System POS"
  New-Shortcut (Join-Path $desktop "Stop Hotel System.lnk") $stopBat $null (Join-Path $Root "scripts") "Stop Hotel System"
  New-Shortcut (Join-Path $startMenu "Start Hotel System.lnk") $startBat $null (Join-Path $Root "scripts") "Start Hotel System POS"
  New-Shortcut (Join-Path $startMenu "Stop Hotel System.lnk") $stopBat $null (Join-Path $Root "scripts") "Stop Hotel System"

  Write-Ok "Shortcuts on Desktop + Start Menu"
}

function Start-HotelStack($Root) {
  Write-Step "Starting Hotel System (Docker network + database + API + web)..."
  Ensure-EnvFile $Root
  Set-Location (Join-Path $Root "docker")
  & docker compose --env-file "$Root\.env" up -d --build
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose failed. Check Docker Desktop is running."
  }
  Write-Ok "Containers started (network auto-created by Docker Compose)"
}

# ---------- main ----------
Clear-Host
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Hotel System — Demo Installer" -ForegroundColor Cyan
Write-Host "  Pixalbotics · https://www.pixalbotics.com/" -ForegroundColor DarkGray
Write-Host "========================================" -ForegroundColor Cyan

$Root = Ensure-ProjectRoot
Write-Ok "Project: $Root"

# Admin already required via #Requires
Enable-VirtualizationFeatures

if (Test-DockerReady) {
  Write-Ok "Docker already running"
} elseif (Get-DockerDesktopPath) {
  Write-Step "Docker Desktop found — starting..."
  Start-Process (Get-DockerDesktopPath)
  if (-not (Wait-DockerReady 8)) {
    Write-Warn "Docker did not become ready."
    Write-Host "  1) Open Docker Desktop manually"
    Write-Host "  2) Wait until it says Running"
    Write-Host "  3) Double-click Desktop: Start Hotel System"
    Write-Host ""
    Write-Host "If this is first install, reboot Windows once, then Start again." -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
  }
} else {
  Install-DockerDesktop
  if (-not (Wait-DockerReady 10)) {
    Write-Host ""
    Write-Host "Docker needs a reboot after first install." -ForegroundColor Yellow
    Write-Host "Please RESTART the PC, then double-click:" -ForegroundColor Yellow
    Write-Host "  Desktop → Start Hotel System" -ForegroundColor White
    Write-Host ""
    $reboot = Read-Host "Reboot now? (Y/N)"
    if ($reboot -match '^[Yy]') {
      Restart-Computer -Force
    }
    exit 0
  }
}

Install-Shortcuts $Root
Start-HotelStack $Root

Write-Step "Opening app..."
Start-Sleep -Seconds 6
Start-Process "http://localhost:3000"

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  SETUP COMPLETE" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Open:  http://localhost:3000"
Write-Host ""
Write-Host "  Demo logins:"
Write-Host "    admin    / admin123"
Write-Host "    cashier  / cashier123"
Write-Host "    kitchen  / kitchen123"
Write-Host "    store    / store123"
Write-Host ""
Write-Host "  Desktop shortcuts: Start / Stop Hotel System"
Write-Host "========================================" -ForegroundColor Green
Read-Host "Press Enter to close"
