# Post-install setup, run elevated by the installer (safe to re-run; used for upgrades too).
#   -Mode server : database + API services, firewall, migrations, seed
#   -Mode client : only firewall rules for the desktop app
param(
  [string]$AppDir = (Split-Path $PSScriptRoot -Parent),
  [ValidateSet("server", "client")][string]$Mode = "server",
  [string]$DataDir = (Join-Path $env:ProgramData "HotelSystem")
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$DbService = "HotelSystemDB"
$ApiService = "HotelSystemAPI"
$DbName = "hotel_db"
$DbUser = "hotel"
$EnvFile = Join-Path $DataDir "hotel.env"
$LogDir = Join-Path $DataDir "logs"
$DesktopExe = Join-Path $AppDir "desktop\PixalBotics Restaurant.exe"
$StartMenu = Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\Hotel System"

New-Item -ItemType Directory -Force -Path $DataDir, $LogDir | Out-Null
$LogFile = Join-Path $LogDir "install.log"

function Log([string]$msg) {
  $line = "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $msg
  Add-Content -Path $LogFile -Value $line
  Write-Host $line
}

# Runs a native exe, logs its output, throws on non-zero exit (unless -AllowFail).
# Returns @{ Code; Output } so callers can inspect Prisma errors (e.g. P3009).
function Run([string]$exe, [string[]]$argv, [string]$cwd = $AppDir, [switch]$AllowFail) {
  Log "> $(Split-Path $exe -Leaf) $($argv -join ' ')"
  Push-Location $cwd
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $out = & $exe @argv 2>&1 | ForEach-Object { "$_" }
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prev
    Pop-Location
  }
  foreach ($l in $out) { if ($l.Trim()) { Log "  $l" } }
  if ($code -ne 0 -and -not $AllowFail) { throw "$(Split-Path $exe -Leaf) failed (exit $code)" }
  return @{ Code = $code; Output = ($out -join "`n") }
}

# Prisma P3009 = failed migration row; P3018 = objects already exist (partial apply).
function Invoke-PrismaMigrateDeploy([string]$nodeExe, [string]$apiDir) {
  $prisma = @("node_modules\prisma\build\index.js", "migrate", "deploy", "--schema", "prisma\schema.prisma")
  $r = Run $nodeExe $prisma $apiDir -AllowFail
  if ($r.Code -eq 0) { return }

  $text = [string]$r.Output
  $names = [regex]::Matches($text, 'The\s+.([0-9]{14}_[A-Za-z0-9_]+).\s+migration') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
  if (-not $names -or $names.Count -eq 0) {
    $names = [regex]::Matches($text, 'Migration name:\s*(\S+)') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
  }
  if (-not $names -or $names.Count -eq 0) {
    $names = [regex]::Matches($text, 'Applying migration .([0-9]{14}_[A-Za-z0-9_]+).') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
  }

  $isP3009 = ($text -match 'P3009' -or $text -match 'failed migrations')
  $isPartial = ($text -match 'already exists' -or $text -match 'duplicate key' -or $text -match 'P3018')

  if (-not $isP3009 -and -not $isPartial) {
    throw "prisma migrate deploy failed (exit $($r.Code)). See $LogFile"
  }
  if (-not $names -or $names.Count -eq 0) {
    throw "prisma migrate deploy failed but could not parse migration name. See $LogFile"
  }

  if ($isP3009) {
    foreach ($name in $names) {
      Log "P3009: clearing failed migration record for $name (rolled-back), then re-applying"
      Run $nodeExe @("node_modules\prisma\build\index.js", "migrate", "resolve", "--rolled-back", $name, "--schema", "prisma\schema.prisma") $apiDir -AllowFail | Out-Null
    }
    $r2 = Run $nodeExe $prisma $apiDir -AllowFail
    if ($r2.Code -eq 0) {
      Log "prisma migrate deploy OK after resolving failed migration(s)"
      return
    }
    $text = [string]$r2.Output
    $isPartial = ($text -match 'already exists' -or $text -match 'duplicate key' -or $text -match 'P3018')
    $names2 = [regex]::Matches($text, 'Migration name:\s*(\S+)') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
    if ($names2 -and $names2.Count -gt 0) { $names = $names2 }
  }

  if ($isPartial -or $isP3009) {
    foreach ($name in $names) {
      Log "Partial migration: marking $name as applied (objects may already exist)"
      Run $nodeExe @("node_modules\prisma\build\index.js", "migrate", "resolve", "--applied", $name, "--schema", "prisma\schema.prisma") $apiDir -AllowFail | Out-Null
    }
    $r3 = Run $nodeExe $prisma $apiDir -AllowFail
    if ($r3.Code -eq 0) {
      Log "prisma migrate deploy OK after marking migration(s) applied"
      return
    }
    throw "prisma migrate deploy still failing after recovery (exit $($r3.Code)). See $LogFile"
  }

  throw "prisma migrate deploy failed (exit $($r.Code)). See $LogFile"
}

