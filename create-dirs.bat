@echo off
set "BASE=%~dp0"
mkdir "%BASE%chainsentinel\apps\web\src\app\api\ctf-claim"
mkdir "%BASE%chainsentinel\apps\web\src\app\api\ctf-pool"
type nul > "%BASE%chainsentinel\apps\web\src\app\api\ctf-claim\route.ts"
type nul > "%BASE%chainsentinel\apps\web\src\app\api\ctf-pool\route.ts"
echo Directories and files created successfully!
dir "%BASE%chainsentinel\apps\web\src\app\api\ctf-claim"
dir "%BASE%chainsentinel\apps\web\src\app\api\ctf-pool"
