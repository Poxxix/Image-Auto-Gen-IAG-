import base64
from io import BytesIO
import mimetypes
import os
from pathlib import Path
import re
import signal
import subprocess
import tempfile
import threading
import time
from typing import Any, Callable, Dict, List, Optional
from urllib.parse import urlparse, urlunparse
import numpy as np
from PIL import Image
import requests

from config import (
    AI_ENGINES,
    CDP_ENDPOINT,
    CDP_PORT,
    CHROME_AI_MASTER_DIR,
    get_chrome_executable_path,
)
from modules.app_logging import logger
from modules.reference_sources.image_utils import (
    dhash_distance,
    inspect_image_bytes,
    measure_image_similarity,
)


class ProviderAuthError(RuntimeError):
    """Raised when the browser session or API provider requires sign-in or intervention."""


class ReferenceTooSimilarError(RuntimeError):
    """Raised when the generated candidate closely clones the input reference image."""

    def __init__(self, message: str, similarity: Optional[Dict[str, Any]] = None) -> None:
        super().__init__(message)
        self.similarity = similarity or {}


_LAST_CDP_CACHE: Dict[str, Any] = {"ts": 0.0, "data": None}
_CDP_CACHE_LOCK = threading.Lock()


def check_cdp_status(force: bool = False) -> Dict[str, Any]:
    """
    Checks if the Chrome AI Master browser is running on CDP_PORT AND has at least
    one active 'page' target (avoiding macOS windowless Dock state where 0 windows exist).
    """
    now = time.time()
    with _CDP_CACHE_LOCK:
        if not force and _LAST_CDP_CACHE["data"] is not None and (now - _LAST_CDP_CACHE["ts"]) < 4.0:
            return dict(_LAST_CDP_CACHE["data"])

    try:
        resp = requests.get(f"{CDP_ENDPOINT}/json/version", timeout=0.8)
        if resp.status_code == 200:
            data = resp.json()
            tabs_resp = requests.get(f"{CDP_ENDPOINT}/json/list", timeout=0.8)
            tabs = tabs_resp.json() if tabs_resp.status_code == 200 else []
            page_tabs = [
                t for t in tabs if isinstance(t, dict) and t.get("type") == "page"
            ]
            open_engines: List[str] = []
            for key, info in AI_ENGINES.items():
                if any(info["domain"] in (t.get("url") or "") for t in page_tabs):
                    open_engines.append(key)

            has_window = len(page_tabs) > 0
            result = {
                "connected": has_window,
                "online": has_window,
                "windowless": not has_window,
                "page_count": len(page_tabs),
                "browser": data.get("Browser", "Google Chrome"),
                "webSocketDebuggerUrl": data.get("webSocketDebuggerUrl", ""),
                "endpoint": CDP_ENDPOINT,
                "open_engines": open_engines,
            }
            with _CDP_CACHE_LOCK:
                _LAST_CDP_CACHE["ts"] = now
                _LAST_CDP_CACHE["data"] = result
            return dict(result)
    except Exception:
        pass

    offline = {
        "connected": False,
        "online": False,
        "windowless": False,
        "page_count": 0,
        "browser": None,
        "endpoint": CDP_ENDPOINT,
        "open_engines": [],
    }
    with _CDP_CACHE_LOCK:
        _LAST_CDP_CACHE["ts"] = now
        _LAST_CDP_CACHE["data"] = offline
    return dict(offline)


def _kill_port_9222_process() -> None:
    """Terminates a zombie/windowless Chrome process listening on CDP_PORT."""
    try:
        out = subprocess.run(
            ["lsof", "-t", f"-iTCP:{CDP_PORT}", "-sTCP:LISTEN"],
            capture_output=True,
            text=True,
            timeout=3,
        )
        pids = [int(x.strip()) for x in out.stdout.splitlines() if x.strip().isdigit()]
        for pid in pids:
            try:
                os.kill(pid, signal.SIGTERM)
            except Exception:
                pass
        if pids:
            time.sleep(1.2)
    except Exception:
        pass


def launch_chrome_ai_master(
    engine: str = "gemini",
    force_restart: bool = False,
) -> Dict[str, Any]:
    """
    Launches Chromium with `--remote-debugging-port=9222` and dedicated `chrome_ai_master` profile.
    If Chrome on :9222 is in a macOS windowless state (0 tabs) or `force_restart=True`,
    cleanly restarts the :9222 process so a real BrowserContext and window exist.
    """
    status = check_cdp_status(force=True)
    if status["connected"] and not force_restart:
        return {
            "launched": True,
            "success": True,
            "already_running": True,
            "message": f"AI Master Browser is connected on port {CDP_PORT} ({status['page_count']} tab(s) open).",
            "status": status,
        }

    if status.get("windowless") or force_restart:
        logger.info("Restarting windowless/stale Chrome on port %s...", CDP_PORT)
        _kill_port_9222_process()

    chrome_bin = get_chrome_executable_path()
    CHROME_AI_MASTER_DIR.mkdir(parents=True, exist_ok=True)

    for lock_name in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
        lock_file = CHROME_AI_MASTER_DIR / lock_name
        if lock_file.exists() or lock_file.is_symlink():
            try:
                lock_file.unlink()
            except Exception:
                pass

    primary_url = AI_ENGINES.get(engine.lower(), AI_ENGINES["gemini"])["url"]
    other_urls = [info["url"] for info in AI_ENGINES.values() if info["url"] != primary_url]

    cmd = [
        chrome_bin,
        f"--remote-debugging-port={CDP_PORT}",
        f"--user-data-dir={str(CHROME_AI_MASTER_DIR)}",
        "--no-first-run",
        "--no-default-browser-check",
        primary_url,
        *other_urls,
    ]

    try:
        subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        for _ in range(16):
            time.sleep(0.5)
            status = check_cdp_status(force=True)
            if status["connected"]:
                break
        return {
            "launched": True,
            "success": True,
            "already_running": False,
            "chrome_binary": chrome_bin,
            "profile_dir": str(CHROME_AI_MASTER_DIR),
            "message": f"Launched AI Master Browser on port {CDP_PORT}.",
            "status": status,
        }
    except Exception as exc:
        return {
            "launched": False,
            "success": False,
            "already_running": False,
            "chrome_binary": chrome_bin,
            "message": f"Failed to launch Chrome at '{chrome_bin}': {exc}",
            "status": status,
        }


def _find_or_open_engine_page(
    context: Any,
    engine: str,
    recycle: bool = False,
) -> Any:
    engine_cfg = AI_ENGINES.get(engine, AI_ENGINES["gemini"])
    domain = engine_cfg["domain"]
    target_url = engine_cfg["url"]

    matching_pages = [p for p in context.pages if domain in (p.url or "")]
    if matching_pages and not recycle:
        return matching_pages[0]

    page = context.new_page()
    page.goto(target_url, wait_until="domcontentloaded", timeout=45000)

    # When recycling to prevent SPA heap bloat on 100–1000 image batches, close stale tabs after new tab opens
    if recycle and matching_pages:
        for old_page in matching_pages:
            try:
                old_page.close()
            except Exception:
                pass
    return page


