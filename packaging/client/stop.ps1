$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
Set-Location $Root
docker compose --env-file "$Root\.env" -f "$Root\docker-compose.yml" down
Write-Host "Hotel System stopped." -ForegroundColor Yellow
