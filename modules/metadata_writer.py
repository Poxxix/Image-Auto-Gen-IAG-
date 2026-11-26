import base64
from io import BytesIO
from pathlib import Path
import threading
from typing import Any, Callable, Dict, List, Optional
from PIL import Image
import requests

from config import (
    AI_ENGINES,
    CDP_PORT,
    DEFAULT_CAPTION_PROMPT,
    DEFAULT_PICASSY_CATEGORIES,
    format_picassy_keyword,
    format_picassy_keyword_prose,
    split_api_keys,
)
from database.db_manager import db
from modules.app_logging import logger
from modules.image_providers.browser_cdp_provider import (
    _collect_metadata_on_open_page,
    _find_or_open_engine_page,
    check_cdp_status,
    get_preferred_online_cdp_port,
)
from modules.metadata_parser import (
    build_metadata_prompt,
    build_picassy_repair_prompt,
    fit_picassy_metadata,
    parse_metadata_json,
    validate_picassy_metadata,
)
from modules.reference_sources.image_utils import inspect_image_bytes

_KEY_ROTATION_LOCK = threading.Lock()
_KEY_ROTATION_IDX = 0


def _next_rotated_key(keys: List[str]) -> List[str]:
    """Returns keys ordered starting from a round-robin offset for concurrent safety."""
    global _KEY_ROTATION_IDX
    if not keys:
        return []
    with _KEY_ROTATION_LOCK:
        start = _KEY_ROTATION_IDX % len(keys)
        _KEY_ROTATION_IDX += 1
    return keys[start:] + keys[:start]


def _prepare_vision_thumbnail(
    image_path: str,
    max_edge: int = 512,
    quality: int = 78,
) -> Optional[tuple[str, str]]:
    """
    Encodes a lightweight <=512px JPEG thumbnail in memory (~25-45 KB) for Small Vision Models
    instead of uploading full 2-5 MB PNGs. Returns (mime_type, base64_ascii).
    """
    path_obj = Path(image_path) if image_path else None
    if not path_obj or not path_obj.exists():
        return None
    raw_bytes = path_obj.read_bytes()
    try:
        with Image.open(BytesIO(raw_bytes)) as im:
            rgb = im.convert("RGB")
            rgb.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
            buf = BytesIO()
            rgb.save(buf, format="JPEG", quality=quality, optimize=True)
            thumb_bytes = buf.getvalue()
            return "image/jpeg", base64.b64encode(thumb_bytes).decode("ascii")
    except Exception:
        info = inspect_image_bytes(raw_bytes)
        return info["mime_type"], base64.b64encode(raw_bytes).decode("ascii")


def _call_gemini_rest(
    keys: List[str],
    model: str,
    prompt_text: str,
    thumb: Optional[tuple[str, str]] = None,
) -> Optional[str]:
    model_id = (model or "gemini-2.0-flash").strip()
    if model_id.startswith("models/"):
        model_id = model_id.split("/", 1)[1]
    parts: List[Dict[str, Any]] = []
    if thumb:
        parts.append({"inline_data": {"mime_type": thumb[0], "data": thumb[1]}})
    parts.append({"text": prompt_text})

    for key in _next_rotated_key(keys):
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model_id}:generateContent?key={key}"
        )
        try:
            resp = requests.post(
                url,
                json={"contents": [{"parts": parts}]},
                timeout=22,
            )
            if resp.status_code in (401, 403, 429):
                continue
            if resp.status_code != 200:
                continue
            data = resp.json()
            candidates = data.get("candidates") or []
            if not candidates:
                continue
            out_parts = ((candidates[0].get("content") or {}).get("parts")) or []
            text = "\n".join(str(p.get("text") or "") for p in out_parts).strip()
            if text:
                return text
        except Exception:
            continue
    return None


