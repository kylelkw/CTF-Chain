@echo off
cd /d C:\Users\tanju\NYhacks\chainsentinel
git config user.email "kylelee07@gmail.com"

echo ============================================
echo COMMIT 1/8: Monorepo config
echo ============================================
git add .gitignore pnpm-workspace.yaml pnpm-lock.yaml package.json .github\copilot-instructions.md
git commit -m "chore: initialize monorepo with pnpm workspace config" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
echo.
pause

echo ============================================
echo COMMIT 2/8: Solidity contracts
echo ============================================
git add packages\contracts\foundry.toml packages\contracts\package.json packages\contracts\src\ProtectedSwapRouter.sol packages\contracts\script\DeployProtectedSwapRouter.s.sol packages\contracts\test\ProtectedSwapRouter.t.sol
git commit -m "feat: add ProtectedSwapRouter Solidity contract with deploy and tests" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
echo.
pause

echo ============================================
echo COMMIT 3/8: Next.js app config
echo ============================================
git add apps\web\package.json apps\web\next.config.ts apps\web\tsconfig.json apps\web\postcss.config.mjs apps\web\.eslintrc.json apps\web\next-env.d.ts
git commit -m "chore: configure Next.js app with TypeScript and Tailwind" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
echo.
pause

echo ============================================
echo COMMIT 4/8: App shell (layout, providers, page, styles)
echo ============================================
git add apps\web\src\app\globals.css apps\web\src\app\layout.tsx apps\web\src\app\page.tsx apps\web\src\app\providers.tsx
git commit -m "feat: add app shell with layout, providers, and global styles" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
echo.
pause

echo ============================================
echo COMMIT 5/8: Lib files (viem, wagmi, contracts, scanner)
echo ============================================
git add apps\web\src\lib\viem.ts apps\web\src\lib\wagmi.ts apps\web\src\lib\contracts.ts apps\web\src\lib\scanner.ts
git commit -m "feat: add blockchain client config and security scanner lib" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
echo.
pause

echo ============================================
echo COMMIT 6/8: UI components (Header, StatusBar, ProtectedSwap, etc.)
echo ============================================
git add apps\web\src\components\Header.tsx apps\web\src\components\StatusBar.tsx apps\web\src\components\ProtectedSwap.tsx apps\web\src\components\ThreatScanner.tsx apps\web\src\components\UnlinkOnboarding.tsx
git commit -m "feat: add UI components for header, status bar, and swap interface" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
echo.
pause

echo ============================================
echo COMMIT 7/8: API route (server-side CTF validation)
echo ============================================
git add apps\web\src\app\api\attack-sim\route.ts
git commit -m "feat: add attack-sim API with server-side CTF flag validation" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
echo.
pause

echo ============================================
echo COMMIT 8/8: CTF game UI (AttackSimulator)
echo ============================================
git add apps\web\src\components\AttackSimulator.tsx
git commit -m "feat: add CTF-Chain game with encryption layer analysis and flag challenges" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
echo.
pause

echo ============================================
echo ALL COMMITS DONE! Pushing to GitHub...
echo ============================================
git add -A
git diff --cached --stat
echo.
echo If there are leftover files above, uncommitted files will be committed now:
pause
git commit -m "chore: add remaining project files" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" --allow-empty

echo.
echo Ready to push. Make sure remote is set:
echo   git remote add origin https://github.com/YOUR_USERNAME/chainsentinel.git
echo.
git push -u origin main
pause