function New-Secret([int]$length) {
  $chars = [char[]]"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
  $bytes = New-Object byte[] $length
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

function Read-EnvFile([string]$path) {
  $map = @{}
  if (Test-Path $path) {
    foreach ($raw in Get-Content $path) {
      $line = $raw.Trim()
      if (-not $line -or $line.StartsWith("#")) { continue }
      $eq = $line.IndexOf("=")
      if ($eq -gt 0) { $map[$line.Substring(0, $eq).Trim()] = $line.Substring($eq + 1).Trim() }
    }
  }
  return $map
}

function Test-PortFree([int]$port) {
  -not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Find-FreePort([int[]]$candidates) {
  foreach ($p in $candidates) { if (Test-PortFree $p) { return $p } }
  throw "No free port among $($candidates -join ', ')"
}

function Set-FirewallRule([string]$name, [string[]]$ruleArgs) {
  Run "netsh.exe" @("advfirewall", "firewall", "delete", "rule", "name=$name") -AllowFail | Out-Null
  Run "netsh.exe" (@("advfirewall", "firewall", "add", "rule", "name=$name", "dir=in", "action=allow", "profile=any") + $ruleArgs) | Out-Null
}

function Get-LanAddresses {
  # Prefer real Wi-Fi / Ethernet; push Hyper-V / WSL / Docker / VPN to the end (QR uses first URL).
  $virtual = 'vEthernet|Hyper-V|WSL|VMware|VirtualBox|vBox|Docker|VPN|ZeroTier|Hamachi|TAP-Windows|Bluetooth|Loopback|Pseudo|isatap|Teredo|Wi-Fi Direct|Hosted Network|Virtual'
  Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" -and $_.AddressState -eq "Preferred" } |
    Sort-Object @{
      Expression = {
        $score = 0
        if ($_.InterfaceAlias -match $virtual) { $score += 1000 }
        if ($_.IPAddress -like "192.168.*") { $score += 0 }
        elseif ($_.IPAddress -like "10.*") { $score += 10 }
        elseif ($_.IPAddress -match '^172\.(1[6-9]|2\d|3[0-1])\.') { $score += 20 }
        else { $score += 50 }
        if ($_.InterfaceAlias -match 'Wi-?Fi|WLAN|Wireless|Ethernet|Local Area Connection') { $score -= 5 }
        $score
      }
    }, IPAddress |
    Select-Object -ExpandProperty IPAddress
}

function Wait-Until([scriptblock]$test, [int]$seconds, [string]$what) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    if (& $test) { return }
    Start-Sleep -Seconds 1
  }
  throw "Timed out waiting for $what"
}

function Install-DesktopFirewall {
  # Support current and older desktop exe names after product rename.
  $candidates = @(
    $DesktopExe,
    (Join-Path $AppDir "desktop\Hotel System.exe"),
    (Join-Path $AppDir "desktop\PixalBoticsRestaurant.exe")
  )
  $exe = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $exe) { Log "Desktop exe not found - skipping desktop firewall rule"; return }
  try {
    Set-FirewallRule "Hotel System - Desktop app" @("program=$exe", "protocol=UDP")
  } catch {
    Log "WARN: desktop firewall rule failed (continuing): $($_.Exception.Message)"
  }
}