def _start_fresh_chat(page: Any, engine: str, log_fn: Callable[[str], None]) -> Any:
    """
    Opens a clean New Chat thread in the current engine tab (via SPA button first,
    falling back to direct URL navigation) so prior turns/reference attachments cannot bias this shot.
    """
    engine_cfg = AI_ENGINES.get(engine, AI_ENGINES["gemini"])
    target_url = engine_cfg["url"]

    try:
        before = _inspect_generation_dom(page)
        if (
            not before.get("domError")
            and int(before.get("userCount") or 0) == 0
            and int(before.get("assistantCount") or 0) == 0
            and _find_chat_input(page) is not None
        ):
            _clear_composer_attachments(page)
            return page
    except Exception:
        pass

    log_fn(f"Opening fresh {engine.capitalize()} New Chat for isolated shot...")
    clicked_new = False
    try:
        clicked_new = bool(
            page.evaluate(
                """() => {
                    const selectors = [
                        'button[data-testid="create-new-chat-button"]',
                        'a[data-testid="create-new-chat-button"]',
                        'button[data-test-id="new-chat-button"]',
                        'a[data-test-id="new-chat-button"]',
                        'button[aria-label*="New chat" i]',
                        'a[aria-label*="New chat" i]',
                        'button[aria-label*="Cuộc trò chuyện mới" i]',
                        'a[aria-label*="Cuộc trò chuyện mới" i]',
                        'a[href="/app"]',
                        'a[href="/"]'
                    ];
                    for (const s of selectors) {
                        const el = document.querySelector(s);
                        if (el && el.offsetParent !== null && !el.disabled && el.getAttribute('aria-disabled') !== 'true') {
                            el.click();
                            return true;
                        }
                    }
                    return false;
                }"""
            )
        )
    except Exception:
        clicked_new = False

    if clicked_new:
        for _ in range(12):
            time.sleep(0.2)
            try:
                cur = _inspect_generation_dom(page)
                if (
                    not cur.get("domError")
                    and int(cur.get("userCount") or 0) == 0
                    and int(cur.get("assistantCount") or 0) == 0
                    and _find_chat_input(page) is not None
                ):
                    _clear_composer_attachments(page)
                    return page
            except Exception:
                break

    # Fallback: clean navigation to engine home URL
    page.goto(target_url, wait_until="domcontentloaded", timeout=30000)
    for _ in range(15):
        if _find_chat_input(page) is not None:
            break
        time.sleep(0.3)
    _clear_composer_attachments(page)
    return page


def _find_chat_input(page: Any) -> Any:
    selectors = [
        "rich-textarea div[contenteditable='true']",
        "div.ql-editor[contenteditable='true']",
        "textarea#prompt-textarea",
        "div#prompt-textarea[contenteditable='true']",
        "div[contenteditable='true'][role='textbox']",
        "textarea[placeholder]",
        "textarea",
    ]
    for sel in selectors:
        try:
            el = page.query_selector(sel)
            if el and el.is_visible():
                return el
        except Exception:
            continue
    return None


def _ensure_authenticated(page: Any, engine: str) -> None:
    label = AI_ENGINES.get(engine, AI_ENGINES["gemini"])["label"]
    url_lower = (page.url or "").lower()
    if any(
        x in url_lower
        for x in ("accounts.google.com", "auth0.com", "login", "/auth/", "signin")
    ):
        raise ProviderAuthError(
            f"{label} redirected to sign-in ({page.url}). "
            f"Sign into {label} in the AI Master Browser (:9222) and click Resume."
        )

    for _ in range(10):
        if _find_chat_input(page) is not None:
            return
        time.sleep(1.0)

    raise ProviderAuthError(
        f"No active chat input found on {label} ({page.url}). "
        f"Please sign into {label} in the AI Master Browser (:9222) and click Resume."
    )


def _clear_composer_attachments(page: Any) -> None:
    """Removes any residual uploaded file chip from the chat composer before starting a new turn."""
    try:
        page.evaluate(
            """() => {
                const removeSelectors = [
                    'uploader-file-preview button[aria-label*="Remove" i]',
                    'uploader-file-preview button[aria-label*="Delete" i]',
                    'uploader-file-preview button[aria-label*="Xóa" i]',
                    'uploader-file-preview button',
                    '.file-preview-container button[aria-label*="Remove" i]',
                    '[data-testid*="remove-attachment"]'
                ];
                for (const sel of removeSelectors) {
                    const btns = document.querySelectorAll(sel);
                    btns.forEach(b => {
                        if (b && b.offsetParent !== null) {
                            try { b.click(); } catch (e) {}
                        }
                    });
                }
            }"""
        )
        time.sleep(0.3)
    except Exception:
        pass


def _has_composer_attachment(page: Any) -> bool:
    try:
        return bool(
            page.evaluate(
                """() => {
                    const selectors = [
                        'uploader-file-preview',
                        'uploader-file-preview-container',
                        '.file-preview-container',
                        '.attachment-preview',
                        '[data-test-id*="file-preview"]',
                        '[data-testid*="attachment"]',
                        'rich-textarea img',
                        'input-container img'
                    ];
                    for (const s of selectors) {
                        const el = document.querySelector(s);
                        if (el && el.offsetParent !== null) return true;
                    }
                    return false;
                }"""
            )
        )
    except Exception:
        return False


def _wait_for_upload_settled(page: Any, timeout_sec: float = 12.0) -> None:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        try:
            uploading = page.evaluate(
                """() => {
                    const spinners = document.querySelectorAll(
                        'uploader-file-preview mat-progress-spinner, ' +
                        'uploader-file-preview [role="progressbar"], ' +
                        '.file-preview-container [role="progressbar"]'
                    );
                    for (const sp of spinners) {
                        if (sp.offsetParent !== null) return true;
                    }
                    return false;
                }"""
            )
            if not uploading:
                return
        except Exception:
            return
        time.sleep(0.4)


def _attach_reference_image(
    page: Any,
    ref_image_path: str,
    log_fn: Callable[[str], None],
) -> bool:
    path_obj = Path(ref_image_path).resolve()
    if not path_obj.exists():
        return False

    _clear_composer_attachments(page)
    mime_type = mimetypes.guess_type(str(path_obj))[0] or "image/jpeg"

    # Strategy 1: Synthetic ClipboardEvent('paste') onto rich-textarea / contenteditable
    try:
        input_box = _find_chat_input(page)
        if input_box:
            input_box.click()
            time.sleep(0.2)

        raw_b64 = base64.b64encode(path_obj.read_bytes()).decode("ascii")
        pasted = page.evaluate(
            """({ b64, fileName, mimeType }) => {
                const selectors = [
                    "rich-textarea div[contenteditable='true']",
                    "div.ql-editor[contenteditable='true']",
                    "div#prompt-textarea[contenteditable='true']",
                    "textarea#prompt-textarea",
                    "div[contenteditable='true'][role='textbox']",
                    "textarea"
                ];
                let target = document.activeElement;
                for (const s of selectors) {
                    const el = document.querySelector(s);
                    if (el && el.offsetParent !== null) {
                        target = el;
                        break;
                    }
                }
                if (!target) return false;
                target.focus();

                const bin = atob(b64);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                const file = new File([bytes], fileName, { type: mimeType });
                const dt = new DataTransfer();
                dt.items.add(file);

                const pasteEvent = new ClipboardEvent('paste', {
                    bubbles: true,
                    cancelable: true,
                    clipboardData: dt
                });
                target.dispatchEvent(pasteEvent);
                return true;
            }""",
            {"b64": raw_b64, "fileName": path_obj.name, "mimeType": mime_type},
        )
        if pasted:
            for _ in range(10):
                time.sleep(0.2)
                if _has_composer_attachment(page):
                    _wait_for_upload_settled(page)
                    log_fn(f"Attached reference image: {path_obj.name}")
                    return True
    except Exception as exc:
        logger.debug("Clipboard paste fallback note: %s", exc)

    # Strategy 2: Direct <input type="file">
    try:
        file_inputs = page.query_selector_all('input[type="file"]')
        if file_inputs:
            file_inputs[-1].set_input_files(str(path_obj))
            for _ in range(10):
                time.sleep(0.2)
                if _has_composer_attachment(page):
                    break
            _wait_for_upload_settled(page)
            log_fn(f"Attached reference image via file input: {path_obj.name}")
            return True
    except Exception:
        pass

    return False


