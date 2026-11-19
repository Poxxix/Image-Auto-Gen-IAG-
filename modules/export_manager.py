from io import BytesIO
import json
import os
import platform
import subprocess
import tempfile
import threading
import time
import zipfile
from pathlib import Path
from typing import Any, Dict, Optional
from PIL import Image

from database.db_manager import db, now_iso
from modules.reference_sources.image_utils import inspect_image_bytes

_MANIFEST_LOCK = threading.Lock()
_MANIFEST_LAST_WRITE: Dict[int, float] = {}


def _safe_mkdir(directory: Path) -> None:
    try:
        directory.mkdir(parents=True, exist_ok=True)
    except (FileExistsError, PermissionError, OSError):
        pass


def _atomic_write_bytes(dest_path: Path, data: bytes, sync_disk: bool = False) -> None:
    _safe_mkdir(dest_path.parent)
    tmp_path = dest_path.parent / f".{dest_path.name}.tmp"
    with open(tmp_path, "wb") as f:
        f.write(data)
        f.flush()
        if sync_disk:
            os.fsync(f.fileno())
    os.replace(tmp_path, dest_path)


def _atomic_write_json(dest_path: Path, payload: Dict[str, Any]) -> None:
    raw = json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8")
    _atomic_write_bytes(dest_path, raw)


def _atomic_write_text(dest_path: Path, text: str) -> None:
    _atomic_write_bytes(dest_path, text.encode("utf-8"))


