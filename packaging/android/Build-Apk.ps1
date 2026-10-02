# Builds the signed Android app (Capacitor) that tablets download from the server.
#
#   pnpm apk                       # web build + APK -> releases\android\hotel-system.apk
#   .\Build-Apk.ps1 -SkipWeb       # reuse the existing apps\web\dist
#
# Needs a JDK 17-21 and the Android SDK (both come with Android Studio).
# Override detection with JAVA_HOME / ANDROID_HOME if they live elsewhere.
#
# The release key is created on first run in packaging\android (git-ignored).
# BACK IT UP: Android only installs updates signed with the same key.
param([switch]$SkipWeb)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "..\..\scripts\lib\Tools.ps1")

$Root = $RepoRoot
$Mobile = Join-Path $Root "apps\mobile"
$AndroidDir = Join-Path $Mobile "android"
$OutDir = Join-Path $Root "releases\android"
$Version = (Get-Content (Join-Path $Root "VERSION") -Raw).Trim()
$parts = ($Version -split "[.-]")[0..2] | ForEach-Object { [int]$_ }
$VersionCode = $parts[0] * 10000 + $parts[1] * 100 + $parts[2]

function Get-JavaMajor([string]$javaHome) {
  $java = Join-Path $javaHome "bin\java.exe"
  if (-not (Test-Path $java)) { return 0 }
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $out = (& $java -version 2>&1 | Out-String)
  $ErrorActionPreference = $prev
  if ($out -match 'version "(\d+)') { return [int]$Matches[1] }
  return 0
}

Step "Locate JDK and Android SDK"
$javaHome = @(
  $env:JAVA_HOME,
  "$env:ProgramFiles\Android\Android Studio\jbr",
  "$env:LOCALAPPDATA\Programs\Android Studio\jbr"
) | Where-Object { $_ -and (Get-JavaMajor $_) -ge 17 -and (Get-JavaMajor $_) -le 21 } | Select-Object -First 1
if (-not $javaHome) { throw "JDK 17-21 not found. Install Android Studio or set JAVA_HOME (Gradle does not support newer JDKs yet)." }
$env:JAVA_HOME = $javaHome

$sdk = @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, "$env:LOCALAPPDATA\Android\Sdk") |
  Where-Object { $_ -and (Test-Path (Join-Path $_ "platforms")) } | Select-Object -First 1
if (-not $sdk) { throw "Android SDK not found. Install it from Android Studio (SDK Manager) or set ANDROID_HOME." }
$env:ANDROID_HOME = $sdk
Set-Content -Path (Join-Path $AndroidDir "local.properties") -Value ("sdk.dir=" + ($sdk -replace "\\", "\\")) -Encoding ascii
Write-Host "JDK: $javaHome (Java $(Get-JavaMajor $javaHome))"
Write-Host "SDK: $sdk"

Step "Release signing key"
$keyProps = Join-Path $PSScriptRoot "keystore.properties"
$keyFile = Join-Path $PSScriptRoot "hotel-release.jks"
if (-not (Test-Path $keyProps)) {
  if (Test-Path $keyFile) { throw "$keyFile exists but keystore.properties is missing. Restore it from your backup." }
  $bytes = New-Object byte[] 24
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $pass = [Convert]::ToBase64String($bytes) -replace "[+/=]", "x"
  Invoke-Checked (Join-Path $javaHome "bin\keytool.exe") @(
    "-genkeypair", "-keystore", $keyFile, "-alias", "hotel", "-keyalg", "RSA", "-keysize", "2048",
    "-validity", "10000", "-storepass", $pass, "-keypass", $pass,
    "-dname", "CN=Hotel System, O=Pixalbotics, C=PK"
  )
  Set-Content -Path $keyProps -Encoding ascii -Value @(
    "storeFile=hotel-release.jks",
    "storePassword=$pass",
    "keyAlias=hotel",
    "keyPassword=$pass"
  )
  Write-Host "Created $keyFile - back up this file and keystore.properties." -ForegroundColor Yellow
}

if (-not $SkipWeb) {
  Step "Build web app"
  Invoke-Checked "pnpm" @("--filter", "@hotel/web", "build")
}

Step "Copy web app into the Android project"
Invoke-Checked "pnpm" @("exec", "cap", "sync", "android") $Mobile

Step "Gradle assembleRelease ($Version, code $VersionCode)"
Invoke-Checked (Join-Path $AndroidDir "gradlew.bat") @(
  "assembleRelease", "--no-daemon", "-q", "-PappVersion=$Version", "-PappVersionCode=$VersionCode"
) $AndroidDir

$apk = Join-Path $AndroidDir "app\build\outputs\apk\release\app-release.apk"
if (-not (Test-Path $apk)) { throw "APK not produced: $apk" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Copy-Item $apk (Join-Path $OutDir "hotel-system.apk") -Force
Copy-Item $apk (Join-Path $OutDir "HotelSystem-$Version.apk") -Force
$mb = [math]::Round((Get-Item $apk).Length / 1MB, 1)
Write-Host "`nAPK: $(Join-Path $OutDir 'hotel-system.apk') ($mb MB)" -ForegroundColor Green
