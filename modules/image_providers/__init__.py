from typing import Any, Callable, Dict, List, Optional

from config import PROVIDER_MODELS, normalize_cdp_slots
from modules.image_providers.browser_cdp_provider import (
    ProviderAuthError,
    ReferenceTooSimilarError,
    check_cdp_status,
    generate_image_via_cdp,
    get_preferred_online_cdp_port,
    launch_chrome_ai_master,
    launch_chrome_slot,
    list_cdp_slots_status,
)
from modules.image_providers.cdp_worker import run_cdp_image_turn_isolated
from modules.reference_sources.image_utils import (
    inspect_image_bytes,
    measure_image_similarity,
)


def list_available_providers() -> List[Dict[str, Any]]:
    """
    Returns all registered image providers with live availability status,
    supported aspect ratios, reference image support, and rate/cost notes.
    """
    from database.db_manager import db

    settings = db.get_settings(include_secrets=True)
    slots = normalize_cdp_slots(settings.get("cdp_slots"))
    slot_statuses = list_cdp_slots_status(slots=slots)
    enabled_slots = [s for s in slot_statuses if s.get("enabled", True)]
    online_slots = [s for s in slot_statuses if s.get("connected")]
    enabled_count = max(1, len(enabled_slots))

    has_gemini_key = bool(str(settings.get("gemini_api_key") or "").strip())
    has_openai_key = bool(str(settings.get("openai_api_key") or "").strip())

    out: List[Dict[str, Any]] = []
    for model_id, meta in PROVIDER_MODELS.items():
        item = dict(meta)
        if meta["mode"] == "browser_cdp":
            eng = meta["engine"]
            item["max_concurrency"] = enabled_count
            item["ready"] = bool(online_slots)
            item["tab_open"] = any(eng in (s.get("open_engines") or []) for s in online_slots)
            if online_slots:
                ports_str = ", ".join(f":{s['port']}" for s in online_slots)
                item["status_label"] = (
                    f"Connected ({len(online_slots)}/{enabled_count} Chrome slots {ports_str} · {eng.capitalize()} ready)"
                    if item["tab_open"]
                    else f"Connected ({len(online_slots)}/{enabled_count} Chrome slots {ports_str})"
                )
            else:
                item["status_label"] = "Browser Slots offline — click Launch"
        elif meta["engine"] == "gemini_api":
            item["ready"] = has_gemini_key
            item["status_label"] = "API Key configured" if has_gemini_key else "Requires Gemini API Key in Settings"
        elif meta["engine"] == "openai_api":
            item["ready"] = has_openai_key
            item["status_label"] = "API Key configured" if has_openai_key else "Requires OpenAI API Key in Settings"
        else:
            item["ready"] = False
            item["status_label"] = "Not configured"
        out.append(item)
    return out


def generate_image_for_turn(
    model_id: str,
    prompt_final: str,
    aspect_ratio: str = "1:1",
    reference_path: Optional[str] = None,
    log_fn: Optional[Callable[[str], None]] = None,
    should_abort: Optional[Callable[[], bool]] = None,
    new_chat: bool = True,
    check_ref_similarity: bool = True,
    recycle_tab: bool = False,
    metadata_request: Optional[Dict[str, Any]] = None,
    cdp_port: Optional[int] = None,
    slot_id: int = 1,
) -> Dict[str, Any]:
    """Dispatches a single turn's image generation to the selected provider adapter."""
    from database.db_manager import db
    from modules.image_providers.api_providers import (
        generate_image_via_gemini_api,
        generate_image_via_openai_api,
    )
    from modules.watermark_remover import remove_gemini_watermark_bytes

    meta = PROVIDER_MODELS.get(model_id) or PROVIDER_MODELS["chrome-cdp/gemini"]
    if reference_path and not meta.get("supports_reference_image", True):
        raise ValueError(
            f"Model '{meta['label']}' does not support reference images."
        )

    mode = meta["mode"]
    engine = meta["engine"]

    if mode == "browser_cdp":
        settings = db.get_settings(include_secrets=False)
        watchdog_sec = max(12.0, float(settings.get("cdp_turn_watchdog_sec") or 30.0))
        result = run_cdp_image_turn_isolated(
            engine=engine,
            prompt_final=prompt_final,
            reference_path=reference_path,
            log_fn=log_fn,
            should_abort=should_abort,
            new_chat=new_chat,
            check_ref_similarity=check_ref_similarity,
            watchdog_sec=watchdog_sec,
            recycle_tab=recycle_tab,
            metadata_request=metadata_request,
            cdp_port=cdp_port,
            slot_id=slot_id,
        )
    elif engine == "gemini_api":
        result = generate_image_via_gemini_api(
            prompt_final=prompt_final,
            aspect_ratio=aspect_ratio,
            reference_path=reference_path,
            log_fn=log_fn,
        )
    elif engine == "openai_api":
        result = generate_image_via_openai_api(
            prompt_final=prompt_final,
            aspect_ratio=aspect_ratio,
            reference_path=reference_path,
            log_fn=log_fn,
        )
    else:
        raise ValueError(f"Unsupported model provider: {model_id}")

    # Auto-remove Gemini visible watermark if enabled in Studio Settings
    if engine in ("gemini", "gemini_api"):
        settings = db.get_settings(include_secrets=False)
        if bool(settings.get("remove_watermark", True)):
            wm_res = remove_gemini_watermark_bytes(
                result["raw_bytes"], log_fn=log_fn
            )
            if wm_res.get("applied") and wm_res.get("raw_bytes"):
                cleaned_info = inspect_image_bytes(wm_res["raw_bytes"])
                cleaned_info["raw_bytes"] = wm_res["raw_bytes"]
                cleaned_info["watermark_removed"] = True
                cleaned_info["watermark_meta"] = wm_res.get("meta") or {}
                if result.get("inline_meta"):
                    cleaned_info["inline_meta"] = result["inline_meta"]
                result = cleaned_info

    # Verify similarity against reference input for non-CDP providers too (CDP already enforces before accept)
    if mode != "browser_cdp" and check_ref_similarity and reference_path:
        from pathlib import Path
        ref_file = Path(reference_path)
        if ref_file.exists():
            ref_info = inspect_image_bytes(ref_file.read_bytes())
            sim = measure_image_similarity(result, ref_info)
            if sim["too_similar"]:
                raise ReferenceTooSimilarError(
                    f"Generated image too closely matches input reference ({sim['reason']}).",
                    similarity=sim,
                )

    return result


__all__ = [
    "ProviderAuthError",
    "ReferenceTooSimilarError",
    "check_cdp_status",
    "launch_chrome_ai_master",
    "list_available_providers",
    "generate_image_for_turn",
]
