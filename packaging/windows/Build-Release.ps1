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
$withDesktop = if ($SkipDesktop) { "0" } else { "1" }
Invoke-Checked $iscc @(
  "/Q",
  "/DAppVersion=$Version",
  "/DStageDir=$Stage",
  "/DWithDesktop=$withDesktop",
  "/O$Releases",
  (Join-Path $PSScriptRoot "HotelSystem.iss")
)
Write-Host "`nInstaller: $(Join-Path $Releases "HotelSystem-Setup-$Version.exe")" -ForegroundColor Green
