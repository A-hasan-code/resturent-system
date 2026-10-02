# Disables Windows 11 Smart App Control so unsigned installers (like HotelSystem-Setup)
# can extract helpers under %TEMP%. Requires Administrator + a reboot.
# Run: right-click → Run with PowerShell (Admin), or:
#   powershell -ExecutionPolicy Bypass -File .\Disable-SmartAppControl.ps1

#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"
$path = "HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy"
$name = "VerifiedAndReputablePolicyState"
$before = (Get-ItemProperty $path -Name $name -ErrorAction SilentlyContinue).$name
Set-ItemProperty -Path $path -Name $name -Value 0 -Type DWord
$after = (Get-ItemProperty $path -Name $name).$name
Write-Host "Smart App Control: $before -> $after (0 = Off)" -ForegroundColor Green
Write-Host ""
Write-Host "REBOOT this PC, then run HotelSystem-Setup-1.3.0.exe again." -ForegroundColor Yellow
Write-Host "UI path (same thing): Settings → Privacy & security → Windows Security →"
Write-Host "  App & browser control → Smart App Control → Off"
$reboot = Read-Host "Reboot now? (Y/N)"
if ($reboot -match '^[Yy]') { Restart-Computer -Force }
