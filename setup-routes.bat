@echo off
set "BASE=%~dp0"
REM Create directories
mkdir "%BASE%chainsentinel\apps\web\src\app\api\ctf-claim" 2>nul
mkdir "%BASE%chainsentinel\apps\web\src\app\api\ctf-pool" 2>nul

REM Copy files
copy "%BASE%ctf-claim-route.ts" "%BASE%chainsentinel\apps\web\src\app\api\ctf-claim\route.ts"
copy "%BASE%ctf-pool-route.ts" "%BASE%chainsentinel\apps\web\src\app\api\ctf-pool\route.ts"

echo Done! Files created successfully.
echo.
echo Created:
echo - %BASE%chainsentinel\apps\web\src\app\api\ctf-claim\route.ts
echo - %BASE%chainsentinel\apps\web\src\app\api\ctf-pool\route.ts
