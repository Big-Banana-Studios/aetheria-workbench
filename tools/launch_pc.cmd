@echo off
setlocal
rem Double-click launcher for the PC. Runs the PC runtime host
rem (tools\pc_runtime.mjs): it serves the built app from dist/ on
rem http://localhost:4173 and runs llama.cpp's llama-server for the app's
rem local runtime (Settings > Local runtime); this window opens the app in
rem a Chrome (or Edge) app window. Closing this window stops the server and
rem the model with it. Lives in tools/, so the app folder is one level up.
rem The Desktop shortcut points here.

set "PORT=4173"
set "URL=http://localhost:%PORT%/"
title Aetheria Workbench
cd /d "%~dp0.."

rem Pick the browser for the app window: Chrome, then Edge, else the default.
set "APP="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "APP=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined APP if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "APP=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined APP if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "APP=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined APP if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "APP=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined APP if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "APP=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

rem A previous window still serving? Just open another app window. An
rem older launcher's server (vite preview, before 0.3.20) answers the page
rem but not the runtime: it is stopped and the runtime host started instead.
call :probe
if not errorlevel 1 (
  call :proberuntime
  if not errorlevel 1 (
    call :open
    exit /b 0
  )
  echo An older Aetheria Workbench server is still running on port %PORT%; replacing it with the runtime host.
  call :replace
  rem a runtime host of ours was on the port beside it (an earlier launch): keep that one
  call :proberuntime
  if not errorlevel 1 (
    call :open
    exit /b 0
  )
)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install it from https://nodejs.org and run this again.
  goto :fail
)

if not exist "node_modules\vite\package.json" (
  echo Installing packages, first run only. This takes a few minutes...
  call npm install
  if errorlevel 1 goto :fail
)

if not exist "dist\index.html" (
  echo Building the app, first run only...
  call npm run build
  if errorlevel 1 goto :fail
)

rem Open the app window as soon as the server answers (waits up to 60 s).
start "" /b powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; $u='%URL%'; $b='%APP%'; foreach ($i in 1..120) { try { $r = Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { break } } catch {}; Start-Sleep -Milliseconds 500 }; if ($b) { Start-Process -FilePath $b -ArgumentList ('--app=' + $u) } else { Start-Process $u }"

echo.
echo   Aetheria Workbench is running at %URL%
echo   Close this window to stop it (and the local model with it).
echo.
node tools\pc_runtime.mjs --port %PORT%
if errorlevel 1 goto :fail
exit /b 0

:probe
rem Exit code 0 when this app already answers on the port.
powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; try { $r = Invoke-WebRequest -Uri '%URL%' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200 -and $r.Content -match '<title>Aetheria Workbench</title>') { exit 0 } } catch {}; exit 1"
exit /b %errorlevel%

:proberuntime
rem Exit code 0 when the runtime host (not an older vite preview) answers on the port.
powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; try { $r = Invoke-WebRequest -Uri '%URL%runtime/status' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200 -and $r.Content -match '\"host\":\"pc\"') { exit 0 } } catch {}; exit 1"
exit /b %errorlevel%

:replace
rem Stop whatever of ours listens on the port (vite preview or an old runtime host), then wait for it to go.
powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; $c = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue; foreach ($x in $c) { $p = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $x.OwningProcess); if ($p -and ($p.CommandLine -match 'vite(\.js\S*)? preview|pc_runtime\.mjs')) { $parent = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $p.ParentProcessId); if ($parent -and $parent.CommandLine -match 'npx|vite preview') { Stop-Process -Id $parent.ProcessId -Force -ErrorAction SilentlyContinue }; Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } }; foreach ($i in 1..20) { if (-not (Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue)) { break }; Start-Sleep -Milliseconds 250 }"
exit /b 0

:open
if defined APP goto :openapp
start "" "%URL%"
exit /b 0
:openapp
start "" "%APP%" --app=%URL%
exit /b 0

:fail
echo.
echo Something went wrong. The lines above say what. Press any key to close.
pause >nul
exit /b 1