def _call_openai_compat_rest(
    *,
    base_url: str,
    keys: List[str],
    model: str,
    prompt_text: str,
    thumb: Optional[tuple[str, str]] = None,
) -> Optional[str]:
    clean_base = (base_url or "https://api.openai.com/v1").strip().rstrip("/")
    url = (
        clean_base
        if clean_base.endswith("/chat/completions")
        else f"{clean_base}/chat/completions"
    )
    content: List[Dict[str, Any]] = []
    if thumb:
        content.append(
            {
                "type": "image_url",
                "image_url": {"url": f"data:{thumb[0]};base64,{thumb[1]}"},
            }
        )
    content.append({"type": "text", "text": prompt_text})

    auth_candidates = _next_rotated_key(keys) if keys else [""]
    for key in auth_candidates:
        headers = {"Content-Type": "application/json"}
        if key:
            headers["Authorization"] = f"Bearer {key}"
        try:
            resp = requests.post(
                url,
                headers=headers,
                json={
                    "model": (model or "gpt-4o-mini").strip(),
                    "messages": [{"role": "user", "content": content}],
                    "temperature": 0.4,
                },
                timeout=24,
            )
            if resp.status_code in (401, 403, 429):
                continue
            if resp.status_code != 200:
                continue
            data = resp.json()
            choices = data.get("choices") or []
            if not choices:
                continue
            text = str((choices[0].get("message") or {}).get("content") or "").strip()
            if text:
                return text
        except Exception:
            continue
    return None


def _invoke_small_metadata_model(
    *,
    settings: Dict[str, Any],
    prompt_text: str,
    image_path: str = "",
    use_vision: bool = True,
    log_fn: Optional[Callable[[str], None]] = None,
) -> Optional[str]:
    """
    Unified Small Metadata Model Router (Option 1A):
    Supports Google Gemini (Flash/Flash-Lite + multi-key rotation), OpenAI Mini/Nano,
    and OpenAI-Compatible endpoints (OpenRouter, Groq, Ollama, LM Studio).
    """
    provider = str(settings.get("metadata_provider") or "auto").strip().lower()
    if provider in ("template", "browser_cdp"):
        return None

    meta_model = str(settings.get("metadata_model") or "").strip()
    meta_base_url = str(settings.get("metadata_api_base_url") or "").strip()
    meta_keys = split_api_keys(settings.get("metadata_api_key"))
    gemini_keys = split_api_keys(settings.get("gemini_api_key"))
    openai_keys = split_api_keys(settings.get("openai_api_key"))

    thumb = (
        _prepare_vision_thumbnail(image_path, max_edge=512, quality=78)
        if use_vision and image_path
        else None
    )

    if provider == "openai_compatible" or (provider == "auto" and meta_base_url):
        if meta_base_url or meta_keys:
            if log_fn:
                log_fn(f"Metadata AI (OpenAI-compat · {meta_model or 'custom'})...")
            return _call_openai_compat_rest(
                base_url=meta_base_url or "https://api.openai.com/v1",
                keys=meta_keys or openai_keys,
                model=meta_model or "gpt-4o-mini",
                prompt_text=prompt_text,
                thumb=thumb,
            )
        return None

    if provider == "gemini" or (provider == "auto" and (meta_keys or gemini_keys)):
        all_g_keys = meta_keys or gemini_keys
        if provider == "auto" and meta_keys and meta_keys[0].startswith("sk-"):
            # User pasted an OpenAI-style sk- key into metadata_api_key under auto mode
            pass
        elif all_g_keys:
            g_model = meta_model or "gemini-2.0-flash"
            if g_model.startswith("gpt-"):
                g_model = "gemini-2.0-flash"
            if log_fn:
                log_fn(f"Metadata AI (Gemini · {g_model})...")
            return _call_gemini_rest(
                keys=all_g_keys,
                model=g_model,
                prompt_text=prompt_text,
                thumb=thumb,
            )

    if provider == "openai" or (provider == "auto" and (openai_keys or (meta_keys and meta_keys[0].startswith("sk-")))):
        all_o_keys = (meta_keys if meta_keys and meta_keys[0].startswith("sk-") else []) or openai_keys
        if all_o_keys:
            o_model = meta_model if (meta_model and not meta_model.startswith("gemini")) else "gpt-4o-mini"
            if log_fn:
                log_fn(f"Metadata AI (OpenAI · {o_model})...")
            return _call_openai_compat_rest(
                base_url="https://api.openai.com/v1",
                keys=all_o_keys,
                model=o_model,
                prompt_text=prompt_text,
                thumb=thumb,
            )

    return None


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
    cdp_port: Optional[int] = None,
    primary_tag: str = "",
    category: str = "",
    available_categories: Optional[List[str]] = None,
) -> Optional[Dict[str, str]]:
    from playwright.sync_api import sync_playwright

    target_port = int(cdp_port or get_preferred_online_cdp_port() or CDP_PORT)
    if not check_cdp_status(cdp_port=target_port).get("connected"):
        return None
    if heartbeat_fn:
        heartbeat_fn()

    endpoint = f"http://127.0.0.1:{target_port}"
    with sync_playwright() as p:
        if heartbeat_fn:
            heartbeat_fn()
        browser = p.chromium.connect_over_cdp(endpoint, timeout=8000)
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
            primary_tag=primary_tag,
            category=category,
            available_categories=available_categories,
            include_visual_context=False,
            timeout_sec=timeout_sec,
            should_abort=should_abort,
            heartbeat_fn=heartbeat_fn,
        )


