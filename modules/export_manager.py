import csv
from io import BytesIO, StringIO
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import tempfile
import threading
import time
from typing import Any, Dict, List, Optional
import zipfile
from PIL import Image

from config import (
    format_picassy_keyword,
    format_picassy_keyword_prose,
    format_picassy_sentence_case,
    normalize_export_image_format,
    normalize_filename_style,
    normalize_metadata_export_mode,
)
from database.db_manager import db, slugify_theme
from modules.reference_sources.image_utils import inspect_image_bytes

CSV_FILENAME = "pin-import.csv"
CSV_HEADERS: List[str] = [
    "File name",
    "title",
    "description",
    "alt_text",
    "categories",
    "tags",
    "Peak of Picassy",
    "prompt",
]

_MANIFEST_LOCK = threading.Lock()
_MANIFEST_LAST_WRITE: Dict[int, float] = {}
_JOB_SYNC_LOCKS: Dict[int, threading.Lock] = {}


def _get_job_sync_lock(job_id: int) -> threading.Lock:
    with _MANIFEST_LOCK:
        lock = _JOB_SYNC_LOCKS.get(job_id)
        if lock is None:
            lock = threading.Lock()
            _JOB_SYNC_LOCKS[job_id] = lock
        return lock


def build_generation_file_prefix(job: Dict[str, Any], index_num: int) -> str:
    """
    Returns file basename prefix for an image turn:
    - `picassy_slug` (default): `<keyword-slug>-<1,2,3...>` e.g. `beautiful-image-1`
    - `studio_seq` (legacy): `<001>_<theme-slug>` e.g. `001_cafe-mua-thu`
    """
    idx = int(index_num)
    style = normalize_filename_style(job.get("filename_style"), default="picassy_slug")
    if style == "studio_seq":
        return f"{idx:03d}_{job['slug']}"
    raw_kw = (job.get("primary_tag") or job.get("theme") or job.get("slug") or "image").strip()
    kw_slug = slugify_theme(raw_kw, max_len=72)
    return f"{kw_slug}-{idx}"


def _safe_mkdir(directory: Path) -> None:
    try:
        directory.mkdir(parents=True, exist_ok=True)
    except (FileExistsError, PermissionError, OSError):
        pass


def _atomic_write_bytes(dest_path: Path, data: bytes, sync_disk: bool = False) -> None:
    _safe_mkdir(dest_path.parent)
    tmp_path = dest_path.parent / f".{dest_path.name}.{threading.get_ident()}.tmp"
    with open(tmp_path, "wb") as f:
        f.write(data)
        f.flush()
        if sync_disk:
            os.fsync(f.fileno())
    os.replace(tmp_path, dest_path)


def _atomic_write_text(dest_path: Path, text: str) -> None:
    # Pure UTF-8 without BOM so bulk importers parse header `File name` cleanly
    _atomic_write_bytes(dest_path, text.encode("utf-8"))


def _sanitize_single_line(value: Any) -> str:
    return " ".join(str(value or "").split())


def _clean_slug_tokens_in_copy(text: str, raw_theme: str, replacement: str) -> str:
    s = re.sub(r"(?:^|\s)#[^\s#]+", " ", str(text or ""))
    s = _sanitize_single_line(s)
    if not s or not replacement:
        return s
    if raw_theme and ("-" in raw_theme or "_" in raw_theme) and raw_theme.lower() != replacement.lower():
        s = re.sub(re.escape(raw_theme), replacement, s, flags=re.IGNORECASE)
    return s