try {

Log "=== Hotel System setup ($Mode) from $AppDir ==="

if ($Mode -eq "client") {
  Install-DesktopFirewall
  Log "Client setup done."
  exit 0
}

$Node = Join-Path $AppDir "node\node.exe"
$PgBin = Join-Path $AppDir "pgsql\bin"
$ApiDir = Join-Path $AppDir "app\api"
$WinSw = Join-Path $AppDir "winsw\$ApiService.exe"
foreach ($p in $Node, (Join-Path $PgBin "postgres.exe"), (Join-Path $ApiDir "dist\main.js"), $WinSw) {
  if (-not (Test-Path $p)) { throw "Missing file: $p" }
}

# --- Config (secrets and ports survive upgrades) ---------------------------
$old = Read-EnvFile $EnvFile
$pgData = Join-Path $DataDir "pgdata"
$freshDb = -not (Test-Path (Join-Path $pgData "PG_VERSION"))

$dbPassword = if ($old.DB_PASSWORD) { $old.DB_PASSWORD } else { New-Secret 28 }
$jwtSecret = if ($old.JWT_SECRET) { $old.JWT_SECRET } else { New-Secret 48 }
$pgPort = if ($old.PG_PORT) { [int]$old.PG_PORT } else { Find-FreePort @(5433, 5434, 5435, 5436, 5440) }
$httpPort = if ($old.PORT) { [int]$old.PORT } else { Find-FreePort @(3000, 3080, 8080, 8090) }
$databaseUrl = "postgresql://${DbUser}:$dbPassword@127.0.0.1:$pgPort/${DbName}?schema=public"

if (-not $freshDb -and -not $old.DB_PASSWORD) {
  throw "Database exists at $pgData but $EnvFile is missing. Restore hotel.env (or move pgdata away for a clean install)."
}

@(
  "# Hotel System server config. Written by the installer; secrets and ports are kept on upgrade."
  "PORT=$httpPort"
  "PG_PORT=$pgPort"
  "DB_PASSWORD=$dbPassword"
  "DATABASE_URL=$databaseUrl"
  "JWT_SECRET=$jwtSecret"
  "HOTEL_DATA_DIR=$DataDir"
  "PG_BIN=$PgBin"
  "NODE_ENV=production"
) | Set-Content -Path $EnvFile -Encoding ascii
Run "icacls.exe" @($EnvFile, "/inheritance:r", "/grant:r", "*S-1-5-32-544:F", "*S-1-5-18:F") | Out-Null
Log "Config: $EnvFile (web port $httpPort, database port $pgPort)"

# --- Stop running services before touching them ----------------------------
foreach ($svc in $ApiService, $DbService) {
  $s = Get-Service -Name $svc -ErrorAction SilentlyContinue
  if ($s -and $s.Status -ne "Stopped") {
    Log "Stopping $svc"
    Stop-Service -Name $svc -Force
  }
}

# --- PostgreSQL --------------------------------------------------------------
$networkService = "*S-1-5-20"
$currentUser = "*" + [Security.Principal.WindowsIdentity]::GetCurrent().User.Value

if ($freshDb) {
  Log "Creating database cluster in $pgData"
  New-Item -ItemType Directory -Force -Path $pgData | Out-Null
  # initdb drops admin rights (restricted token), so the folder must be writable without them.
  Run "icacls.exe" @($pgData, "/grant", "${currentUser}:(OI)(CI)F", "/grant", "${networkService}:(OI)(CI)F", "/T") | Out-Null
  $pwFile = Join-Path $DataDir "pw.tmp"
  Set-Content -Path $pwFile -Value $dbPassword -NoNewline -Encoding ascii
  try {
    Run (Join-Path $PgBin "initdb.exe") @("-D", $pgData, "-U", $DbUser, "--pwfile=$pwFile", "-E", "UTF8", "--no-locale", "-A", "scram-sha-256")
  } finally {
    Remove-Item $pwFile -Force -ErrorAction SilentlyContinue
  }
}

# Always (re)apply: localhost only, our port.
$autoConf = Join-Path $pgData "postgresql.auto.conf"
@(
  "# Managed by Hotel System installer"
  "listen_addresses = 'localhost'"
  "port = $pgPort"
  "logging_collector = on"
  "log_directory = 'log'"
  "log_rotation_age = '7d'"
  "log_truncate_on_rotation = on"
) | Set-Content -Path $autoConf -Encoding ascii
Run "icacls.exe" @($pgData, "/grant", "${networkService}:(OI)(CI)F", "/T", "/Q") | Out-Null

$pgCtl = Join-Path $PgBin "pg_ctl.exe"
if (Get-Service -Name $DbService -ErrorAction SilentlyContinue) {
  Run $pgCtl @("unregister", "-N", $DbService) -AllowFail | Out-Null
  Wait-Until { -not (Get-Service -Name $DbService -ErrorAction SilentlyContinue) } 30 "old database service removal"
}
Run $pgCtl @("register", "-N", $DbService, "-U", "NT AUTHORITY\NetworkService", "-D", $pgData, "-S", "auto", "-w") | Out-Null
Run "sc.exe" @("config", $DbService, "DisplayName=", "Hotel System Database") | Out-Null
Run "sc.exe" @("description", $DbService, "PostgreSQL database for Hotel System (localhost only)") | Out-Null
Run "sc.exe" @("failure", $DbService, "reset=", "3600", "actions=", "restart/5000/restart/15000/restart/60000") | Out-Null

Log "Starting database"
Start-Service -Name $DbService
$pgIsReady = Join-Path $PgBin "pg_isready.exe"
Wait-Until { & $pgIsReady -h 127.0.0.1 -p $pgPort -q; $LASTEXITCODE -eq 0 } 60 "database to accept connections"

$env:PGPASSWORD = $dbPassword
$exists = & (Join-Path $PgBin "psql.exe") -h 127.0.0.1 -p $pgPort -U $DbUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DbName'"
if ("$exists".Trim() -ne "1") {
  Run (Join-Path $PgBin "createdb.exe") @("-h", "127.0.0.1", "-p", "$pgPort", "-U", $DbUser, "-O", $DbUser, $DbName) | Out-Null
  Log "Database $DbName created"
}
Remove-Item Env:PGPASSWORD

# --- Pre-upgrade safety dump (never skip on existing hotels) ----------------
if (-not $freshDb) {
  $backupDir = Join-Path $DataDir "backups"
  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  $stamp = Get-Date -Format "yyyy-MM-dd-HH-mm-ss"
  $preUpgrade = Join-Path $backupDir "hotel-$stamp-pre-upgrade.dump"
  Log "Upgrade safety backup: $preUpgrade"
  $env:PGPASSWORD = $dbPassword
  try {
    $dump = Run (Join-Path $PgBin "pg_dump.exe") @(
      "--format=custom", "--no-owner", "--file=$preUpgrade",
      "-h", "127.0.0.1", "-p", "$pgPort", "-U", $DbUser, $DbName
    ) -AllowFail
    if ($dump.Code -ne 0 -or -not (Test-Path $preUpgrade) -or ((Get-Item $preUpgrade).Length -lt 8192)) {
      throw "Pre-upgrade backup failed or too small — aborting upgrade so restaurant data stays safe. See $LogFile"
    }
    Log "Pre-upgrade backup OK ($([math]::Round((Get-Item $preUpgrade).Length / 1KB)) KB)"
  } finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }
}

