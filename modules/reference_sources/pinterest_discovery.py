import os
import re
import urllib.parse
import uuid
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
import requests

from config import PINTEREST_CANDIDATES_DIR, REFERENCES_DIR, get_chrome_executable_path
from database.db_manager import db, slugify_theme
from modules.reference_sources.image_utils import inspect_image_bytes

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
    # Explicitly avoid image/avif so i.pinimg.com serves standard JPEG/PNG/WebP
    "Accept": "image/jpeg,image/png,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

BLOCKED_SUBSTRINGS = (
    "/avatars/",
    "/profile_",
    "default_",
    "logo",
    "icon",
    "spinner",
    "/75x75_",
    "/30x30_",
    "/60x60_",
    "/140x140_",
    "/170x/",
)


def detect_pinterest_input_kind(raw_input: str) -> Dict[str, str]:
    """
    Classifies a Pinterest query into:
    - 'pin_url': e.g. https://www.pinterest.com/pin/123456789/
    - 'board_url': e.g. https://www.pinterest.com/username/board-slug/
    - 'keyword': free-text keyword or tag
    """
    text = (raw_input or "").strip()
    if text.startswith(("http://", "https://")) and ("pinterest." in text or "pin.it" in text):
        pin_match = re.search(r"/pin/(?:[\w-]+--)?(\d+)", text)
        if pin_match:
            return {
                "kind": "pin_url",
                "pin_id": pin_match.group(1),
                "url": text,
                "label": f"Pin #{pin_match.group(1)}",
            }
        parsed = urllib.parse.urlparse(text)
        parts = [p for p in parsed.path.split("/") if p]
        if len(parts) >= 2 and parts[0] not in ("search", "ideas", "today", "pin"):
            return {
                "kind": "board_url",
                "board_path": f"{parts[0]}/{parts[1]}",
                "url": text,
                "label": f"Board @{parts[0]}/{parts[1]}",
            }
    clean_kw = text.lstrip("#").strip()
    return {
        "kind": "keyword",
        "keyword": clean_kw,
        "url": f"https://www.pinterest.com/search/pins/?q={urllib.parse.quote(clean_kw)}&rs=typed",
        "label": f"Keyword '{clean_kw}'",
    }


def _is_valid_pinimg_url(url: str) -> bool:
    if not url or "i.pinimg.com/" not in url:
        return False
    lower = url.lower()
    if any(b in lower for b in BLOCKED_SUBSTRINGS):
        return False
    return any(ext in lower for ext in (".jpg", ".jpeg", ".png", ".webp"))


def _upgrade_pinimg_resolution(url: str) -> List[str]:
    clean = url.split("?")[0].replace("\\/", "/").replace("\\u002F", "/")
    upgraded = re.sub(r"/(?:236x|474x|564x)/", "/736x/", clean)
    originals = re.sub(r"/(?:236x|474x|564x|736x)/", "/originals/", clean)
    candidates: List[str] = []
    for u in (originals, upgraded, clean):
        if u not in candidates:
            candidates.append(u)
    return candidates


def _extract_pinimg_urls(raw_text: str) -> List[str]:
    normalized = (
        raw_text.replace("\\/", "/")
        .replace("\\u002F", "/")
        .replace("&amp;", "&")
    )
    pattern = r"https://i\.pinimg\.com/(?:originals|736x|564x|474x|236x)/[a-zA-Z0-9/_-]+\.(?:jpg|jpeg|png|webp)"
    matches = re.findall(pattern, normalized)
    ordered: List[str] = []
    seen_keys: set[str] = set()
    for m in matches:
        if not _is_valid_pinimg_url(m):
            continue
        key = Path(m).stem
        if key not in seen_keys:
            seen_keys.add(key)
            ordered.append(m)
    return ordered


def _discover_via_official_api(
    info: Dict[str, str],
    access_token: str,
    limit: int = 8,
) -> List[Dict[str, Any]]:
    """Attempts Pinterest API v5 when an official access token is configured."""
    headers = {
        "Authorization": f"Bearer {access_token.strip()}",
        "Accept": "application/json",
    }
    results: List[Dict[str, Any]] = []
    try:
        if info["kind"] == "pin_url" and info.get("pin_id"):
            resp = requests.get(
                f"https://api.pinterest.com/v5/pins/{info['pin_id']}",
                headers=headers,
                timeout=10,
            )
            if resp.status_code == 200:
                data = resp.json()
                images = (data.get("media") or {}).get("images") or {}
                best = (
                    images.get("1200x")
                    or images.get("600x")
                    or images.get("400x300")
                    or next(iter(images.values()), {})
                )
                if best and best.get("url"):
                    results.append(
                        {
                            "image_url": best["url"],
                            "source_ref": f"pinterest:pin:{info['pin_id']}",
                            "title": data.get("title") or data.get("description") or info["label"],
                        }
                    )
        else:
            resp = requests.get(
                "https://api.pinterest.com/v5/pins",
                headers=headers,
                params={"page_size": min(limit, 25)},
                timeout=10,
            )
            if resp.status_code == 200:
                items = resp.json().get("items") or []
                for item in items:
                    images = (item.get("media") or {}).get("images") or {}
                    best = (
                        images.get("1200x")
                        or images.get("600x")
                        or next(iter(images.values()), {})
                    )
                    if best and best.get("url"):
                        results.append(
                            {
                                "image_url": best["url"],
                                "source_ref": f"pinterest:pin:{item.get('id', '')}",
                                "title": item.get("title") or item.get("description") or info["label"],
                            }
                        )
    except Exception:
        pass
    return results


