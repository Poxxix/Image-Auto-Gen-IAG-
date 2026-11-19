from modules.reference_sources.image_utils import (
    compute_bytes_md5,
    compute_dhash,
    compute_file_md5,
    dhash_distance,
    inspect_image_bytes,
)

__all__ = [
    "compute_bytes_md5",
    "compute_dhash",
    "compute_file_md5",
    "dhash_distance",
    "inspect_image_bytes",
    "save_uploaded_reference",
    "detect_pinterest_input_kind",
    "discover_pinterest_references",
]


def __getattr__(name: str):
    """Lazy-load DB-backed source modules so lightweight image_utils imports stay DB-free."""
    if name == "save_uploaded_reference":
        from modules.reference_sources.local_upload import save_uploaded_reference

        return save_uploaded_reference
    if name in ("detect_pinterest_input_kind", "discover_pinterest_references"):
        from modules.reference_sources import pinterest_discovery

        return getattr(pinterest_discovery, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