# --- Schema (+ seed only on first install; never wipe a live hotel on upgrade) -
$env:DATABASE_URL = $databaseUrl
$env:CHECKPOINT_DISABLE = "1"
$env:PRISMA_HIDE_UPDATE_MESSAGE = "1"
Invoke-PrismaMigrateDeploy $Node $ApiDir
if ($freshDb) {
  Log "Fresh install: seeding demo catalog and users"
  Run $Node @("node_modules\tsx\dist\cli.mjs", "prisma\seed.ts") $ApiDir | Out-Null
} else {
  Log "Upgrade: skipping seed (existing restaurant data kept)"
}

# --- API service (WinSW) -----------------------------------------------------
$xml = @"
<service>
  <id>$ApiService</id>
  <name>Hotel System Server</name>
  <description>Hotel System: web app, tablets, printing and LAN discovery</description>
  <executable>$Node</executable>
  <arguments>"$ApiDir\dist\main.js"</arguments>
  <workingdirectory>$ApiDir</workingdirectory>
  <env name="HOTEL_ENV_FILE" value="$EnvFile"/>
  <env name="NODE_ENV" value="production"/>
  <depend>$DbService</depend>
  <startmode>Automatic</startmode>
  <onfailure action="restart" delay="5 sec"/>
  <onfailure action="restart" delay="15 sec"/>
  <onfailure action="restart" delay="60 sec"/>
  <resetfailure>1 hour</resetfailure>
  <stoptimeout>15 sec</stoptimeout>
  <logpath>$LogDir</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>5120</sizeThreshold>
    <keepFiles>5</keepFiles>
  </log>
