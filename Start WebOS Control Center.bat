@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules\electron\cli.js" goto install
if not exist "node_modules\ws\package.json" goto install
goto ensure_binary

:install
echo webOS Control Center needs its dependencies first.
echo Running: npm install
echo.
call npm install
if errorlevel 1 (
  echo.
  echo npm install failed. Make sure Node.js 18+ is installed: https://nodejs.org
  pause
  exit /b 1
)
if not exist "node_modules\electron\cli.js" (
  echo.
  echo Electron did not install. Run "npm install" again in this folder.
  pause
  exit /b 1
)

:ensure_binary
if exist "node_modules\electron\dist\electron.exe" goto launch

echo Downloading the Electron runtime (first launch only)...
node -e "require('./node_modules/electron')"
if not exist "node_modules\electron\dist\electron.exe" (
  echo.
  echo Electron could not be downloaded. Check your internet connection and try again.
  pause
  exit /b 1
)

:launch
start "" "node_modules\electron\dist\electron.exe" .
exit /b 0
