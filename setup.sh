#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

echo "========================================================================"
echo "Theme Image Set Studio (v4.1) — macOS / Linux Setup"
echo "========================================================================"

if ! command -v python3 >/dev/null 2>&1; then
  echo "[ERROR] python3 (>= 3.10) is required. Install Python first."
  exit 1
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "[ERROR] Node.js (>= 18) and npm are required to build the Studio UI."
  exit 1
fi

PY_VER="$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
echo "• Python detected: $PY_VER ($(command -v python3))"
echo "• Node.js detected: $(node -v)"

if [ ! -d ".venv" ]; then
  echo "• Creating Python virtual environment (.venv)..."
  python3 -m venv .venv
fi

echo "• Installing Python dependencies..."
./.venv/bin/python -m pip install --upgrade pip --quiet
./.venv/bin/pip install -r requirements.txt

echo "• Installing frontend npm packages..."
if [ -f "frontend/package-lock.json" ]; then
  npm --prefix frontend ci
else
  npm --prefix frontend install
fi

echo "• Building frontend bundle (frontend/dist)..."
npm --prefix frontend run build

echo "• Running modular preflight audit..."
./.venv/bin/python scripts/run_module_audit.py --module all

echo ""
echo "========================================================================"
echo "Setup complete! Start the Studio anytime with:"
echo "  ./start.sh"
echo "or:"
echo "  ./.venv/bin/python app.py"
echo "========================================================================"
