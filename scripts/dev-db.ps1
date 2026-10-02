# Local PostgreSQL for development (portable binaries, no Docker, no Windows service).
#
#   pnpm db:start    initialise (first run) and start on localhost:5544
#   pnpm db:stop     stop
#   pnpm db:status   show state
#   pnpm db:reset    delete all local data and start fresh
#
# Data lives in .dev\pgdata (git-ignored). Credentials match apps/api/.env.example.
param([ValidateSet("start", "stop", "status", "reset")][string]$Command = "start")

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\Tools.ps1")

# Uncommon port so it never collides with other local PostgreSQL instances (5432/5433).
$Port = 5544
$User = "hotel"
$Password = "hotel_dev"
$Database = "hotel_db"

$DevDir = Join-Path $RepoRoot ".dev"
$PgData = Join-Path $DevDir "pgdata"
$LogFile = Join-Path $DevDir "postgres.log"
$Bin = Join-Path (Get-PostgresHome) "bin"

function Pg([string]$exe) { Join-Path $Bin "$exe.exe" }

function Test-Running {
  if (-not (Test-Path (Join-Path $PgData "PG_VERSION"))) { return $false }
  $ErrorActionPreference = "Continue"
  & (Pg "pg_ctl") status -D $PgData *> $null
  return $LASTEXITCODE -eq 0
}

function Initialize-Cluster {
  Write-Host "Creating database cluster in $PgData"
  New-Item -ItemType Directory -Force -Path $DevDir | Out-Null
  $pwFile = Join-Path $DevDir "pw.tmp"
  Set-Content -Path $pwFile -Value $Password -NoNewline -Encoding ascii
  try {
    & (Pg "initdb") -D $PgData -U $User --pwfile=$pwFile -E UTF8 --no-locale -A scram-sha-256 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "initdb failed" }
  } finally { Remove-Item $pwFile -Force -ErrorAction SilentlyContinue }
}

function Start-Db {
  if (-not (Test-Path (Join-Path $PgData "PG_VERSION"))) { Initialize-Cluster }
  if (Test-Running) {
    Write-Host "PostgreSQL already running on localhost:$Port"
  } else {
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
      throw "Port $Port is already in use by another program."
    }
    @("listen_addresses = 'localhost'", "port = $Port") | Set-Content (Join-Path $PgData "postgresql.auto.conf") -Encoding ascii
    # Start-Process keeps postgres from inheriting this console's handles. WaitForExit (not -Wait)
    # so we wait for pg_ctl only, not for the server process tree it leaves running.
    $p = Start-Process -FilePath (Pg "pg_ctl") -ArgumentList @("start", "-D", "`"$PgData`"", "-l", "`"$LogFile`"", "-w") -WindowStyle Hidden -PassThru
    $p.WaitForExit()
    if (-not (Test-Running)) { throw "PostgreSQL did not start. See $LogFile" }
    Write-Host "PostgreSQL started on localhost:$Port"
  }

  $env:PGPASSWORD = $Password
  try {
    $exists = & (Pg "psql") -h localhost -p $Port -U $User -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$Database'"
    if ("$exists".Trim() -ne "1") {
      & (Pg "createdb") -h localhost -p $Port -U $User $Database
      if ($LASTEXITCODE -ne 0) { throw "createdb failed" }
      Write-Host "Database $Database created"
    }
  } finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }

  $envFile = Join-Path $RepoRoot "apps\api\.env"
  if (-not (Test-Path $envFile)) {
    Copy-Item (Join-Path $RepoRoot "apps\api\.env.example") $envFile
    Write-Host "Created apps\api\.env from .env.example"
  }
}

function Stop-Db {
  if (Test-Running) {
    & (Pg "pg_ctl") stop -D $PgData -m fast | Out-Null
    Write-Host "PostgreSQL stopped"
  } else {
    Write-Host "PostgreSQL is not running"
  }
}

switch ($Command) {
  "start" { Start-Db }
  "stop" { Stop-Db }
  "status" {
    if (Test-Running) { Write-Host "Running on localhost:$Port (data: $PgData)" } else { Write-Host "Stopped" }
  }
  "reset" {
    Stop-Db
    if (Test-Path $PgData) { Remove-Item $PgData -Recurse -Force }
    Start-Db
  }
}
