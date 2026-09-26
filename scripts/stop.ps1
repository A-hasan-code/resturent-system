$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location "$Root\docker"
docker compose --env-file "$Root\.env" down
Write-Host "Hotel System stopped." -ForegroundColor Yellow
