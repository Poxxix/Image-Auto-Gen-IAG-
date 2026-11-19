#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if [ ! -x ".venv/bin/python" ]; then
  echo "[INFO] .venv not found — running ./setup.sh first..."
  bash ./setup.sh
fi

if [ ! -f "frontend/dist/index.html" ]; then
  echo "[INFO] frontend/dist missing — building UI..."
  npm --prefix frontend run build
fi

exec ./.venv/bin/python app.py "$@"
