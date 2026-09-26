#Requires -Version 5.1
<#
.SYNOPSIS
  Build versioned client release ZIP (NO apps/ source).
  Output: releases/HotelSystem-vX.Y.Z.zip  — send THIS one file to client.
#>
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Root = Split-Path -Parent $PSScriptRoot
$DockerDir = Join-Path $Root "docker"
$ClientSrc = Join-Path $Root "packaging\client"
$ReleasesDir = Join-Path $Root "releases"
$VersionFile = Join-Path $Root "VERSION"

if (-not (Test-Path (Join-Path $DockerDir "docker-compose.yml"))) {
  throw "docker\docker-compose.yml not found."
}

# ---- version ----
$Version = "1.0.0"
if (Test-Path $VersionFile) {
  $Version = (Get-Content $VersionFile -Raw).Trim()
}
if ($Version -notmatch '^\d+\.\d+\.\d+') {
  throw "VERSION file must be like 1.0.0 (got: $Version)"
}

$ReleaseName = "HotelSystem-v$Version"
$Pack = Join-Path $Root "client-pack"
$Stage = Join-Path $env:TEMP $ReleaseName
$ImagesDir = Join-Path $Pack "images"
$ZipPath = Join-Path $ReleasesDir "$ReleaseName.zip"

$ApiImage = "hotel-system-api:$Version"
$WebImage = "hotel-system-web:$Version"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Hotel System Release Builder" -ForegroundColor Cyan
Write-Host "  Version: $Version" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Project: $Root"
Write-Host "ZIP:     $ZipPath"
Write-Host ""

docker info 1>$null 2>$null
if ($LASTEXITCODE -ne 0) {
  throw "Start Docker Desktop first, then run again."
}

if (-not (Test-Path (Join-Path $Root ".env"))) {
  Copy-Item (Join-Path $Root ".env.example") (Join-Path $Root ".env") -ErrorAction SilentlyContinue
}

# Align compose image tags with VERSION for this build
$composeFiles = @(
  (Join-Path $DockerDir "docker-compose.yml"),
  (Join-Path $DockerDir "docker-compose.client.yml")
)
foreach ($cf in $composeFiles) {
  if (Test-Path $cf) {
    $txt = Get-Content $cf -Raw
    $txt = $txt -replace 'hotel-system-api:\S+', $ApiImage
    $txt = $txt -replace 'hotel-system-web:\S+', $WebImage
    Set-Content -Path $cf -Value $txt -Encoding UTF8 -NoNewline
  }
}

Write-Host "==> Building images $ApiImage / $WebImage ..." -ForegroundColor Cyan
Set-Location $DockerDir
docker compose --env-file "$Root\.env" build api web
if ($LASTEXITCODE -ne 0) { throw "Build failed" }

# Ensure exact tags (compose may have set them)
docker tag $ApiImage $ApiImage 2>$null
docker tag $WebImage $WebImage 2>$null

Write-Host "==> Pulling postgres:16-alpine..." -ForegroundColor Cyan
docker pull postgres:16-alpine
if ($LASTEXITCODE -ne 0) { throw "Postgres pull failed" }

if (Test-Path $Pack) { Remove-Item -Recurse -Force $Pack }
New-Item -ItemType Directory -Force -Path $ImagesDir | Out-Null
New-Item -ItemType Directory -Force -Path $ReleasesDir | Out-Null

Write-Host "==> Saving images..." -ForegroundColor Cyan
docker save $ApiImage -o (Join-Path $ImagesDir "hotel-api.tar")
if ($LASTEXITCODE -ne 0) { throw "save api failed" }
docker save $WebImage -o (Join-Path $ImagesDir "hotel-web.tar")
if ($LASTEXITCODE -ne 0) { throw "save web failed" }
docker save postgres:16-alpine -o (Join-Path $ImagesDir "postgres.tar")
if ($LASTEXITCODE -ne 0) { throw "save postgres failed" }

Write-Host "==> Assembling pack files..." -ForegroundColor Cyan
# Client compose with this version's tags
$clientCompose = Get-Content (Join-Path $DockerDir "docker-compose.client.yml") -Raw
Set-Content (Join-Path $Pack "docker-compose.yml") -Value $clientCompose -Encoding UTF8

