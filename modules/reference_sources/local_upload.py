import os
import re
import uuid
from pathlib import Path
from typing import Any, Dict

from config import REFERENCES_DIR
from database.db_manager import db, slugify_theme
from modules.reference_sources.image_utils import inspect_image_bytes


def save_uploaded_reference(
    raw_bytes: bytes,
    original_filename: str,
    title: str = "",
    usage_rights: str = "user_provided_confirmed",
) -> Dict[str, Any]:
    """
    Validates and saves a user-uploaded reference image atomically to `data/references/`,
    recording its perceptual hash and metadata in SQLite `references`.
    """
    info = inspect_image_bytes(raw_bytes)
    stem = Path(original_filename or "reference").stem
    safe_stem = slugify_theme(stem, max_len=32)
    short_uid = uuid.uuid4().hex[:8]
    final_filename = f"ref_{safe_stem}_{short_uid}.{info['ext']}"

    REFERENCES_DIR.mkdir(parents=True, exist_ok=True)
    final_path = REFERENCES_DIR / final_filename
    tmp_path = REFERENCES_DIR / f".{final_filename}.tmp"

    with open(tmp_path, "wb") as f:
        f.write(raw_bytes)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp_path, final_path)

    return db.add_reference(
        source_type="local_upload",
        source_ref=original_filename,
        title=title.strip() or stem,
        file_path=str(final_path),
        filename=final_filename,
        mime_type=info["mime_type"],
        width=info["width"],
        height=info["height"],
        file_size=info["file_size"],
        md5=info["md5"],
        dhash=info["dhash"],
        usage_rights=usage_rights,
        metadata={"original_filename": original_filename, "format": info["format"]},
    )
