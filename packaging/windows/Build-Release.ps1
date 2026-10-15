# Builds the offline Windows installer (no Docker; the client needs no internet).
#
#   pnpm release                                   # full build -> releases\HotelSystem-Setup-<version>.exe
#   .\Build-Release.ps1 -SkipDesktop               # server only (faster)
#   .\Build-Release.ps1 -SkipAndroid               # no Android Studio on this PC
#   .\Build-Release.ps1 -SkipInstall -SkipBuild    # re-package existing build output
#   .\Build-Release.ps1 -RequireSign               # fail if Authenticode signing is not configured
#
# Professional client releases MUST be Authenticode-signed (see docs\CODE-SIGNING.md).
# Unsigned builds are for internal/dev only - Smart App Control blocks them on Windows 11.
#
# The version comes from the root VERSION file.
# Stage layout (build\stage) mirrors the install folder:
#   node\node.exe  pgsql\{bin,lib,share}  winsw\HotelSystemAPI.exe
#   app\api\{dist,prisma,node_modules,VERSION}  app\web\dist
#   app\downloads\{hotel-system.apk,desktop-update.zip,desktop-update.json}  desktop\  scripts\
param(
  [switch]$SkipInstall,
  [switch]$SkipBuild,
  [switch]$SkipDesktop,
  [switch]$SkipAndroid,
  [switch]$RequireSign
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$env:CHECKPOINT_DISABLE = "1"
$env:PRISMA_HIDE_UPDATE_MESSAGE = "1"

. (Join-Path $PSScriptRoot "..\..\scripts\lib\Tools.ps1")

function Import-HotelSigningEnv {
  $envFile = Join-Path $PSScriptRoot "signing.env"
  if (-not (Test-Path $envFile)) { return }
  foreach ($raw in Get-Content $envFile) {
    $line = $raw.Trim()
    if (-not $line -or $line.StartsWith("#")) { continue }
    $eq = $line.IndexOf("=")
    if ($eq -lt 1) { continue }
    $k = $line.Substring(0, $eq).Trim()
    $v = $line.Substring($eq + 1).Trim().Trim('"').Trim("'")
    if ($k -and -not [Environment]::GetEnvironmentVariable($k)) {
      [Environment]::SetEnvironmentVariable($k, $v, "Process")
    }
  }
}

function Find-HotelSignTool {
  if ($env:HOTEL_SIGNTOOL -and (Test-Path $env:HOTEL_SIGNTOOL)) { return $env:HOTEL_SIGNTOOL }
  $cmd = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($root in @("${env:ProgramFiles(x86)}\Windows Kits\10\bin", "$env:ProgramFiles\Windows Kits\10\bin")) {
    if (-not (Test-Path $root)) { continue }
    $hit = Get-ChildItem $root -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
      Sort-Object FullName -Descending | Select-Object -First 1
    if ($hit) { return $hit.FullName }
  }
  return $null
}

# Inno SignTool must be a single safe command line. PFX passwords with # or ! break ISCC if inlined.
# Returns a .cmd wrapper path; ISCC uses: /SHotelSign=wrapper.cmd $f
function Get-InnoSignWrapperPath {
  $signtool = Find-HotelSignTool
  if (-not $signtool) { return $null }
  $wrapper = Join-Path $script:RepoRoot "build\inno-sign.cmd"
  New-Item -ItemType Directory -Force -Path (Split-Path $wrapper) | Out-Null

  $tsRaw = $env:HOTEL_SIGN_TIMESTAMP_URL
  $useTs = $true
  if ($null -ne [Environment]::GetEnvironmentVariable("HOTEL_SIGN_TIMESTAMP_URL", "Process")) {
    $useTs = $tsRaw -and $tsRaw -ne "none"
  }
  $ts = if ($useTs) { if ($tsRaw) { $tsRaw } else { "http://timestamp.digicert.com" } } else { $null }
  $tsLine = if ($ts) { " /td SHA256 /tr `"$ts`"" } else { "" }

  if ($env:HOTEL_SIGN_AZURE_ACCOUNT -and $env:HOTEL_SIGN_AZURE_DLIB -and $env:HOTEL_SIGN_AZURE_METADATA) {
    if (-not (Test-Path $env:HOTEL_SIGN_AZURE_DLIB)) { return $null }
    if (-not (Test-Path $env:HOTEL_SIGN_AZURE_METADATA)) { return $null }
    @"
@echo off
"$signtool" sign /fd SHA256$tsLine /dlib "$($env:HOTEL_SIGN_AZURE_DLIB)" /dmdf "$($env:HOTEL_SIGN_AZURE_METADATA)" %1
exit /b %ERRORLEVEL%
"@ | Set-Content -Path $wrapper -Encoding ascii
    return $wrapper
  }
  if ($env:HOTEL_SIGN_PFX -and (Test-Path $env:HOTEL_SIGN_PFX)) {
    $pass = $env:HOTEL_SIGN_PFX_PASSWORD
    $passLine = if ($pass) { " /p `"$pass`"" } else { "" }
    @"
@echo off
"$signtool" sign /fd SHA256$tsLine /f "$($env:HOTEL_SIGN_PFX)"$passLine %1
exit /b %ERRORLEVEL%
"@ | Set-Content -Path $wrapper -Encoding ascii
    return $wrapper
  }
  if ($env:HOTEL_SIGN_THUMBPRINT) {
    $thumb = $env:HOTEL_SIGN_THUMBPRINT -replace "\s", ""
    @"
@echo off
"$signtool" sign /fd SHA256$tsLine /sha1 $thumb /sm %1
exit /b %ERRORLEVEL%
"@ | Set-Content -Path $wrapper -Encoding ascii
    return $wrapper
  }
  return $null
}

$Root = $RepoRoot
$Stage = Join-Path $Root "build\stage"
$Releases = Join-Path $Root "releases"
$Version = (Get-Content (Join-Path $Root "VERSION") -Raw).Trim()

Import-HotelSigningEnv
if ($env:HOTEL_SIGN_REQUIRED -eq "1") { $RequireSign = $true }
# electron-builder picks these up when packing the desktop app
if ($env:HOTEL_SIGN_PFX -and -not $env:CSC_LINK) { $env:CSC_LINK = $env:HOTEL_SIGN_PFX }
if ($env:HOTEL_SIGN_PFX_PASSWORD -and -not $env:CSC_KEY_PASSWORD) { $env:CSC_KEY_PASSWORD = $env:HOTEL_SIGN_PFX_PASSWORD }

Write-Host "Hotel System release $Version" -ForegroundColor Green
if (Get-InnoSignWrapperPath) {
  Write-Host "Code signing: configured" -ForegroundColor Green
} else {
  Write-Host "Code signing: NOT configured (unsigned build = internal/dev only)" -ForegroundColor Yellow
}

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
if (Test-Path $Stage) {
  # Rename first so a locked file (AV / leftover prisma engine) cannot block the whole release.
  $stageParent = Split-Path $Stage
  $stageOldLeaf = "stage-old-$(Get-Date -Format 'yyyyMMddHHmmss')"
  $stageOld = Join-Path $stageParent $stageOldLeaf
  Rename-Item -LiteralPath $Stage -NewName $stageOldLeaf
  Remove-Item -LiteralPath $stageOld -Recurse -Force -ErrorAction SilentlyContinue
}
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
# Seed/import scripts for Settings → Developer setup (auto-listed at runtime)
$scriptsSrc = Join-Path $Root "apps\api\scripts"
$scriptsDest = Join-Path $apiStage "scripts"
if (Test-Path $scriptsSrc) {
  New-Item -ItemType Directory -Force -Path $scriptsDest | Out-Null
  Get-ChildItem $scriptsSrc -Filter "*.ts" | Where-Object {
    $_.Name -match '^(seed|import)[-.].+\.ts$|^seed\.ts$|^import.+\.ts$'
  } | ForEach-Object { Copy-Item $_.FullName (Join-Path $scriptsDest $_.Name) -Force }
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
}

$apkBuilt = Join-Path $Releases "android\hotel-system.apk"
if (Test-Path $apkBuilt) {
  New-Item -ItemType Directory -Force -Path (Join-Path $Stage "app\downloads") | Out-Null
  Copy-Item $apkBuilt (Join-Path $Stage "app\downloads\hotel-system.apk")
  if ($SkipAndroid) {
    Write-Host "Using existing APK: $apkBuilt" -ForegroundColor Green
  }
} elseif (-not $SkipAndroid) {
  throw "APK missing after Android build: $apkBuilt"
}

if (-not $SkipDesktop) {
  Step "Desktop app (Electron)"
  # Sign with Sign.ps1 after pack; electron-builder winCodeSign cache needs symlinks on some PCs.
  $prevCsc = $env:CSC_LINK
  $env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
  Remove-Item Env:CSC_LINK -ErrorAction SilentlyContinue
  Remove-Item Env:CSC_KEY_PASSWORD -ErrorAction SilentlyContinue
  try {
    # Unique output dir avoids EBUSY when releases\desktop\win-unpacked is locked (IDE/antivirus).
    $desktopOutRel = "../../releases/desktop-build"
    $desktopOutAbs = Join-Path $Releases "desktop-build"
    if (Test-Path $desktopOutAbs) {
      $stamp = Get-Date -Format "HHmmss"
      $desktopOutRel = "../../releases/desktop-build-$stamp"
      $desktopOutAbs = Join-Path $Releases "desktop-build-$stamp"
    }
    # Prefer workspace Electron dist when present (avoids GitHub download failures offline).
    $electronDist = Join-Path $Root "node_modules\electron\dist"
    $builderArgs = @(
      "--filter", "@hotel/desktop", "exec", "electron-builder", "--dir",
      "-c.extraMetadata.version=$Version",
      "-c.directories.output=$desktopOutRel"
    )
    if (Test-Path (Join-Path $electronDist "electron.exe")) {
      Write-Host "Using local Electron: $electronDist" -ForegroundColor Green
      $builderArgs += "-c.electronDist=$electronDist"
    }
    Invoke-Checked "pnpm" $builderArgs
  } finally {
    if ($prevCsc) { $env:CSC_LINK = $prevCsc }
  }
  $unpacked = Join-Path $desktopOutAbs "win-unpacked"
  $desktopExeName = "PixalBotics Restaurant.exe"
  if (-not (Test-Path (Join-Path $unpacked $desktopExeName))) {
    throw "Electron build missing: $(Join-Path $unpacked $desktopExeName)"
  }
  Copy-Item $unpacked (Join-Path $Stage "desktop") -Recurse
  # Additional PCs read this for LAN auto-update comparisons.
  Set-Content -Path (Join-Path $Stage "desktop\VERSION") -Value $Version -NoNewline -Encoding ascii
}

Step "Install scripts"
New-Item -ItemType Directory -Force -Path (Join-Path $Stage "scripts") | Out-Null
Copy-Item (Join-Path $PSScriptRoot "install.ps1"), (Join-Path $PSScriptRoot "uninstall.ps1"), (Join-Path $PSScriptRoot "Repair-Migrations.ps1") (Join-Path $Stage "scripts")
Set-Content -Path (Join-Path $Stage "VERSION") -Value $Version -NoNewline -Encoding ascii

# LAN auto-update package for Additional (cashier) PCs — served at /downloads
$desktopStage = Join-Path $Stage "desktop"
$desktopExe = Join-Path $desktopStage "PixalBotics Restaurant.exe"
if (Test-Path $desktopExe) {
  Step "Desktop auto-update zip (Additional PCs)"
  $dlDir = Join-Path $Stage "app\downloads"
  New-Item -ItemType Directory -Force -Path $dlDir | Out-Null
  if (-not (Test-Path (Join-Path $desktopStage "VERSION"))) {
    Set-Content -Path (Join-Path $desktopStage "VERSION") -Value $Version -NoNewline -Encoding ascii
  }
  $zipPath = Join-Path $dlDir "desktop-update.zip"
  if (Test-Path $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::CreateFromDirectory($desktopStage, $zipPath)
  $hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $size = (Get-Item -LiteralPath $zipPath).Length
  $manifest = [ordered]@{
    version = $Version
    file    = "desktop-update.zip"
    path    = "/downloads/desktop-update.zip"
    sha256  = $hash
    size    = $size
  }
  ($manifest | ConvertTo-Json -Compress) | Set-Content -Path (Join-Path $dlDir "desktop-update.json") -Encoding ascii
  Write-Host ("Desktop update package: {0:N1} MB (sha256 {1}…)" -f ($size / 1MB), $hash.Substring(0, 12)) -ForegroundColor Green
}

Step "Authenticode sign staged binaries"
$signScript = Join-Path $PSScriptRoot "Sign.ps1"
$toSign = @()
if (Test-Path (Join-Path $Stage "desktop\PixalBotics Restaurant.exe")) {
  $toSign += (Join-Path $Stage "desktop\PixalBotics Restaurant.exe")
}
if (Test-Path (Join-Path $Stage "winsw\HotelSystemAPI.exe")) { $toSign += (Join-Path $Stage "winsw\HotelSystemAPI.exe") }
$signResult = & $signScript -Path $toSign -Required:$RequireSign
if ($signResult -is [hashtable] -and -not $signResult.Signed -and $RequireSign) {
  throw "Signing required but no files were signed. Configure packaging\windows\signing.env - see docs\CODE-SIGNING.md"
}

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

# Inno Setup splits on spaces in /D and /O. Junctions avoid spaces in the repo path.
function New-InnoJunction([string]$target) {
  if ($target -notmatch ' ') { return $target }
  $linkRoot = Join-Path $env:TEMP "hotel-inno-links"
  New-Item -ItemType Directory -Force -Path $linkRoot | Out-Null
  $link = Join-Path $linkRoot ([guid]::NewGuid().ToString("n").Substring(0, 12))
  if (Test-Path $link) { Remove-Item $link -Force -Recurse -ErrorAction SilentlyContinue }
  New-Item -ItemType Junction -Path $link -Target $target | Out-Null
  return $link
}

$stageForInno = New-InnoJunction $Stage
$outForInno = New-InnoJunction $versionDir
$issPath = Join-Path $PSScriptRoot "HotelSystem.iss"
$issForInno = $issPath
if ($issPath -match ' ') {
  $issLinkRoot = Join-Path $env:TEMP "hotel-inno-links"
  New-Item -ItemType Directory -Force -Path $issLinkRoot | Out-Null
  $issDirLink = Join-Path $issLinkRoot ("iss-" + [guid]::NewGuid().ToString("n").Substring(0, 8))
  New-Item -ItemType Junction -Path $issDirLink -Target $PSScriptRoot | Out-Null
  $issForInno = Join-Path $issDirLink "HotelSystem.iss"
}
if ($stageForInno -ne $Stage -or $outForInno -ne $versionDir) {
  Write-Host "Inno paths (no spaces): stage=$stageForInno out=$outForInno" -ForegroundColor DarkGray
}

# Build Inno SignTool definition so Setup.exe + SignedUninstaller stub are signed.
$isccArgs = @(
  "/Q",
  "/DAppVersion=$Version",
  "/DStageDir=$stageForInno",
  "/DWithDesktop=$withDesktop",
  "/O$outForInno"
)
$signWrapper = Get-InnoSignWrapperPath
if ($signWrapper) {
  Write-Host "Inno SignTool enabled (Authenticode)" -ForegroundColor Green
  $isccArgs += "/DHotelDoSign=1"
  $signForInno = New-InnoJunction (Split-Path $signWrapper -Parent)
  $isccArgs += "/SHotelSign=$(Join-Path $signForInno (Split-Path $signWrapper -Leaf)) `$f"
} else {
  # Inno 6.7+ verifies SignTool actually signed the file — do not pass a no-op.
  # HotelSystem.iss omits SignTool unless /DHotelDoSign=1 is set.
  Write-Host "WARNING: Building UNSIGNED installer (dev/internal only)." -ForegroundColor Yellow
  Write-Host "Configure signing.env + docs\CODE-SIGNING.md for Smart App Control-safe releases." -ForegroundColor Yellow
  if ($RequireSign) { throw "HOTEL_SIGN_REQUIRED / -RequireSign set but signing is not configured." }
}
$isccArgs += $issForInno
Invoke-Checked $iscc $isccArgs

$setupExe = Join-Path $versionDir "HotelSystem-Setup-$Version.exe"
if (-not (Test-Path $setupExe)) { throw "Installer missing: $setupExe" }

# Sign outer Setup again if Inno noop was used but we still have a cert (belt and suspenders),
# or when SignTool was used - verify and optionally re-stamp via Sign.ps1 on the final EXE.
Step "Verify / finalize Setup.exe signature"
& $signScript -Path @($setupExe) -Required:$RequireSign | Out-Null
$sig = Get-AuthenticodeSignature $setupExe
Write-Host "Setup signature status: $($sig.Status)" -ForegroundColor $(if ($sig.Status -eq "Valid") { "Green" } else { "Yellow" })
if ($RequireSign -and $sig.Status -ne "Valid") {
  throw "Setup.exe is not Validly signed. Status=$($sig.Status). See docs\CODE-SIGNING.md"
}

$apkSrc = Join-Path $Releases "android\hotel-system.apk"
if (Test-Path $apkSrc) {
  Copy-Item $apkSrc (Join-Path $versionDir "hotel-system.apk") -Force
}

$readme = @"
Hotel System v$Version - client package
=====================================

SEND TO CLIENT
--------------
1) HotelSystem-Setup-$Version.exe   (main installer - required)
2) hotel-system.apk                 (optional; also inside the server after install)
3) See docs in the product: INDUSTRIAL-SETUP (main server + counter printers)

