# Fixes Prisma failed / partial migrations on an already-installed Main PC.
# Handles P3009 (failed row) and P3018 (already exists).
# Run elevated PowerShell:
#   powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Program Files\HotelSystem\scripts\Repair-Migrations.ps1"
param(
  [string]$AppDir = (Split-Path $PSScriptRoot -Parent),
  [string]$DataDir = (Join-Path $env:ProgramData "HotelSystem")
)

$ErrorActionPreference = "Stop"
$EnvFile = Join-Path $DataDir "hotel.env"
$ApiDir = Join-Path $AppDir "app\api"
$Node = Join-Path $AppDir "node\node.exe"

if (-not (Test-Path $EnvFile)) { throw "Missing $EnvFile" }
if (-not (Test-Path $Node)) { throw "Missing $Node" }
if (-not (Test-Path (Join-Path $ApiDir "prisma\schema.prisma"))) { throw "Missing API at $ApiDir" }

Get-Content $EnvFile | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#")) { return }
  $eq = $line.IndexOf("=")
  if ($eq -lt 1) { return }
  $k = $line.Substring(0, $eq).Trim()
  $v = $line.Substring($eq + 1).Trim()
  if ($k -and $v) { Set-Item -Path "Env:$k" -Value $v }
}

if (-not $env:DATABASE_URL) { throw "DATABASE_URL missing in hotel.env" }

$env:CHECKPOINT_DISABLE = "1"
$env:PRISMA_HIDE_UPDATE_MESSAGE = "1"

function Get-MigrationNames([string]$text) {
  $n = [regex]::Matches($text, 'The\s+.([0-9]{14}_[A-Za-z0-9_]+).\s+migration') | ForEach-Object { $_.Groups[1].Value }
  if (-not $n) { $n = [regex]::Matches($text, 'Migration name:\s*(\S+)') | ForEach-Object { $_.Groups[1].Value } }
  if (-not $n) { $n = [regex]::Matches($text, 'Applying migration .([0-9]{14}_[A-Za-z0-9_]+).') | ForEach-Object { $_.Groups[1].Value } }
  return @($n | Select-Object -Unique)
}

Write-Host "Checking migration status..." -ForegroundColor Cyan
Push-Location $ApiDir
try {
  & $Node "node_modules\prisma\build\index.js" "migrate" "status" "--schema" "prisma\schema.prisma" 2>&1 | ForEach-Object { Write-Host $_ }

  $deploy = & $Node "node_modules\prisma\build\index.js" "migrate" "deploy" "--schema" "prisma\schema.prisma" 2>&1
  $deploy | ForEach-Object { Write-Host $_ }
  if ($LASTEXITCODE -eq 0) {
    Write-Host "Migrations OK." -ForegroundColor Green
    exit 0
  }

  $text = ($deploy | ForEach-Object { "$_" }) -join "`n"
  $isP3009 = ($text -match 'P3009' -or $text -match 'failed migrations')
  $isPartial = ($text -match 'already exists' -or $text -match 'duplicate key' -or $text -match 'P3018')
  if (-not $isP3009 -and -not $isPartial) {
    throw "migrate deploy failed (not a recoverable P3009/P3018). Exit $LASTEXITCODE"
  }
  $names = Get-MigrationNames $text
  if (-not $names -or $names.Count -eq 0) {
    throw "Recoverable migrate error but migration name not found. Paste this output to support."
  }

  if ($isP3009) {
    foreach ($name in $names) {
      Write-Host "Resolving failed migration as rolled-back: $name" -ForegroundColor Yellow
      & $Node "node_modules\prisma\build\index.js" "migrate" "resolve" "--rolled-back" $name "--schema" "prisma\schema.prisma"
    }
    $deploy2 = & $Node "node_modules\prisma\build\index.js" "migrate" "deploy" "--schema" "prisma\schema.prisma" 2>&1
    $deploy2 | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -eq 0) {
      Write-Host "Fixed. Restart HotelSystemAPI or re-run the installer." -ForegroundColor Green
      exit 0
    }
    $text = ($deploy2 | ForEach-Object { "$_" }) -join "`n"
    $names2 = Get-MigrationNames $text
    if ($names2 -and $names2.Count -gt 0) { $names = $names2 }
  }

  foreach ($name in $names) {
    Write-Host "Marking as applied (objects may already exist): $name" -ForegroundColor Yellow
    & $Node "node_modules\prisma\build\index.js" "migrate" "resolve" "--applied" $name "--schema" "prisma\schema.prisma"
  }
  & $Node "node_modules\prisma\build\index.js" "migrate" "deploy" "--schema" "prisma\schema.prisma"
  if ($LASTEXITCODE -ne 0) { throw "Still failing after resolve. See messages above." }
  Write-Host "Migrations fixed. Restart HotelSystemAPI or re-run the installer." -ForegroundColor Green
} finally {
  Pop-Location
}
