from io import BytesIO
import json
from pathlib import Path
import shutil
import struct
import subprocess
from typing import Any, Callable, Dict, Optional
import numpy as np
from PIL import Image

from config import BASE_DIR
from database.db_manager import db
from modules.app_logging import logger
from modules.export_manager import _atomic_write_bytes, sync_job_manifest
from modules.reference_sources.image_utils import inspect_image_bytes

GWR_BRIDGE_SCRIPT = BASE_DIR / "modules" / "gwr_bridge.mjs"
GWR_VENDOR_SDK = (
    BASE_DIR
    / "vendor"
    / "gemini-watermark-remover"
    / "src"
    / "sdk"
    / "image-data.js"
)


def _encode_cleaned_pil_image(
    cleaned_rgba: Image.Image,
    orig_format: str,
    exif_bytes: Optional[bytes] = None,
) -> bytes:
    out_buf = BytesIO()
    fmt = (orig_format or "WEBP").upper()
    if fmt in ("JPG", "JPEG"):
        rgb = cleaned_rgba.convert("RGB")
        save_kw: Dict[str, Any] = {"format": "JPEG", "quality": 95}
        if exif_bytes:
            save_kw["exif"] = exif_bytes
        rgb.save(out_buf, **save_kw)
    elif fmt == "PNG":
        cleaned_rgba.save(out_buf, format="PNG")
    else:
        rgb = cleaned_rgba.convert("RGB")
        save_kw_webp: Dict[str, Any] = {"format": "WEBP", "quality": 95}
        if exif_bytes:
            save_kw_webp["exif"] = exif_bytes
        rgb.save(out_buf, **save_kw_webp)
    return out_buf.getvalue()


def _fallback_remove_watermark_numpy(
    rgba_arr: np.ndarray,
) -> tuple[np.ndarray, Dict[str, Any]]:
    """
    Pure-Python NumPy Reverse Alpha Blending fallback if Node.js is unavailable.
    Uses radial 4-point star profile at standard Gemini bottom-right coordinates.
    """
    h, w, _ = rgba_arr.shape
    if w > 1024 and h > 1024:
        size, margin = 96, 64
    elif w >= 500 and h >= 500:
        scale = min(w, h) / 1024.0
        size = max(24, int(round(48 * scale)))
        margin = max(16, int(round(32 * scale)))
    else:
        return rgba_arr, {"applied": False, "skipReason": "image-too-small"}

    x0 = w - margin - size
    y0 = h - margin - size
    if x0 < 0 or y0 < 0:
        return rgba_arr, {"applied": False, "skipReason": "out-of-bounds"}

    # Construct normalized 4-point star alpha template
    coords = np.linspace(-1.0, 1.0, size, dtype=np.float32)
    yy, xx = np.meshgrid(coords, coords, indexing="ij")
    star_dist = np.sqrt(np.abs(xx)) + np.sqrt(np.abs(yy))
    alpha = np.clip((1.05 - star_dist) / 0.65, 0.0, 1.0) ** 1.6 * 0.58
    alpha_3d = alpha[:, :, None]

    out = rgba_arr.copy()
    roi = out[y0 : y0 + size, x0 : x0 + size, :3].astype(np.float32)
    denom = np.maximum(1.0 - alpha_3d, 0.05)
    restored = np.clip((roi - alpha_3d * 255.0) / denom, 0.0, 255.0)
    out[y0 : y0 + size, x0 : x0 + size, :3] = np.round(restored).astype(np.uint8)
    return out, {
        "applied": True,
        "size": size,
        "position": {"x": x0, "y": y0, "width": size, "height": size},
        "source": "numpy-fallback",
    }