def _format_reference_for_export(ref: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """
    Formats reference provenance for sidecar JSON and manifest.json without
    copying external/Pinterest files into the export directory.
    """
    if not ref:
        return None
    return {
        "id": ref.get("id"),
        "source_type": ref.get("source_type"),
        "source_ref": ref.get("source_ref") or ref.get("filename"),
        "filename": ref.get("filename"),
        "usage_rights": ref.get("usage_rights") or "user_provided_confirmed",
    }


def save_generated_image_atomically(
    job: Dict[str, Any],
    index_num: int,
    raw_bytes: bytes,
    preferred_format: str = "original",
    precomputed_info: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Saves a generated image atomically (`*.tmp` -> `001_<slug>.<ext>`) inside `job['export_dir']`.
    Preserves original model bytes and provenance by default (`preferred_format='original'`).
    """
    export_dir = Path(job["export_dir"])
    export_dir.mkdir(parents=True, exist_ok=True)
    slug = job["slug"]
    prefix = f"{int(index_num):03d}_{slug}"

    orig_info = (
        precomputed_info
        if precomputed_info
        and precomputed_info.get("width")
        and precomputed_info.get("ext")
        and precomputed_info.get("md5")
        else inspect_image_bytes(raw_bytes)
    )
    target_fmt = (preferred_format or "original").lower().strip()

    if target_fmt in ("original", "", orig_info["ext"]):
        final_bytes = raw_bytes
        ext = orig_info["ext"]
        final_info = orig_info
    else:
        with Image.open(BytesIO(raw_bytes)) as im:
            exif_bytes = im.info.get("exif")
            out_buf = BytesIO()
            if target_fmt in ("jpg", "jpeg"):
                ext = "jpg"
                rgb = im.convert("RGB")
                save_kw: Dict[str, Any] = {"format": "JPEG", "quality": 95}
                if exif_bytes:
                    save_kw["exif"] = exif_bytes
                rgb.save(out_buf, **save_kw)
            elif target_fmt == "webp":
                ext = "webp"
                im.save(out_buf, format="WEBP", quality=95)
            else:
                ext = "png"
                im.save(out_buf, format="PNG")
            final_bytes = out_buf.getvalue()
        final_info = inspect_image_bytes(final_bytes)

    image_file = f"{prefix}.{ext}"
    sidecar_file = f"{prefix}.json"
    caption_file = f"{prefix}.txt"
    image_path = export_dir / image_file

    # Remove any older extension variant if a retry produced a different extension
    for old_ext in ("png", "jpg", "jpeg", "webp"):
        candidate_old = export_dir / f"{prefix}.{old_ext}"
        if candidate_old != image_path and candidate_old.exists():
            try:
                candidate_old.unlink()
            except Exception:
                pass

    _atomic_write_bytes(image_path, final_bytes, sync_disk=True)

    return {
        "image_file": image_file,
        "image_path": str(image_path),
        "sidecar_file": sidecar_file,
        "caption_file": caption_file,
        "mime_type": final_info["mime_type"],
        "width": final_info["width"],
        "height": final_info["height"],
        "file_size": final_info["file_size"],
        "md5": final_info["md5"],
        "dhash": final_info["dhash"],
    }


def format_caption_text(job: Dict[str, Any], generation: Dict[str, Any]) -> str:
    """
    Formats a single image's Pinterest / Social caption & description into clean,
    copy-paste-ready plain text.
    """
    idx = int(generation.get("index_num") or 1)
    title = (generation.get("title") or "").strip()
    caption = (generation.get("caption") or title).strip()
    description = (generation.get("description") or "").strip()
    hashtags = (generation.get("hashtags") or "").strip()
    img_file = (generation.get("image_file") or f"{idx:03d}_{job['slug']}").strip()

    lines = [
        f"=== #{idx:03d} · {img_file} ===",
        f"Title: {title}",
    ]
    if caption and caption != title:
        lines.append(f"Caption: {caption}")
    lines.append("")
    lines.append("Description:")
    lines.append(description)
    if hashtags and hashtags not in description:
        lines.append("")
        lines.append(f"Hashtags: {hashtags}")
    lines.append("")
    return "\n".join(lines)


def write_caption_txt(job: Dict[str, Any], generation: Dict[str, Any]) -> Path:
    """Writes `<NNN>_<slug>.txt` alongside the image file when in 'caption' export mode."""
    export_dir = Path(job["export_dir"])
    export_dir.mkdir(parents=True, exist_ok=True)
    slug = job["slug"]
    idx = int(generation["index_num"])
    caption_name = generation.get("caption_file") or f"{idx:03d}_{slug}.txt"
    caption_path = export_dir / caption_name

    content = format_caption_text(job, generation)
    _atomic_write_text(caption_path, content)
    return caption_path


def write_sidecar_json(job: Dict[str, Any], generation: Dict[str, Any]) -> Path:
    """
    Writes `<NNN>_<slug>.json` alongside the image file when in 'json' export mode.
    """
    export_dir = Path(job["export_dir"])
    export_dir.mkdir(parents=True, exist_ok=True)
    slug = job["slug"]
    idx = int(generation["index_num"])
    sidecar_name = generation.get("sidecar_file") or f"{idx:03d}_{slug}.json"
    sidecar_path = export_dir / sidecar_name

    payload: Dict[str, Any] = {
        "index": idx,
        "title": generation.get("title") or "",
        "caption": generation.get("caption") or generation.get("title") or "",
        "description": generation.get("description") or "",
        "hashtags": generation.get("hashtags") or "",
        "prompt_final": generation.get("prompt_final") or "",
        "reference": _format_reference_for_export(generation.get("reference")),
        "model": generation.get("model") or job.get("model") or "chrome-cdp/gemini",
        "status": generation.get("status") or "planned",
        "image_file": generation.get("image_file") or "",
        "variation_axes": generation.get("variation_axes") or {},
        "fixed_elements": generation.get("fixed_elements") or {},
        "width": generation.get("width") or 0,
        "height": generation.get("height") or 0,
        "md5": generation.get("md5") or "",
        "dhash": generation.get("dhash") or "",
        "duplicate_warning": generation.get("duplicate_warning") or "",
        "updated_at": generation.get("updated_at") or now_iso(),
    }
    _atomic_write_json(sidecar_path, payload)
    return sidecar_path


def sync_job_manifest(
    job_id: int,
    job: Optional[Dict[str, Any]] = None,
    rewrite_all_sidecars: bool = True,
) -> Optional[Path]:
    """
    Synchronizes the export directory on disk according to `job['metadata_export_mode']`:
    - 'json': writes `<NNN>_<slug>.json` sidecars + `manifest.json` (removes `.txt` caption files).
    - 'caption': writes `<NNN>_<slug>.txt` caption files + `captions.txt` (removes `.json` sidecars).
    - 'none': removes `.json` and `.txt` files so only the generated images remain on disk.
    Never writes API keys or sensitive credentials into exported files.
    """
    job_data = job or db.get_job(job_id)
    if not job_data:
        return None

    export_dir = Path(job_data["export_dir"])
    _safe_mkdir(export_dir)
    export_mode = (job_data.get("metadata_export_mode") or "json").strip().lower()
    slug = job_data["slug"]
    manifest_path = export_dir / "manifest.json"
    captions_bundle_path = export_dir / "captions.txt"

    try:
        if export_mode == "none":
            # Remove any sidecar JSON or TXT files so only pure image files exist in export_dir
            if export_dir.exists():
                for child in export_dir.iterdir():
                    if child.is_file() and child.suffix.lower() in (".json", ".txt"):
                        try:
                            child.unlink()
                        except Exception:
                            pass
            return None

        if export_mode == "caption":
            if rewrite_all_sidecars and export_dir.exists():
                for child in export_dir.iterdir():
                    if child.is_file() and child.suffix.lower() == ".json":
                        try:
                            child.unlink()
                        except Exception:
                            pass

            bundle_blocks = [
                f"============================================================",
                f"PINTEREST & SOCIAL CAPTIONS · {job_data['theme'].upper()}",
                f"Set #{job_data['id']} · Language: {job_data.get('metadata_language') or 'English'}",
                f"============================================================\n",
            ]
            for gen in job_data.get("generations") or []:
                if gen.get("image_file"):
                    if rewrite_all_sidecars:
                        write_caption_txt(job_data, gen)
                    bundle_blocks.append(format_caption_text(job_data, gen))

            _atomic_write_text(captions_bundle_path, "\n".join(bundle_blocks))
            return captions_bundle_path

        # Default 'json' mode: remove stale .txt caption files if switched from 'caption' mode
        if rewrite_all_sidecars and export_dir.exists():
            for child in export_dir.iterdir():
                if child.is_file() and child.suffix.lower() == ".txt":
                    try:
                        child.unlink()
                    except Exception:
                        pass

        items = []
        for gen in job_data.get("generations") or []:
            idx = int(gen["index_num"])
            sidecar_rel = gen.get("sidecar_file") or (
                f"{idx:03d}_{slug}.json" if gen.get("image_file") else ""
            )
            if gen.get("image_file") and rewrite_all_sidecars:
                write_sidecar_json(job_data, gen)
            items.append(
                {
                    "index": idx,
                    "generation_id": gen["id"],
                    "title": gen.get("title") or "",
                    "caption": gen.get("caption") or gen.get("title") or "",
                    "description": gen.get("description") or "",
                    "hashtags": gen.get("hashtags") or "",
                    "prompt_final": gen.get("prompt_final") or "",
                    "reference": _format_reference_for_export(gen.get("reference")),
                    "model": gen.get("model") or job_data.get("model"),
                    "status": gen.get("status"),
                    "image_file": gen.get("image_file") or "",
                    "sidecar_file": sidecar_rel,
                    "variation_axes": gen.get("variation_axes") or {},
                    "width": gen.get("width") or 0,
                    "height": gen.get("height") or 0,
                    "md5": gen.get("md5") or "",
                    "dhash": gen.get("dhash") or "",
                    "duplicate_warning": gen.get("duplicate_warning") or "",
                    "error": gen.get("error") or "",
                }
            )

        manifest_payload: Dict[str, Any] = {
            "job_id": job_data["id"],
            "theme": job_data["theme"],
            "slug": slug,
            "base_prompt": job_data.get("base_prompt") or "",
            "status": job_data["status"],
            "created_at": job_data["created_at"],
            "updated_at": job_data["updated_at"],
            "completed_at": job_data.get("completed_at"),
            "settings": {
                "reference_mode": job_data.get("reference_mode"),
                "run_mode": job_data.get("run_mode"),
                "target_count": job_data.get("target_count"),
                "batch_size": job_data.get("batch_size"),
                "session_cap": job_data.get("session_cap"),
                "cycle_references": job_data.get("cycle_references"),
                "aspect_ratio": job_data.get("aspect_ratio"),
                "metadata_language": job_data.get("metadata_language"),
                "metadata_export_mode": export_mode,
                "caption_prompt": job_data.get("caption_prompt") or "",
                "use_ai_caption_prompt": job_data.get("use_ai_caption_prompt", True),
                "optimize_prompt_english": job_data.get("optimize_prompt_english"),
                "model": job_data.get("model"),
                "preset_id": job_data.get("preset_id") or "",
                "fixed_elements": job_data.get("fixed_elements") or {},
            },
            "counts": job_data.get("counts") or {},
            "generations": items,
        }
        _atomic_write_json(manifest_path, manifest_payload)
        return manifest_path
    except PermissionError:
        return None
    except OSError:
        return None


def sync_generation_and_manifest(
    job_id: int,
    generation_id: int,
    force_manifest: bool = False,
) -> None:
    """
    Updates ONLY the single generation's sidecar/caption file immediately, and
    throttles full `manifest.json` / `captions.txt` rewrites for large sets (100–1000 items)
    so per-turn disk I/O stays O(1) while final/pause/export calls always flush in full.
    """
    job = db.get_job(job_id)
    if not job:
        return
    gens = job.get("generations") or []
    export_mode = (job.get("metadata_export_mode") or "json").strip().lower()
    if export_mode != "none":
        target_gen = next(
            (g for g in gens if g["id"] == generation_id),
            None,
        )
        if target_gen and target_gen.get("image_file"):
            try:
                if export_mode == "caption":
                    write_caption_txt(job, target_gen)
                else:
                    write_sidecar_json(job, target_gen)
            except OSError:
                pass

    now = time.time()
    with _MANIFEST_LOCK:
        last_ts = _MANIFEST_LAST_WRITE.get(job_id, 0.0)
        should_write = force_manifest or len(gens) <= 30 or (now - last_ts) >= 4.0
        if should_write:
            _MANIFEST_LAST_WRITE[job_id] = now

    if should_write:
        sync_job_manifest(job_id, job=job, rewrite_all_sidecars=False)


def cleanup_and_resequence_after_delete_generation(
    job_id: int,
    delete_result: Dict[str, Any],
) -> None:
    """
    Removes the deleted generation's files on disk and renames any re-indexed sibling
    files (`002_<slug>.png` -> `001_<slug>.png`, `.json`, `.txt`) so disk files and DB stay
    100% synchronized.
    """
    job = db.get_job(job_id)
    if not job:
        return
    export_dir = Path(job["export_dir"])
    slug = job["slug"]

    deleted = delete_result.get("deleted") or {}
    for fname_key in ("image_file", "sidecar_file", "caption_file"):
        fname = deleted.get(fname_key)
        if fname:
            fpath = export_dir / fname
            if fpath.exists():
                try:
                    fpath.unlink()
                except Exception:
                    pass
    if deleted.get("image_path"):
        p = Path(deleted["image_path"])
        if p.exists():
            try:
                p.unlink()
            except Exception:
                pass

    # Rename files for any re-indexed generations in ascending order
    for item in delete_result.get("reindexed") or []:
        gen_id = item["id"]
        old_idx = int(item["old_index"])
        new_idx = int(item["new_index"])
        old_img_file = item.get("image_file") or ""
        old_sidecar = item.get("sidecar_file") or f"{old_idx:03d}_{slug}.json"
        old_caption = item.get("caption_file") or f"{old_idx:03d}_{slug}.txt"

        updates: Dict[str, Any] = {}
        if old_img_file:
            ext = Path(old_img_file).suffix.lstrip(".") or "png"
            new_img_file = f"{new_idx:03d}_{slug}.{ext}"
            old_img_path = export_dir / old_img_file
            new_img_path = export_dir / new_img_file
            if old_img_path.exists() and old_img_path != new_img_path:
                try:
                    os.replace(old_img_path, new_img_path)
                except Exception:
                    pass
            updates["image_file"] = new_img_file
            updates["image_path"] = str(new_img_path)
            updates["sidecar_file"] = f"{new_idx:03d}_{slug}.json"
            updates["caption_file"] = f"{new_idx:03d}_{slug}.txt"

        for old_aux in (old_sidecar, old_caption):
            aux_path = export_dir / old_aux
            if aux_path.exists():
                try:
                    aux_path.unlink()
                except Exception:
                    pass

        if updates:
            db.update_generation(gen_id, **updates)

    sync_job_manifest(job_id)


def build_job_zip_file(job_id: int) -> tuple[Path, str]:
    """
    Packages all exported files inside `job['export_dir']` into a temporary ZIP file on disk
    using `ZIP_STORED` (fast streaming with minimal RAM even for 100–1000 image sets).
    Caller is responsible for removing the temporary path after sending the response.
    """
    job = db.get_job(job_id)
    if not job:
        raise ValueError(f"Job #{job_id} not found.")

    sync_job_manifest(job_id, job=job, rewrite_all_sidecars=False)
    export_dir = Path(job["export_dir"])
    folder_name = export_dir.name

    tmp = tempfile.NamedTemporaryFile(prefix=f"_studio_zip_{job_id}_", suffix=".zip", delete=False)
    tmp_path = Path(tmp.name)
    tmp.close()

    with zipfile.ZipFile(tmp_path, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as zf:
        if export_dir.exists():
            for file_path in sorted(export_dir.iterdir()):
                if file_path.is_file() and not file_path.name.startswith("."):
                    zf.write(file_path, arcname=f"{folder_name}/{file_path.name}")
    return tmp_path, f"{folder_name}.zip"


def build_job_zip_bytes(job_id: int) -> tuple[bytes, str]:
    """Backwards-compatible wrapper returning in-memory bytes."""
    tmp_path, filename = build_job_zip_file(job_id)
    try:
        return tmp_path.read_bytes(), filename
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass


def open_export_folder_in_os(job_id: int) -> Dict[str, Any]:
    """Opens the job's export directory in macOS Finder / OS file manager."""
    job = db.get_job(job_id)
    if not job:
        raise ValueError(f"Job #{job_id} not found.")
    export_dir = Path(job["export_dir"])
    export_dir.mkdir(parents=True, exist_ok=True)
    sync_job_manifest(job_id, job=job)

    sys_name = platform.system().lower()
    if sys_name == "darwin":
        subprocess.Popen(["open", str(export_dir)])
    elif sys_name == "windows":
        subprocess.Popen(["explorer", str(export_dir)])
    else:
        subprocess.Popen(["xdg-open", str(export_dir)])

    return {
        "opened": True,
        "export_dir": str(export_dir),
    }


def pick_folder_via_os_dialog(prompt_label: str = "Select Export Folder for Image Sets:") -> Optional[str]:
    """
    Opens the native OS folder chooser dialog (macOS Finder choose-folder via osascript)
    and returns the selected absolute directory path, or None if cancelled.
    """
    sys_name = platform.system().lower()
    if sys_name == "darwin":
        script = f'POSIX path of (choose folder with prompt "{prompt_label}")'
        res = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if res.returncode == 0 and res.stdout.strip():
            chosen = str(Path(res.stdout.strip()).expanduser().resolve())
            Path(chosen).mkdir(parents=True, exist_ok=True)
            return chosen
        return None
    return None


def relocate_job_export_dir(job_id: int, new_root_dir: str) -> Dict[str, Any]:
    """
    Moves a job's export folder (and any already-saved images, sidecars, and manifest.json)
    into `new_root_dir/<set_subfolder_name>` and updates SQLite paths atomically.
    """
    import shutil

    job = db.get_job(job_id)
    if not job:
        raise ValueError(f"Job #{job_id} not found.")

    clean_root = Path(new_root_dir.strip()).expanduser().resolve()
    clean_root.mkdir(parents=True, exist_ok=True)

    old_dir = Path(job["export_dir"]).resolve()
    subfolder_name = old_dir.name
    new_dir = clean_root if clean_root.name == subfolder_name else (clean_root / subfolder_name)
    new_dir.mkdir(parents=True, exist_ok=True)

    if old_dir.exists() and old_dir != new_dir:
        for item in list(old_dir.iterdir()):
            dest_item = new_dir / item.name
            if dest_item.exists():
                dest_item.unlink()
            shutil.move(str(item), str(dest_item))
        try:
            if not any(old_dir.iterdir()):
                old_dir.rmdir()
        except Exception:
            pass

    for gen in job.get("generations") or []:
        if gen.get("image_file"):
            new_img_path = str(new_dir / gen["image_file"])
            db.update_generation(gen["id"], image_path=new_img_path)

    updated_job = db.update_job(job_id, export_dir=str(new_dir))
    sync_job_manifest(job_id, job=updated_job)
    return updated_job or db.get_job(job_id)  # type: ignore
