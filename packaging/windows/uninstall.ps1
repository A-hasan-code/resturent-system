# Removes Hotel System services, firewall rules and shortcuts.
# Data (database, backups, config) in ProgramData is kept unless -RemoveData is passed.
param(
  [string]$AppDir = (Split-Path $PSScriptRoot -Parent),
  [string]$DataDir = (Join-Path $env:ProgramData "HotelSystem"),
  [switch]$RemoveData
)

$ErrorActionPreference = "Continue"

$DbService = "HotelSystemDB"
$ApiService = "HotelSystemAPI"

function Remove-ServiceSafe([string]$name, [scriptblock]$remove) {
  $s = Get-Service -Name $name -ErrorAction SilentlyContinue
  if (-not $s) { return }
  if ($s.Status -ne "Stopped") { Stop-Service -Name $name -Force -ErrorAction SilentlyContinue }
  & $remove
  if (Get-Service -Name $name -ErrorAction SilentlyContinue) { & sc.exe delete $name | Out-Null }
}

Remove-ServiceSafe $ApiService {
  $winsw = Join-Path $AppDir "winsw\$ApiService.exe"
  if (Test-Path $winsw) { & $winsw uninstall | Out-Null }
}
Remove-ServiceSafe $DbService {
  $pgCtl = Join-Path $AppDir "pgsql\bin\pg_ctl.exe"
  if (Test-Path $pgCtl) { & $pgCtl unregister -N $DbService | Out-Null }
}

$rules = & netsh.exe advfirewall firewall show rule name=all |
  Select-String -Pattern "^Rule Name:\s+(Hotel System - .+)$" |
  ForEach-Object { $_.Matches[0].Groups[1].Value.Trim() } |
  Sort-Object -Unique
foreach ($r in $rules) { & netsh.exe advfirewall firewall delete rule "name=$r" | Out-Null }

Remove-Item (Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\Hotel System\Hotel System (Browser).url") -Force -ErrorAction SilentlyContinue

if ($RemoveData -and (Test-Path $DataDir)) {
  Remove-Item $DataDir -Recurse -Force
}
exit 0
