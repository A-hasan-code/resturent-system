$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
Set-Location $Root

if (-not (Test-Path ".env")) {
  if (Test-Path ".env.example") { Copy-Item ".env.example" ".env" }
}

function Test-DockerReady {
  try {
    $null = & docker info 2>$null
    return ($LASTEXITCODE -eq 0)
  } catch { return $false }
}

Write-Host "Hotel System starting..." -ForegroundColor Cyan

if (-not (Test-DockerReady)) {
  $dd = @(
    "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
    "${env:ProgramFiles(x86)}\Docker\Docker\Docker Desktop.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($dd) {
    Start-Process $dd | Out-Null
    for ($i = 0; $i -lt 60; $i++) {
      Start-Sleep -Seconds 3
      if (Test-DockerReady) { break }
      Write-Host "." -NoNewline
    }
    Write-Host ""
  }
  if (-not (Test-DockerReady)) {
    Write-Host "Docker not ready. Run HotelSystem-Setup.exe first." -ForegroundColor Red
    Read-Host "Press Enter"
    exit 1
  }
}

# Load images if tags missing (e.g. after reboot before first load finished)
$needLoad = $false
docker image inspect hotel-system-api:1.0.0 1>$null 2>$null
if ($LASTEXITCODE -ne 0) { $needLoad = $true }
if ($needLoad -and (Test-Path ".\images")) {
  Write-Host "Loading images..." -ForegroundColor Yellow
  Get-ChildItem ".\images\*.tar" | ForEach-Object {
    docker load -i $_.FullName
  }
}

docker compose --env-file "$Root\.env" -f "$Root\docker-compose.yml" up -d
if ($LASTEXITCODE -ne 0) {
  Write-Host "Start failed." -ForegroundColor Red
  Read-Host "Press Enter"
  exit 1
}

Write-Host "Ready. Opening http://localhost:3000" -ForegroundColor Green
Start-Sleep -Seconds 5
Start-Process "http://localhost:3000"
