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
    """Returns the Hamming distance between two equal-length hex hashes."""
    if not hash_a or not hash_b or len(hash_a) != len(hash_b):
        return max(len(hash_a or ""), len(hash_b or ""), 16) * 4
    try:
        xor_val = int(hash_a, 16) ^ int(hash_b, 16)
        return bin(xor_val).count("1")
    except ValueError:
        return len(hash_a) * 4


def _center_crop(img: Image.Image, keep_fraction: float) -> Image.Image:
    """Crops the centered `keep_fraction` (0.2..1.0) of `img` to strip outer borders/margins."""
    frac = max(0.2, min(1.0, float(keep_fraction)))
    if frac >= 0.999:
        return img
    w, h = img.size
    dx = int(round(w * (1.0 - frac) * 0.5))
    dy = int(round(h * (1.0 - frac) * 0.5))
    x2 = max(dx + 4, w - dx)
    y2 = max(dy + 4, h - dy)
    if x2 <= dx or y2 <= dy or w < 16 or h < 16:
        return img
    return img.crop((dx, dy, min(w, x2), min(h, y2)))


def compute_dhash(img: Image.Image, hash_size: int = 8) -> str:
    """Computes a horizontal difference perceptual hash (`hash_size * hash_size` bits)."""
    gray = img.convert("L").resize((hash_size + 1, hash_size), Image.Resampling.BILINEAR)
    pixels = list(gray.getdata())
    bits = 0
    for row in range(hash_size):
        row_offset = row * (hash_size + 1)
        for col in range(hash_size):
            bits = (bits << 1) | (1 if pixels[row_offset + col] > pixels[row_offset + col + 1] else 0)
    hex_width = (hash_size * hash_size + 3) // 4
    return f"{bits:0{hex_width}x}"


def compute_ahash(img: Image.Image, hash_size: int = 8) -> str:
    """Computes a 64-bit average luminance perceptual hash (16 hex characters)."""
    gray = img.convert("L").resize((hash_size, hash_size), Image.Resampling.BILINEAR)
    pixels = list(gray.getdata())
    mean_val = sum(pixels) / len(pixels)
    bits = 0
    for p in pixels:
        bits = (bits << 1) | (1 if p >= mean_val else 0)
    hex_width = (hash_size * hash_size + 3) // 4
    return f"{bits:0{hex_width}x}"


def compute_luma_grid_from_pixels(pixels: List[float]) -> List[float]:
    """Converts a grayscale pixel list into a zero-mean L2-normalized structure vector."""
    n = len(pixels)
    if not n:
        return []
    mean_val = sum(pixels) / n
    centered = [float(p) - mean_val for p in pixels]
    norm = math.sqrt(sum(v * v for v in centered))
    if norm < 1e-6:
        return [0.0] * n
    return [round(v / norm, 5) for v in centered]


def compute_edge_grid(img: Image.Image, grid_size: int = 28) -> List[float]:
    """
    Computes a zero-mean L2-normalized gradient-magnitude map (`grid_size x grid_size`).
    Flat paper, studio sweeps, and smooth skin gradients vanish to ~0, isolating real
    ink strokes, charcoal lines, tattoo contours, and object edges.
    """
    cropped = _center_crop(img, 0.88)
    gray = cropped.convert("L").resize((grid_size + 1, grid_size + 1), Image.Resampling.BILINEAR)
    px = list(gray.getdata())
    stride = grid_size + 1
    mags: List[float] = []
    for r in range(grid_size):
        row_off = r * stride
        next_off = (r + 1) * stride
        for c in range(grid_size):
            gx = float(px[row_off + c + 1]) - float(px[row_off + c])
            gy = float(px[next_off + c]) - float(px[row_off + c])
            mags.append(math.hypot(gx, gy))
    return compute_luma_grid_from_pixels(mags)


def luma_cosine_similarity(vec_a: List[float], vec_b: List[float]) -> float:
    """Returns cosine similarity (-1.0..1.0) between two normalized vectors."""
    if not vec_a or not vec_b or len(vec_a) != len(vec_b):
        return 0.0
    return sum(a * b for a, b in zip(vec_a, vec_b))


def dhash_distance(hash_a: str, hash_b: str) -> int:
    """Returns the Hamming distance between two hex dHashes."""
    return _hamming_hex_distance(hash_a, hash_b)


def ahash_distance(hash_a: str, hash_b: str) -> int:
    """Returns the Hamming distance between two hex aHashes."""
    return _hamming_hex_distance(hash_a, hash_b)