# Natural grammatical synthesis templates complying with Picassy Title (<=60, starts with keyword),
# Description (<=160, natural complete sentences), and Alt Text (100..125 narrative).
_EN_TITLE_SUFFIXES = [
    "with Soft Natural Light",
    "in Editorial Composition",
    "with Warm Atmospheric Glow",
    "Styled in Minimalist Harmony",
    "in Crisp Studio Framing",
    "with Gentle Tonal Depth",
]

_EN_DESC_TEMPLATES = [
    "{kw} showcased through {angle} and {lighting}, blending tactile clarity with {atmos}.",
    "Explore {kw} framed in {comp}, highlighted by {lighting} and a calm visual mood.",
    "Thoughtfully composed {kw} scene balancing {lighting} with authentic detail in {atmos}.",
    "{kw} brought into crisp focus using {angle} and warm highlights across {atmos}.",
]

_EN_ALT_TEMPLATES = [
    "View of {kw} framed from {angle}, illuminated by {lighting} against {atmos}.",
    "Photograph depicting {kw} in {comp}, featuring {lighting} and natural depth across {atmos}.",
    "Close visual of {kw} captured with {angle}, showing {lighting} and balanced details in {atmos}.",
    "Artistic scene showing {kw} arranged in {comp}, lit gently by {lighting} inside {atmos}.",
]

_VI_TITLE_SUFFIXES = [
    "với ánh sáng tự nhiên tinh tế",
    "trong bố cục nghệ thuật cân đối",
    "nổi bật cùng sắc thái ấm áp",
    "mang nét tối giản thanh lịch",
    "với góc nhìn giàu chiều sâu",
    "cùng chi tiết sắc nét hài hòa",
]

_VI_DESC_TEMPLATES = [
    "{kw} được thể hiện tự nhiên qua {angle} và {lighting}, hòa quyện tinh tế trong {atmos}.",
    "Khám phá vẻ đẹp {kw} với {comp}, nổi bật dưới {lighting} tạo chiều sâu cuốn hút.",
    "Khung hình {kw} hài hòa giữa {lighting} và đường nét tinh xảo trong {atmos}.",
    "{kw} nổi bật rõ nét nhờ {angle}, mang lại cảm giác ấm áp và giàu thẩm mỹ.",
]