INSTALL - INDUSTRIAL PATTERN
----------------------------
• Main / server PC (ONE only, often in a back room):
  run the exe → "Main PC: server + desktop app"
  Reserve this PC's IP in the router (DHCP reservation).

• Cashier / kitchen / other PCs (same LAN or Wi-Fi):
  run the same exe → "Additional PC: desktop app only"
  UI only - finds the main server automatically.

• Each cashier COUNTER billing printer:
  Option A — NETWORK mode (Wi-Fi/Ethernet), fixed IP, port 9100.
  Option B — USB on the cashier PC: leave the desktop app open on that PC;
  printers appear automatically in Settings as "USB (Additional PC)".
  On the server: tick Bill, set Station (e.g. Cashier 1), Test print.
  Users → edit cashier → Bill printer → assign that printer.
  Every Additional PC registers its own USB printers (new PCs too).

• Tablets / phones: same Wi-Fi → scan QR or install hotel-system.apk

DEMO LOGIN (change after install)
--------------------------------
admin / admin123

UPGRADE (already installed hotel)
---------------------------------
• Do NOT uninstall. Uninstall can delete data if you click Yes.
• Run the newer Setup.exe on the Main PC as Administrator.
• Choose "Main PC: server + desktop" again (same as first install).
• Existing data is kept (menu, orders, stock, users) under ProgramData.
• Setup migrates the database schema only — it does NOT re-seed.
• A pre-upgrade backup is written under C:\ProgramData\HotelSystem\backups.
• If Setup says a service is marked for deletion: restart the PC, run Setup again.
• Logs: C:\ProgramData\HotelSystem\logs\install.log and last-error.txt

