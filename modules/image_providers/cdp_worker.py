"""
Isolated subprocess runner for Chrome CDP Playwright turns.

Running each Playwright CDP interaction in a disposable child OS process group
ensures that even if Playwright's greenlet dispatcher (`page.evaluate()`, IPC,
or Node driver) deadlocks, killing the process group (`killpg`) cleanly tears
down both Python and Playwright's child `node` driver without touching Chrome (:9222)
or blocking on inherited `stderr` pipes.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import tempfile
import time
from typing import Any, Callable, Dict, Optional

from config import BASE_DIR
from modules.image_providers.browser_cdp_provider import (
    ProviderAuthError,
    ProviderToolUnavailableError,
    ReferenceTooSimilarError,
    generate_image_via_cdp,
)


def _emit(event_type: str, **payload: Any) -> None:
    msg = {"type": event_type, **payload}
    sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _terminate_process_group(proc: subprocess.Popen[bytes]) -> None:
    """Terminates the worker Python process AND any child Playwright node drivers in its group."""
    if os.name == "posix":
        try:
            pgid = os.getpgid(proc.pid)
        except Exception:
            pgid = None
        if pgid:
            if proc.poll() is None:
                try:
                    os.killpg(pgid, signal.SIGTERM)
                    proc.wait(timeout=0.7)
                except Exception:
                    pass
            try:
                os.killpg(pgid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            except Exception:
                pass

    if proc.poll() is None:
        try:
            proc.terminate()
            proc.wait(timeout=0.7)
        except Exception:
            pass
    if proc.poll() is None:
        try:
            proc.kill()
        except Exception:
            pass
    try:
        proc.wait(timeout=0.8)
    except Exception:
        pass


def run_cdp_worker_task(
    payload: Dict[str, Any],
    *,
    watchdog_sec: float = 30.0,
    hard_timeout_sec: float = 165.0,
    log_fn: Optional[Callable[[str], None]] = None,
    should_abort: Optional[Callable[[], bool]] = None,
) -> Dict[str, Any]:
    """
    Executes a CDP payload inside an isolated child Python process group, monitoring
    real worker heartbeats (`watchdog_sec`) and operator abort signals every 0.25s.
    Uses a temporary file for `stderr` instead of a pipe so an orphaned Playwright
    `node` driver holding FD 2 can NEVER deadlock parent reads.
    """
    err_tmp = tempfile.NamedTemporaryFile(prefix="_studio_cdperr_", suffix=".log", delete=False)
    err_path = Path(err_tmp.name)
    err_tmp.close()

    env = dict(os.environ)
    env["PYTHONUNBUFFERED"] = "1"

    popen_kwargs: Dict[str, Any] = {
        "cwd": str(BASE_DIR),
        "stdin": subprocess.PIPE,
        "stdout": subprocess.PIPE,
        "env": env,
    }
    if os.name == "posix":
        popen_kwargs["start_new_session"] = True

    err_fh = open(err_path, "wb")
    try:
        proc = subprocess.Popen(
            [
                sys.executable,
                "-c",
                "from modules.image_providers.cdp_worker import _worker_entrypoint; _worker_entrypoint()",
            ],
            stderr=err_fh,
            **popen_kwargs,
        )
    finally:
        try:
            err_fh.close()
        except Exception:
            pass

    sel = selectors.DefaultSelector()
    final_done: Optional[Dict[str, Any]] = None
    final_err: Optional[Dict[str, Any]] = None
    stdout_buf = bytearray()

    try:
        assert proc.stdin is not None and proc.stdout is not None
        proc.stdin.write((json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8"))
        proc.stdin.flush()
        proc.stdin.close()

        out_fd = proc.stdout.fileno()
        os.set_blocking(out_fd, False)
        sel.register(out_fd, selectors.EVENT_READ)
        out_registered = True

        start_ts = time.time()
        last_hb_ts = start_ts
        eof = False

        def _handle_line(raw_line: bytes) -> None:
            nonlocal last_hb_ts, final_done, final_err
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line:
                return
            try:
                ev = json.loads(line)
            except Exception:
                return
            ev_type = ev.get("type")
            if ev_type == "heartbeat":
                last_hb_ts = time.time()
            elif ev_type == "log":
                last_hb_ts = time.time()
                if log_fn and ev.get("msg"):
                    log_fn(str(ev["msg"]))
            elif ev_type == "done":
                last_hb_ts = time.time()
                final_done = ev
            elif ev_type == "error":
                last_hb_ts = time.time()
                final_err = ev

        while True:
            if should_abort and should_abort():
                _terminate_process_group(proc)
                raise RuntimeError("Turn aborted or deferred by operator.")

            if out_registered:
                events = sel.select(timeout=0.25)
                for _key, _mask in events:
                    try:
                        chunk = os.read(out_fd, 8192)
                    except BlockingIOError:
                        chunk = b""
                    if not chunk:
                        eof = True
                        if out_registered:
                            try:
                                sel.unregister(out_fd)
                            except Exception:
                                pass
                            out_registered = False
                        continue
                    stdout_buf.extend(chunk)
                    while b"\n" in stdout_buf:
                        nl_idx = stdout_buf.index(b"\n")
                        line_bytes = bytes(stdout_buf[:nl_idx])
                        del stdout_buf[: nl_idx + 1]
                        _handle_line(line_bytes)
            else:
                time.sleep(0.15)

            if stdout_buf and eof:
                _handle_line(bytes(stdout_buf))
                stdout_buf.clear()

            if final_done is not None or final_err is not None:
                try:
                    proc.wait(timeout=1.2)
                except Exception:
                    pass
                _terminate_process_group(proc)
                break

            if eof and proc.poll() is not None:
                break

            now_ts = time.time()
            if now_ts - last_hb_ts >= watchdog_sec:
                _terminate_process_group(proc)
                raise RuntimeError(
                    f"Worker stalled with no browser heartbeat for {int(watchdog_sec)}s — "
                    "terminated stuck Playwright session and moved on."
                )
            if now_ts - start_ts >= hard_timeout_sec:
                _terminate_process_group(proc)
                raise RuntimeError(
                    f"CDP worker exceeded {int(hard_timeout_sec)}s safety limit — terminated stuck turn."
                )

        if final_done is not None:
            return final_done

        if final_err is not None:
            kind = final_err.get("kind")
            msg = str(final_err.get("msg") or "CDP worker failed.")
            if kind == "auth":
                raise ProviderAuthError(msg)
            if kind == "tool_unavailable":
                raise ProviderToolUnavailableError(msg)
            if kind == "similarity":
                raise ReferenceTooSimilarError(msg, similarity=final_err.get("similarity") or {})
            raise RuntimeError(msg)

        _terminate_process_group(proc)
        stderr_tail = ""
        try:
            if err_path.exists():
                stderr_tail = err_path.read_text(encoding="utf-8", errors="replace").strip()[-350:]
        except Exception:
            pass
        raise RuntimeError(
            f"CDP worker exited unexpectedly (code {proc.returncode}): {stderr_tail or 'no output'}"
        )
    finally:
        try:
            sel.close()
        except Exception:
            pass
        _terminate_process_group(proc)
        try:
            err_path.unlink(missing_ok=True)
        except Exception:
            pass


def run_cdp_image_turn_isolated(
    *,
    engine: str,
    prompt_final: str,
    reference_path: Optional[str] = None,
    log_fn: Optional[Callable[[str], None]] = None,
    should_abort: Optional[Callable[[], bool]] = None,
    max_wait_sec: float = 150.0,
    new_chat: bool = True,
    check_ref_similarity: bool = True,
    watchdog_sec: float = 30.0,
    recycle_tab: bool = False,
    metadata_request: Optional[Dict[str, Any]] = None,
    cdp_port: Optional[int] = None,
    slot_id: int = 1,
    reference_strength: str = "balanced",
    soft_similarity_accept: bool = False,
) -> Dict[str, Any]:
    tmp = tempfile.NamedTemporaryFile(prefix="_studio_cdp_", suffix=".bin", delete=False)
    bytes_path = tmp.name
    tmp.close()

    try:
        done = run_cdp_worker_task(
            {
                "task": "generate_image",
                "engine": engine,
                "prompt_final": prompt_final,
                "reference_path": reference_path,
                "max_wait_sec": max_wait_sec,
                "new_chat": new_chat,
                "check_ref_similarity": check_ref_similarity,
                "reference_strength": reference_strength,
                "soft_similarity_accept": soft_similarity_accept,
                "recycle_tab": recycle_tab,
                "metadata_request": metadata_request,
                "cdp_port": cdp_port,
                "slot_id": slot_id,
                "bytes_out_path": bytes_path,
            },
            watchdog_sec=watchdog_sec,
            hard_timeout_sec=max_wait_sec + 35.0,
            log_fn=log_fn,
            should_abort=should_abort,
        )
        raw_bytes = Path(bytes_path).read_bytes()
        if not raw_bytes or len(raw_bytes) < 4096:
            raise RuntimeError("CDP worker completed but output image file was empty.")
        info = dict(done.get("info") or {})
        info["raw_bytes"] = raw_bytes
        return info
    finally:
        try:
            Path(bytes_path).unlink(missing_ok=True)
        except Exception:
            pass


def run_cdp_metadata_turn_isolated(
    *,
    engine: str,
    theme: str,
    prompt_final: str,
    metadata_language: str,
    index_num: int,
    caption_prompt: str = "",
    primary_tag: str = "",
    category: str = "",
    available_categories: Optional[list[str]] = None,
    cdp_port: Optional[int] = None,
    timeout_sec: float = 15.0,
    should_abort: Optional[Callable[[], bool]] = None,
) -> Optional[Dict[str, str]]:
    done = run_cdp_worker_task(
        {
            "task": "metadata_turn",
            "engine": engine,
            "theme": theme,
            "prompt_final": prompt_final,
            "metadata_language": metadata_language,
            "index_num": index_num,
            "caption_prompt": caption_prompt,
            "primary_tag": primary_tag,
            "category": category,
            "available_categories": available_categories,
            "cdp_port": cdp_port,
            "timeout_sec": timeout_sec,
        },
        watchdog_sec=16.0,
        hard_timeout_sec=max(26.0, timeout_sec + 10.0),
        should_abort=should_abort,
    )
    meta = done.get("meta")
    return meta if isinstance(meta, dict) else None


def _worker_entrypoint() -> None:
    _emit("heartbeat")
    raw_in = sys.stdin.read()
    payload = json.loads(raw_in)
    task = payload.get("task")

    try:
        if task == "generate_image":
            result = generate_image_via_cdp(
                engine=payload["engine"],
                prompt_final=payload["prompt_final"],
                reference_path=payload.get("reference_path"),
                log_fn=lambda m: _emit("log", msg=m),
                heartbeat_fn=lambda: _emit("heartbeat"),
                max_wait_sec=float(payload.get("max_wait_sec") or 150.0),
                new_chat=bool(payload.get("new_chat", True)),
                check_ref_similarity=bool(payload.get("check_ref_similarity", True)),
                recycle_tab=bool(payload.get("recycle_tab", False)),
                metadata_request=payload.get("metadata_request"),
                cdp_port=payload.get("cdp_port"),
                slot_id=int(payload.get("slot_id") or 1),
                reference_strength=str(payload.get("reference_strength") or "balanced"),
                soft_similarity_accept=bool(payload.get("soft_similarity_accept", False)),
            )
            raw_bytes = result.pop("raw_bytes")
            result.pop("core_luma20", None)
            result.pop("edge_vec", None)
            Path(payload["bytes_out_path"]).write_bytes(raw_bytes)
            _emit("done", info=result)
            return

        if task == "metadata_turn":
            from modules.metadata_writer import _generate_via_cdp_turn

            meta = _generate_via_cdp_turn(
                engine=payload["engine"],
                theme=payload["theme"],
                prompt_final=payload["prompt_final"],
                metadata_language=payload["metadata_language"],
                index_num=int(payload["index_num"]),
                caption_prompt=payload.get("caption_prompt") or "",
                timeout_sec=float(payload.get("timeout_sec") or 15.0),
                heartbeat_fn=lambda: _emit("heartbeat"),
                cdp_port=payload.get("cdp_port"),
                primary_tag=payload.get("primary_tag") or "",
                category=payload.get("category") or "",
                available_categories=payload.get("available_categories"),
            )
            _emit("done", meta=meta)
            return

        raise RuntimeError(f"Unknown CDP worker task: {task}")
    except ProviderAuthError as auth_err:
        _emit("error", kind="auth", msg=str(auth_err))
    except ProviderToolUnavailableError as tool_err:
        _emit("error", kind="tool_unavailable", msg=str(tool_err))
    except ReferenceTooSimilarError as sim_err:
        _emit("error", kind="similarity", msg=str(sim_err), similarity=sim_err.similarity)
    except Exception as exc:
        _emit("error", kind="transient", msg=str(exc))


if __name__ == "__main__":
    _worker_entrypoint()
