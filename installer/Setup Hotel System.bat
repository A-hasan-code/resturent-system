@echo off
title Hotel System Setup
cd /d "%~dp0"

:: Request Administrator
net session >nul 2>&1
if %errorLevel% neq 0 (
  echo Requesting Administrator permission...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo.
echo Hotel System Demo Installer
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Setup-HotelSystem.ps1"
if errorlevel 1 (
  echo.
  echo Setup failed. See messages above.
  pause
)
