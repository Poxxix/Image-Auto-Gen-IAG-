$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RootDir

Write-Host "========================================================================"
Write-Host "Theme Image Set Studio (v4.1) — Windows Setup"
Write-Host "========================================================================"

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Error "Python (>= 3.10) is required. Install Python from python.org first."
    exit 1
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js (>= 18) and npm are required to build the Studio UI."
    exit 1
}

if (-not (Test-Path ".venv")) {
    Write-Host "• Creating Python virtual environment (.venv)..."
    python -m venv .venv
}

Write-Host "• Installing Python dependencies..."
.\.venv\Scripts\python.exe -m pip install --upgrade pip --quiet
.\.venv\Scripts\pip.exe install -r requirements.txt

Write-Host "• Installing frontend npm packages..."
if (Test-Path "frontend\package-lock.json") {
    npm --prefix frontend ci
} else {
    npm --prefix frontend install
}

Write-Host "• Building frontend bundle (frontend/dist)..."
npm --prefix frontend run build

Write-Host "• Running modular preflight audit..."
.\.venv\Scripts\python.exe scripts\run_module_audit.py --module all

Write-Host ""
Write-Host "========================================================================"
Write-Host "Setup complete! Start the Studio anytime by running: .\start.bat"
Write-Host "========================================================================"
