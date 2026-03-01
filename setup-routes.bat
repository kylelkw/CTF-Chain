@echo off
REM Create directories
mkdir "C:\Users\tanju\NYhacks\chainsentinel\apps\web\src\app\api\ctf-claim" 2>nul
mkdir "C:\Users\tanju\NYhacks\chainsentinel\apps\web\src\app\api\ctf-pool" 2>nul

REM Copy files
copy "C:\Users\tanju\NYhacks\ctf-claim-route.ts" "C:\Users\tanju\NYhacks\chainsentinel\apps\web\src\app\api\ctf-claim\route.ts"
copy "C:\Users\tanju\NYhacks\ctf-pool-route.ts" "C:\Users\tanju\NYhacks\chainsentinel\apps\web\src\app\api\ctf-pool\route.ts"

echo Done! Files created successfully.
echo.
echo Created:
echo - C:\Users\tanju\NYhacks\chainsentinel\apps\web\src\app\api\ctf-claim\route.ts
echo - C:\Users\tanju\NYhacks\chainsentinel\apps\web\src\app\api\ctf-pool\route.ts
