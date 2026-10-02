# Authenticode signing helper for Hotel System Windows releases.
# Supports:
#   1) Certificate store thumbprint  (HOTEL_SIGN_THUMBPRINT)
#   2) PFX file                      (HOTEL_SIGN_PFX + HOTEL_SIGN_PFX_PASSWORD)
#   3) Azure Trusted Signing         (HOTEL_SIGN_AZURE_* ) via TrustedSigning dlib
#
# Loads optional packaging\windows\signing.env (KEY=VALUE lines; never commit secrets).
# Called by Build-Release.ps1. RSA SHA-256 + RFC3161 timestamp (Smart App Control requirement).

param(
  [Parameter(Mandatory = $true)][string[]]$Path,
  [switch]$Required
)

$ErrorActionPreference = "Stop"

function Import-SigningEnv {
  $envFile = Join-Path $PSScriptRoot "signing.env"
  if (-not (Test-Path $envFile)) { return }
  foreach ($raw in Get-Content $envFile) {
    $line = $raw.Trim()
    if (-not $line -or $line.StartsWith("#")) { continue }
    $eq = $line.IndexOf("=")
    if ($eq -lt 1) { continue }
    $k = $line.Substring(0, $eq).Trim()
    $v = $line.Substring($eq + 1).Trim().Trim('"').Trim("'")
    if (-not [string]::IsNullOrEmpty($k) -and -not [Environment]::GetEnvironmentVariable($k)) {
      [Environment]::SetEnvironmentVariable($k, $v, "Process")
    }
  }
}

function Find-SignTool {
  $fromEnv = $env:HOTEL_SIGNTOOL
  if ($fromEnv -and (Test-Path $fromEnv)) { return $fromEnv }
  $cmd = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $roots = @(
    "${env:ProgramFiles(x86)}\Windows Kits\10\bin",
    "${env:ProgramFiles}\Windows Kits\10\bin"
  )
  foreach ($root in $roots) {
    if (-not (Test-Path $root)) { continue }
    $hit = Get-ChildItem $root -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
      Sort-Object FullName -Descending |
      Select-Object -First 1
    if ($hit) { return $hit.FullName }
  }
  return $null
}

function Get-SignMode {
  if ($env:HOTEL_SIGN_AZURE_ACCOUNT -and $env:HOTEL_SIGN_AZURE_CERT_PROFILE -and $env:HOTEL_SIGN_AZURE_ENDPOINT) {
    return "azure"
  }
  if ($env:HOTEL_SIGN_PFX -and (Test-Path $env:HOTEL_SIGN_PFX)) { return "pfx" }
  if ($env:HOTEL_SIGN_THUMBPRINT) { return "thumbprint" }
  return $null
}

function Get-TimestampUrl {
  # If the env var is defined (even empty / "none"), honor it — local self-signed CAs
  # cannot use public timestamp servers.
  $defined = $null -ne [Environment]::GetEnvironmentVariable("HOTEL_SIGN_TIMESTAMP_URL", "Process")
  if ($defined) {
    $v = $env:HOTEL_SIGN_TIMESTAMP_URL
    if (-not $v -or $v -eq "none") { return $null }
    return $v
  }
  return "http://timestamp.digicert.com"
}

function Build-SignArgs([string]$file) {
  $common = @("sign", "/fd", "SHA256", "/v")
  $ts = Get-TimestampUrl
  if ($ts) { $common += @("/td", "SHA256", "/tr", $ts) }
  switch (Get-SignMode) {
    "azure" {
      $dlib = $env:HOTEL_SIGN_AZURE_DLIB
      $meta = $env:HOTEL_SIGN_AZURE_METADATA
      if (-not $dlib -or -not (Test-Path $dlib)) {
        throw "Azure Trusted Signing: set HOTEL_SIGN_AZURE_DLIB to Azure.CodeSigning.Dlib.dll"
      }
      if (-not $meta -or -not (Test-Path $meta)) {
        throw "Azure Trusted Signing: set HOTEL_SIGN_AZURE_METADATA to metadata.json"
      }
      return $common + @("/dlib", $dlib, "/dmdf", $meta, $file)
    }
    "pfx" {
      $args = $common + @("/f", $env:HOTEL_SIGN_PFX)
      if ($env:HOTEL_SIGN_PFX_PASSWORD) { $args += @("/p", $env:HOTEL_SIGN_PFX_PASSWORD) }
      return $args + @($file)
    }
    "thumbprint" {
      return $common + @("/sha1", ($env:HOTEL_SIGN_THUMBPRINT -replace "\s", ""), "/sm", $file)
    }
    default { throw "No signing configuration" }
  }
}

function Test-IsSigned([string]$file) {
  try {
    $s = Get-AuthenticodeSignature -FilePath $file
    return ($s.Status -eq "Valid")
  } catch { return $false }
}

Import-SigningEnv
$mode = Get-SignMode
$signtool = Find-SignTool

if (-not $mode) {
  $msg = @"
Code signing is NOT configured. The installer will remain unsigned.
Windows 11 Smart App Control / SmartScreen will block or warn on client PCs.

Configure packaging\windows\signing.env (see signing.env.example) then rebuild.
Docs: docs\CODE-SIGNING.md
"@
  if ($Required) { throw $msg }
  Write-Host $msg -ForegroundColor Yellow
  return @{ Signed = $false; Mode = $null; SignTool = $signtool }
}

if (-not $signtool) {
  $msg = "signtool.exe not found. Install Windows SDK (Signing Tools) or set HOTEL_SIGNTOOL."
  if ($Required) { throw $msg }
  Write-Host $msg -ForegroundColor Yellow
  return @{ Signed = $false; Mode = $mode; SignTool = $null }
}

$files = @()
foreach ($p in $Path) {
  if (Test-Path $p -PathType Container) {
    $files += Get-ChildItem $p -Recurse -Include *.exe, *.dll, *.msi, *.sys -File |
      Where-Object { $_.Length -gt 0 } |
      ForEach-Object { $_.FullName }
  } elseif (Test-Path $p) {
    $files += (Resolve-Path $p).Path
  } else {
    Write-Host "Skip missing: $p" -ForegroundColor DarkYellow
  }
}
$files = $files | Select-Object -Unique

$signed = 0
$skipped = 0
foreach ($f in $files) {
  # Do not re-sign already-valid vendor binaries (Node, Postgres, Electron framework, etc.)
  # unless HOTEL_SIGN_FORCE=1. Always sign our product EXE names.
  $name = Split-Path $f -Leaf
  $ours = $name -match '^(Hotel System\.exe|HotelSystem-Setup-.*\.exe|HotelSystemAPI\.exe)$'
  if (-not $ours -and (Test-IsSigned $f) -and $env:HOTEL_SIGN_FORCE -ne "1") {
    $skipped++
    continue
  }
  Write-Host "Signing $f"
  $argv = Build-SignArgs $f
  & $signtool @argv
  if ($LASTEXITCODE -ne 0) { throw "signtool failed for $f (exit $LASTEXITCODE)" }
  if (-not (Test-IsSigned $f)) { throw "Signature not Valid after signing: $f" }
  $signed++
}

Write-Host "Signed $signed file(s); skipped $skipped already-valid vendor binaries. Mode=$mode" -ForegroundColor Green
return @{ Signed = ($signed -gt 0 -or $skipped -gt 0); Mode = $mode; SignTool = $signtool; Count = $signed }
