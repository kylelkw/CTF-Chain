@echo off
REM Complete setup script for CTF API routes
REM This script creates the necessary directories and files

setlocal enabledelayedexpansion

set "API_PATH=%~dp0chainsentinel\apps\web\src\app\api"
set "CLAIM_PATH=%API_PATH%\ctf-claim"
set "POOL_PATH=%API_PATH%\ctf-pool"

echo Creating directories...
if not exist "%CLAIM_PATH%" (
  mkdir "%CLAIM_PATH%"
  echo Created: %CLAIM_PATH%
)

if not exist "%POOL_PATH%" (
  mkdir "%POOL_PATH%"
  echo Created: %POOL_PATH%
)

echo.
echo Copying files...
copy /Y "%~dp0ctf-claim-route.ts" "%CLAIM_PATH%\route.ts" >nul 2>&1
if errorlevel 1 (
  echo ERROR: Failed to copy ctf-claim route file
  pause
  exit /b 1
)
echo Copied: %CLAIM_PATH%\route.ts

copy /Y "%~dp0ctf-pool-route.ts" "%POOL_PATH%\route.ts" >nul 2>&1
if errorlevel 1 (
  echo ERROR: Failed to copy ctf-pool route file
  pause
  exit /b 1
)
echo Copied: %POOL_PATH%\route.ts

echo.
echo Setup complete!
echo.
echo Created files:
echo - %CLAIM_PATH%\route.ts
echo - %POOL_PATH%\route.ts
echo.
pause