def save_generated_image_atomically(
    job: Dict[str, Any],
    index_num: int,
    raw_bytes: bytes,
    preferred_format: str = "original",
    precomputed_info: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Saves a generated image atomically inside `job['export_dir']` using the active filename style
    (`picassy_slug` -> `<keyword-slug>-<1,2,3...>.<ext>` or `studio_seq` -> `<001>_<slug>.<ext>`).
    """
    export_dir = Path(job["export_dir"])
    export_dir.mkdir(parents=True, exist_ok=True)
    slug = job["slug"]
    idx = int(index_num)
    prefix = build_generation_file_prefix(job, idx)

    orig_info = (
        precomputed_info
        if precomputed_info
        and precomputed_info.get("width")
        and precomputed_info.get("ext")
        and precomputed_info.get("md5")
        else inspect_image_bytes(raw_bytes)
    )
    target_fmt = normalize_export_image_format(preferred_format)

    if target_fmt in ("original", "", orig_info["ext"]):
        final_bytes = raw_bytes
        ext = orig_info["ext"]
        final_info = orig_info
    else:
        with Image.open(BytesIO(raw_bytes)) as im:
            exif_bytes = im.info.get("exif")
            out_buf = BytesIO()
            if target_fmt == "jpg":
                ext = "jpg"
                rgb = im.convert("RGB")
                save_kw: Dict[str, Any] = {"format": "JPEG", "quality": 95}
                if exif_bytes:
                    save_kw["exif"] = exif_bytes
                rgb.save(out_buf, **save_kw)
            elif target_fmt == "webp":
                ext = "webp"
                webp_im = im
                if im.mode == "P":
                    webp_im = im.convert("RGBA" if "transparency" in im.info else "RGB")
                elif im.mode not in ("RGB", "RGBA"):
                    webp_im = im.convert("RGB")
                save_kw_webp: Dict[str, Any] = {"format": "WEBP", "quality": 95}
                if exif_bytes:
                    save_kw_webp["exif"] = exif_bytes
                webp_im.save(out_buf, **save_kw_webp)
            else:
                ext = "png"
                png_im = im
                if im.mode not in ("RGB", "RGBA", "L", "LA", "P"):
                    png_im = im.convert("RGBA")
                png_im.save(out_buf, format="PNG")
            final_bytes = out_buf.getvalue()
        final_info = inspect_image_bytes(final_bytes)

    image_file = f"{prefix}.{ext}"
    image_path = export_dir / image_file

    legacy_prefix = f"{idx:03d}_{slug}"
    for cand_prefix in {prefix, legacy_prefix}:
        for old_ext in ("png", "jpg", "jpeg", "webp"):
            candidate_old = export_dir / f"{cand_prefix}.{old_ext}"
            if candidate_old != image_path and candidate_old.exists():
                try:
                    candidate_old.unlink()
                except Exception:
                    pass

    _atomic_write_bytes(image_path, final_bytes, sync_disk=True)

    return {
        "image_file": image_file,
        "image_path": str(image_path),
        "sidecar_file": "",
        "caption_file": "",
        "mime_type": final_info["mime_type"],
        "width": final_info["width"],
        "height": final_info["height"],
        "file_size": final_info["file_size"],
        "md5": final_info["md5"],
        "dhash": final_info["dhash"],
    }


def _generation_has_saved_image(export_dir: Path, gen: Dict[str, Any]) -> bool:
    img_file = str(gen.get("image_file") or "").strip()
    if not img_file:
        return False
    img_path_str = str(gen.get("image_path") or "").strip()
    if img_path_str and Path(img_path_str).exists():
        return True
    return (export_dir / img_file).exists()


def build_generation_csv_row(job: Dict[str, Any], generation: Dict[str, Any]) -> List[str]:
    """
    Builds a single Picassy CSV row matching `pin-import-sample.csv`:
    [File name, title, description, alt_text, categories, tags, Peak of Picassy, prompt]
    """
    raw_theme = str(job.get("theme") or "").strip()
    raw_tag_src = str(job.get("primary_tag") or raw_theme or generation.get("image_file") or "").strip()
    clean_tag = format_picassy_keyword(raw_tag_src) or raw_tag_src
    prose_tag = format_picassy_keyword_prose(raw_tag_src) or clean_tag.lower()

    image_file = _sanitize_single_line(generation.get("image_file"))
    raw_title = _clean_slug_tokens_in_copy(generation.get("title") or "", raw_theme, clean_tag)
    if not raw_title:
        raw_title = clean_tag[:60]
    elif clean_tag and not raw_title.lower().startswith(clean_tag.lower()):
        tail = re.sub(re.escape(clean_tag), "", raw_title, flags=re.IGNORECASE).strip(" :-–—|.,")
        raw_title = f"{clean_tag} {tail}".strip()[:60] if tail else clean_tag[:60]
    else:
        # Ensure exact Title-Case prefix on title
        raw_title = f"{clean_tag}{raw_title[len(clean_tag):]}"[:60].strip()

    desc = format_picassy_sentence_case(
        _clean_slug_tokens_in_copy(generation.get("description") or "", raw_theme, prose_tag)[:160].strip()
    )
    alt_text = format_picassy_sentence_case(
        _clean_slug_tokens_in_copy(generation.get("alt_text") or "", raw_theme, prose_tag)[:125].strip()
    )
    category = _sanitize_single_line(job.get("category"))
    peak_flag = "TRUE" if bool(generation.get("is_peak")) else "FALSE"
    prompt_val = _sanitize_single_line(generation.get("prompt_final"))

    return [
        image_file,
        raw_title,
        desc,
        alt_text,
        category,
        clean_tag,
        peak_flag,
        prompt_val,
    ]


def format_job_csv_text(job: Dict[str, Any]) -> str:
    """
    Serializes all saved images in `job` into RFC-4180 CSV (`UTF-8` no BOM, `\r\n` CRLF)
    matching `pin-import-sample.csv`.
    """
    export_dir = Path(job["export_dir"])
    buf = StringIO()
    writer = csv.writer(buf, quoting=csv.QUOTE_MINIMAL, lineterminator="\r\n")
    writer.writerow(CSV_HEADERS)
    for gen in job.get("generations") or []:
        if _generation_has_saved_image(export_dir, gen):
            writer.writerow(build_generation_csv_row(job, gen))
    return buf.getvalue()


def _prune_legacy_sidecars(export_dir: Path, remove_csv: bool = False) -> None:
    if not export_dir.exists():
        return
    drop_exts = {".json", ".txt"}
    if remove_csv:
        drop_exts.add(".csv")
    for child in export_dir.iterdir():
        if child.is_file() and child.suffix.lower() in drop_exts:
            try:
                child.unlink()
            except Exception:
                pass


def sync_job_manifest(
    job_id: int,
    job: Optional[Dict[str, Any]] = None,
    rewrite_all_sidecars: bool = True,
) -> Optional[Path]:
    """
    Synchronizes the export directory on disk according to `job['metadata_export_mode']` (`csv` | `none`):
    - `csv`: cleans any legacy `.json`/`.txt` files and atomically writes `pin-import.csv`
    - `none`: cleans `.json`/`.txt`/`.csv` files so the folder contains pure images only
    """
    del rewrite_all_sidecars
    with _get_job_sync_lock(job_id):
        job_data = job or db.get_job(job_id)
        if not job_data:
            return None

        export_dir = Path(job_data["export_dir"])
        _safe_mkdir(export_dir)
        export_mode = normalize_metadata_export_mode(
            job_data.get("metadata_export_mode"), default="csv"
        )
        csv_path = export_dir / CSV_FILENAME

        try:
            if export_mode == "none":
                _prune_legacy_sidecars(export_dir, remove_csv=True)
                return None

            _prune_legacy_sidecars(export_dir, remove_csv=False)
            csv_text = format_job_csv_text(job_data)
            _atomic_write_text(csv_path, csv_text)
            return csv_path
        except (PermissionError, OSError):
            return None


def get_or_build_job_csv_bytes(job_id: int) -> tuple[bytes, str]:
    """Returns `(utf8_bytes, download_filename)` for `GET /api/jobs/{job_id}/csv`."""
    job = db.get_job(job_id)
    if not job:
        raise ValueError(f"Job #{job_id} not found.")
    csv_text = format_job_csv_text(job)
    if normalize_metadata_export_mode(job.get("metadata_export_mode"), default="csv") == "csv":
        try:
            export_dir = Path(job["export_dir"])
            _safe_mkdir(export_dir)
            _atomic_write_text(export_dir / CSV_FILENAME, csv_text)
        except OSError:
            pass
    dl_name = f"{job['slug']}-pin-import.csv" if job.get("slug") else CSV_FILENAME
    return csv_text.encode("utf-8"), dl_name


def sync_generation_and_manifest(
    job_id: int,
    generation_id: int,
    force_manifest: bool = False,
) -> None:
    """
    Throttles full `pin-import.csv` rewrites on huge 100–1000 image sets while flushing
    immediately for sets <= 40 items or explicit metadata/Peak edits.
    """
    del generation_id
    job = db.get_job(job_id)
    if not job:
        return
    gens = job.get("generations") or []
    now = time.time()
    with _MANIFEST_LOCK:
        last_ts = _MANIFEST_LAST_WRITE.get(job_id, 0.0)
        should_write = force_manifest or len(gens) <= 40 or (now - last_ts) >= 3.5
        if should_write:
            _MANIFEST_LAST_WRITE[job_id] = now

    if should_write:
        sync_job_manifest(job_id, job=job)


def cleanup_and_resequence_after_delete_generation(
    job_id: int,
    delete_result: Dict[str, Any],
) -> None:
    """
    Removes the deleted generation's files on disk, renames re-indexed sibling images
    (`-2 -> -1`), and re-syncs `pin-import.csv` so `File name` entries stay 100% matched.
    """
    job = db.get_job(job_id)
    if not job:
        return
    export_dir = Path(job["export_dir"])

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

    for item in delete_result.get("reindexed") or []:
        gen_id = item["id"]
        old_idx = int(item["old_index"])
        new_idx = int(item["new_index"])
        old_prefix = build_generation_file_prefix(job, old_idx)
        new_prefix = build_generation_file_prefix(job, new_idx)
        old_img_file = item.get("image_file") or ""

        updates: Dict[str, Any] = {}
        if old_img_file:
            ext = Path(old_img_file).suffix.lstrip(".") or "png"
            new_img_file = f"{new_prefix}.{ext}"
            old_img_path = export_dir / old_img_file
            new_img_path = export_dir / new_img_file
            if old_img_path.exists() and old_img_path != new_img_path:
                try:
                    os.replace(old_img_path, new_img_path)
                except Exception:
                    pass
            updates["image_file"] = new_img_file
            updates["image_path"] = str(new_img_path)
            updates["sidecar_file"] = ""
            updates["caption_file"] = ""

        for old_aux in (f"{old_prefix}.json", f"{old_prefix}.txt"):
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
    Packages all exported images (plus `pin-import.csv` in `csv` mode) inside `job['export_dir']`
    into a temporary ZIP file on disk using `ZIP_STORED`.
    """
    job = db.get_job(job_id)
    if not job:
        raise ValueError(f"Job #{job_id} not found.")

    sync_job_manifest(job_id, job=job)
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
    tmp_path, filename = build_job_zip_file(job_id)
    try:
        return tmp_path.read_bytes(), filename
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass


def open_export_folder_in_os(job_id: int) -> Dict[str, Any]:
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
