import base64
import json
from pathlib import Path
import re
import time
from typing import Any, Callable, Dict, List, Optional
import requests

from config import AI_ENGINES, CDP_ENDPOINT, DEFAULT_CAPTION_PROMPT
from database.db_manager import db, slugify_theme
from modules.app_logging import logger
from modules.image_providers.browser_cdp_provider import (
    _collect_metadata_on_open_page,
    _find_or_open_engine_page,
    check_cdp_status,
)
from modules.metadata_parser import (
    _build_theme_hashtags,
    _normalize_hashtags,
    build_metadata_prompt,
    parse_metadata_json,
)
from modules.reference_sources.image_utils import inspect_image_bytes


def _generate_via_gemini_vision_api(
    api_key: str,
    image_path: str,
    theme: str,
    prompt_final: str,
    metadata_language: str,
    index_num: int,
    caption_prompt: str = "",
) -> Optional[Dict[str, str]]:
    path_obj = Path(image_path)
    if not path_obj.exists():
        return None
    raw_bytes = path_obj.read_bytes()
    info = inspect_image_bytes(raw_bytes)
    b64_img = base64.b64encode(raw_bytes).decode("ascii")

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={api_key}"
    payload = {
        "contents": [
            {
                "parts": [
                    {
                        "inline_data": {
                            "mime_type": info["mime_type"],
                            "data": b64_img,
                        }
                    },
                    {
                        "text": build_metadata_prompt(
                            theme=theme,
                            prompt_final=prompt_final,
                            metadata_language=metadata_language,
                            index_num=index_num,
                            caption_prompt=caption_prompt,
                        )
                    },
                ]
            }
        ]
    }
    resp = requests.post(url, json=payload, timeout=20)
    if resp.status_code != 200:
        return None
    data = resp.json()
    candidates = data.get("candidates") or []
    if not candidates:
        return None
    parts = ((candidates[0].get("content") or {}).get("parts")) or []
    text = "\n".join(str(p.get("text") or "") for p in parts)
    return parse_metadata_json(text, theme=theme)


def _generate_via_cdp_turn(
    engine: str,
    theme: str,
    prompt_final: str,
    metadata_language: str,
    index_num: int,
    caption_prompt: str = "",
    timeout_sec: float = 12.0,
    should_abort: Optional[Callable[[], bool]] = None,
    heartbeat_fn: Optional[Callable[[], None]] = None,
) -> Optional[Dict[str, str]]:
    from playwright.sync_api import sync_playwright

    if not check_cdp_status().get("connected"):
        return None
    if heartbeat_fn:
        heartbeat_fn()

    with sync_playwright() as p:
        if heartbeat_fn:
            heartbeat_fn()
        browser = p.chromium.connect_over_cdp(CDP_ENDPOINT, timeout=8000)
        if heartbeat_fn:
            heartbeat_fn()
        context = browser.contexts[0] if browser.contexts else browser.new_context()
        page = _find_or_open_engine_page(context, engine)
        try:
            page.set_default_timeout(10000)
        except Exception:
            pass
        return _collect_metadata_on_open_page(
            page,
            theme=theme,
            prompt_final=prompt_final,
            metadata_language=metadata_language,
            index_num=index_num,
            caption_prompt=caption_prompt,
            timeout_sec=timeout_sec,
            should_abort=should_abort,
            heartbeat_fn=heartbeat_fn,
        )


# Pinterest-friendly hook templates for instant synthesis & fallback
_EN_HOOK_TEMPLATES = [
    "{theme} Inspo · {headline}",
    "Aesthetic {theme} Ideas — {headline}",
    "Curated {theme} Lookbook · {headline}",
    "Elevated {theme} Style: {headline}",
    "Effortless {theme} Mood — {headline}",
    "Modern {theme} Aesthetic · {headline}",
    "Timeless {theme} Detail — {headline}",
    "Chic {theme} Inspiration · {headline}",
]

_EN_CAPTION_TEMPLATES = [
    "Save this {theme_lower} inspiration for your next moodboard — {atmos_lower} meets {lighting_lower}.",
    "Obsessed with the {lighting_lower} and {comp_lower} in this {theme_lower} look.",
    "Minimal, polished, and timeless {theme_lower} aesthetic captured from a {angle_lower}.",
    "Your sign to try this {theme_lower} vibe: {atmos_lower} with {lighting_lower}.",
    "Every detail counts — {theme_lower} styling with {comp_lower} and {lighting_lower}.",
    "Pin-worthy {theme_lower} moment featuring {atmos_lower} and crisp editorial clarity.",
]