NOTES
-----
• Prefer the 192.168.x address for tablets (ignore virtual 10.x / 172.x).
• USB printers must be on the MAIN SERVER PC, or use network printers at counters.
• Production Setup.exe must be Authenticode-signed (see CODE-SIGNING.md).
  Unsigned builds are for internal testing only.
• Developer test DB (.dev) is never used by this installer.
"@
Set-Content -Path (Join-Path $versionDir "README.txt") -Value $readme -Encoding utf8

# Ship docs next to the installer
foreach ($doc in @("INDUSTRIAL-SETUP.md", "RELEASE-NOTES.md", "NETWORKING.md", "CODE-SIGNING.md")) {
  $src = Join-Path $Root "docs\$doc"
  if (Test-Path $src) { Copy-Item $src (Join-Path $versionDir $doc) -Force }
}

$exeMb = [math]::Round(((Get-Item $setupExe).Length / 1MB), 1)
Write-Host "`nRelease folder: $versionDir" -ForegroundColor Green
Write-Host "Installer: $setupExe ($exeMb MB)" -ForegroundColor Green
Write-Host "Signature: $($sig.Status)" -ForegroundColor $(if ($sig.Status -eq "Valid") { "Green" } else { "Yellow" })
if ($sig.Status -ne "Valid") {
  Write-Host "Client PCs with Smart App Control ON will block this unsigned Setup." -ForegroundColor Yellow
  Write-Host "See docs\CODE-SIGNING.md - obtain a trusted Authenticode cert, then rebuild with -RequireSign." -ForegroundColor Yellow
}
if (Test-Path (Join-Path $versionDir "hotel-system.apk")) {
  Write-Host "APK: $(Join-Path $versionDir 'hotel-system.apk')" -ForegroundColor Green
}