def measure_image_similarity(
    cand_info: Dict[str, Any],
    ref_info: Dict[str, Any],
    reference_strength: str = "balanced",
    dhash_max: int | None = None,
    ahash_max: int | None = None,
    cosine_min: float | None = None,
) -> Dict[str, Any]:
    """
    Detects true 1:1 input clones while avoiding false-positive rejections on shared
    surface carriers (e.g. white flash paper, charcoal sheets, centered studio backdrops).

    Uses an AND-gate across:
      1. Global 8x8 dHash (`d_dist`)
      2. Inner-core (62% center ROI) 144-bit dHash difference fraction (`core_diff`)
      3. Inner-core 20x20 normalized luminance correlation (`core_corr`)
      4. 28x28 high-frequency edge/stroke gradient cosine (`edge_cos`)
    calibrated automatically to `reference_strength` (`subject_keep` | `balanced` | `style_only`).
    """
    cand_md5 = str(cand_info.get("md5") or "")
    ref_md5 = str(ref_info.get("md5") or "")
    md5_match = bool(cand_md5 and ref_md5 and cand_md5 == ref_md5)

    d_dist = dhash_distance(str(cand_info.get("dhash") or ""), str(ref_info.get("dhash") or ""))
    a_dist = ahash_distance(str(cand_info.get("ahash") or ""), str(ref_info.get("ahash") or ""))
    cos_sim = luma_cosine_similarity(
        cand_info.get("luma_vec") or [],
        ref_info.get("luma_vec") or [],
    )

    cand_core_dh = str(cand_info.get("core_dhash12") or "")
    ref_core_dh = str(ref_info.get("core_dhash12") or "")
    if cand_core_dh and ref_core_dh and len(cand_core_dh) == len(ref_core_dh):
        core_bits = len(cand_core_dh) * 4
        core_diff = _hamming_hex_distance(cand_core_dh, ref_core_dh) / float(max(1, core_bits))
    else:
        core_diff = d_dist / 64.0

    cand_core_luma = cand_info.get("core_luma20") or []
    ref_core_luma = ref_info.get("core_luma20") or []
    core_corr = (
        luma_cosine_similarity(cand_core_luma, ref_core_luma)
        if cand_core_luma and ref_core_luma and len(cand_core_luma) == len(ref_core_luma)
        else cos_sim
    )

    cand_edge = cand_info.get("edge_vec") or []
    ref_edge = ref_info.get("edge_vec") or []
    edge_cos = (
        luma_cosine_similarity(cand_edge, ref_edge)
        if cand_edge and ref_edge and len(cand_edge) == len(ref_edge)
        else cos_sim
    )

    mode = str(reference_strength or "balanced").strip().lower()
    if mode in ("subject_keep", "character_lock"):
        d_lim, core_diff_lim, core_corr_lim, edge_cos_lim = 3, 0.10, 0.96, 0.78
    elif mode in ("style_only", "layout_map"):
        d_lim, core_diff_lim, core_corr_lim, edge_cos_lim = 7, 0.18, 0.89, 0.60
    else:
        d_lim, core_diff_lim, core_corr_lim, edge_cos_lim = 5, 0.14, 0.93, 0.68

    if dhash_max is not None:
        d_lim = int(dhash_max)
    if cosine_min is not None:
        core_corr_lim = float(cosine_min)

    is_verbatim_echo = bool(
        md5_match
        or (d_dist <= 1 and a_dist <= 1 and core_corr >= 0.990 and edge_cos >= 0.88)
    )

    too_similar = bool(
        is_verbatim_echo
        or (
            d_dist <= d_lim
            and core_diff <= core_diff_lim
            and core_corr >= core_corr_lim
            and edge_cos >= edge_cos_lim
        )
    )
    if ahash_max is not None and too_similar and not is_verbatim_echo:
        too_similar = bool(a_dist <= int(ahash_max))

    return {
        "dhash_dist": d_dist,
        "ahash_dist": a_dist,
        "luma_cosine": round(cos_sim, 3),
        "core_diff": round(core_diff, 3),
        "core_corr": round(core_corr, 3),
        "edge_cos": round(edge_cos, 3),
        "is_verbatim_echo": is_verbatim_echo,
        "reference_strength": mode,
        "too_similar": too_similar,
        "reason": (
            f"dHash={d_dist}, core_diff={core_diff:.2f}, "
            f"core_corr={core_corr:.2f}, edge_cos={edge_cos:.2f}"
        ),
    }


FORMAT_TO_EXT_MIME = {
    "PNG": ("png", "image/png"),
    "JPEG": ("jpg", "image/jpeg"),
    "JPG": ("jpg", "image/jpeg"),
    "WEBP": ("webp", "image/webp"),
}


def inspect_image_bytes(data: bytes) -> Dict[str, Any]:
    """Validates image bytes and extracts dimensions, format, MD5, global hashes, and inner-core/edge features."""
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

        core_im = _center_crop(im, 0.62)
        core_dhash12 = compute_dhash(core_im, hash_size=12)
        core_pixels = list(core_im.convert("L").resize((20, 20), Image.Resampling.BILINEAR).getdata())
        core_luma20 = compute_luma_grid_from_pixels(core_pixels)
        edge_vec = compute_edge_grid(im, grid_size=28)

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
        "core_dhash12": core_dhash12,
        "core_luma20": core_luma20,
        "edge_vec": edge_vec,
        "std_dev": std_approx,
    }