def _send_chat_message(page: Any, message: str) -> None:
    input_box = _find_chat_input(page)
    if not input_box:
        raise ProviderAuthError("Chat input box disappeared before sending prompt.")

    input_box.click()
    time.sleep(0.08)

    try:
        tag_name = (input_box.evaluate("el => el.tagName.toLowerCase()") or "").strip()
        if tag_name in ("textarea", "input"):
            input_box.fill("")
        else:
            input_box.evaluate(
                """el => {
                    const sel = window.getSelection();
                    const range = document.createRange();
                    range.selectNodeContents(el);
                    sel.removeAllRanges();
                    sel.addRange(range);
                }"""
            )
            page.keyboard.press("Backspace")
            time.sleep(0.05)
    except Exception:
        pass

    single_line = " ".join(line.strip() for line in message.splitlines() if line.strip())
    try:
        tag_name = (input_box.evaluate("el => el.tagName.toLowerCase()") or "").strip()
        if tag_name in ("textarea", "input"):
            input_box.fill(single_line)
        else:
            page.keyboard.insert_text(single_line)
    except Exception:
        page.keyboard.insert_text(single_line)

    time.sleep(0.2)
    sent = page.evaluate(
        """() => {
            const selectors = [
                'button[data-testid="send-button"]',
                'button.send-button:not(.stop)',
                'button[aria-label*="Send message" i]',
                'button[aria-label*="Send prompt" i]',
                'button[aria-label="Send"]',
                'button[aria-label*="Gửi tin nhắn" i]',
                'button[aria-label*="Gửi" i]',
                'button[type="submit"]'
            ];
            for (const s of selectors) {
                const btn = document.querySelector(s);
                if (btn && btn.offsetParent !== null && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
                    btn.click();
                    return true;
                }
            }
            return false;
        }"""
    )
    if not sent:
        page.keyboard.press("Enter")


def _inspect_generation_dom(page: Any) -> Dict[str, Any]:
    try:
        if page.is_closed():
            return {
                "domError": "Browser tab closed.",
                "userCount": 0,
                "assistantCount": 0,
                "streaming": False,
                "stopVisible": False,
                "sendReady": False,
                "actionBarVisible": False,
                "errorBanner": "",
                "latestText": "",
                "images": [],
                "loadingImagesCount": 0,
                "brokenImagesCount": 0,
            }
        return page.evaluate(
            """() => {
                const isTrulyVisible = (el) => {
                    if (!el || el.offsetParent === null) return false;
                    const rect = el.getBoundingClientRect();
                    if (rect.width < 8 || rect.height < 8) return false;
                    const st = window.getComputedStyle(el);
                    return st.visibility !== 'hidden' && st.display !== 'none' && parseFloat(st.opacity || '1') > 0.05;
                };

                const userSelectors = [
                    'user-query',
                    '.user-query-container',
                    '[data-message-author-role="user"]'
                ];
                let userCount = 0;
                for (const us of userSelectors) {
                    const foundU = document.querySelectorAll(us);
                    if (foundU.length > 0) {
                        userCount = foundU.length;
                        break;
                    }
                }

                const turnSelectors = [
                    'model-response',
                    '[data-message-author-role="assistant"]',
                    '.response-container',
                    'message-content'
                ];
                let turns = [];
                for (const ts of turnSelectors) {
                    const found = Array.from(document.querySelectorAll(ts));
                    if (found.length > 0) {
                        turns = found;
                        break;
                    }
                }

                const lastTurn = turns.length > 0 ? turns[turns.length - 1] : null;
                let latestText = '';
                if (lastTurn) {
                    const msgContent = lastTurn.querySelector('message-content, .model-response-text, .markdown') || lastTurn;
                    latestText = (msgContent.innerText || '').trim();
                }

                // 1. Check active composer Stop button
                const stopBtnSelectors = [
                    'button.send-button.stop',
                    'button[aria-label*="Stop" i]',
                    'button[aria-label*="Dừng" i]',
                    'button[aria-label*="Ngừng" i]',
                    'button[data-testid="stop-button"]'
                ];
                let stopVisible = false;
                for (const s of stopBtnSelectors) {
                    const btn = document.querySelector(s);
                    if (isTrulyVisible(btn) && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
                        stopVisible = true;
                        break;
                    }
                }

                // 2. Check if Send / Mic composer button is back (idle composer state)
                let sendReady = false;
                if (!stopVisible) {
                    const idleComposerSelectors = [
                        'button[data-testid="send-button"]',
                        'button.send-button:not(.stop)',
                        'button[aria-label*="Send" i]',
                        'button[aria-label*="Gửi" i]',
                        'button[aria-label*="Microphone" i]',
                        'button[aria-label*="Micro" i]'
                    ];
                    for (const cs of idleComposerSelectors) {
                        const cbtn = document.querySelector(cs);
                        if (isTrulyVisible(cbtn)) {
                            sendReady = true;
                            break;
                        }
                    }
                }

                // 3. Check active spinners/loaders inside the LAST assistant turn only
                let streaming = stopVisible;
                if (!streaming && lastTurn) {
                    const loaderSelectors = [
                        'mat-progress-bar',
                        'mat-progress-spinner',
                        '.image-generation-loader',
                        '.generated-image-loading',
                        '.result-streaming',
                        '.streaming-indicator',
                        '[aria-busy="true"]'
                    ];
                    for (const ls of loaderSelectors) {
                        const loader = lastTurn.querySelector(ls);
                        if (isTrulyVisible(loader)) {
                            streaming = true;
                            break;
                        }
                    }
                }

                // 4. Check completion action bar in lastTurn (only appears after turn finishes)
                let actionBarVisible = false;
                if (lastTurn && !streaming) {
                    const actionSelectors = [
                        'message-actions button',
                        'button[data-testid="copy-turn-action-button"]',
                        'button[data-testid="good-response-turn-action-button"]',
                        'button[aria-label*="Good response" i]',
                        'button[aria-label*="Bad response" i]',
                        'button[aria-label*="Copy" i]',
                        'button[aria-label*="Redo" i]',
                        'button[aria-label*="Regenerate" i]',
                        'button[aria-label*="Sao chép" i]',
                        'button[aria-label*="Thích" i]',
                        'button[aria-label*="Thử lại" i]'
                    ];
                    for (const asel of actionSelectors) {
                        const abtn = lastTurn.querySelector(asel);
                        if (isTrulyVisible(abtn)) {
                            actionBarVisible = true;
                            break;
                        }
                    }
                }

                // 5. Check error banners / rate-limit alerts
                let errorBanner = '';
                const errSelectors = [
                    '[role="alert"]',
                    '.error-container',
                    '.response-error',
                    '.model-response-error'
                ];
                for (const es of errSelectors) {
                    const els = Array.from(document.querySelectorAll(es));
                    for (const el of els) {
                        if (!isTrulyVisible(el)) continue;
                        const txt = (el.innerText || '').trim();
                        if (!txt) continue;
                        if (/(error|went wrong|try again|limit|too many|failed|unable|sign in|đã xảy ra lỗi|thử lại|giới hạn)/i.test(txt)) {
                            errorBanner = txt.slice(0, 180);
                            break;
                        }
                    }
                    if (errorBanner) break;
                }

                // Scan assistant images across document & classify loading/broken images in lastTurn
                const forbiddenAncestor = 'user-query, .user-query-container, [data-message-author-role="user"], rich-textarea, uploader, uploader-file-preview, header, nav';
                const rawImgs = Array.from(document.querySelectorAll('img'));
                const images = [];
                let loadingImagesCount = 0;
                let brokenImagesCount = 0;

                for (const img of rawImgs) {
                    if (img.closest(forbiddenAncestor)) continue;
                    const src = img.currentSrc || img.src || '';
                    if (!src) continue;
                    const lower = src.toLowerCase();
                    if (
                        lower.includes('avatar') ||
                        lower.includes('favicon') ||
                        lower.includes('profile_photo') ||
                        lower.includes('/ogw/') ||
                        lower.includes('gstatic.com/lamda') ||
                        lower.endsWith('.svg')
                    ) {
                        continue;
                    }
                    const rect = img.getBoundingClientRect();
                    const nw = img.naturalWidth || 0;
                    const nh = img.naturalHeight || 0;
                    const inLastTurn = Boolean(lastTurn && lastTurn.contains(img));

                    if (img.complete && nw >= 256 && nh >= 256 && rect.width >= 80 && rect.height >= 80) {
                        images.push({
                            src,
                            naturalWidth: nw,
                            naturalHeight: nh,
                            width: Math.round(rect.width),
                            height: Math.round(rect.height)
                        });
                    } else if (inLastTurn && !img.complete && rect.width >= 80 && rect.height >= 80) {
                        loadingImagesCount += 1;
                        streaming = true;
                    } else if (inLastTurn && img.complete && nw === 0 && (src.startsWith('http') || src.startsWith('blob:'))) {
                        brokenImagesCount += 1;
                    }
                }

                return {
                    domError: '',
                    userCount,
                    assistantCount: turns.length,
                    streaming,
                    stopVisible,
                    sendReady,
                    actionBarVisible,
                    errorBanner,
                    latestText,
                    images,
                    loadingImagesCount,
                    brokenImagesCount
                };
            }"""
        )
    except Exception as exc:
        return {
            "domError": str(exc)[:180],
            "userCount": 0,
            "assistantCount": 0,
            "streaming": False,
            "stopVisible": False,
            "sendReady": False,
            "actionBarVisible": False,
            "errorBanner": "",
            "latestText": "",
            "images": [],
            "loadingImagesCount": 0,
            "brokenImagesCount": 0,
        }