if (Test-Path (Join-Path $Root ".env.example")) {
  Copy-Item (Join-Path $Root ".env.example") (Join-Path $Pack ".env.example")
} else {
  @"
POSTGRES_USER=hotel
POSTGRES_PASSWORD=hotel_secret
POSTGRES_DB=hotel_db
POSTGRES_PORT=5432
API_PORT=4000
WEB_PORT=3000
JWT_SECRET=hotel-demo-secret
"@ | Set-Content (Join-Path $Pack ".env.example") -Encoding UTF8
}

Copy-Item (Join-Path $ClientSrc "Setup-HotelSystem.ps1") $Pack
Copy-Item (Join-Path $ClientSrc "Setup Hotel System.bat") $Pack
Copy-Item (Join-Path $ClientSrc "start.ps1") $Pack
Copy-Item (Join-Path $ClientSrc "stop.ps1") $Pack
Copy-Item (Join-Path $ClientSrc "Start Hotel System.bat") $Pack
Copy-Item (Join-Path $ClientSrc "Stop Hotel System.bat") $Pack

# Versioned README
@"
Hotel System — Client Release v$Version
=======================================
Pixalbotics · https://www.pixalbotics.com/

INSTALL
-------
1. Extract this ZIP completely (keep all files together).
2. Open the extracted folder.
3. Double-click: HotelSystem-Setup.exe
4. Allow Administrator and wait.
5. Browser opens http://localhost:3000

If Docker installed for the first time: reboot once, then
Desktop → Start Hotel System.

Demo logins
-----------
admin    / admin123
cashier  / cashier123
kitchen  / kitchen123
store    / store123

Stop: Desktop → Stop Hotel System

Version: $Version
"@ | Set-Content (Join-Path $Pack "README.txt") -Encoding UTF8

Set-Content (Join-Path $Pack "VERSION") -Value $Version -Encoding UTF8

# Patch start.ps1 image tag check for this version
$startPs1 = Get-Content (Join-Path $Pack "start.ps1") -Raw
$startPs1 = $startPs1 -replace 'hotel-system-api:\S+', $ApiImage
Set-Content (Join-Path $Pack "start.ps1") -Value $startPs1 -Encoding UTF8

Write-Host "==> Building HotelSystem-Setup.exe..." -ForegroundColor Cyan
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ClientSrc "Build-SetupExe.ps1") -OutDir $Pack

# Stage as versioned folder then zip ONE file
Write-Host "==> Creating release ZIP..." -ForegroundColor Cyan
if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Force -Path $Stage | Out-Null
Copy-Item -Path (Join-Path $Pack "*") -Destination $Stage -Recurse -Force

if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }

# Compress-Archive needs .NET; folder content under versioned name
$ZipParent = Join-Path $env:TEMP "hotel-release-zip"
if (Test-Path $ZipParent) { Remove-Item -Recurse -Force $ZipParent }
New-Item -ItemType Directory -Force -Path $ZipParent | Out-Null
$ZipFolder = Join-Path $ZipParent $ReleaseName
Move-Item $Stage $ZipFolder
Compress-Archive -Path $ZipFolder -DestinationPath $ZipPath -CompressionLevel Optimal
Remove-Item -Recurse -Force $ZipParent

$zipMb = [math]::Round((Get-Item $ZipPath).Length / 1MB, 1)
$packMb = [math]::Round(((Get-ChildItem $Pack -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB, 1)

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  RELEASE READY" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Version:  $Version"
Write-Host "  Pack:     $Pack  (~$packMb MB)"
Write-Host "  SEND THIS FILE TO CLIENT:"
Write-Host "  $ZipPath" -ForegroundColor Yellow
Write-Host "  Size:     ~$zipMb MB"
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Client: extract ZIP → HotelSystem-Setup.exe"
Write-Host "  Next version: edit VERSION file (e.g. 1.0.1) then rebuild."
Write-Host "========================================" -ForegroundColor Green