_VI_ALT_TEMPLATES = [
    "Bức ảnh ghi lại {kw} từ {angle}, nổi bật với {lighting} giữa khung cảnh {atmos}.",
    "Khung hình miêu tả {kw} theo {comp}, ánh sáng {lighting} tôn lên chi tiết trong {atmos}.",
    "Góc nhìn cận cảnh {kw} thể hiện đường nét sắc sảo dưới {lighting} và nền {atmos}.",
    "Cảnh sắc {kw} được bố trí hài hòa cùng {lighting}, tạo chiều sâu tự nhiên trong {atmos}.",
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
    primary_tag: str = "",
    category: str = "",
    available_categories: Optional[List[str]] = None,
) -> Dict[str, str]:
    """
    Instant zero-token grammatical metadata synthesizer conforming to Picassy's SEO rules
    when no external Small Model API key is configured.
    """
    path_obj = Path(image_path) if image_path else None
    if not image_path or (known_width <= 0 and known_height <= 0 and (not path_obj or not path_obj.exists())):
        raise FileNotFoundError(f"Generated image file not found at {image_path}")

    if (known_width <= 0 or known_height <= 0) and path_obj and path_obj.exists():
        inspect_image_bytes(path_obj.read_bytes())

    raw_kw = (primary_tag or theme or "Artwork").strip()
    kw = format_picassy_keyword(raw_kw) or raw_kw
    kw_prose = format_picassy_keyword_prose(raw_kw) or kw.lower()
    angle = str(variation_axes.get("camera_angle") or "editorial close-up perspective").strip().rstrip(".")
    lighting = str(variation_axes.get("lighting") or "soft natural daylight").strip().rstrip(".")
    comp = str(variation_axes.get("composition") or "balanced hero framing").strip().rstrip(".")
    atmos = str(variation_axes.get("atmosphere") or "clean studio backdrop").strip().rstrip(".")

    import re as _re

    def _clean_axis_noun(raw_axis: str) -> str:
        s_ax = raw_axis.split("(")[0].split(",")[0].strip().lower()
        s_ax = _re.sub(
            r"^(?:shoot\s+from\s+|capture\s+from\s+|captured\s+from\s+|frame\s+|let\s+|show\s+|create\s+|use\s+)",
            "",
            s_ax,
        ).strip()
        return s_ax or "balanced framing"

    angle_short = _clean_axis_noun(angle)
    lighting_short = _clean_axis_noun(lighting)
    comp_short = _clean_axis_noun(comp)
    atmos_short = _clean_axis_noun(atmos)

    lang = (metadata_language or "English").strip().lower()
    idx_zero = max(0, index_num - 1)

    if lang in ("vietnamese", "tiếng việt", "vi"):
        title_raw = f"{kw} {_VI_TITLE_SUFFIXES[idx_zero % len(_VI_TITLE_SUFFIXES)]}"
        desc_raw = _VI_DESC_TEMPLATES[idx_zero % len(_VI_DESC_TEMPLATES)].format(
            kw=kw_prose,
            angle=angle_short,
            lighting=lighting_short,
            comp=comp_short,
            atmos=atmos_short,
        )
        alt_raw = _VI_ALT_TEMPLATES[idx_zero % len(_VI_ALT_TEMPLATES)].format(
            kw=kw_prose,
            angle=angle_short,
            lighting=lighting_short,
            comp=comp_short,
            atmos=atmos_short,
        )
    else:
        title_raw = f"{kw} {_EN_TITLE_SUFFIXES[idx_zero % len(_EN_TITLE_SUFFIXES)]}"
        desc_raw = _EN_DESC_TEMPLATES[idx_zero % len(_EN_DESC_TEMPLATES)].format(
            kw=kw_prose,
            angle=angle_short,
            lighting=lighting_short,
            comp=comp_short,
            atmos=atmos_short,
        )
        alt_raw = _EN_ALT_TEMPLATES[idx_zero % len(_EN_ALT_TEMPLATES)].format(
            kw=kw_prose,
            angle=angle_short,
            lighting=lighting_short,
            comp=comp_short,
            atmos=atmos_short,
        )

    return fit_picassy_metadata(
        {"title": title_raw, "description": desc_raw, "alt_text": alt_raw},
        primary_tag=kw,
        theme=theme,
        metadata_language=metadata_language,
        visual_hints={
            "camera_angle": angle_short,
            "lighting": lighting_short,
            "composition": comp_short,
            "atmosphere": atmos_short,
        },
        category=category,
        available_categories=available_categories,
    )


