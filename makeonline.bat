@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo =========================================
echo   Dhaniya Sir Bot Launcher
echo =========================================

echo [1/3] Checking Node.js...
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Please install it to continue.
  pause
  exit /b 1
)

:: Always run npm install. It's fast and ensures all packages are up-to-date.
echo [2/3] Syncing dependencies...
call npm.cmd install
if errorlevel 1 (
  echo npm install failed. Check your internet connection or package.json.
  pause
  exit /b 1
)

:: Always build to ensure the latest code from /src is used.
echo [3/3] Building TypeScript...
call npm.cmd run build
if errorlevel 1 (
  echo Build failed. Check src/ for TypeScript errors.
  pause
  exit /b 1
)

:run
echo.
echo =========================================
echo   Starting the bot... Press Ctrl+C to stop.
echo =========================================
node dist\index.js

echo.
echo =========================================
echo   Bot process stopped.
echo =========================================
set /p RESTART="Do you want to restart the bot? (y/n): "
if /I "%RESTART%"=="y" goto run

endlocal
exit /b 0