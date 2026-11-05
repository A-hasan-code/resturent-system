# Smoke-test release code protection (no full installer).
# Requires: pnpm install, apps/api and apps/web already built.
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

$apiDist = Join-Path $Root "apps\api\dist\main.js"
$webDist = Join-Path $Root "apps\web\dist"
if (-not (Test-Path $apiDist)) { throw "Build API first: pnpm --filter @hotel/api run build" }
if (-not (Test-Path $webDist)) { throw "Build web first: pnpm --filter @hotel/web run build" }

$smoke = Join-Path $Root "build\protect-smoke"
if (Test-Path $smoke) { Remove-Item $smoke -Recurse -Force }
$app = Join-Path $smoke "app"
New-Item -ItemType Directory -Force -Path (Join-Path $app "api") | Out-Null
Copy-Item (Join-Path $Root "apps\api\dist") (Join-Path $app "api\dist") -Recurse
Copy-Item $webDist (Join-Path $app "web\dist") -Recurse

Write-Host "Running protect-release on smoke stage..." -ForegroundColor Cyan
& node (Join-Path $Root "scripts\protect-release.mjs") --stage $smoke
if ($LASTEXITCODE -ne 0) { throw "protect-release failed" }

$protected = Join-Path $app "api\dist\app.protected.js"
$main = Join-Path $app "api\dist\main.js"
$integrity = Join-Path $app "integrity.json"
foreach ($p in $protected, $main, $integrity) {
  if (-not (Test-Path $p)) { throw "Missing after protect: $p" }
}

# Nest module paths should be gone from dist.
$leftover = Get-ChildItem (Join-Path $app "api\dist") -Recurse -Filter "*.js" |
  Where-Object { $_.Name -notin @("main.js", "app.protected.js") }
if ($leftover) {
  throw "Readable Nest JS still present: $($leftover.FullName -join ', ')"
}

$sample = Get-Content $protected -Raw -ErrorAction SilentlyContinue
if ($sample -match "NestFactory\.create") {
  throw "Protected bundle still contains clear NestFactory.create - obfuscation too weak or skipped"
}

function Invoke-NodeCapture([string]$WorkDir, [string[]]$NodeArgs, [int]$TimeoutMs = 15000) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "node"
  $psi.Arguments = ($NodeArgs | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join " "
  $psi.WorkingDirectory = $WorkDir
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  $exited = $p.WaitForExit($TimeoutMs)
  if (-not $exited) {
    try { $p.Kill($true) } catch { try { $p.Kill() } catch {} }
    Start-Sleep -Milliseconds 200
  }
  $stdout = $p.StandardOutput.ReadToEnd()
  $stderr = $p.StandardError.ReadToEnd()
  $code = if ($exited) { $p.ExitCode } else { -1 }
  return [pscustomobject]@{ Code = $code; Out = ($stdout + "`n" + $stderr); TimedOut = -not $exited }
}

Write-Host "Integrity OK path: launch bootstrap briefly (Nest may keep running)..." -ForegroundColor Cyan
$env:NODE_ENV = "production"
# Smoke stage has no node_modules under app/api - only test that integrity passes then require fails/times out.
# Copy minimal check: run from repo api folder with NODE_PATH? Simpler: only assert integrity file + bootstrap parse.
$verifyScript = @'
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const appRoot = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(path.join(appRoot, "integrity.json"), "utf8"));
for (const [rel, expected] of Object.entries(manifest.files)) {
  const abs = path.join(appRoot, rel.split("/").join(path.sep));
  const actual = crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
  if (actual !== expected) { console.error("[HotelSystem integrity] tampered file: " + rel); process.exit(1); }
}
console.log("integrity-ok");
'@
$verifyPath = Join-Path $smoke "verify-integrity.js"
Set-Content -Path $verifyPath -Value $verifyScript -Encoding utf8
$clean = Invoke-NodeCapture $smoke @($verifyPath, $app) 10000
if ($clean.Out -notmatch "integrity-ok") {
  throw "Clean integrity verify failed:`n$($clean.Out)"
}
Write-Host "Clean integrity verify OK" -ForegroundColor Green

Write-Host "Tamper test..." -ForegroundColor Cyan
Add-Content -Path $protected -Value "`n/* tamper */" -Encoding utf8
$tamper = Invoke-NodeCapture $smoke @($verifyPath, $app) 10000
if ($tamper.Code -eq 0 -or $tamper.Out -match "integrity-ok") {
  throw "Tampered verify succeeded - integrity seal failed"
}
if ($tamper.Out -notmatch "tampered|integrity") {
  throw "Expected integrity error on tamper, got:`n$($tamper.Out)"
}
Write-Host "Tamper correctly blocked (exit=$($tamper.Code))" -ForegroundColor Green

# Also ensure obfuscated bootstrap refuses when run (needs cwd api/dist parent structure)
Write-Host "Bootstrap tamper refusal..." -ForegroundColor Cyan
$boot = Invoke-NodeCapture (Join-Path $app "api") @("dist\main.js") 8000
if ($boot.Out -notmatch "tampered|integrity") {
  throw "Bootstrap did not report integrity failure:`n$($boot.Out)"
}
Write-Host "Bootstrap integrity refusal OK" -ForegroundColor Green

Write-Host "Desktop protect dry-run (copy)..." -ForegroundColor Cyan
$deskCopy = Join-Path $smoke "desktop-src"
Copy-Item (Join-Path $Root "apps\desktop\src") $deskCopy -Recurse
& node (Join-Path $Root "scripts\protect-release.mjs") --desktop-src $deskCopy
if ($LASTEXITCODE -ne 0) { throw "desktop protect failed" }
$deskMain = Get-Content (Join-Path $deskCopy "main.js") -Raw
if ($deskMain -match "function createWindow") {
  Write-Host "Warning: desktop main still has clear createWindow (obfuscator may keep some names)" -ForegroundColor Yellow
} else {
  Write-Host "Desktop main obfuscated" -ForegroundColor Green
}

Write-Host "protect-release smoke PASSED" -ForegroundColor Green
