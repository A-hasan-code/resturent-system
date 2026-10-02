# Builds the offline Windows installer (no Docker; the client needs no internet).
#
#   pnpm release                                   # full build -> releases\HotelSystem-Setup-<version>.exe
#   .\Build-Release.ps1 -SkipDesktop               # server only (faster)
#   .\Build-Release.ps1 -SkipAndroid               # no Android Studio on this PC
#   .\Build-Release.ps1 -SkipInstall -SkipBuild    # re-package existing build output
#
# The version comes from the root VERSION file.
# Stage layout (build\stage) mirrors the install folder:
#   node\node.exe  pgsql\{bin,lib,share}  winsw\HotelSystemAPI.exe
#   app\api\{dist,prisma,node_modules,VERSION}  app\web\dist  app\downloads\hotel-system.apk  desktop\  scripts\
param(
  [switch]$SkipInstall,
  [switch]$SkipBuild,
  [switch]$SkipDesktop,
  [switch]$SkipAndroid
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$env:CHECKPOINT_DISABLE = "1"
$env:PRISMA_HIDE_UPDATE_MESSAGE = "1"

. (Join-Path $PSScriptRoot "..\..\scripts\lib\Tools.ps1")

$Root = $RepoRoot
$Stage = Join-Path $Root "build\stage"
$Releases = Join-Path $Root "releases"
$Version = (Get-Content (Join-Path $Root "VERSION") -Raw).Trim()

Write-Host "Hotel System release $Version" -ForegroundColor Green

if (-not $SkipInstall) {
  Step "pnpm install"
  Invoke-Checked "pnpm" @("install", "--frozen-lockfile")
}

if (-not $SkipBuild) {
  Step "Build API + web"
  Invoke-Checked "pnpm" @("db:generate")
  Invoke-Checked "pnpm" @("build")
}

Step "Prepare stage folder"
if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Stage | Out-Null

Step "Node.js runtime"
Expand-ZipEntry (Get-CachedDownload "node") "node-v$NodeVersion-win-x64/node.exe" (Join-Path $Stage "node\node.exe")

Step "PostgreSQL binaries"
$pgHome = Get-PostgresHome
foreach ($part in "bin", "lib", "share") {
  Copy-Item (Join-Path $pgHome $part) (Join-Path $Stage "pgsql\$part") -Recurse
}
Get-ChildItem (Join-Path $Stage "pgsql\bin") -Filter "stackbuilder*" -ErrorAction SilentlyContinue | Remove-Item -Force
Remove-Item (Join-Path $Stage "pgsql\lib\*.lib") -Force -ErrorAction SilentlyContinue

Step "WinSW service wrapper"
New-Item -ItemType Directory -Force -Path (Join-Path $Stage "winsw") | Out-Null
Copy-Item (Get-CachedDownload "winsw") (Join-Path $Stage "winsw\HotelSystemAPI.exe")

Step "API (production dependencies via pnpm deploy)"
$apiStage = Join-Path $Stage "app\api"
Invoke-Checked "pnpm" @("--filter", "@hotel/api", "deploy", "--prod", $apiStage)
foreach ($dir in "dist", "prisma") {
  $dest = Join-Path $apiStage $dir
  if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
  Copy-Item (Join-Path $Root "apps\api\$dir") $dest -Recurse
}
Get-ChildItem (Join-Path $apiStage "dist") -Recurse -Include "*.map", "*.d.ts", "*.tsbuildinfo" -File | Remove-Item -Force
Remove-Item (Join-Path $apiStage ".env*") -Force -ErrorAction SilentlyContinue
Set-Content -Path (Join-Path $apiStage "VERSION") -Value $Version -NoNewline -Encoding ascii
Invoke-Checked (Join-Path $Stage "node\node.exe") @(
  "node_modules\prisma\build\index.js", "generate", "--schema", "prisma\schema.prisma"
) $apiStage

# Prune engine download caches, WASM engines (only used with driver adapters) and TypeScript (optional peer).
$nm = Join-Path $apiStage "node_modules"
Get-ChildItem $nm -Recurse -Directory -Force -Filter ".cache" | Remove-Item -Recurse -Force
Get-ChildItem (Join-Path $nm "@prisma\client\runtime") -File |
  Where-Object { $_.Name -match "^query_(engine|compiler)_bg\." } | Remove-Item -Force
foreach ($pkg in "typescript", ".pnpm") {
  $p = Join-Path $nm $pkg
  if (Test-Path $p) { Remove-Item $p -Recurse -Force }
}

Step "Web app"
Copy-Item (Join-Path $Root "apps\web\dist") (Join-Path $Stage "app\web\dist") -Recurse

if (-not $SkipAndroid) {
  Step "Android app (served to tablets at /downloads)"
  & (Join-Path $Root "packaging\android\Build-Apk.ps1") -SkipWeb
  New-Item -ItemType Directory -Force -Path (Join-Path $Stage "app\downloads") | Out-Null
  Copy-Item (Join-Path $Releases "android\hotel-system.apk") (Join-Path $Stage "app\downloads\hotel-system.apk")
}

if (-not $SkipDesktop) {
  Step "Desktop app (Electron)"
  Invoke-Checked "pnpm" @("--filter", "@hotel/desktop", "exec", "electron-builder", "--dir", "-c.extraMetadata.version=$Version")
  $unpacked = Join-Path $Releases "desktop\win-unpacked"
  if (-not (Test-Path (Join-Path $unpacked "Hotel System.exe"))) { throw "Electron build missing: $unpacked" }
  Copy-Item $unpacked (Join-Path $Stage "desktop") -Recurse
}

Step "Install scripts"
New-Item -ItemType Directory -Force -Path (Join-Path $Stage "scripts") | Out-Null
Copy-Item (Join-Path $PSScriptRoot "install.ps1"), (Join-Path $PSScriptRoot "uninstall.ps1") (Join-Path $Stage "scripts")
Set-Content -Path (Join-Path $Stage "VERSION") -Value $Version -NoNewline -Encoding ascii

$sizeMb = [math]::Round(((Get-ChildItem $Stage -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 1)
Write-Host "Stage ready: $Stage ($sizeMb MB)" -ForegroundColor Green

Step "Inno Setup"
$iscc = @(
  (Get-Command iscc.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
  "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
  "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if (-not $iscc) {
  Write-Host "Inno Setup 6 not found. Install it once (winget install JRSoftware.InnoSetup)," -ForegroundColor Yellow
  Write-Host "then re-run with -SkipInstall -SkipBuild." -ForegroundColor Yellow
  exit 1
}

New-Item -ItemType Directory -Force -Path $Releases | Out-Null
$versionDir = Join-Path $Releases "v$Version"
if (Test-Path $versionDir) { Remove-Item $versionDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $versionDir | Out-Null

$withDesktop = if ($SkipDesktop) { "0" } else { "1" }
Invoke-Checked $iscc @(
  "/Q",
  "/DAppVersion=$Version",
  "/DStageDir=$Stage",
  "/DWithDesktop=$withDesktop",
  "/O$versionDir",
  (Join-Path $PSScriptRoot "HotelSystem.iss")
)

$setupExe = Join-Path $versionDir "HotelSystem-Setup-$Version.exe"
if (-not (Test-Path $setupExe)) { throw "Installer missing: $setupExe" }

$apkSrc = Join-Path $Releases "android\hotel-system.apk"
if (Test-Path $apkSrc) {
  Copy-Item $apkSrc (Join-Path $versionDir "hotel-system.apk") -Force
}

$readme = @"
Hotel System v$Version — client package
=====================================

SEND TO CLIENT
--------------
1) HotelSystem-Setup-$Version.exe   (main installer — required)
2) hotel-system.apk                 (optional; also inside the server after install)
3) See docs in the product: INDUSTRIAL-SETUP (main server + counter printers)

INSTALL — INDUSTRIAL PATTERN
----------------------------
• Main / server PC (ONE only, often in a back room):
  run the exe → "Main PC: server + desktop app"
  Reserve this PC's IP in the router (DHCP reservation).

• Cashier / kitchen / other PCs (same LAN or Wi-Fi):
  run the same exe → "Additional PC: desktop app only"
  UI only — finds the main server automatically.

• Each cashier COUNTER billing printer:
  Use NETWORK mode (Wi-Fi or Ethernet), fixed IP, port 9100.
  On the server: Settings → Printers → Add LAN printer, tick Bill,
  set Station (e.g. Cashier 1), Test print.
  Users → edit cashier → Bill printer → assign that printer.

• Tablets / phones: same Wi-Fi → scan QR or install hotel-system.apk

DEMO LOGIN (change after install)
--------------------------------
admin / admin123

NOTES
-----
• Prefer the 192.168.x address for tablets (ignore virtual 10.x / 172.x).
• USB printers must be on the MAIN SERVER PC, or use network printers at counters.
"@
Set-Content -Path (Join-Path $versionDir "README.txt") -Value $readme -Encoding utf8

# Ship industrial setup guide next to the installer
$industrialDoc = Join-Path $Root "docs\INDUSTRIAL-SETUP.md"
if (Test-Path $industrialDoc) {
  Copy-Item $industrialDoc (Join-Path $versionDir "INDUSTRIAL-SETUP.md") -Force
}

$exeMb = [math]::Round(((Get-Item $setupExe).Length / 1MB), 1)
Write-Host "`nRelease folder: $versionDir" -ForegroundColor Green
Write-Host "Installer: $setupExe ($exeMb MB)" -ForegroundColor Green
if (Test-Path (Join-Path $versionDir "hotel-system.apk")) {
  Write-Host "APK: $(Join-Path $versionDir 'hotel-system.apk')" -ForegroundColor Green
}
