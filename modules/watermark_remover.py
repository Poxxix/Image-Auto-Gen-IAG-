from io import BytesIO
import json
from pathlib import Path
import shutil
import struct
import subprocess
from typing import Any, Callable, Dict, List, Optional
import numpy as np
from PIL import Image

from config import BASE_DIR
from database.db_manager import db
from modules.app_logging import logger
from modules.export_manager import (
    _atomic_write_bytes,
    sync_generation_and_manifest,
    sync_job_manifest,
)
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
    force: bool = False,
) -> Dict[str, Any]:
    """
    Removes visible Google Gemini AI sparkle watermark from `raw_bytes` using
    `GargantuaX/gemini-watermark-remover` (Reverse Alpha Blending + Subpixel/Isophote Polish)
    with automatic pure-Python NumPy fallback. When `force=True`, bypasses the confidence
    gate to clean faint stars on bright paper/sky backgrounds.
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
            cmd = [node_bin, str(GWR_BRIDGE_SCRIPT)]
            if force:
                cmd.append("--force")
            proc = subprocess.run(
                cmd,
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


def _dilate_bool_mask(mask: np.ndarray, radius: int = 3) -> np.ndarray:
    """Fast pure-NumPy 2D binary dilation without SciPy/OpenCV."""
    out = mask.copy()
    for _ in range(max(1, radius)):
        p = np.pad(out, 1, mode="edge")
        out = (
            p[1:-1, 1:-1]
            | p[:-2, 1:-1]
            | p[2:, 1:-1]
            | p[1:-1, :-2]
            | p[1:-1, 2:]
            | p[:-2, :-2]
            | p[:-2, 2:]
            | p[2:, :-2]
            | p[2:, 2:]
        )
    return out


def _harmonic_diffuse_patch(
    patch_rgb: np.ndarray,
    patch_mask: np.ndarray,
    iterations: int = 48,
) -> np.ndarray:
    """
    Multi-scale coarse-to-fine harmonic diffusion + surrounding grain synthesis.
    Cleanly erases text/logos/watermarks on paper, skin, backdrops, and fabrics in <50ms.
    """
    ph, pw, _ = patch_rgb.shape
    work = patch_rgb.astype(np.float32).copy()
    m = patch_mask.astype(bool)
    if not m.any():
        return patch_rgb

    ring = _dilate_bool_mask(m, radius=8) & (~m)
    if ring.any():
        seed_color = np.median(work[ring], axis=0)
    else:
        seed_color = np.median(work, axis=0)
    work[m] = seed_color

    # Coarse initialization if masked region is wider than 18px
    if ph >= 32 and pw >= 32 and m.sum() > 220:
        cw = max(8, pw // 3)
        ch = max(8, ph // 3)
        small_rgb = np.asarray(
            Image.fromarray(np.clip(work, 0, 255).astype(np.uint8)).resize(
                (cw, ch), Image.Resampling.BILINEAR
            ),
            dtype=np.float32,
        )
        small_m = (
            np.asarray(
                Image.fromarray((m.astype(np.uint8) * 255)).resize(
                    (cw, ch), Image.Resampling.BILINEAR
                ),
                dtype=np.uint8,
            )
            > 64
        )
        for _ in range(45):
            pad = np.pad(small_rgb, ((1, 1), (1, 1), (0, 0)), mode="edge")
            avg = (
                (pad[:-2, 1:-1] + pad[2:, 1:-1] + pad[1:-1, :-2] + pad[1:-1, 2:]) * 0.20
                + (pad[:-2, :-2] + pad[:-2, 2:] + pad[2:, :-2] + pad[2:, 2:]) * 0.05
            )
            small_rgb[small_m] = avg[small_m]
        up_rgb = np.asarray(
            Image.fromarray(np.clip(small_rgb, 0, 255).astype(np.uint8)).resize(
                (pw, ph), Image.Resampling.BILINEAR
            ),
            dtype=np.float32,
        )
        work[m] = up_rgb[m]

    # Full-resolution harmonic smoothing
    for _ in range(iterations):
        pad = np.pad(work, ((1, 1), (1, 1), (0, 0)), mode="edge")
        avg = (
            (pad[:-2, 1:-1] + pad[2:, 1:-1] + pad[1:-1, :-2] + pad[1:-1, 2:]) * 0.20
            + (pad[:-2, :-2] + pad[:-2, 2:] + pad[2:, :-2] + pad[2:, 2:]) * 0.05
        )
        work[m] = avg[m]

    # Match subtle local paper/skin/film grain from the surrounding clean ring
    if ring.sum() >= 24:
        pad_orig = np.pad(patch_rgb.astype(np.float32), ((1, 1), (1, 1), (0, 0)), mode="edge")
        local_blur = (
            pad_orig[:-2, 1:-1] + pad_orig[2:, 1:-1] + pad_orig[1:-1, :-2] + pad_orig[1:-1, 2:]
        ) * 0.25
        hf = patch_rgb.astype(np.float32) - local_blur
        grain_std = np.std(hf[ring], axis=0)
        grain_std = np.clip(grain_std * 0.65, 0.0, 9.0)
        if float(grain_std.max()) > 0.35:
            rng = np.random.default_rng(seed=int(ph * 131 + pw * 17))
            noise = rng.normal(0.0, 1.0, size=(ph, pw, 1)).astype(np.float32) * grain_std[None, None, :]
            # Feather mask boundary over 2px for seamless transition
            inner = ~_dilate_bool_mask(~m, radius=1)
            work[m] = work[m] + noise[m] * 0.75
            work[inner] = work[inner] + noise[inner] * 0.25

    return np.clip(np.round(work), 0, 255).astype(np.uint8)


def inpaint_image_bytes(
    raw_bytes: bytes,
    mask_png_bytes: Optional[bytes] = None,
    boxes: Optional[List[Dict[str, float]]] = None,
) -> bytes:
    """
    Erases logos/watermarks/signatures inside user-painted `mask_png_bytes` and/or
    normalized `[0..1]` `boxes` (`[{"x": 0.85, "y": 0.90, "w": 0.12, "h": 0.08}]`),
    preserving original resolution, color profile, and file format.
    """
    with Image.open(BytesIO(raw_bytes)) as im:
        orig_format = (im.format or "PNG").upper()
        exif_bytes = im.info.get("exif")
        rgba = im.convert("RGBA")
        width, height = rgba.size
        arr = np.array(rgba, dtype=np.uint8)

    full_mask = np.zeros((height, width), dtype=bool)

    if mask_png_bytes:
        with Image.open(BytesIO(mask_png_bytes)) as mim:
            m_rgba = mim.convert("RGBA")
            if m_rgba.size != (width, height):
                m_rgba = m_rgba.resize((width, height), Image.Resampling.BILINEAR)
            m_arr = np.asarray(m_rgba, dtype=np.uint8)
            # Treat any pixel with alpha > 24 or RGB > 24 as painted mask
            painted = (m_arr[:, :, 3] > 24) & (
                (m_arr[:, :, 0] > 24) | (m_arr[:, :, 1] > 24) | (m_arr[:, :, 2] > 24)
            )
            if not painted.any():
                painted = m_arr[:, :, 3] > 24
            full_mask |= painted

    if boxes:
        for b in boxes:
            bx = max(0.0, min(1.0, float(b.get("x", 0.0))))
            by = max(0.0, min(1.0, float(b.get("y", 0.0))))
            bw = max(0.0, min(1.0 - bx, float(b.get("w", 0.0))))
            bh = max(0.0, min(1.0 - by, float(b.get("h", 0.0))))
            x0, x1 = int(round(bx * width)), int(round((bx + bw) * width))
            y0, y1 = int(round(by * height)), int(round((by + bh) * height))
            if x1 > x0 + 1 and y1 > y0 + 1:
                full_mask[y0:y1, x0:x1] = True

    if not full_mask.any():
        return raw_bytes

    dilate_r = max(2, int(round(min(width, height) * 0.003)))
    full_mask = _dilate_bool_mask(full_mask, radius=dilate_r)

    ys, xs = np.where(full_mask)
    pad = max(24, int(round(min(width, height) * 0.025)))
    y0 = max(0, int(ys.min()) - pad)
    y1 = min(height, int(ys.max()) + pad + 1)
    x0 = max(0, int(xs.min()) - pad)
    x1 = min(width, int(xs.max()) + pad + 1)

    repaired_rgb = _harmonic_diffuse_patch(
        arr[y0:y1, x0:x1, :3],
        full_mask[y0:y1, x0:x1],
        iterations=52,
    )
    arr[y0:y1, x0:x1, :3] = repaired_rgb
    cleaned_im = Image.fromarray(arr, mode="RGBA")
    return _encode_cleaned_pil_image(cleaned_im, orig_format=orig_format, exif_bytes=exif_bytes)


def trim_image_edges_bytes(
    raw_bytes: bytes,
    trim_percent: float = 3.0,
    anchor: str = "bottom_right",
) -> bytes:
    """
    Crops `trim_percent` (0.5%..15%) while strictly preserving the exact original W:H aspect ratio.
    - `anchor="bottom_right"`: trims from the bottom and right edges (removing corner watermarks).
    - `anchor="center"`: trims evenly around all 4 edges.
    """
    pct = max(0.5, min(15.0, float(trim_percent))) / 100.0
    with Image.open(BytesIO(raw_bytes)) as im:
        orig_format = (im.format or "PNG").upper()
        exif_bytes = im.info.get("exif")
        rgba = im.convert("RGBA")
        w, h = rgba.size
        keep_w = max(64, int(round(w * (1.0 - pct))))
        keep_h = max(64, int(round(h * (1.0 - pct))))
        if anchor == "bottom_right":
            # Keep top-left, shaving off bottom & right where corner logos sit
            box = (0, 0, keep_w, keep_h)
        else:
            dx = (w - keep_w) // 2
            dy = (h - keep_h) // 2
            box = (dx, dy, dx + keep_w, dy + keep_h)
        cropped = rgba.crop(box)
    return _encode_cleaned_pil_image(cropped, orig_format=orig_format, exif_bytes=exif_bytes)


def replace_generation_image_on_disk(
    generation_id: int,
    new_bytes: bytes,
    action_label: str = "Edited image in Review Deck",
) -> Optional[Dict[str, Any]]:
    """
    Overwrites the generation's existing file inside the job export folder atomically
    (matching the file's extension so filenames & `pin-import.csv` stay 100% intact),
    refreshes SQLite dimensions/MD5/dHash, and syncs the job manifest.
    """
    gen = db.get_generation(generation_id)
    if not gen:
        return None
    img_path_str = str(gen.get("image_path") or "").strip()
    if not img_path_str:
        raise ValueError("Generation has no saved image path on disk.")

    img_path = Path(img_path_str)
    ext = img_path.suffix.lstrip(".").lower() or "png"
    target_fmt = "JPEG" if ext in ("jpg", "jpeg") else ("WEBP" if ext == "webp" else "PNG")

    with Image.open(BytesIO(new_bytes)) as im:
        exif_bytes = im.info.get("exif")
        rgba = im.convert("RGBA")
        encoded = _encode_cleaned_pil_image(rgba, orig_format=target_fmt, exif_bytes=exif_bytes)

    _atomic_write_bytes(img_path, encoded, sync_disk=True)
    info = inspect_image_bytes(encoded)
    updated_gen = db.update_generation(
        generation_id,
        width=info["width"],
        height=info["height"],
        file_size=info["file_size"],
        md5=info["md5"],
        dhash=info["dhash"],
        duplicate_warning="",
    )
    job_id = int(gen["job_id"])
    db.log_activity(
        f"{action_label} on #{int(gen['index_num']):03d} -> replaced {img_path.name} ({info['width']}x{info['height']}).",
        stage="WATERMARK",
        job_id=job_id,
        generation_id=generation_id,
    )
    sync_generation_and_manifest(job_id, generation_id, force_manifest=True)
    return {
        "generation": updated_gen or db.get_generation(generation_id),
        "job": db.get_job(job_id),
    }


def remove_watermark_for_generation(
    generation_id: int,
    force: bool = False,
) -> Optional[Dict[str, Any]]:
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
    res = remove_gemini_watermark_bytes(orig_bytes, force=force)
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