def _discover_via_browser_and_http(
    info: Dict[str, str],
    limit: int = 8,
) -> List[Dict[str, Any]]:
    """Fetches candidate pin URLs from a Pin URL, Board URL, or Keyword search."""
    target_url = info["url"]
    found_urls: List[str] = []

    # Layer 1: Headless Chromium rendering of the target Pinterest URL
    try:
        from playwright.sync_api import sync_playwright

        chrome_path = get_chrome_executable_path()
        with sync_playwright() as p:
            launch_kwargs: Dict[str, Any] = {
                "headless": True,
                "args": ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
            }
            if chrome_path and os.path.exists(chrome_path):
                launch_kwargs["executable_path"] = chrome_path
            browser = p.chromium.launch(**launch_kwargs)
            context = browser.new_context(
                user_agent=HEADERS["User-Agent"],
                viewport={"width": 1440, "height": 960},
            )
            page = context.new_page()
            try:
                page.goto(target_url, wait_until="domcontentloaded", timeout=20000)
                page.wait_for_timeout(2200)
                if info["kind"] != "pin_url":
                    page.mouse.wheel(0, 1400)
                    page.wait_for_timeout(1200)
                dom_srcs: List[str] = page.evaluate(
                    """() => {
                        const out = [];
                        document.querySelectorAll('img').forEach(img => {
                            if (img.srcset) {
                                img.srcset.split(',').forEach(part => {
                                    const u = part.trim().split(' ')[0];
                                    if (u) out.push(u);
                                });
                            }
                            if (img.src) out.push(img.src);
                        });
                        return out;
                    }"""
                )
                html = page.content()
                for u in dom_srcs + _extract_pinimg_urls(html):
                    if _is_valid_pinimg_url(u) and u not in found_urls:
                        found_urls.append(u)
            finally:
                browser.close()
    except Exception:
        pass

    # Layer 2: Direct HTTP fetch if still below limit
    if len(found_urls) < limit:
        try:
            resp = requests.get(target_url, headers=HEADERS, timeout=12)
            if resp.status_code == 200:
                for u in _extract_pinimg_urls(resp.text):
                    if u not in found_urls:
                        found_urls.append(u)
        except Exception:
            pass

    results: List[Dict[str, Any]] = []
    seen_stems: set[str] = set()
    for u in found_urls:
        stem = Path(u.split("?")[0]).stem
        if stem in seen_stems:
            continue
        seen_stems.add(stem)
        results.append(
            {
                "image_url": u,
                "source_ref": target_url,
                "title": f"{info['label']} · #{len(results) + 1}",
            }
        )
        if len(results) >= limit * 2:
            break
    return results


def discover_pinterest_references(
    query_or_url: str,
    limit: int = 6,
    log_fn: Optional[Callable[[str], None]] = None,
) -> Dict[str, Any]:
    """
    Discovers candidate reference images from Pinterest (Keyword, Pin URL, or Board URL),
    downloads validated images into `data/references/` as reference records with
    `source_type='pinterest'` and `usage_rights='inspiration_reference_only'`.
    Never copies Pinterest files into `exports/`.
    """
    def _log(msg: str) -> None:
        if log_fn:
            log_fn(msg)

    info = detect_pinterest_input_kind(query_or_url)
    settings = db.get_settings(include_secrets=True)
    token = str(settings.get("pinterest_access_token") or "").strip()

    _log(f"Discovering Pinterest candidates for {info['label']} (kind={info['kind']})...")
    raw_candidates: List[Dict[str, Any]] = []

    if token:
        raw_candidates.extend(_discover_via_official_api(info, token, limit=limit))

    if len(raw_candidates) < limit:
        browser_candidates = _discover_via_browser_and_http(info, limit=limit)
        raw_candidates.extend(browser_candidates)

    saved_references: List[Dict[str, Any]] = []
    seen_md5s: set[str] = set()
    REFERENCES_DIR.mkdir(parents=True, exist_ok=True)

    for cand in raw_candidates:
        if len(saved_references) >= limit:
            break
        base_url = cand["image_url"]
        for candidate_url in _upgrade_pinimg_resolution(base_url):
            try:
                resp = requests.get(candidate_url, headers=HEADERS, timeout=12)
                if resp.status_code != 200 or not resp.content:
                    continue
                img_info = inspect_image_bytes(resp.content)
                if img_info["width"] < 320 or img_info["height"] < 320:
                    continue
                if img_info["md5"] in seen_md5s:
                    break
                seen_md5s.add(img_info["md5"])

                short_uid = uuid.uuid4().hex[:8]
                slug_part = slugify_theme(info.get("label") or "pin", max_len=24)
                filename = f"pin_{slug_part}_{short_uid}.{img_info['ext']}"
                final_path = REFERENCES_DIR / filename
                tmp_path = REFERENCES_DIR / f".{filename}.tmp"

                with open(tmp_path, "wb") as f:
                    f.write(resp.content)
                    f.flush()
                    os.fsync(f.fileno())
                os.replace(tmp_path, final_path)

                ref_record = db.add_reference(
                    source_type="pinterest",
                    source_ref=cand.get("source_ref") or candidate_url,
                    title=cand.get("title") or info["label"],
                    file_path=str(final_path),
                    filename=filename,
                    mime_type=img_info["mime_type"],
                    width=img_info["width"],
                    height=img_info["height"],
                    file_size=img_info["file_size"],
                    md5=img_info["md5"],
                    dhash=img_info["dhash"],
                    usage_rights="inspiration_reference_only",
                    metadata={
                        "input_kind": info["kind"],
                        "query_or_url": query_or_url,
                        "origin_image_url": candidate_url,
                        "api_authorized": bool(token),
                    },
                )
                saved_references.append(ref_record)
                break
            except Exception:
                continue

    return {
        "input_info": info,
        "api_token_configured": bool(token),
        "count": len(saved_references),
        "references": saved_references,
    }
