@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is required. Install it, then run this file again.
  pause
  exit /b 1
)
if not exist "dist\index.html" (
  echo First prepare the app: npm.cmd ci --no-fund --no-audit
  echo Then build it: npm.cmd run build
  pause
  exit /b 1
)
echo Open http://localhost:4173 in Microsoft Edge. Press Ctrl+C to stop.
node scripts/serve.mjs
if errorlevel 1 pause