</service>
"@
$xmlPath = [IO.Path]::ChangeExtension($WinSw, ".xml")
Set-Content -Path $xmlPath -Value $xml -Encoding utf8

if (Get-Service -Name $ApiService -ErrorAction SilentlyContinue) {
  Run $WinSw @("uninstall") -AllowFail | Out-Null
  Wait-Until { -not (Get-Service -Name $ApiService -ErrorAction SilentlyContinue) } 30 "old server service removal"
}
Run $WinSw @("install") | Out-Null
Log "Starting server"
Start-Service -Name $ApiService

Wait-Until {
  try { (Invoke-RestMethod -Uri "http://127.0.0.1:$httpPort/api/health" -TimeoutSec 3).ok -eq $true } catch { $false }
} 120 "server health check (see $LogDir\$ApiService.err.log)"
Log "Server is up on port $httpPort"

# --- Firewall ----------------------------------------------------------------
try {
  Set-FirewallRule "Hotel System - Web (TCP $httpPort)" @("protocol=TCP", "localport=$httpPort")
  Set-FirewallRule "Hotel System - Discovery (UDP)" @("protocol=UDP", "localport=41234-41235")
  Set-FirewallRule "Hotel System - Server (node)" @("program=$Node", "protocol=UDP")
  Install-DesktopFirewall
} catch {
  Log "WARN: firewall rules failed (continuing): $($_.Exception.Message)"
}

# --- Shortcuts + summary -----------------------------------------------------
New-Item -ItemType Directory -Force -Path $StartMenu | Out-Null
Set-Content -Path (Join-Path $StartMenu "Hotel System (Browser).url") -Encoding ascii -Value @(
  "[InternetShortcut]", "URL=http://localhost:$httpPort/"
)

$urls = @(Get-LanAddresses | ForEach-Object { "http://${_}:$httpPort" })
$summary = @(
  "Hotel System server is running."
  ""
  "On tablets / phones (same Wi-Fi), open one of these addresses:"
) + ($urls | ForEach-Object { "  $_" }) + @(
  "  http://hotel.local:$httpPort"
  ""
  "Settings > Server also shows a QR code. Reserve this PC's IP in the router (DHCP reservation)."
)
$summary | Set-Content -Path (Join-Path $DataDir "server-info.txt") -Encoding ascii
Log "Setup complete. URLs: $($urls -join ', ')"

} catch {
  Log "FATAL: $($_.Exception.Message)"
  if ($_.ScriptStackTrace) { Log $_.ScriptStackTrace }
  throw
}
exit 0
