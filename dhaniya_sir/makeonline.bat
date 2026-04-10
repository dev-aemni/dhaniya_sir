@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo =========================================
echo   Dhaniya Sir Bot Launcher
echo =========================================

echo [1/3] Checking Node.js...
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install Node.js and try again.
  pause
  exit /b 1
)

echo [2/3] Ensuring dependencies...
if not exist "node_modules" (
  echo node_modules missing. Running npm install...
  call npm.cmd install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo [3/3] Building TypeScript...
call npm.cmd run build
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)

:run
echo Launching bot...
node dist\index.js
echo.
set /p RESTART="Bot stopped. Restart? (y/n): "
if /I "%RESTART%"=="y" goto run

endlocal
exit /b 0
