"""
Entrypoint for Theme Image Set Studio.
Run directly with:
    ./.venv/bin/python app.py
to run preflight environment checks, stop any stale background server instances,
and launch the Studio at http://127.0.0.1:8000
"""
import os
import signal
import socket
import subprocess
import sys
import time
import webbrowser
from threading import Timer

import uvicorn

from config import (
    EXPORTS_DIR,
    LOG_FILE_PATH,
    ensure_directories,
    get_chrome_executable_path,
)


def _is_port_in_use(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.6)
        return s.connect_ex((host, port)) == 0


def _terminate_stale_servers(start_port: int = 8000, end_port: int = 8015) -> None:
    """
    Finds and terminates any stale Python/uvicorn server processes holding ports 8000..8015
    so `./.venv/bin/python app.py` always starts the latest Studio server on port 8000
    and never leaves duplicate background JobRunner workers running.
    """
    my_pid = os.getpid()
    try:
        out = subprocess.run(
            ["lsof", "-t", f"-iTCP:{start_port}-{end_port}", "-sTCP:LISTEN"],
            capture_output=True,
            text=True,
            timeout=4,
        )
        pids = {
            int(line.strip())
            for line in out.stdout.splitlines()
            if line.strip().isdigit() and int(line.strip()) != my_pid
        }
        if not pids:
            return

        for pid in pids:
            try:
                print(f"• Stopping previous server instance (PID {pid})...")
                os.kill(pid, signal.SIGTERM)
            except Exception:
                pass

        for _ in range(12):
            if not _is_port_in_use("127.0.0.1", start_port):
                break
            time.sleep(0.15)

        for pid in pids:
            try:
                os.kill(pid, signal.SIGKILL)
            except Exception:
                pass
        time.sleep(0.2)
    except Exception:
        pass


def run_preflight_checks(host: str, port: int) -> int:
    ensure_directories()
    _terminate_stale_servers(port, port + 15)

    chrome_path = get_chrome_executable_path()
    chrome_found = bool(chrome_path and os.path.exists(chrome_path))

    print("=" * 72)
    print("THEME IMAGE SET STUDIO — PREFLIGHT CHECK")
    print("=" * 72)
    print(f"• Python runtime : {sys.version.split()[0]} ({sys.executable})")
    print(f"• Chrome binary  : {chrome_path if chrome_found else 'NOT FOUND'}")
    print(f"• Exports folder : {EXPORTS_DIR}")
    print(f"• Log file       : {LOG_FILE_PATH}")

    chosen_port = port
    if _is_port_in_use(host, chosen_port):
        for candidate in range(port + 1, port + 15):
            if not _is_port_in_use(host, candidate):
                chosen_port = candidate
                break

    url = f"http://{host}:{chosen_port}"
    print("-" * 72)
    print(f"Studio URL       : {url}")
    print("=" * 72)
    return chosen_port


def _open_browser_when_ready(host: str, port: int) -> None:
    for _ in range(30):
        if _is_port_in_use(host, port):
            time.sleep(0.25)
            webbrowser.open(f"http://{host}:{port}/?studio={int(time.time())}")
            return
        time.sleep(0.2)


def main() -> None:
    host = "127.0.0.1"
    port = run_preflight_checks(host, 8000)

    if "--no-browser" not in sys.argv:
        import threading
        threading.Thread(
            target=_open_browser_when_ready,
            args=(host, port),
            daemon=True,
        ).start()

    uvicorn.run("server:app", host=host, port=port, reload=False)


if __name__ == "__main__":
    main()