def _validate_candidate_bytes(
    raw_bytes: bytes,
    ref_dhash: Optional[str] = None,
    ref_info: Optional[Dict[str, Any]] = None,
    check_ref_similarity: bool = True,
) -> Optional[Dict[str, Any]]:
    if not raw_bytes or len(raw_bytes) < 4096:
        return None
    try:
        info = inspect_image_bytes(raw_bytes)
        if info["width"] < 256 or info["height"] < 256:
            return None
        if float(info.get("std_dev", 20.0)) < 6.0:
            return None
        if check_ref_similarity:
            if ref_info:
                sim = measure_image_similarity(info, ref_info)
                if sim["too_similar"]:
                    raise ReferenceTooSimilarError(
                        f"Generated image is too similar to input reference ({sim['reason']}).",
                        similarity=sim,
                    )
            elif ref_dhash:
                dist = dhash_distance(info["dhash"], ref_dhash)
                if dist <= 10:
                    raise ReferenceTooSimilarError(
                        f"Generated image is too similar to input reference (dHash={dist}).",
                        similarity={"dhash_dist": dist, "too_similar": True},
                    )
        info["raw_bytes"] = raw_bytes
        return info
    except ReferenceTooSimilarError:
        raise
    except Exception:
        return None


def normalize_gemini_asset_url(url: str) -> str:
    """
    Rewrites Google Gemini `googleusercontent.com` preview URLs (e.g. `=s1024-rj`
    or `=w825-h1024`) to `=s0` so the CDN serves the full-resolution master asset.
    """
    if not url or not isinstance(url, str):
        return url
    try:
        parsed = urlparse(url.strip())
        host = (parsed.hostname or "").lower()
        if host != "googleusercontent.com" and not host.endswith(".googleusercontent.com"):
            return url
        path = parsed.path or ""
        first_seg = next((s for s in path.split("/") if s), "")
        if not (
            first_seg == "gg"
            or first_seg.startswith("gg-")
            or first_seg.startswith("rd-")
        ):
            return url

        if re.search(r"=w\d+-h\d+([^/]*)$", path, flags=re.IGNORECASE):
            new_path = re.sub(r"=w\d+-h\d+([^/]*)$", r"=s0\1", path, flags=re.IGNORECASE)
        elif re.search(r"=(?:d|d-I)$", path, flags=re.IGNORECASE):
            new_path = re.sub(
                r"=(d|d-I)$",
                lambda m: f"=s0-{m.group(1)}",
                path,
                flags=re.IGNORECASE,
            )
        elif re.search(r"=(?:s|w|h)\d+([^/]*)$", path, flags=re.IGNORECASE):
            new_path = re.sub(
                r"=(?:s|w|h)\d+([^/]*)$", r"=s0\1", path, flags=re.IGNORECASE
            )
        else:
            new_path = f"{path}=s0"

        return urlunparse(parsed._replace(path=new_path))
    except Exception:
        return url


def _build_full_res_googleusercontent_urls(src: str) -> List[str]:
    norm = normalize_gemini_asset_url(src)
    if not norm or norm == src:
        return []
    candidates = [norm]
    # Also include pure `=s0` without `-rj` suffix if present
    clean_s0 = re.sub(r"=s0-[^/?#]+", "=s0", norm)
    if clean_s0 != norm and clean_s0 != src:
        candidates.insert(0, clean_s0)
    return candidates


def _inpage_fetch_bytes(page: Any, target_url: str) -> Optional[bytes]:
    try:
        b64_data = page.evaluate(
            """async (targetUrl) => {
                const ctrl = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), 6000);
                try {
                    const res = await fetch(targetUrl, {
                        credentials: 'include',
                        signal: ctrl.signal
                    });
                    if (!res.ok) return null;
                    const buf = await res.arrayBuffer();
                    if (!buf || buf.byteLength < 4096) return null;
                    const bytes = new Uint8Array(buf);
                    let binary = '';
                    const chunkSize = 0x8000;
                    for (let i = 0; i < bytes.length; i += chunkSize) {
                        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
                    }
                    return btoa(binary);
                } catch (e) {
                    return null;
                } finally {
                    clearTimeout(timer);
                }
            }""",
            target_url,
        )
        if b64_data:
            return base64.b64decode(b64_data)
    except Exception:
        pass
    return None


