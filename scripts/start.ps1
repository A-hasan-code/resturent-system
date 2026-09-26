$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Test-Path ".env")) {
  if (Test-Path ".env.example") {
    Copy-Item ".env.example" ".env"
  } else {
    throw ".env missing — run Setup Hotel System first."
  }
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

Write-Host "Hotel System starting..." -ForegroundColor Cyan

if (-not (Test-DockerReady)) {
  Write-Host "Starting Docker Desktop..." -ForegroundColor Yellow
  $dockerDesktop = Get-DockerDesktopPath
  if ($dockerDesktop) {
    Start-Process $dockerDesktop | Out-Null
    for ($i = 0; $i -lt 60; $i++) {
      Start-Sleep -Seconds 3
      if (Test-DockerReady) { break }
      Write-Host "." -NoNewline
    }
    Write-Host ""
  }

  if (-not (Test-DockerReady)) {
    Write-Host ""
    Write-Host "Docker is not ready." -ForegroundColor Red
    Write-Host "1) Open Docker Desktop and wait until it is Running"
    Write-Host "2) Or run installer\Setup Hotel System.bat / HotelSystem-Setup.exe"
    Write-Host ""
    Read-Host "Press Enter"
    exit 1
  }
}

Set-Location "$Root\docker"
Write-Host "Starting containers (network + database + API + web)..." -ForegroundColor Cyan
docker compose --env-file "$Root\.env" up -d --build
if ($LASTEXITCODE -ne 0) {
  Write-Host "Failed to start. Is Docker Desktop running?" -ForegroundColor Red
  Read-Host "Press Enter"
  exit 1
}

Write-Host "Services ready. Opening app..." -ForegroundColor Green
Start-Sleep -Seconds 5
Start-Process "http://localhost:3000"