_VI_HOOK_TEMPLATES = [
    "Gợi ý {theme} cực cuốn · {headline}",
    "Cảm hứng {theme} tinh tế — {headline}",
    "BST {theme} Aesthetic · {headline}",
    "Xu hướng {theme} nổi bật: {headline}",
    "Ý tưởng {theme} sang trọng — {headline}",
    "Phong cách {theme} hiện đại · {headline}",
]

_VI_CAPTION_TEMPLATES = [
    "Lưu ngay mẫu {theme_lower} cực xinh này cho bộ sưu tập của bạn — sự kết hợp hoàn hảo giữa {atmos_lower} và {lighting_lower}.",
    "Mê mẩn từng đường nét {theme_lower} dưới góc chụp {angle_lower} đầy cuốn hút.",
    "Gợi ý {theme_lower} chuẩn vibe nàng thơ với bố cục {comp_lower} và {lighting_lower}.",
    "Một chút cảm hứng {theme_lower} tinh tế, nhẹ nhàng nhưng vẫn cực kỳ nổi bật.",
]


def _synthesize_structured_metadata(
    theme: str,
    prompt_final: str,
    variation_axes: Dict[str, Any],
    fixed_elements: Dict[str, Any],
    metadata_language: str,
    index_num: int,
    image_path: str,
    caption_prompt: str = "",
    known_width: int = 0,
    known_height: int = 0,
) -> Dict[str, str]:
    """
    Synthesizes a Pinterest/Social-ready Title, Caption (hook), SEO Description, and Hashtags
    tailored to the turn's specific theme, variation axes, and custom caption prompt.
    """
    path_obj = Path(image_path) if image_path else None
    if not image_path or (known_width <= 0 and known_height <= 0 and (not path_obj or not path_obj.exists())):
        raise FileNotFoundError(f"Generated image file not found at {image_path}")

    if (known_width <= 0 or known_height <= 0) and path_obj and path_obj.exists():
        img_info = inspect_image_bytes(path_obj.read_bytes())
        width, height = img_info["width"], img_info["height"]
    else:
        width, height = known_width or 1080, known_height or 1080

    clean_theme = theme.strip()
    angle = str(variation_axes.get("camera_angle") or "editorial close-up perspective").strip().rstrip(".")
    lighting = str(variation_axes.get("lighting") or "soft natural daylight").strip().rstrip(".")
    comp = str(variation_axes.get("composition") or "balanced hero framing").strip().rstrip(".")
    atmos = str(variation_axes.get("atmosphere") or "clean studio aesthetic").strip().rstrip(".")
    style = str(fixed_elements.get("style") or "").strip().rstrip(".")
    palette = str(fixed_elements.get("color_palette") or "").strip().rstrip(".")

    atmos_short = atmos.split(" with ")[0].strip()
    angle_short = angle.split("(")[0].strip()

    # Extract any custom keywords from caption_prompt for hashtag enrichment
    extra_kw = [
        w for w in re.findall(r"#([a-zA-Z0-9_]+)", caption_prompt or "") if len(w) >= 3
    ]
    hashtags = _build_theme_hashtags(clean_theme, extra_words=extra_kw + [atmos_short.split()[0]])

    lang = (metadata_language or "English").strip().lower()
    idx_zero = max(0, index_num - 1)

    if lang in ("vietnamese", "tiếng việt", "vi"):
        hook_tpl = _VI_HOOK_TEMPLATES[idx_zero % len(_VI_HOOK_TEMPLATES)]
        cap_tpl = _VI_CAPTION_TEMPLATES[idx_zero % len(_VI_CAPTION_TEMPLATES)]
        title = hook_tpl.format(theme=clean_theme, headline=atmos_short)
        caption = cap_tpl.format(
            theme_lower=clean_theme.lower(),
            atmos_lower=atmos_short.lower(),
            lighting_lower=lighting.lower(),
            angle_lower=angle_short.lower(),
            comp_lower=comp.lower(),
        )
        description = (
            f"{caption} Khung hình {clean_theme} được chăm chút với góc chụp {angle_short.lower()}, "
            f"ánh sáng {lighting.lower()} tôn lên chất liệu và sắc độ hài hòa. "
            f"Lưu lại ngay để tham khảo khi cần! {hashtags}"
        )
    else:
        hook_tpl = _EN_HOOK_TEMPLATES[idx_zero % len(_EN_HOOK_TEMPLATES)]
        cap_tpl = _EN_CAPTION_TEMPLATES[idx_zero % len(_EN_CAPTION_TEMPLATES)]
        title = hook_tpl.format(theme=clean_theme, headline=atmos_short)
        caption = cap_tpl.format(
            theme_lower=clean_theme.lower(),
            atmos_lower=atmos_short.lower(),
            lighting_lower=lighting.lower(),
            angle_lower=angle_short.lower(),
            comp_lower=comp.lower(),
        )
        palette_sentence = (
            f" Styled with {palette.lower()} tones for a cohesive, save-worthy look."
            if palette
            else " Designed for your Pinterest aesthetic board and daily inspiration."
        )
        description = (
            f"{caption} Showcasing \"{clean_theme}\" from an {angle_short.lower()} "
            f"with {comp.lower()} and {lighting.lower()} in a {atmos.lower()}.{palette_sentence} "
            f"{hashtags}"
        )

    return {
        "title": title[:160],
        "caption": caption[:240],
        "description": description[:600],
        "hashtags": hashtags,
    }


