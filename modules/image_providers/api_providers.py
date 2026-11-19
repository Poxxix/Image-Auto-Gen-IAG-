import base64
from pathlib import Path
from typing import Any, Callable, Dict, Optional
import requests

from database.db_manager import db
from modules.image_providers.browser_cdp_provider import ProviderAuthError
from modules.reference_sources.image_utils import inspect_image_bytes


def generate_image_via_gemini_api(
    prompt_final: str,
    aspect_ratio: str = "1:1",
    reference_path: Optional[str] = None,
    log_fn: Optional[Callable[[str], None]] = None,
) -> Dict[str, Any]:
    """Generates an image using the official Google Gemini / Imagen REST API."""
    settings = db.get_settings(include_secrets=True)
    api_key = str(settings.get("gemini_api_key") or "").strip()
    if not api_key:
        raise ProviderAuthError(
            "Gemini API Key is not configured. Add your key in Settings or select 'Gemini · Browser CDP (:9222)'."
        )

    if log_fn:
        log_fn("Calling Google Gemini / Imagen official REST API...")

    # Try Gemini 2.0 Flash image generation / Imagen 3 endpoint
    url = f"https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key={api_key}"
    payload = {
        "instances": [{"prompt": prompt_final}],
        "parameters": {
            "sampleCount": 1,
            "aspectRatio": aspect_ratio if aspect_ratio in ("1:1", "4:3", "3:4", "16:9", "9:16") else "1:1",
        },
    }
    resp = requests.post(url, json=payload, timeout=90)
    if resp.status_code != 200:
        raise RuntimeError(
            f"Gemini Imagen API returned HTTP {resp.status_code}: {resp.text[:240]}"
        )
    data = resp.json()
    predictions = data.get("predictions") or []
    if not predictions or not predictions[0].get("bytesBase64Encoded"):
        raise RuntimeError("Gemini Imagen API response did not contain image bytes.")

    raw_bytes = base64.b64decode(predictions[0]["bytesBase64Encoded"])
    info = inspect_image_bytes(raw_bytes)
    info["raw_bytes"] = raw_bytes
    return info


def generate_image_via_openai_api(
    prompt_final: str,
    aspect_ratio: str = "1:1",
    reference_path: Optional[str] = None,
    log_fn: Optional[Callable[[str], None]] = None,
) -> Dict[str, Any]:
    """Generates an image using the official OpenAI Images API (gpt-image-1 / dall-e-3)."""
    settings = db.get_settings(include_secrets=True)
    api_key = str(settings.get("openai_api_key") or "").strip()
    if not api_key:
        raise ProviderAuthError(
            "OpenAI API Key is not configured. Add your key in Settings or select a Browser CDP (:9222) model."
        )

    if log_fn:
        log_fn("Calling OpenAI Images REST API...")

    size_map = {
        "1:1": "1024x1024",
        "4:5": "1024x1536",
        "9:16": "1024x1536",
        "16:9": "1536x1024",
        "3:2": "1536x1024",
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": "gpt-image-1",
        "prompt": prompt_final,
        "n": 1,
        "size": size_map.get(aspect_ratio, "1024x1024"),
    }
    resp = requests.post(
        "https://api.openai.com/v1/images/generations",
        headers=headers,
        json=payload,
        timeout=90,
    )
    if resp.status_code != 200:
        raise RuntimeError(
            f"OpenAI Images API returned HTTP {resp.status_code}: {resp.text[:240]}"
        )
    data = resp.json()
    items = data.get("data") or []
    if not items:
        raise RuntimeError("OpenAI Images API returned empty data list.")

    first = items[0]
    if first.get("b64_json"):
        raw_bytes = base64.b64decode(first["b64_json"])
    elif first.get("url"):
        dl = requests.get(first["url"], timeout=30)
        raw_bytes = dl.content
    else:
        raise RuntimeError("OpenAI response contained neither b64_json nor url.")

    info = inspect_image_bytes(raw_bytes)
    info["raw_bytes"] = raw_bytes
    return info
