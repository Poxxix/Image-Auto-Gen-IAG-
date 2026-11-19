import hashlib
import io
import math
from pathlib import Path
from typing import Any, Dict, List, Union
from PIL import Image


def compute_bytes_md5(data: bytes) -> str:
    return hashlib.md5(data).hexdigest()


def compute_file_md5(path: Union[str, Path]) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _hamming_hex_distance(hash_a: str, hash_b: str) -> int:
    """Returns the Hamming distance (0..64) between two equal-length hex hashes."""
    if not hash_a or not hash_b or len(hash_a) != len(hash_b):
        return 64
    try:
        xor_val = int(hash_a, 16) ^ int(hash_b, 16)
        return bin(xor_val).count("1")
    except ValueError:
        return 64


def compute_dhash(img: Image.Image, hash_size: int = 8) -> str:
    """Computes a 64-bit horizontal difference perceptual hash (16 hex characters)."""
    gray = img.convert("L").resize((hash_size + 1, hash_size), Image.Resampling.BILINEAR)
    pixels = list(gray.getdata())
    bits = 0
    for row in range(hash_size):
        row_offset = row * (hash_size + 1)
        for col in range(hash_size):
            bits = (bits << 1) | (1 if pixels[row_offset + col] > pixels[row_offset + col + 1] else 0)
    return f"{bits:016x}"


def compute_ahash(img: Image.Image, hash_size: int = 8) -> str:
    """Computes a 64-bit average luminance perceptual hash (16 hex characters)."""
    gray = img.convert("L").resize((hash_size, hash_size), Image.Resampling.BILINEAR)
    pixels = list(gray.getdata())
    mean_val = sum(pixels) / len(pixels)
    bits = 0
    for p in pixels:
        bits = (bits << 1) | (1 if p >= mean_val else 0)
    return f"{bits:016x}"


def compute_luma_grid_from_pixels(pixels: List[float]) -> List[float]:
    """Converts a 16x16 grayscale pixel list into a zero-mean L2-normalized structure vector."""
    n = len(pixels)
    if not n:
        return []
    mean_val = sum(pixels) / n
    centered = [float(p) - mean_val for p in pixels]
    norm = math.sqrt(sum(v * v for v in centered))
    if norm < 1e-6:
        return [0.0] * n
    return [round(v / norm, 5) for v in centered]


def luma_cosine_similarity(vec_a: List[float], vec_b: List[float]) -> float:
    """Returns cosine similarity (-1.0..1.0) between two normalized luminance grids."""
    if not vec_a or not vec_b or len(vec_a) != len(vec_b):
        return 0.0
    return sum(a * b for a, b in zip(vec_a, vec_b))


def dhash_distance(hash_a: str, hash_b: str) -> int:
    """Returns the Hamming distance (0..64) between two 16-char hex dHashes."""
    return _hamming_hex_distance(hash_a, hash_b)


def ahash_distance(hash_a: str, hash_b: str) -> int:
    """Returns the Hamming distance (0..64) between two 16-char hex aHashes."""
    return _hamming_hex_distance(hash_a, hash_b)


def measure_image_similarity(
    cand_info: Dict[str, Any],
    ref_info: Dict[str, Any],
    dhash_max: int = 10,
    ahash_max: int = 8,
    cosine_min: float = 0.92,
) -> Dict[str, Any]:
    """
    Compares a generated candidate image against a reference/input image across
    dHash, aHash, and normalized 16x16 luminance structure to detect input clones.
    """
    d_dist = dhash_distance(str(cand_info.get("dhash") or ""), str(ref_info.get("dhash") or ""))
    a_dist = ahash_distance(str(cand_info.get("ahash") or ""), str(ref_info.get("ahash") or ""))
    cos_sim = luma_cosine_similarity(
        cand_info.get("luma_vec") or [],
        ref_info.get("luma_vec") or [],
    )
    too_similar = (
        d_dist <= dhash_max
        or a_dist <= ahash_max
        or (cos_sim >= cosine_min and d_dist <= 16)
    )
    return {
        "dhash_dist": d_dist,
        "ahash_dist": a_dist,
        "luma_cosine": round(cos_sim, 3),
        "too_similar": too_similar,
        "reason": f"dHash={d_dist}, aHash={a_dist}, structure_cos={cos_sim:.2f}",
    }


FORMAT_TO_EXT_MIME = {
    "PNG": ("png", "image/png"),
    "JPEG": ("jpg", "image/jpeg"),
    "JPG": ("jpg", "image/jpeg"),
    "WEBP": ("webp", "image/webp"),
}


def inspect_image_bytes(data: bytes) -> Dict[str, Any]:
    """Validates image bytes and extracts dimensions, format, extension, MD5, perceptual hashes, and variance."""
    if not data or len(data) < 256:
        raise ValueError("Image payload is empty or too small.")

    with Image.open(io.BytesIO(data)) as im:
        im.load()
        width, height = im.size
        fmt = (im.format or "JPEG").upper()
        ext, mime_type = FORMAT_TO_EXT_MIME.get(fmt, ("jpg", "image/jpeg"))
        gray_small = im.convert("L").resize((16, 16), Image.Resampling.BILINEAR)
        small_pixels = list(gray_small.getdata())
        mean_val = sum(small_pixels) / len(small_pixels)
        variance = sum((p - mean_val) ** 2 for p in small_pixels) / len(small_pixels)
        std_approx = variance ** 0.5
        dhash = compute_dhash(im)
        ahash = compute_ahash(im)
        luma_vec = compute_luma_grid_from_pixels(small_pixels)

    return {
        "width": width,
        "height": height,
        "format": fmt,
        "ext": ext,
        "mime_type": mime_type,
        "file_size": len(data),
        "md5": compute_bytes_md5(data),
        "dhash": dhash,
        "ahash": ahash,
        "luma_vec": luma_vec,
        "std_dev": std_approx,
    }
