# Shared helpers for the dev database script and the release build.
# Third-party binaries are downloaded once into packaging\cache (git-ignored).

$script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$script:ToolCache = Join-Path $script:RepoRoot "packaging\cache"

$script:NodeVersion = "22.14.0"
$script:PgVersion = "16.8-1"
$script:WinSwVersion = "2.12.0"

$script:Downloads = @{
  node  = @{ File = "node-v$NodeVersion-win-x64.zip"; Url = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip" }
  pg    = @{ File = "postgresql-$PgVersion-windows-x64-binaries.zip"; Url = "https://get.enterprisedb.com/postgresql/postgresql-$PgVersion-windows-x64-binaries.zip" }
  winsw = @{ File = "WinSW-x64.exe"; Url = "https://github.com/winsw/winsw/releases/download/v$WinSwVersion/WinSW-x64.exe" }
}

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

function Invoke-Checked([string]$exe, [string[]]$argv, [string]$cwd = $script:RepoRoot) {
  Push-Location $cwd
  try {
    & $exe @argv
    if ($LASTEXITCODE -ne 0) { throw "$exe $($argv -join ' ') failed (exit $LASTEXITCODE)" }
  } finally { Pop-Location }
}

function Get-CachedDownload([string]$key) {
  $d = $script:Downloads[$key]
  $path = Join-Path $script:ToolCache $d.File
  if (-not (Test-Path $path)) {
    New-Item -ItemType Directory -Force -Path $script:ToolCache | Out-Null
    Write-Host "Downloading $($d.Url)"
    $prev = $ProgressPreference
    $ProgressPreference = "SilentlyContinue"
    try {
      Invoke-WebRequest -Uri $d.Url -OutFile "$path.part" -UseBasicParsing
    } finally { $ProgressPreference = $prev }
    Move-Item "$path.part" $path
  }
  return $path
}

function Expand-ZipEntries([string]$zip, [string]$prefix, [string]$dest) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($zip)
  try {
    foreach ($e in $archive.Entries) {
      if (-not $e.FullName.StartsWith($prefix) -or $e.FullName.EndsWith("/")) { continue }
      $target = Join-Path $dest ($e.FullName.Substring($prefix.Length) -replace "/", "\")
      New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
      [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $target, $true)
    }
  } finally { $archive.Dispose() }
}

function Expand-ZipEntry([string]$zip, [string]$entryName, [string]$target) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($zip)
  try {
    $e = $archive.GetEntry($entryName)
    if (-not $e) { throw "$entryName not found in $zip" }
    New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
    [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $target, $true)
  } finally { $archive.Dispose() }
}

# Portable PostgreSQL (bin, lib, share only). Returns the install root.
function Get-PostgresHome {
  $pgHome = Join-Path $script:ToolCache "pgsql"
  if (-not (Test-Path (Join-Path $pgHome "bin\postgres.exe"))) {
    $zip = Get-CachedDownload "pg"
    Write-Host "Extracting PostgreSQL binaries to $pgHome"
    foreach ($part in "bin", "lib", "share") {
      Expand-ZipEntries $zip "pgsql/$part/" (Join-Path $pgHome $part)
    }
  }
  return $pgHome
}
