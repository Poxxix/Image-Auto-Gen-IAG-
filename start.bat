@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo [INFO] Virtual environment not found. Running setup.ps1...
    powershell -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
    if errorlevel 1 exit /b 1
)

if not exist "frontend\dist\index.html" (
    echo [INFO] frontend\dist missing. Building frontend...
    npm --prefix frontend run build
    if errorlevel 1 exit /b 1
)

.\.venv\Scripts\python.exe app.py %*