def remove_gemini_watermark_bytes(
    raw_bytes: bytes,
    log_fn: Optional[Callable[[str], None]] = None,
) -> Dict[str, Any]:
    """
    Removes visible Google Gemini AI sparkle watermark from `raw_bytes` using
    `GargantuaX/gemini-watermark-remover` (Reverse Alpha Blending + Subpixel/Isophote Polish)
    with automatic pure-Python NumPy fallback.

    Returns:
      {
        "raw_bytes": <cleaned_or_original_bytes>,
        "applied": bool,
        "meta": {...}
      }
    """
    if not raw_bytes or len(raw_bytes) < 1024:
        return {"raw_bytes": raw_bytes, "applied": False, "meta": {"skipReason": "empty"}}

    try:
        with Image.open(BytesIO(raw_bytes)) as im:
            orig_format = (im.format or "WEBP").upper()
            exif_bytes = im.info.get("exif")
            rgba_im = im.convert("RGBA")
            width, height = rgba_im.size
            raw_rgba = rgba_im.tobytes()
    except Exception as exc:
        logger.debug("Watermark remover could not decode image bytes: %s", exc)
        return {"raw_bytes": raw_bytes, "applied": False, "meta": {"error": str(exc)}}

    node_bin = shutil.which("node")
    if node_bin and GWR_BRIDGE_SCRIPT.exists() and GWR_VENDOR_SDK.exists():
        try:
            payload = struct.pack("<II", width, height) + raw_rgba
            proc = subprocess.run(
                [node_bin, str(GWR_BRIDGE_SCRIPT)],
                input=payload,
                capture_output=True,
                cwd=str(BASE_DIR),
                timeout=15,
            )
            if proc.returncode == 0 and len(proc.stdout) == width * height * 4:
                meta: Dict[str, Any] = {}
                stderr_text = proc.stderr.decode("utf-8", errors="replace").strip()
                if stderr_text:
                    try:
                        meta = json.loads(stderr_text.splitlines()[-1])
                    except Exception:
                        meta = {"raw_stderr": stderr_text[:200]}

                if not meta.get("applied"):
                    return {
                        "raw_bytes": raw_bytes,
                        "applied": False,
                        "meta": meta,
                    }

                cleaned_im = Image.frombytes("RGBA", (width, height), proc.stdout)
                cleaned_bytes = _encode_cleaned_pil_image(
                    cleaned_im, orig_format=orig_format, exif_bytes=exif_bytes
                )
                if log_fn:
                    pos = meta.get("position") or {}
                    log_fn(
                        f"Removed Gemini watermark ({meta.get('size', '?')}px at "
                        f"x={pos.get('x', '?')}, y={pos.get('y', '?')}, gain={meta.get('alphaGain', '?')})."
                    )
                return {
                    "raw_bytes": cleaned_bytes,
                    "applied": True,
                    "meta": meta,
                }
        except Exception as exc:
            logger.warning("Node GWR bridge fallback triggered: %s", exc)

    # Pure-Python NumPy fallback if Node.js is unavailable
    try:
        arr = np.frombuffer(raw_rgba, dtype=np.uint8).reshape((height, width, 4))
        cleaned_arr, fb_meta = _fallback_remove_watermark_numpy(arr)
        if not fb_meta.get("applied"):
            return {"raw_bytes": raw_bytes, "applied": False, "meta": fb_meta}
        cleaned_im = Image.fromarray(cleaned_arr, mode="RGBA")
        cleaned_bytes = _encode_cleaned_pil_image(
            cleaned_im, orig_format=orig_format, exif_bytes=exif_bytes
        )
        if log_fn:
            log_fn(f"Removed Gemini watermark via NumPy fallback ({fb_meta.get('size')}px).")
        return {
            "raw_bytes": cleaned_bytes,
            "applied": True,
            "meta": fb_meta,
        }
    except Exception as exc:
        logger.warning("Watermark removal skipped due to error: %s", exc)
        return {"raw_bytes": raw_bytes, "applied": False, "meta": {"error": str(exc)}}


def remove_watermark_for_generation(generation_id: int) -> Optional[Dict[str, Any]]:
    """
    Removes the Gemini watermark from an already-saved generation file on disk,
    updates SQLite metadata (`md5`, `dhash`, `file_size`, `updated_at`), and syncs manifest/sidecar.
    """
    gen = db.get_generation(generation_id)
    if not gen:
        return None
    img_path_str = gen.get("image_path") or ""
    if not img_path_str:
        return {"applied": False, "generation": gen, "reason": "no_image_path"}

    img_path = Path(img_path_str)
    try:
        if not img_path.exists():
            return {"applied": False, "generation": gen, "reason": "file_missing"}
        orig_bytes = img_path.read_bytes()
    except (PermissionError, OSError) as exc:
        logger.debug("Skipping watermark removal for %s: %s", img_path, exc)
        return {"applied": False, "generation": gen, "reason": "permission_denied"}
    res = remove_gemini_watermark_bytes(orig_bytes)
    if res["applied"]:
        _atomic_write_bytes(img_path, res["raw_bytes"])
        info = inspect_image_bytes(res["raw_bytes"])
        updated_gen = db.update_generation(
            generation_id,
            width=info["width"],
            height=info["height"],
            file_size=info["file_size"],
            md5=info["md5"],
            dhash=info["dhash"],
        )
        job_id = int(gen["job_id"])
        pos = res["meta"].get("position") or {}
        db.log_activity(
            f"Removed Gemini watermark on #{int(gen['index_num']):03d} ({img_path.name}, "
            f"{res['meta'].get('size', '?')}px at {pos.get('x', '?')},{pos.get('y', '?')}).",
            stage="WATERMARK",
            job_id=job_id,
            generation_id=generation_id,
        )
        sync_job_manifest(job_id)
        return {
            "applied": True,
            "meta": res["meta"],
            "generation": updated_gen or db.get_generation(generation_id),
        }

    return {
        "applied": False,
        "meta": res["meta"],
        "generation": gen,
    }


def remove_watermarks_for_job(job_id: int) -> Optional[Dict[str, Any]]:
    """
    Batch-processes all completed/saved images in a job to remove Gemini watermarks,
    updating SQLite hashes and syncing disk manifests.
    """
    job = db.get_job(job_id)
    if not job:
        return None

    cleaned_count = 0
    skipped_count = 0
    for gen in job.get("generations") or []:
        img_path_str = gen.get("image_path") or ""
        if not img_path_str or not Path(img_path_str).exists():
            continue
        res = remove_watermark_for_generation(gen["id"])
        if res and res.get("applied"):
            cleaned_count += 1
        else:
            skipped_count += 1

    sync_job_manifest(job_id)
    return {
        "job": db.get_job(job_id),
        "cleaned_count": cleaned_count,
        "skipped_count": skipped_count,
    }