def write_generation_metadata(
    job: Dict[str, Any],
    generation: Dict[str, Any],
    use_browser_turn: bool = True,
    log_fn: Optional[Callable[[str], None]] = None,
    should_abort: Optional[Callable[[], bool]] = None,
    inline_meta: Optional[Dict[str, str]] = None,
) -> Dict[str, str]:
    """
    Generates Pinterest/Social-ready `title`, `caption`, `description`, and `hashtags`
    for a completed image generation:
    1. Uses `inline_meta` if already captured in Turn 1's single CDP browser session.
    2. Uses Gemini Vision API if `gemini_api_key` is configured in Settings.
    3. Uses standalone Browser CDP Turn 2 if `use_browser_turn=True` (when not already captured inline).
    4. Synthesizes rich Pinterest-ready caption & description from the verified image + variation axes.
    """
    theme = job["theme"]
    metadata_language = job.get("metadata_language") or "English"
    caption_prompt = job.get("caption_prompt") or DEFAULT_CAPTION_PROMPT
    prompt_final = generation.get("prompt_final") or ""
    index_num = int(generation.get("index_num") or 1)
    image_path = str(generation.get("image_path") or "")
    variation_axes = generation.get("variation_axes") or {}
    fixed_elements = generation.get("fixed_elements") or job.get("fixed_elements") or {}

    if isinstance(inline_meta, dict) and inline_meta.get("title"):
        return inline_meta

    settings = db.get_settings(include_secrets=True)
    gemini_key = str(settings.get("gemini_api_key") or "").strip()

    if gemini_key and image_path:
        try:
            if log_fn:
                log_fn(f"Generating Pin Caption & Description (#{index_num:03d}) via Gemini Vision API...")
            res = _generate_via_gemini_vision_api(
                api_key=gemini_key,
                image_path=image_path,
                theme=theme,
                prompt_final=prompt_final,
                metadata_language=metadata_language,
                index_num=index_num,
                caption_prompt=caption_prompt,
            )
            if res:
                return res
        except Exception as exc:
            logger.warning("Gemini Vision metadata fallback: %s", exc)

    if use_browser_turn:
        model_id = generation.get("model") or job.get("model") or "chrome-cdp/gemini"
        engine = model_id.split("/")[-1] if "/" in model_id else "gemini"
        if engine in AI_ENGINES:
            try:
                from modules.image_providers.cdp_worker import run_cdp_metadata_turn_isolated

                if log_fn:
                    log_fn(f"Sending post-image caption prompt (#{index_num:03d}) to {engine.capitalize()} browser session...")
                res = run_cdp_metadata_turn_isolated(
                    engine=engine,
                    theme=theme,
                    prompt_final=prompt_final,
                    metadata_language=metadata_language,
                    index_num=index_num,
                    caption_prompt=caption_prompt,
                    should_abort=should_abort,
                )
                if res:
                    return res
            except Exception as exc:
                logger.warning("CDP metadata turn fallback: %s", exc)

    return _synthesize_structured_metadata(
        theme=theme,
        prompt_final=prompt_final,
        variation_axes=variation_axes,
        fixed_elements=fixed_elements,
        metadata_language=metadata_language,
        index_num=index_num,
        image_path=image_path,
        caption_prompt=caption_prompt,
        known_width=int(generation.get("width") or 0),
        known_height=int(generation.get("height") or 0),
    )
