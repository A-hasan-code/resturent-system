# Developer helpers: seed, open data/backups, print DB connection.
#
#   pnpm hotel:dev seed
#   pnpm hotel:dev seed:inventory
#   pnpm hotel:dev backups
#   pnpm hotel:dev data
#   pnpm hotel:dev db
#   pnpm hotel:dev info
#
param(
  [ValidateSet("seed", "seed:inventory", "list", "backups", "data", "db", "info", "help")]
  [string]$Command = "help",
  [string]$File = ""
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\Tools.ps1")

$ApiDir = Join-Path $RepoRoot "apps\api"
$EnvFile = Join-Path $ApiDir ".env"
$DevData = Join-Path $RepoRoot ".dev\data"
$DevBackups = Join-Path $DevData "backups"
$ProdData = Join-Path $env:ProgramData "HotelSystem"
$ProdEnv = Join-Path $ProdData "hotel.env"

function Read-DotEnv([string]$path) {
  $map = @{}
  if (-not (Test-Path $path)) { return $map }
  Get-Content $path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $eq = $line.IndexOf("=")
    if ($eq -lt 1) { return }
    $map[$line.Substring(0, $eq).Trim()] = $line.Substring($eq + 1).Trim().Trim('"')
  }
  return $map
}

function Get-DataDir {
  $dev = Read-DotEnv $EnvFile
  if ($dev["HOTEL_DATA_DIR"]) {
    $p = $dev["HOTEL_DATA_DIR"]
    if (-not [IO.Path]::IsPathRooted($p)) { $p = Join-Path $ApiDir $p }
    $resolved = Resolve-Path $p -ErrorAction SilentlyContinue
    if ($resolved) { return $resolved.Path }
    return $p
  }
  if (Test-Path $ProdData) { return $ProdData }
  return $DevData
}

function Invoke-Seed([string]$rel) {
  $tsx = Join-Path $ApiDir "node_modules\tsx\dist\cli.mjs"
  if (-not (Test-Path $tsx)) { $tsx = Join-Path $RepoRoot "node_modules\tsx\dist\cli.mjs" }
  if (-not (Test-Path $tsx)) { throw "tsx not found. Run pnpm install first." }
  $script = Join-Path $ApiDir $rel
  if (-not (Test-Path $script)) { throw "Missing $script" }
  $envMap = Read-DotEnv $EnvFile
  if (-not $envMap["DATABASE_URL"] -and (Test-Path $ProdEnv)) {
    $envMap = Read-DotEnv $ProdEnv
  }
  if (-not $envMap["DATABASE_URL"]) { throw "DATABASE_URL missing (apps/api/.env or ProgramData hotel.env)" }
  Write-Host "Running $rel …"
  Write-Host "Confirm live hotel: backup first (Settings → Backup, or copy backups folder)."
  $env:DATABASE_URL = $envMap["DATABASE_URL"]
  & node $tsx $script
  if ($LASTEXITCODE -ne 0) { throw "Seed failed (exit $LASTEXITCODE)" }
  Write-Host "Seed OK"
}

function Show-DbInfo {
  $envMap = Read-DotEnv $EnvFile
  if (-not $envMap["DATABASE_URL"] -and (Test-Path $ProdEnv)) { $envMap = Read-DotEnv $ProdEnv }
  $url = $envMap["DATABASE_URL"]
  if (-not $url) { throw "DATABASE_URL not found" }
  Write-Host "DATABASE_URL=$url"
  $pgBin = if ($envMap["PG_BIN"]) {
    $p = $envMap["PG_BIN"]
    if (-not [IO.Path]::IsPathRooted($p)) { $p = Join-Path $ApiDir $p }
    Join-Path $p "psql.exe"
  } elseif (Test-Path (Join-Path $RepoRoot "packaging\cache\pgsql\bin\psql.exe")) {
    Join-Path $RepoRoot "packaging\cache\pgsql\bin\psql.exe"
  } else { $null }
  if ($pgBin -and (Test-Path $pgBin)) {
    Write-Host "psql: $pgBin"
    Write-Host "Open shell: set PGPASSWORD then & `"$pgBin`" `$DATABASE_URL"
  }
}

function List-Seeds {
  $re = '^(seed|import)[-.].+\.ts$|^seed\.ts$|^import.+\.ts$'
  foreach ($folder in @("prisma", "scripts")) {
    $dir = Join-Path $ApiDir $folder
    if (-not (Test-Path $dir)) { continue }
    Get-ChildItem $dir -Filter "*.ts" | Where-Object { $_.Name -match $re } | Sort-Object Name | ForEach-Object {
      Write-Host ("  {0}/{1}" -f $folder, $_.Name)
    }
  }
}

switch ($Command) {
  "list" { Write-Host "Seed scripts:"; List-Seeds }
  "seed" {
    if ($File) { Invoke-Seed ($File -replace "/", "\") }
    else { Invoke-Seed "prisma\seed.ts" }
  }
  "seed:inventory" { Invoke-Seed "prisma\import-pdf-inventory.ts" }
  "backups" {
    $dir = Join-Path (Get-DataDir) "backups"
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Write-Host $dir
    Start-Process explorer.exe $dir
  }
  "data" {
    $dir = Get-DataDir
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Write-Host $dir
    Start-Process explorer.exe $dir
  }
  "db" { Show-DbInfo }
  "info" {
    Write-Host "Repo: $RepoRoot"
    Write-Host "Data: $(Get-DataDir)"
    Write-Host "Dev backups: $DevBackups"
    if (Test-Path $ProdData) { Write-Host "Installed: $ProdData" }
    Show-DbInfo
  }
  default {
    Write-Host @"
hotel:dev commands
  list                      List seed/import scripts on disk
  seed                      Run prisma/seed.ts (full catalog)
  seed -File scripts\x.ts   Run a specific seed file
  seed:inventory            Run prisma/import-pdf-inventory.ts
  backups                   Open backups folder in Explorer
  data                      Open HOTEL_DATA_DIR in Explorer
  db                        Print DATABASE_URL / psql hint
  info                      Paths + DB summary
"@
  }
}