def write_generation_metadata(
    job: Dict[str, Any],
    generation: Dict[str, Any],
    use_browser_turn: Optional[bool] = None,
    log_fn: Optional[Callable[[str], None]] = None,
    should_abort: Optional[Callable[[], bool]] = None,
    inline_meta: Optional[Dict[str, str]] = None,
) -> Dict[str, str]:
    """
    Generates Picassy SEO metadata (`title`, `description`, `alt_text`, `category`)
    prioritizing Option 1A (Small Vision/Text Model API with 512px thumbnail & zero
    CDP Turn-2 burn), optional self-correction for strict char bounds, and instant
    grammatical synthesis fallback.
    """
    theme = job["theme"]
    raw_pt = (job.get("primary_tag") or theme).strip()
    primary_tag = format_picassy_keyword(raw_pt) or raw_pt
    category = (job.get("category") or "").strip()
    metadata_language = job.get("metadata_language") or "English"
    caption_prompt = job.get("caption_prompt") or DEFAULT_CAPTION_PROMPT
    prompt_final = generation.get("prompt_final") or ""
    index_num = int(generation.get("index_num") or 1)
    image_path = str(generation.get("image_path") or "")
    variation_axes = generation.get("variation_axes") or {}
    fixed_elements = generation.get("fixed_elements") or job.get("fixed_elements") or {}

    settings = db.get_settings(include_secrets=True)
    available_categories = settings.get("picassy_categories") or list(DEFAULT_PICASSY_CATEGORIES)
    visual_hints = {
        "camera_angle": str(variation_axes.get("camera_angle") or ""),
        "lighting": str(variation_axes.get("lighting") or ""),
        "composition": str(variation_axes.get("composition") or ""),
        "atmosphere": str(variation_axes.get("atmosphere") or ""),
    }

    if isinstance(inline_meta, dict) and inline_meta.get("title"):
        return fit_picassy_metadata(
            inline_meta,
            primary_tag=primary_tag,
            theme=theme,
            metadata_language=metadata_language,
            visual_hints=visual_hints,
            category=category,
            available_categories=available_categories,
        )

    provider_pref = str(settings.get("metadata_provider") or "auto").strip().lower()
    use_ai_flag = bool(job.get("use_ai_caption_prompt", True))
    use_vision = str(settings.get("metadata_vision_mode") or "thumbnail_512") != "text_only"

    # Option 1A: Try Small Cloud/Local Model API first whenever enabled (saves 50% Chrome CDP turns)
    if use_ai_flag and provider_pref not in ("template", "browser_cdp"):
        prompt_text = build_metadata_prompt(
            theme=theme,
            prompt_final=prompt_final,
            metadata_language=metadata_language,
            index_num=index_num,
            caption_prompt=caption_prompt,
            primary_tag=primary_tag,
            category=category,
            available_categories=None if category else available_categories,
            include_visual_context=True,
        )
        raw_reply = _invoke_small_metadata_model(
            settings=settings,
            prompt_text=prompt_text,
            image_path=image_path,
            use_vision=use_vision,
            log_fn=log_fn,
        )
        parsed = parse_metadata_json(raw_reply or "", theme=theme)
        if parsed:
            issues = validate_picassy_metadata(parsed, primary_tag)
            if issues:
                # 1 ultra-cheap text-only self-correction pass (no image upload) if char bounds drifted
                repair_prompt = build_picassy_repair_prompt(
                    primary_tag=primary_tag,
                    metadata_language=metadata_language,
                    title=parsed.get("title") or "",
                    description=parsed.get("description") or "",
                    alt_text=parsed.get("alt_text") or "",
                    issues=issues,
                )
                repair_reply = _invoke_small_metadata_model(
                    settings=settings,
                    prompt_text=repair_prompt,
                    image_path="",
                    use_vision=False,
                    log_fn=None,
                )
                repaired = parse_metadata_json(repair_reply or "", theme=theme)
                if repaired:
                    parsed = repaired

            return fit_picassy_metadata(
                parsed,
                primary_tag=primary_tag,
                theme=theme,
                metadata_language=metadata_language,
                visual_hints=visual_hints,
                category=category,
                available_categories=available_categories,
            )

    # Browser CDP turn #2 ONLY runs when explicitly requested by operator or `metadata_provider == "browser_cdp"`
    should_cdp = bool(use_browser_turn) if use_browser_turn is not None else (
        use_ai_flag and provider_pref == "browser_cdp"
    )
    if should_cdp:
        model_id = generation.get("model") or job.get("model") or "chrome-cdp/gemini"
        engine = model_id.split("/")[-1] if "/" in model_id else "gemini"
        if engine in AI_ENGINES:
            try:
                from modules.image_providers.cdp_worker import run_cdp_metadata_turn_isolated

                slot_id = int(job.get("active_cdp_slot") or job.get("preferred_cdp_slot") or 0)
                cdp_port = get_preferred_online_cdp_port(preferred_slot=slot_id)
                if cdp_port:
                    if log_fn:
                        log_fn(f"Sending caption prompt (#{index_num:03d}) to {engine.capitalize()} browser (:{cdp_port})...")
                    res = run_cdp_metadata_turn_isolated(
                        engine=engine,
                        theme=theme,
                        prompt_final=prompt_final,
                        metadata_language=metadata_language,
                        index_num=index_num,
                        caption_prompt=caption_prompt,
                        primary_tag=primary_tag,
                        category=category,
                        available_categories=None if category else available_categories,
                        cdp_port=cdp_port,
                        should_abort=should_abort,
                    )
                    if res:
                        return fit_picassy_metadata(
                            res,
                            primary_tag=primary_tag,
                            theme=theme,
                            metadata_language=metadata_language,
                            visual_hints=visual_hints,
                            category=category,
                            available_categories=available_categories,
                        )
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
        primary_tag=primary_tag,
        category=category,
        available_categories=available_categories,
    )