def _context_request_bytes(
    context: Any,
    target_url: str,
    referer: str = "https://gemini.google.com/",
) -> Optional[bytes]:
    """
    Fetches `target_url` directly through Playwright's browser context network stack
    (with full session cookies & Referer, bypassing renderer CORS restrictions, without opening any new tab).
    """
    if not target_url or not target_url.startswith("http"):
        return None
    try:
        headers = {
            "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        }
        if referer:
            headers["Referer"] = referer
        api_resp = context.request.get(target_url, headers=headers, timeout=10000)
        if api_resp and api_resp.ok:
            body = api_resp.body()
            if body and len(body) >= 4096:
                return body
    except Exception:
        pass
    return None


def _extract_raw_bytes_via_cdp(
    context: Any,
    page: Any,
    src: str,
    ref_dhash: Optional[str] = None,
    response_cache: Optional[Dict[str, bytes]] = None,
    log_fn: Optional[Callable[[str], None]] = None,
    ref_info: Optional[Dict[str, Any]] = None,
    check_ref_similarity: bool = True,
    response_objects: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    def _check(raw_data: bytes) -> Optional[Dict[str, Any]]:
        return _validate_candidate_bytes(
            raw_data,
            ref_dhash=ref_dhash,
            ref_info=ref_info,
            check_ref_similarity=check_ref_similarity,
        )

    page_referer = "https://gemini.google.com/"
    try:
        if page.url and page.url.startswith("http"):
            page_referer = page.url
    except Exception:
        pass

    # 1. Try upgrading Gemini googleusercontent preview URLs to full master resolution (=s0) first
    full_res_urls = _build_full_res_googleusercontent_urls(src)
    for full_url in full_res_urls:
        if response_cache and full_url in response_cache:
            checked = _check(response_cache[full_url])
            if checked:
                if log_fn:
                    log_fn(
                        f"Extracted full-res (=s0) {checked['format']} image "
                        f"({len(checked['raw_bytes']) // 1024} KB, {checked['width']}x{checked['height']})."
                    )
                return checked
        raw_ctx = _context_request_bytes(context, full_url, referer=page_referer)
        if raw_ctx:
            checked = _check(raw_ctx)
            if checked:
                if log_fn:
                    log_fn(
                        f"Extracted full-res (=s0) {checked['format']} image "
                        f"({len(raw_ctx) // 1024} KB, {checked['width']}x{checked['height']}) via =s0 upgrade."
                    )
                return checked
        raw_full = _inpage_fetch_bytes(page, full_url)
        if raw_full:
            checked = _check(raw_full)
            if checked:
                if log_fn:
                    log_fn(
                        f"Extracted full-res (=s0) {checked['format']} image "
                        f"({len(raw_full) // 1024} KB, {checked['width']}x{checked['height']}) via =s0 upgrade."
                    )
                return checked

    # 2. Check response_cache & captured Response objects (reads Playwright network buffer safely outside callback)
    if response_cache:
        if src in response_cache:
            checked = _check(response_cache[src])
            if checked:
                return checked
        src_prefix = src.split("?")[0].rsplit("=", 1)[0]
        for cached_url, cached_bytes in list(response_cache.items()):
            if src_prefix and len(src_prefix) > 24 and src_prefix in cached_url:
                checked = _check(cached_bytes)
                if checked:
                    return checked

    if response_objects:
        src_prefix = src.split("?")[0].rsplit("=", 1)[0]
        matched_resps: List[Any] = []
        if src in response_objects:
            matched_resps.append(response_objects[src])
        elif src_prefix and len(src_prefix) > 24:
            for r_url, r_obj in list(response_objects.items()):
                if src_prefix in r_url:
                    matched_resps.append(r_obj)
        for resp_obj in matched_resps:
            try:
                raw_resp = resp_obj.body()
                checked = _check(raw_resp)
                if checked:
                    if response_cache is not None:
                        response_cache[resp_obj.url or src] = raw_resp
                    if log_fn:
                        log_fn(
                            f"Extracted original {checked['format']} image ({len(raw_resp) // 1024} KB, "
                            f"{checked['width']}x{checked['height']}) via captured network buffer."
                        )
                    return checked
            except ReferenceTooSimilarError:
                raise
            except Exception:
                continue

    # 3. Fast path without opening any tab: context.request.get(src) or in-page fetch (for blob:)
    if src.startswith("http"):
        raw_http = _context_request_bytes(context, src, referer=page_referer)
        if raw_http:
            checked = _check(raw_http)
            if checked:
                if log_fn:
                    log_fn(
                        f"Extracted original {checked['format']} image ({len(raw_http) // 1024} KB, "
                        f"{checked['width']}x{checked['height']}) via direct context request."
                    )
                return checked

    if src.startswith("blob:") or src.startswith("http"):
        raw_inpage = _inpage_fetch_bytes(page, src)
        if raw_inpage:
            checked = _check(raw_inpage)
            if checked:
                if log_fn:
                    log_fn(
                        f"Extracted original {checked['format']} image ({len(raw_inpage) // 1024} KB, "
                        f"{checked['width']}x{checked['height']}) via fast in-page fetch."
                    )
                return checked

    # 4. Try native download button before opening extra tabs
    try:
        dl_selectors = [
            'single-image button:has(mat-icon[fonticon="download"])',
            'generated-image button:has(mat-icon[fonticon="download"])',
            'generated-image button[data-test-id="download-generated-image-button"]',
            'single-image button[data-test-id="download-generated-image-button"]',
        ]
        for d_sel in dl_selectors:
            btns = page.query_selector_all(d_sel)
            if btns and btns[-1].is_visible():
                tmp_dl = tempfile.NamedTemporaryFile(prefix="_studio_dl_", suffix=".bin", delete=False)
                tmp_file = Path(tmp_dl.name)
                tmp_dl.close()
                try:
                    with page.expect_download(timeout=12000) as dl_info:
                        btns[-1].click()
                    dl_info.value.save_as(str(tmp_file))
                    raw_dl = tmp_file.read_bytes()
                finally:
                    tmp_file.unlink(missing_ok=True)
                checked = _check(raw_dl)
                if checked:
                    if log_fn:
                        log_fn(
                            f"Extracted original {checked['format']} image ({len(raw_dl) // 1024} KB, "
                            f"{checked['width']}x{checked['height']}) via native download."
                        )
                    return checked
    except ReferenceTooSimilarError:
        raise
    except Exception:
        pass

    # 5. Last resort: same-context download tab (without calling bring_to_front to avoid focus stealing)
    if src.startswith("blob:") or src.startswith("http"):
        dl_page = None
        try:
            dl_page = context.new_page()
            for nav_url in [*full_res_urls, src]:
                try:
                    resp = dl_page.goto(nav_url, wait_until="load", timeout=12000)
                    if resp and resp.ok:
                        raw_nav_bytes = resp.body()
                        checked = _check(raw_nav_bytes)
                        if checked:
                            if log_fn:
                                log_fn(
                                    f"Extracted original {checked['format']} image ({len(raw_nav_bytes) // 1024} KB, "
                                    f"{checked['width']}x{checked['height']}) via browser context."
                                )
                            return checked
                except ReferenceTooSimilarError:
                    raise
                except Exception:
                    continue
        except ReferenceTooSimilarError:
            raise
        except Exception as exc:
            logger.debug("Same-context tab extraction note: %s", exc)
        finally:
            if dl_page is not None:
                try:
                    dl_page.close()
                except Exception:
                    pass

    return None


def _is_generation_stream_url(url: str, method: str = "POST") -> bool:
    u = (url or "").lower()
    if "streamgenerate" in u or "/backend-api/f/conversation" in u or "/backend-api/conversation" in u or "/rest/app-chat/" in u:
        return True
    if method.upper() == "POST" and "bardfrontendservice" in u:
        return True
    return False


def _is_image_cdn_url(url: str) -> bool:
    u = (url or "").lower()
    if not u or u.endswith(".svg") or "avatar" in u or "favicon" in u or "gstatic.com/lamda" in u:
        return False
    return (
        "googleusercontent.com/gg" in u
        or "googleusercontent.com/rd" in u
        or "oaiusercontent.com" in u
        or "twimg.com" in u
        or any(ext in u for ext in (".png", ".jpg", ".jpeg", ".webp"))
    )


class _CdpNetworkTracker:
    """
    Tracks live generation API streams and image downloads on a Playwright page
    using strictly non-blocking metadata handlers (never calls `resp.body()` inside
    event callbacks, eliminating Playwright Sync greenlet deadlocks).
    """

    def __init__(self) -> None:
        self.response_cache: Dict[str, bytes] = {}
        self.response_objects: Dict[str, Any] = {}
        self.active_gen_streams: Dict[int, str] = {}
        self.active_img_requests: Dict[int, str] = {}
        self.gen_stream_started: int = 0
        self.gen_stream_finished: int = 0
        self.gen_stream_error: Optional[str] = None
        self.gen_stream_auth_error: Optional[str] = None
        self.failed_img_count: int = 0
        self.last_net_event_ts: float = time.time()

    def _on_request(self, req: Any) -> None:
        try:
            url = req.url or ""
            method = getattr(req, "method", "GET") or "GET"
            now = time.time()
            if _is_generation_stream_url(url, method):
                self.active_gen_streams[id(req)] = url
                self.gen_stream_started += 1
                self.last_net_event_ts = now
            elif _is_image_cdn_url(url):
                self.active_img_requests[id(req)] = url
                self.last_net_event_ts = now
        except Exception:
            pass

    def _on_response(self, resp: Any) -> None:
        try:
            url = resp.url or ""
            req_method = "POST"
            try:
                req_method = getattr(resp.request, "method", "POST") or "POST"
            except Exception:
                pass
            now = time.time()
            if _is_generation_stream_url(url, req_method):
                self.last_net_event_ts = now
                if resp.status in (401, 403):
                    self.gen_stream_auth_error = f"Session returned HTTP {resp.status}"
                elif resp.status >= 400:
                    self.gen_stream_error = f"AI generation API returned HTTP {resp.status}"
            elif _is_image_cdn_url(url):
                self.last_net_event_ts = now
                if getattr(resp, "ok", False) and len(self.response_objects) < 24:
                    self.response_objects[url] = resp
        except Exception:
            pass

    def _on_request_finished(self, req: Any) -> None:
        try:
            rid = id(req)
            if rid in self.active_gen_streams:
                self.active_gen_streams.pop(rid, None)
                self.gen_stream_finished += 1
                self.last_net_event_ts = time.time()
            elif rid in self.active_img_requests:
                self.active_img_requests.pop(rid, None)
                self.last_net_event_ts = time.time()
        except Exception:
            pass

    def _on_request_failed(self, req: Any) -> None:
        try:
            rid = id(req)
            url = req.url or ""
            now = time.time()
            if rid in self.active_gen_streams or _is_generation_stream_url(url):
                self.active_gen_streams.pop(rid, None)
                fail_txt = str(getattr(req, "failure", "") or "network error")
                self.gen_stream_error = f"Generation request failed ({fail_txt})"
                self.last_net_event_ts = now
            elif rid in self.active_img_requests or _is_image_cdn_url(url):
                self.active_img_requests.pop(rid, None)
                self.failed_img_count += 1
                self.last_net_event_ts = now
        except Exception:
            pass

    def attach(self, page: Any) -> None:
        page.on("request", self._on_request)
        page.on("response", self._on_response)
        page.on("requestfinished", self._on_request_finished)
        page.on("requestfailed", self._on_request_failed)

    def detach(self, page: Any) -> None:
        for ev, fn in (
            ("request", self._on_request),
            ("response", self._on_response),
            ("requestfinished", self._on_request_finished),
            ("requestfailed", self._on_request_failed),
        ):
            try:
                page.remove_listener(ev, fn)
            except Exception:
                pass

    def snapshot(self) -> Dict[str, Any]:
        return {
            "active_gen_streams": len(self.active_gen_streams),
            "gen_stream_started": self.gen_stream_started,
            "gen_stream_finished": self.gen_stream_finished,
            "gen_stream_error": self.gen_stream_error,
            "gen_stream_auth_error": self.gen_stream_auth_error,
            "active_img_requests": len(self.active_img_requests),
            "failed_img_count": self.failed_img_count,
            "last_net_event_ts": self.last_net_event_ts,
        }


def _evaluate_cdp_turn_signals(
    engine: str,
    dom_state: Dict[str, Any],
    net_state: Dict[str, Any],
    *,
    prev_user_count: int,
    prev_assistant_count: int,
    new_imgs_count: int,
    dom_hang_streak: int,
    no_send_polls: int,
    nudged_send: bool,
    idle_after_finish_polls: int,
    retried_explicit: bool,
    seconds_since_progress: float,
) -> tuple[str, str]:
    """
    Signal-driven state evaluator combining Playwright network stream status
    with live DOM completion/error indicators instead of blind fixed timers.
    Returns `(action, reason)` where action is one of:
    `continue`, `nudge_send`, `retry_image_prompt`, `fail_transient`, `fail_auth`.
    """
    if dom_hang_streak >= 3:
        err = dom_state.get("domError") or "Browser tab became unresponsive."
        return "fail_transient", f"{engine.upper()} tab unresponsive ({err})."

    if net_state.get("gen_stream_auth_error"):
        return "fail_auth", f"{engine.upper()}: {net_state['gen_stream_auth_error']}. Please verify browser sign-in."

    active_streams = int(net_state.get("active_gen_streams") or 0)
    active_img_reqs = int(net_state.get("active_img_requests") or 0)
    gen_started = int(net_state.get("gen_stream_started") or 0)
    gen_finished = int(net_state.get("gen_stream_finished") or 0)

    if net_state.get("gen_stream_error") and new_imgs_count == 0 and active_streams == 0:
        return "fail_transient", f"{engine.upper()}: {net_state['gen_stream_error']}"

    streaming = bool(dom_state.get("streaming"))
    user_count = int(dom_state.get("userCount") or 0)
    assistant_count = int(dom_state.get("assistantCount") or 0)
    send_ready = bool(dom_state.get("sendReady"))
    action_bar = bool(dom_state.get("actionBarVisible"))
    loading_imgs = int(dom_state.get("loadingImagesCount") or 0)
    broken_imgs = int(dom_state.get("brokenImagesCount") or 0)
    latest_text = str(dom_state.get("latestText") or "").strip()
    error_banner = str(dom_state.get("errorBanner") or "").strip()

    if error_banner and new_imgs_count == 0 and not streaming and active_streams == 0:
        low_err = error_banner.lower()
        if any(tok in low_err for tok in ("sign in", "log in", "đăng nhập")):
            return "fail_auth", f"{engine.upper()} session error: {error_banner}"
        return "fail_transient", f"{engine.upper()} UI error: {error_banner}"

    send_confirmed = (
        user_count > prev_user_count
        or assistant_count > prev_assistant_count
        or streaming
        or gen_started > 0
        or new_imgs_count > 0
    )
    if not send_confirmed:
        if no_send_polls >= 5 and not nudged_send:
            return "nudge_send", "Prompt send not yet confirmed by DOM or network; re-submitting..."
        if no_send_polls >= 15:
            return "fail_transient", f"{engine.upper()} tab did not register prompt submission."
        return "continue", ""

    # Server stream + DOM loaders + image downloads all finished with no valid image
    if (
        new_imgs_count == 0
        and not streaming
        and active_streams == 0
        and active_img_reqs == 0
        and loading_imgs == 0
    ):
        if broken_imgs > 0 and idle_after_finish_polls >= 2:
            return "fail_transient", f"{engine.upper()} generated a broken/unloaded image element."

        turn_completed = action_bar or (
            send_ready
            and (gen_finished > 0 or assistant_count > prev_assistant_count)
            and idle_after_finish_polls >= 2
        )
        if turn_completed:
            if len(latest_text) > 10:
                if not retried_explicit:
                    return "retry_image_prompt", "Assistant returned text only; requesting explicit image tool invocation..."
                snippet = latest_text[:90].replace("\n", " ")
                return "fail_transient", f"{engine.upper()} returned text instead of an image (\"{snippet}...\")."
            if idle_after_finish_polls >= 2:
                return "fail_transient", f"{engine.upper()} finished/stopped the turn without generating an image."

    # Silent hang ceiling when sockets/loaders freeze without any state changes
    if seconds_since_progress >= 65.0 and new_imgs_count == 0:
        return "fail_transient", f"{engine.upper()} stalled with zero network or DOM progress for {int(seconds_since_progress)}s."

    return "continue", ""


def _collect_metadata_on_open_page(
    page: Any,
    *,
    theme: str,
    prompt_final: str,
    metadata_language: str,
    index_num: int,
    caption_prompt: str = "",
    timeout_sec: float = 18.0,
    should_abort: Optional[Callable[[], bool]] = None,
    heartbeat_fn: Optional[Callable[[], None]] = None,
) -> Optional[Dict[str, str]]:
    """
    Shared Turn-2 caption/title/description collector operating on an ALREADY OPEN engine `page`
    (eliminating redundant CDP reconnects and Playwright subprocess spawns per shot).
    Imports strictly stateless `metadata_parser` so child `cdp_worker` never opens `studio.db`.
    Never raises: returns None cleanly on timeout/abort so Turn 1 images are never lost.
    """
    try:
        from modules.metadata_parser import build_metadata_prompt, parse_metadata_json

        if heartbeat_fn:
            heartbeat_fn()
        _clear_composer_attachments(page)
        if heartbeat_fn:
            heartbeat_fn()
        before = _inspect_generation_dom(page)
        prev_count = int(before.get("assistantCount") or 0)
        prev_text = str(before.get("latestText") or "").strip()

        prompt = build_metadata_prompt(
            theme=theme,
            prompt_final=prompt_final,
            metadata_language=metadata_language,
            index_num=index_num,
            caption_prompt=caption_prompt,
        )
        _send_chat_message(page, prompt)
        if heartbeat_fn:
            heartbeat_fn()

        start = time.time()
        saw_new_turn = False
        nudged_send = False
        last_seen_text = ""
        stable_text_ticks = 0

        while time.time() - start < timeout_sec:
            if should_abort and should_abort():
                return None
            time.sleep(0.45)
            if heartbeat_fn:
                heartbeat_fn()
            elapsed = time.time() - start
            state = _inspect_generation_dom(page)
            if state.get("domError"):
                return None
            streaming = bool(state.get("streaming"))
            curr_count = int(state.get("assistantCount") or 0)
            latest_text = str(state.get("latestText") or "").strip()

            if curr_count > prev_count or (latest_text and latest_text != prev_text):
                saw_new_turn = True

            if not saw_new_turn and not streaming and elapsed >= 2.5 and not nudged_send:
                nudged_send = True
                try:
                    _send_chat_message(page, prompt)
                except Exception:
                    pass
                continue

            if not saw_new_turn and not streaming and elapsed >= 6.5:
                return None

            if saw_new_turn and latest_text and latest_text != prev_text:
                if latest_text == last_seen_text:
                    stable_text_ticks += 1
                else:
                    last_seen_text = latest_text
                    stable_text_ticks = 0

                parsed = parse_metadata_json(
                    latest_text,
                    theme=theme,
                    allow_freeform=(not streaming or stable_text_ticks >= 2),
                )
                if parsed:
                    return parsed
    except Exception as exc:
        logger.warning("In-session CDP metadata turn fell back cleanly: %s", exc)
    return None


def generate_image_via_cdp(
    engine: str,
    prompt_final: str,
    reference_path: Optional[str] = None,
    log_fn: Optional[Callable[[str], None]] = None,
    should_abort: Optional[Callable[[], bool]] = None,
    max_wait_sec: float = 150.0,
    new_chat: bool = True,
    check_ref_similarity: bool = True,
    heartbeat_fn: Optional[Callable[[], None]] = None,
    recycle_tab: bool = False,
    metadata_request: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Generates 1 image via Chrome CDP (:9222) on `gemini` | `chatgpt` | `grok`,
    using an isolated New Chat per shot (when `new_chat=True`), real Network + DOM
    state monitoring instead of fixed wait guesses, and immediate input-clone rejection.
    """
    from playwright.sync_api import sync_playwright

    def _log(msg: str) -> None:
        logger.info("[CDP:%s] %s", engine.upper(), msg)
        if log_fn:
            log_fn(msg)

    def _hb() -> None:
        if heartbeat_fn:
            heartbeat_fn()

    status = check_cdp_status(force=True)
    _hb()
    if not status["connected"]:
        _log("Launching / restoring AI Master Browser window on :9222...")
        launch_res = launch_chrome_ai_master(engine=engine, force_restart=bool(status.get("windowless")))
        status = launch_res.get("status") or check_cdp_status(force=True)
        if not status["connected"]:
            raise ProviderAuthError(
                f"Chrome AI Master Browser is not running on port {CDP_PORT}. "
                "Click 'Launch Browser (:9222)' in Settings and sign into your AI account."
            )

    ref_info: Optional[Dict[str, Any]] = None
    ref_dhash: Optional[str] = None
    if reference_path and os.path.exists(reference_path):
        try:
            ref_info = inspect_image_bytes(Path(reference_path).read_bytes())
            ref_dhash = ref_info["dhash"]
        except Exception:
            pass

    with sync_playwright() as p:
        try:
            browser = p.chromium.connect_over_cdp(CDP_ENDPOINT, timeout=12000)
        except Exception as conn_err:
            if "setDownloadBehavior" in str(conn_err) or "context management" in str(conn_err):
                _log("Detected windowless Chrome state; reopening Chrome (:9222) window...")
                launch_chrome_ai_master(engine=engine, force_restart=True)
                time.sleep(1.5)
                browser = p.chromium.connect_over_cdp(CDP_ENDPOINT, timeout=12000)
            else:
                raise
        _hb()

        context = browser.contexts[0] if browser.contexts else browser.new_context()
        if recycle_tab:
            _log(f"Recycling {engine.capitalize()} browser tab to keep Chrome memory lean...")
        page = _find_or_open_engine_page(context, engine, recycle=recycle_tab)
        _hb()
        try:
            page.set_default_timeout(15000)
        except Exception:
            pass

        _ensure_authenticated(page, engine)
        _hb()
        if new_chat:
            page = _start_fresh_chat(page, engine, _log)
            _ensure_authenticated(page, engine)
            _hb()

        if reference_path and os.path.exists(reference_path):
            _attach_reference_image(page, reference_path, _log)
        else:
            _clear_composer_attachments(page)
        _hb()

        before_state = _inspect_generation_dom(page)
        known_srcs = {img.get("src") for img in before_state.get("images", []) if img.get("src")}
        prev_user_count = int(before_state.get("userCount") or 0)
        prev_assistant_count = int(before_state.get("assistantCount") or 0)

        tracker = _CdpNetworkTracker()
        tracker.attach(page)
        try:
            full_prompt = (
                "Generate a new image now using your image generation tool "
                f"(output a visual image, do NOT reply with JSON or text caption). {prompt_final}"
                if not prompt_final.lower().startswith("generate a")
                else prompt_final
            )
            _log("Sending visual generation prompt to browser session...")
            _send_chat_message(page, full_prompt)
            _hb()

            start_ts = time.time()
            last_hb = start_ts
            last_progress_ts = start_ts
            last_sig = None
            nudged_send = False
            retried_explicit = False
            dom_hang_streak = 0
            no_send_polls = 0
            idle_after_finish_polls = 0
            stable_ticks = 0

            while time.time() - start_ts < max_wait_sec:
                if should_abort and should_abort():
                    raise RuntimeError("Turn aborted or skipped by operator.")

                time.sleep(0.65)
                now_ts = time.time()
                elapsed = int(now_ts - start_ts)
                state = _inspect_generation_dom(page)
                net = tracker.snapshot()
                _hb()

                if state.get("domError"):
                    dom_hang_streak += 1
                else:
                    dom_hang_streak = 0

                streaming = bool(state.get("streaming"))
                curr_images = state.get("images") or []
                new_imgs = [
                    im
                    for im in curr_images
                    if im.get("src") and im.get("src") not in known_srcs
                ]

                sig = (
                    int(state.get("userCount") or 0),
                    int(state.get("assistantCount") or 0),
                    streaming,
                    len(str(state.get("latestText") or "")),
                    len(curr_images),
                    int(state.get("loadingImagesCount") or 0),
                    int(net["gen_stream_started"]),
                    int(net["gen_stream_finished"]),
                    int(net["active_gen_streams"]),
                    int(net["active_img_requests"]),
                )
                if sig != last_sig or net["last_net_event_ts"] > last_progress_ts:
                    last_sig = sig
                    last_progress_ts = max(now_ts, net["last_net_event_ts"])

                if new_imgs and not streaming and net["active_img_requests"] == 0:
                    stable_ticks += 2
                elif new_imgs:
                    stable_ticks += 1
                else:
                    stable_ticks = 0

                if new_imgs and stable_ticks >= 2:
                    for cand in reversed(new_imgs):
                        cand_src = cand.get("src") or ""
                        extracted = _extract_raw_bytes_via_cdp(
                            context=context,
                            page=page,
                            src=cand_src,
                            ref_dhash=ref_dhash,
                            response_cache=tracker.response_cache,
                            response_objects=tracker.response_objects,
                            log_fn=_log,
                            ref_info=ref_info,
                            check_ref_similarity=check_ref_similarity,
                        )
                        if extracted:
                            if metadata_request and not (should_abort and should_abort()):
                                idx_num = int(metadata_request.get("index_num") or 1)
                                _log(
                                    f"Collecting post-image caption prompt (#{idx_num:03d}) inside same {engine.capitalize()} session..."
                                )
                                inline_meta = _collect_metadata_on_open_page(
                                    page,
                                    theme=str(metadata_request.get("theme") or ""),
                                    prompt_final=str(metadata_request.get("prompt_final") or prompt_final),
                                    metadata_language=str(metadata_request.get("metadata_language") or "English"),
                                    index_num=idx_num,
                                    caption_prompt=str(metadata_request.get("caption_prompt") or ""),
                                    timeout_sec=float(metadata_request.get("timeout_sec") or 12.0),
                                    should_abort=should_abort,
                                    heartbeat_fn=_hb,
                                )
                                if inline_meta:
                                    extracted["inline_meta"] = inline_meta
                            return extracted
                        known_srcs.add(cand_src)

                send_confirmed_now = (
                    int(state.get("userCount") or 0) > prev_user_count
                    or int(state.get("assistantCount") or 0) > prev_assistant_count
                    or streaming
                    or net["gen_stream_started"] > 0
                    or bool(new_imgs)
                )
                if not send_confirmed_now:
                    no_send_polls += 1
                else:
                    no_send_polls = 0

                if (
                    send_confirmed_now
                    and not new_imgs
                    and not streaming
                    and net["active_gen_streams"] == 0
                    and net["active_img_requests"] == 0
                    and int(state.get("loadingImagesCount") or 0) == 0
                ):
                    idle_after_finish_polls += 1
                else:
                    idle_after_finish_polls = 0

                action, reason = _evaluate_cdp_turn_signals(
                    engine=engine,
                    dom_state=state,
                    net_state=net,
                    prev_user_count=prev_user_count,
                    prev_assistant_count=prev_assistant_count,
                    new_imgs_count=len(new_imgs),
                    dom_hang_streak=dom_hang_streak,
                    no_send_polls=no_send_polls,
                    nudged_send=nudged_send,
                    idle_after_finish_polls=idle_after_finish_polls,
                    retried_explicit=retried_explicit,
                    seconds_since_progress=(now_ts - last_progress_ts),
                )

                if action == "fail_auth":
                    raise ProviderAuthError(reason)
                if action == "fail_transient":
                    raise RuntimeError(reason)
                if action == "nudge_send":
                    nudged_send = True
                    no_send_polls = 0
                    _log(reason)
                    try:
                        _send_chat_message(page, full_prompt)
                    except Exception:
                        pass
                    continue
                if action == "retry_image_prompt":
                    retried_explicit = True
                    idle_after_finish_polls = 0
                    prev_user_count = int(state.get("userCount") or prev_user_count)
                    prev_assistant_count = int(state.get("assistantCount") or prev_assistant_count)
                    last_progress_ts = time.time()
                    _log(reason)
                    _send_chat_message(
                        page,
                        f"Use your image generation tool right now to generate a visual image for: {prompt_final}",
                    )
                    time.sleep(1.2)
                    continue

                if now_ts - last_hb >= 10.0:
                    last_hb = now_ts
                    status_tag = (
                        f"stream={net['active_gen_streams']}, img_dl={net['active_img_requests'] + int(state.get('loadingImagesCount') or 0)}"
                    )
                    _log(f"Monitoring browser generation ({elapsed}s elapsed, {status_tag})...")

            raise RuntimeError(
                f"Exceeded safety ceiling ({int(max_wait_sec)}s) waiting for {engine.upper()} image generation."
            )
        finally:
            tracker.detach(page)
            tracker.response_objects.clear()
            tracker.response_cache.clear()
