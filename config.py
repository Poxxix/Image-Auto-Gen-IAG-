import os
import platform
import re
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Base Project Directory
BASE_DIR = Path(__file__).resolve().parent

# Browser Profiles Directory (AI Master Browser on CDP :9222)
BROWSER_PROFILES_DIR = BASE_DIR / "browser_profiles"
CHROME_AI_MASTER_DIR = BROWSER_PROFILES_DIR / "chrome_ai_master"

# Studio Data & Export Directories
DATA_DIR = BASE_DIR / "data"
REFERENCES_DIR = DATA_DIR / "references"
PINTEREST_CANDIDATES_DIR = DATA_DIR / "pinterest_candidates"
EXPORTS_DIR = BASE_DIR / "exports"

# Database Path
DATABASE_DIR = BASE_DIR / "database"
DATABASE_PATH = DATABASE_DIR / "studio.db"

# Log files
LOGS_DIR = BASE_DIR / "logs"
LOG_FILE_PATH = LOGS_DIR / "app.log"


def ensure_directories() -> None:
    for directory in [
        BROWSER_PROFILES_DIR,
        CHROME_AI_MASTER_DIR,
        DATA_DIR,
        REFERENCES_DIR,
        PINTEREST_CANDIDATES_DIR,
        EXPORTS_DIR,
        DATABASE_DIR,
        LOGS_DIR,
    ]:
        directory.mkdir(parents=True, exist_ok=True)


ensure_directories()

# Chrome DevTools Protocol (CDP) Configuration for Multi-Slot Browser AI Pool (16 GB RAM max 4 slots)
CDP_HOST = "127.0.0.1"
CDP_PORT = 9222
CDP_ENDPOINT = f"http://{CDP_HOST}:{CDP_PORT}"
MAX_CDP_SLOTS = 4

DEFAULT_CDP_SLOTS: List[Dict[str, Any]] = [
    {
        "slot_id": 1,
        "label": "Chrome #1 (Main)",
        "port": 9222,
        "profile_name": "chrome_ai_master",
        "enabled": True,
    },
    {
        "slot_id": 2,
        "label": "Chrome #2",
        "port": 9223,
        "profile_name": "chrome_slot_2",
        "enabled": False,
    },
    {
        "slot_id": 3,
        "label": "Chrome #3",
        "port": 9224,
        "profile_name": "chrome_slot_3",
        "enabled": False,
    },
    {
        "slot_id": 4,
        "label": "Chrome #4",
        "port": 9225,
        "profile_name": "chrome_slot_4",
        "enabled": False,
    },
]

# Fixed Picassy Categories (extensible via Studio Settings)
DEFAULT_PICASSY_CATEGORIES: List[str] = [
    "AI Prompts",
    "Anime",
    "Art",
    "Fashions",
    "Nail",
    "Photography Topics",
    "Posters & Visuals",
    "Tattoos",
    "Wallpaper",
]

FILENAME_STYLES: List[str] = [
    "picassy_slug",
    "studio_seq",
]

METADATA_PROVIDERS: List[str] = [
    "auto",
    "gemini",
    "openai",
    "openai_compatible",
    "browser_cdp",
    "template",
]

METADATA_VISION_MODES: List[str] = [
    "thumbnail_512",
    "text_only",
]


def normalize_filename_style(
    value: Optional[str],
    default: str = "picassy_slug",
    strict: bool = False,
) -> str:
    raw = (value or "").strip().lower()
    if not raw:
        return default
    if raw in FILENAME_STYLES:
        return raw
    if strict:
        raise ValueError(f"Unsupported filename_style '{value}'.")
    return default


def normalize_picassy_categories(raw_categories: Any) -> List[str]:
    if isinstance(raw_categories, str):
        items = [line.strip() for line in raw_categories.replace(",", "\n").splitlines()]
    elif isinstance(raw_categories, list):
        items = [str(item).strip() for item in raw_categories]
    else:
        items = []
    out: List[str] = []
    seen: set[str] = set()
    for item in items:
        if not item:
            continue
        low = item.lower()
        if low not in seen:
            seen.add(low)
            out.append(item)
    return out or list(DEFAULT_PICASSY_CATEGORIES)


def normalize_cdp_slots(raw_slots: Any) -> List[Dict[str, Any]]:
    by_id: Dict[int, Dict[str, Any]] = {}
    if isinstance(raw_slots, list):
        for entry in raw_slots:
            if not isinstance(entry, dict):
                continue
            try:
                sid = int(entry.get("slot_id") or 0)
            except Exception:
                continue
            if 1 <= sid <= MAX_CDP_SLOTS:
                by_id[sid] = entry

    normalized: List[Dict[str, Any]] = []
    for default_slot in DEFAULT_CDP_SLOTS:
        sid = int(default_slot["slot_id"])
        raw = by_id.get(sid) or {}
        label = str(raw.get("label") or default_slot["label"]).strip()[:48] or default_slot["label"]
        try:
            port = int(raw.get("port") or default_slot["port"])
        except Exception:
            port = int(default_slot["port"])
        if port < 9000 or port > 65000:
            port = int(default_slot["port"])
        profile_name = str(raw.get("profile_name") or default_slot["profile_name"]).strip()
        if not profile_name or "/" in profile_name or "\\" in profile_name or ".." in profile_name:
            profile_name = str(default_slot["profile_name"])
        enabled = bool(raw.get("enabled")) if "enabled" in raw else bool(default_slot["enabled"])
        normalized.append(
            {
                "slot_id": sid,
                "label": label,
                "port": port,
                "profile_name": profile_name,
                "enabled": enabled,
            }
        )
    return normalized


def get_slot_profile_dir(slot_cfg: Dict[str, Any]) -> Path:
    profile_name = str(slot_cfg.get("profile_name") or "chrome_ai_master").strip()
    if not profile_name or "/" in profile_name or "\\" in profile_name or ".." in profile_name:
        profile_name = "chrome_ai_master"
    return BROWSER_PROFILES_DIR / profile_name


def split_api_keys(raw_value: Optional[str]) -> List[str]:
    if not raw_value:
        return []
    parts = [
        tok.strip()
        for line in str(raw_value).splitlines()
        for tok in line.split(",")
    ]
    seen: set[str] = set()
    out: List[str] = []
    for p in parts:
        if p and "••••" not in p and p not in seen:
            seen.add(p)
            out.append(p)
    return out

# Supported Aspect Ratios
ASPECT_RATIOS: Dict[str, Tuple[int, int]] = {
    "1:1": (1080, 1080),
    "4:5": (1080, 1350),
    "9:16": (1080, 1920),
    "16:9": (1920, 1080),
    "3:2": (1620, 1080),
}

# Supported Metadata Languages (Title & Description)
METADATA_LANGUAGES: List[str] = [
    "English",
    "Vietnamese",
    "Japanese",
    "Korean",
    "French",
    "German",
    "Spanish",
]

_UPPER_ACRONYMS = {
    "ai", "seo", "3d", "2d", "4k", "8k", "hd", "ui", "ux", "tv", "diy", "led", "uv", "rgb", "y2k"
}


def format_picassy_keyword(raw_text: Optional[str]) -> str:
    """
    Normalizes any raw keyword, theme, or image filename into clean Title-Case words
    with zero hyphens/underscores (e.g. 'beautiful-image-1.png' -> 'Beautiful Image',
    '1989_nails' -> '1989 Nails', 'Sympathy Messages' -> 'Sympathy Messages').
    """
    s = str(raw_text or "").strip()
    if not s:
        return ""
    s = re.sub(r"\.(?:png|jpe?g|webp|gif|avif)$", "", s, flags=re.IGNORECASE).strip()
    if re.match(r"^\d{3}_[a-zA-Z]", s):
        s = re.sub(r"^\d{3}_+", "", s)
    elif re.search(r"[-_][a-zA-Z].*[-_]\d+$", s) or re.match(r"^[a-zA-Z][a-zA-Z0-9]*[-_]\d+$", s):
        s = re.sub(r"[-_]\d+$", "", s)

    s = re.sub(r"[-_]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    if not s:
        return ""

    out_words: List[str] = []
    for word in s.split(" "):
        if not word:
            continue
        low = word.lower()
        if low in _UPPER_ACRONYMS:
            out_words.append(low.upper())
        elif len(word) >= 2 and word.isupper():
            out_words.append(word)
        elif re.match(r"^\d+[a-zA-Z]+$", word):
            out_words.append(word.lower())
        else:
            out_words.append(word[0].upper() + word[1:])
    return " ".join(out_words)


# Supported Post-Image Metadata Export Modes (Picassy CSV Only or Image Only)
# - "csv": Generate Picassy Title, Description & Alt Text -> export single `pin-import.csv` alongside images
# - "none": Skip post-image metadata and export images only (maximum speed)
METADATA_EXPORT_MODES: List[str] = [
    "csv",
    "none",
]


def normalize_metadata_export_mode(
    value: Optional[str],
    default: str = "csv",
    strict: bool = False,
) -> str:
    raw = (value or "").strip().lower()
    if not raw:
        if strict and value is not None:
            raise ValueError("Invalid metadata_export_mode.")
        return default
    if raw in METADATA_EXPORT_MODES:
        return raw
    if raw in ("json", "caption"):
        if strict:
            raise ValueError(
                f"Unsupported metadata_export_mode '{value}'. Expected one of: {', '.join(METADATA_EXPORT_MODES)}."
            )
        return "csv"
    if strict:
        raise ValueError(
            f"Unsupported metadata_export_mode '{value}'. Expected one of: {', '.join(METADATA_EXPORT_MODES)}."
        )
    return default

# Supported Exported Image Formats (per-set override or workspace default)
# - "original": Keep exact bytes & format returned by provider (preserves provenance)
# - "png": Re-encode atomically as lossless PNG (.png)
# - "jpg": Re-encode atomically as JPEG (.jpg, quality=95)
# - "webp": Re-encode atomically as WebP (.webp, quality=95)
EXPORT_IMAGE_FORMATS: List[str] = [
    "original",
    "png",
    "jpg",
    "webp",
]


def normalize_export_image_format(
    value: Optional[str],
    default: str = "original",
    strict: bool = False,
) -> str:
    """Normalize and validate an exported image format string."""
    raw = (value or "").strip().lower()
    if not raw:
        if strict and value is not None:
            raise ValueError("Invalid export_image_format.")
        return default
    if raw == "jpeg":
        raw = "jpg"
    if raw in EXPORT_IMAGE_FORMATS:
        return raw
    if strict:
        raise ValueError(
            f"Unsupported export_image_format '{value}'. Expected one of: {', '.join(EXPORT_IMAGE_FORMATS)}."
        )
    return default

DEFAULT_CAPTION_PROMPT: str = (
    "Write natural, grammatically clean SEO image metadata tailored to this image: "
    "a concise Title (max 60 chars, starting directly with the exact primary keyword), "
    "a natural Description (max 160 chars, containing the primary keyword naturally), "
    "and a faithful Screen-Reader Alt Text (100-125 chars, describing the visible scene)."
)

CAPTION_STYLE_PRESETS: List[Dict[str, str]] = [
    {
        "id": "picassy_standard",
        "label": "Picassy SEO (Default)",
        "prompt": DEFAULT_CAPTION_PROMPT,
    },
    {
        "id": "picassy_beauty_fashion",
        "label": "Beauty, Nails & Fashion",
        "prompt": (
            "Write natural Picassy SEO metadata highlighting finish, color harmony, and seasonal styling: "
            "Title <= 60 chars starting with exact keyword, Description <= 160 chars without hashtags, "
            "and truthful Alt Text strictly 100-125 chars."
        ),
    },
    {
        "id": "picassy_art_wallpaper",
        "label": "Art, Anime & Wallpaper",
        "prompt": (
            "Write evocative yet concise Picassy SEO metadata focusing on composition, lighting mood, and palette: "
            "Title <= 60 chars starting with exact keyword, Description <= 160 chars without hashtags, "
            "and vivid Alt Text strictly 100-125 chars."
        ),
    },
    {
        "id": "picassy_editorial_photo",
        "label": "Photography & Visuals",
        "prompt": (
            "Write editorial Picassy SEO metadata emphasizing camera perspective, texture, and atmosphere: "
            "Title <= 60 chars starting with exact keyword, Description <= 160 chars without hashtags, "
            "and screen-reader Alt Text strictly 100-125 chars."
        ),
    },
]

# Browser AI Engines (CDP :9222)
AI_ENGINES: Dict[str, Dict[str, str]] = {
    "gemini": {
        "label": "Gemini",
        "url": "https://gemini.google.com/app",
        "domain": "gemini.google.com",
    },
    "chatgpt": {
        "label": "ChatGPT",
        "url": "https://chatgpt.com/",
        "domain": "chatgpt.com",
    },
    "grok": {
        "label": "Grok",
        "url": "https://grok.com/",
        "domain": "grok.com",
    },
}

# Provider & Model Registry with Capability Declarations
PROVIDER_MODELS: Dict[str, Dict[str, Any]] = {
    "chrome-cdp/gemini": {
        "id": "chrome-cdp/gemini",
        "label": "Gemini · Browser CDP (:9222)",
        "provider": "chrome-cdp",
        "engine": "gemini",
        "mode": "browser_cdp",
        "supports_reference_image": True,
        "max_reference_images_per_turn": 1,
        "supported_aspect_ratios": ["1:1", "4:5", "9:16", "16:9", "3:2"],
        "supported_formats": ["original", "png", "jpg", "webp"],
        "max_concurrency": 1,
        "rate_limit_note": "Sequential browser session (1 image/turn) · Requires signed-in Gemini tab on :9222",
        "cost_estimate": "Included in Google account session",
    },
    "chrome-cdp/chatgpt": {
        "id": "chrome-cdp/chatgpt",
        "label": "ChatGPT · Browser CDP (:9222)",
        "provider": "chrome-cdp",
        "engine": "chatgpt",
        "mode": "browser_cdp",
        "supports_reference_image": True,
        "max_reference_images_per_turn": 1,
        "supported_aspect_ratios": ["1:1", "4:5", "9:16", "16:9", "3:2"],
        "supported_formats": ["original", "png", "jpg", "webp"],
        "max_concurrency": 1,
        "rate_limit_note": "Sequential browser session · Subject to ChatGPT web generation quota",
        "cost_estimate": "Included in OpenAI account session",
    },
    "chrome-cdp/grok": {
        "id": "chrome-cdp/grok",
        "label": "Grok · Browser CDP (:9222)",
        "provider": "chrome-cdp",
        "engine": "grok",
        "mode": "browser_cdp",
        "supports_reference_image": True,
        "max_reference_images_per_turn": 1,
        "supported_aspect_ratios": ["1:1", "4:5", "9:16", "16:9", "3:2"],
        "supported_formats": ["original", "png", "jpg", "webp"],
        "max_concurrency": 1,
        "rate_limit_note": "Sequential browser session · Subject to Grok web quota",
        "cost_estimate": "Included in X/Grok account session",
    },
    "gemini-api/imagen-3": {
        "id": "gemini-api/imagen-3",
        "label": "Google Gemini / Imagen API",
        "provider": "gemini-api",
        "engine": "gemini_api",
        "mode": "official_api",
        "supports_reference_image": True,
        "max_reference_images_per_turn": 1,
        "supported_aspect_ratios": ["1:1", "4:5", "9:16", "16:9"],
        "supported_formats": ["original", "png", "jpg", "webp"],
        "max_concurrency": 1,
        "rate_limit_note": "Requires Gemini API Key in Settings · Quota governed by Google AI Studio tier",
        "cost_estimate": "~$0.03–$0.04 per image",
    },
    "openai-api/gpt-image-1": {
        "id": "openai-api/gpt-image-1",
        "label": "OpenAI GPT-Image-1 API",
        "provider": "openai-api",
        "engine": "openai_api",
        "mode": "official_api",
        "supports_reference_image": True,
        "max_reference_images_per_turn": 1,
        "supported_aspect_ratios": ["1:1", "4:5", "9:16", "16:9", "3:2"],
        "supported_formats": ["original", "png", "jpg", "webp"],
        "max_concurrency": 1,
        "rate_limit_note": "Requires OpenAI API Key in Settings · Quota governed by OpenAI tier",
        "cost_estimate": "~$0.04–$0.08 per image",
    },
}

# Built-in Variation & Fixed Element Presets for the Create / Plan Studio
STUDIO_PRESETS: List[Dict[str, Any]] = [
    {
        "id": "auto_universal",
        "label": "Universal Adaptive (Default)",
        "description": "Versatile, subject-faithful variations that adapt naturally to any theme or reference image.",
        "fixed_elements": {
            "subject": "",
            "style": "High-resolution editorial photography, crisp focus, authentic texture",
            "color_palette": "Harmonious tones faithful to the theme and reference",
            "brand_mood": "Refined, clean, cohesive visual storytelling",
        },
        "variation_axes": {
            "camera_angles": [
                "Close-up three-quarter angle focusing on primary subject details",
                "Overhead top-down flatlay perspective",
                "Intimate macro close-up highlighting fine surface texture and finish",
                "Soft eye-level editorial framing with shallow depth of field",
                "Angled profile view with clean background separation",
                "Balanced medium framing showing subject in natural context",
            ],
            "lighting": [
                "Soft diffused natural window light with gentle highlights",
                "Warm golden-hour sunlight with luminous surface tones",
                "Clean studio softbox lighting with crisp specular reflections",
                "Bright airy daylight with soft shadow roll-off",
                "Warm ambient indoor glow with subtle rim lighting",
                "High-clarity editorial key light emphasizing gloss and texture",
            ],
            "compositions": [
                "Centered hero framing with clean negative space",
                "Rule-of-thirds placement with subtle complementary styling",
                "Tight detail crop emphasizing form, finish, and craftsmanship",
                "Diagonal dynamic composition with soft foreground depth",
                "Symmetrical editorial balance",
                "Layered close-up composition with creamy bokeh background",
            ],
            "atmospheres": [
                "Authentic environment naturally suited to the subject",
                "Clean minimalist backdrop with subtle tonal depth",
                "Warm contemporary setting with balanced depth",
                "Refined editorial backdrop with subtle tonal gradient",
                "Natural daylight setting with organic textures",
                "Polished atmospheric environment with soft reflections",
            ],
        },
    },
    {
        "id": "beauty_fashion",
        "label": "Beauty, Nails & Fashion",
        "description": "Close-up beauty, manicure, jewelry, and fashion lookbook variations with flattering skin & gloss lighting.",
        "fixed_elements": {
            "subject": "Close-up beauty / manicure / styling detail",
            "style": "High-end beauty editorial photography, 100mm macro lens, luminous skin and gloss finish",
            "color_palette": "Flattering warm skin tones, rich pigment fidelity, soft neutral backdrop",
            "brand_mood": "Polished, modern luxury, effortless elegance",
        },
        "variation_axes": {
            "camera_angles": [
                "Intimate macro close-up on hands and nail artistry",
                "Elegant three-quarter hand pose resting on soft fabric",
                "Overhead flatlay hand composition against minimalist surface",
                "Close-up side profile highlighting gloss and contour",
                "Relaxed candid gesture holding a delicate ceramic or glass object",
                "Symmetrical dual-hand editorial beauty pose",
            ],
            "lighting": [
                "Soft diffused beauty dish lighting with crisp gloss catchlights",
                "Warm sunlit window glow across skin and polished surfaces",
                "Bright clean studio daylight with zero harsh shadows",
                "Golden-hour warm rim light with soft fill",
                "Luminous high-key beauty lighting",
                "Subtle dramatic studio spotlight emphasizing rich color depth",
            ],
            "compositions": [
                "Tight macro framing focused on nail finish and detail",
                "Graceful diagonal hand placement with negative space",
                "Rule-of-thirds beauty crop with soft blurred background",
                "Centered editorial composition with tactilesilk or stone prop",
                "Layered foreground-to-background hand pose",
                "Minimalist close-up with clean geometric balance",
            ],
            "atmospheres": [
                "Clean ivory silk and cashmere studio surface",
                "Sunlit travertine vanity with subtle botanical shadow",
                "Warm minimalist salon sanctuary",
                "Soft neutral stone backdrop with diffused daylight",
                "Modern editorial lookbook set with warm tones",
                "Quiet luxury dressing table in morning light",
            ],
        },
    },
    {
        "id": "editorial_product",
        "label": "Product Studio",
        "description": "Tactile studio product photography with controlled directional lighting and clean geometry.",
        "fixed_elements": {
            "subject": "Hero product form and material texture",
            "style": "High-end editorial studio photography, 85mm prime lens, crisp micro-contrast",
            "color_palette": "Warm travertine stone, brushed aluminum, muted charcoal shadows",
            "brand_mood": "Quiet precision, tactile minimalism",
        },
        "variation_axes": {
            "camera_angles": [
                "Three-quarter hero angle at 35 degrees",
                "Top-down 90-degree architectural flatlay",
                "Low-angle monolithic silhouette view",
                "Extreme macro detail on surface texture and edges",
                "Eye-level symmetrical pedestal composition",
                "Off-center diagonal perspective with shallow depth of field",
            ],
            "lighting": [
                "Hard morning side-light casting long geometric shadows",
                "Diffused overhead softbox with subtle rim highlight",
                "Warm golden-hour window shaft across textured stone",
                "High-contrast chiaroscuro spotlight on dark graphite ground",
                "Soft overcast studio bounce with crisp specular reflections",
                "Backlit translucent glow emphasizing silhouette contour",
            ],
            "compositions": [
                "Rule-of-thirds placement balanced by raw mineral prop",
                "Centered monolithic framing with generous negative space",
                "Dynamic diagonal arrangement on stepped plinths",
                "Layered foreground blur leading to sharp hero subject",
                "Minimalist diptych balance with geometric shadow play",
                "Close-cropped asymmetric corner framing",
            ],
            "atmospheres": [
                "Sunlit gallery plinth with travertine and raw linen",
                "Dark basalt studio surface with subtle mist",
                "Brushed concrete workshop bench at dawn",
                "Warm cedar and handmade ceramic backdrop",
                "Monochrome architectural alcove with soft dust motes",
                "Minimalist glass and anodized metal laboratory surface",
            ],
        },
    },
    {
        "id": "architectural_interior",
        "label": "Architecture & Interior",
        "description": "Spatial studies across angles, natural daylight shifts, and material compositions.",
        "fixed_elements": {
            "subject": "Architectural space and curated interior furniture",
            "style": "Editorial architectural digest photography, tilt-shift 24mm rectilinearity",
            "color_palette": "Warm oak, raw plaster, limewash ivory, deep olive foliage",
            "brand_mood": "Serene, lived-in calm, timeless craftsmanship",
        },
        "variation_axes": {
            "camera_angles": [
                "Wide-angle establishing view down the central axis",
                "Intimate corner vignette focused on seating and window light",
                "Framing through an open doorway into an adjacent room",
                "Low tabletop perspective looking toward high ceiling beams",
                "Detail study of joinery, plaster wall, and ceramic vessel",
                "Exterior-to-interior courtyard view at dusk",
            ],
            "lighting": [
                "Crisp early morning sun streaming through linen curtains",
                "Zenithal skylight illumination on textured limewash",
                "Late afternoon amber light raking across floorboards",
                "Soft overcast daylight with warm recessed accent lamps",
                "Blue-hour twilight balanced by warm pendant glow",
                "Dappled courtyard tree shadows across raw stone floor",
            ],
            "compositions": [
                "Symmetrical one-point perspective with deep sightline",
                "Asymmetrical foreground table leading into open lounge",
                "Vertical framing emphasizing floor-to-ceiling aperture",
                "Layered spatial depth across foreground, midground, and courtyard",
                "Minimalist still-life corner with single sculptural chair",
                "Wide panoramic balance of built-in shelving and workspace",
            ],
            "atmospheres": [
                "Quiet morning stillness before the studio opens",
                "Rainy afternoon warmth with soft reflections on wood",
                "Breezy Mediterranean summer noon with open shutters",
                "Autumnal study with dried botanicals and tactile textiles",
                "Nordic winter clarity with pale low-angle sun",
                "Evening sanctuary with sculptural paper lanterns lit",
            ],
        },
    },
    {
        "id": "lifestyle_editorial",
        "label": "Editorial Lifestyle",
        "description": "Candid human-scale moments, natural environments, and cinematic film grain.",
        "fixed_elements": {
            "subject": "Authentic lifestyle moment and artisanal objects",
            "style": "35mm medium-format analog film aesthetic, Kodak Portra tonal range",
            "color_palette": "Earth tones, warm skin highlights, muted sage and espresso",
            "brand_mood": "Unstaged authenticity, tactile storytelling",
        },
        "variation_axes": {
            "camera_angles": [
                "Over-the-shoulder documentary perspective on hands at work",
                "Medium environmental portrait in natural workspace",
                "Close-up tactile interaction with tools and materials",
                "Wide environmental shot anchoring subject in architecture",
                "High-angle café table view capturing movement",
                "Candid profile framed through café window glass",
            ],
            "lighting": [
                "Natural window side-lighting with gentle shadow roll-off",
                "Golden-hour backlight with subtle lens halation",
                "Open shade outdoor clarity with soft ambient fill",
                "Warm tungsten café interior against cool rainy street",
                "Bright morning terrace sunlight with crisp contrast",
                "Dusk ambient glow with soft practical table lamp",
            ],
            "compositions": [
                "Subject in lower-right third with expansive environment",
                "Tight framing on hands, linen apron, and raw craft",
                "Frame-within-a-frame through archway or window",
                "Balanced foreground coffee cup and background artisan",
                "Dynamic candid motion with crisp focal point",
                "Serene negative-space composition against textured wall",
            ],
            "atmospheres": [
                "Bustling morning roastery with steam and natural wood",
                "Quiet ceramic workshop lined with drying bisque ware",
                "Sun-drenched courtyard table with sketchbook and espresso",
                "Rain-streaked window seat in an independent bookshop",
                "Late afternoon studio wrap-up with warm long shadows",
                "Weekend farmers market stall with organic textures",
            ],
        },
    },
    {
        "id": "cinematic_concept",
        "label": "Cinematic Concept",
        "description": "Atmospheric world-building with anamorphic framing, volumetric light, and rich depth.",
        "fixed_elements": {
            "subject": "Core thematic environment and focal motif",
            "style": "Anamorphic cinema lens, 65mm film stock, fine atmospheric depth",
            "color_palette": "Deep slate, warm amber tungsten, muted cyan shadows",
            "brand_mood": "Evocative, narrative-driven, high visual drama",
        },
        "variation_axes": {
            "camera_angles": [
                "Ultra-wide establishing vista with tiny scale figure",
                "Low-angle heroic perspective looking up at structure",
                "Eye-level corridor tracking shot with deep vanishing point",
                "High crane perspective looking down through mist",
                "Intimate close-up on weathered artifact in foreground",
                "Silhouette profile against illuminated horizon",
            ],
            "lighting": [
                "Volumetric god-rays piercing through high clerestory windows",
                "Cold moonlight contrasted with warm amber brazier glow",
                "Diffused fog illumination with soft silhouette separation",
                "Harsh zenithal beam in a dark subterranean chamber",
                "Break of dawn horizon light reflecting on wet stone",
                "Bioluminescent and practical warm lantern interplay",
            ],
            "compositions": [
                "Extreme scale contrast between monolithic architecture and foreground",
                "Leading lines converging on illuminated central threshold",
                "Foreground silhouette framing distant atmospheric vista",
                "Symmetrical monumental framing with water reflection",
                "Layered depth planes separated by rolling ground mist",
                "Asymmetrical cliffside perch overlooking vast expanse",
            ],
            "atmospheres": [
                "Dawn mist rising over ancient Brutalist sanctuary",
                "After-rain stillness with mirror-like basalt puddles",
                "High-altitude observatory under clearing storm clouds",
                "Sunbeams cutting through a towering botanical conservatory",
                "Twilight coastal monolith with calm tidal reflections",
                "Quiet library archive illuminated by warm reading lamps",
            ],
            "enabled_axes": {
                "camera_angles": True,
                "compositions": True,
                "lighting": True,
                "atmospheres": True,
                "custom_axis": False,
            },
            "custom_axis_label": "Scene Detail",
            "custom_axis": [],
        },
    },
    {
        "id": "wallpaper_abstract",
        "label": "Wallpaper & Screen Art",
        "description": "Phone/desktop wallpapers, flowing abstracts & tranquil scenes. Camera Angles disabled by default for clean edge-to-edge fill.",
        "fixed_elements": {
            "subject": "Edge-to-edge aesthetic wallpaper composition with tranquil negative space",
            "style": "Ultra-crisp digital wallpaper illustration, silky gradient transitions, 4K retinal clarity",
            "color_palette": "Luminous pastel sage, pearl cream, misty slate blue, soft champagne highlights",
            "brand_mood": "Calm, mesmerizing, clean lockscreen visual harmony",
        },
        "variation_axes": {
            "camera_angles": [
                "Pure straight-on full-bleed wallpaper framing",
            ],
            "lighting": [
                "Soft iridescent prism glow sweeping diagonally across the canvas",
                "Subtle ambient aurora backlight with velvet gradient falloff",
                "Warm morning window light wash without harsh highlights",
                "Luminous opal rim glow separating layered translucent planes",
                "Serene pastel twilight gradient illumination",
                "Minimalist studio softbox sheen across matte pigment textures",
            ],
            "compositions": [
                "Upper clean breathing negative space ideal for lockscreen clock widgets",
                "Flowing diagonal ribbon motif sweeping from bottom-left to top-right",
                "Centered floating organic sculptural form surrounded by air",
                "Layered misty horizon bands from dark base to airy crown",
                "Minimalist asymmetrical balance concentrated in lower third",
                "Seamless organic wave ripples radiating softly outward",
            ],
            "atmospheres": [
                "Translucent frosted glass & botanical silhouette veil",
                "Liquid silk wave backdrop with fine film pearl grain",
                "Calm alpine dawn mist fading into pearl sky",
                "Sunlit rippled water caustic pattern on sand-toned backdrop",
                "Abstract mineral marble vein texture with matte depth",
                "Dreamy botanical petal shadow overlay on limewash ground",
            ],
            "enabled_axes": {
                "camera_angles": False,
                "compositions": True,
                "lighting": True,
                "atmospheres": True,
                "custom_axis": True,
            },
            "custom_axis_label": "Color Flow & Visual Motif",
            "custom_axis": [
                "Translucent layered botanical silhouettes drifting gently",
                "Sculpted organic sand dunes with soft matte ripple gradients",
                "Liquid pearl glass waves refracting pale pastel light",
                "Minimalist celestial crescent arcs against textured linen wash",
                "Flowing ink-in-water wisps suspended in calm negative space",
                "Geometric Bauhaus soft arches with tactile paper grain",
            ],
        },
    },
    {
        "id": "fine_art_painting",
        "label": "Painting, Charcoal & Art",
        "description": "Charcoal sketches, watercolor, oil & gouache paintings. Disables rigid camera angles in favor of brushwork, canvas & composition.",
        "fixed_elements": {
            "subject": "Expressive traditional fine art study focusing on form, tonal contrast, and soul",
            "style": "Authentic hand-crafted fine art painting/drawing, visible brush & charcoal grain on cold-press rag paper",
            "color_palette": "Deep velvety charcoal black, warm raw umber, unbleached ivory paper, muted sepia midtones",
            "brand_mood": "Evocative, timeless atelier mastery, raw tactile emotion",
        },
        "variation_axes": {
            "camera_angles": [
                "Flat straight-on frontal artwork view filling the entire canvas",
            ],
            "lighting": [
                "Classical chiaroscuro chiaroscuro side-illumination carving deep shadow planes",
                "Soft north-facing atelier skylight revealing subtle midtone gradations",
                "Warm candlelight rim glow picking out textured highlight strokes",
                "High-key luminous wash leaving generous untouched ivory highlights",
                "Moody stormy diffused light with velvety dark tonal depth",
                "Crisp late-afternoon raking light across impasto & paper tooth",
            ],
            "compositions": [
                "Classical triangular study anchored near center canvas with fading vignette edges",
                "Off-center expressive portrait crop fading organically into raw paper grain",
                "Sweeping diagonal gesture study balancing dense charcoal strokes with negative space",
                "Intimate close crop emphasizing eyes, hand gesture, or core focal brushwork",
                "Minimalist zenith balance with delicate unfinished pencil construction lines",
                "Tall vertical scroll balance with atmospheric ink & pigment fade",
            ],
            "atmospheres": [
                "Raw cold-press heavyweight cotton paper grain with dusty charcoal smudges",
                "Aged warm parchment tone with subtle sepia wash undertones",
                "Expressive textured linen canvas showing rich palette-knife underpainting",
                "Mist-softened tonal ground evoking romantic impressionist stillness",
                "High-contrast monochrome gallery study with crisp dry-brush edges",
                "Translucent wet-on-wet watercolor bleed softening outer contours",
            ],
            "enabled_axes": {
                "camera_angles": False,
                "compositions": True,
                "lighting": True,
                "atmospheres": True,
                "custom_axis": True,
            },
            "custom_axis_label": "Medium, Stroke & Texture",
            "custom_axis": [
                "Bold willow charcoal sweeps blended softly with fingertip sfumato",
                "Fine cross-hatched graphite and compressed charcoal linework accents",
                "Expressive impasto oil brushstrokes with crisp palette-knife ridges",
                "Delicate translucent watercolor glazes layered over loose ink contours",
                "Loose dry-brush gouache highlights lifting off raw toned paper",
                "Velvety konte crayon tonal rubbing paired with sharp white chalk highlights",
            ],
        },
    },
    {
        "id": "front_facing_portrait",
        "label": "Front-Facing & Symmetrical",
        "description": "Locks strict straight-on front perspective (for lookbooks, avatars, posters & symmetrical icons) while varying lighting, styling & backdrop.",
        "fixed_elements": {
            "subject": "Strict straight-on front-facing eye-level hero subject aligned cleanly along central vertical axis",
            "style": "Clean straight-on studio portrait & editorial lookbook photography, 85mm rectilinear prime, zero lens distortion",
            "color_palette": "True-to-life skin/material fidelity, balanced highlights, refined tonal harmony",
            "brand_mood": "Confident, iconic, balanced straight-on visual clarity",
        },
        "variation_axes": {
            "camera_angles": [
                "Strict straight-on 0-degree front-facing eye-level symmetrical view",
            ],
            "lighting": [
                "Symmetrical butterfly beauty key light with crisp eye catchlights",
                "Soft giant octabox frontal wrap with clean backdrop falloff",
                "Warm golden window cross-light sculpted by white bounce fill",
                "Minimalist high-key white sweep studio illumination",
                "Editorial duo-tone rim separation against deep slate studio wall",
                "Gentle overcast daylight clarity with zero harsh nose shadows",
            ],
            "compositions": [
                "Tight symmetrical head-and-shoulders central crop",
                "Balanced medium bust framing centered with generous headroom",
                "Clean full vertical symmetrical hero pose centered frame",
                "Tight frontal detail crop highlighting central symmetry and expression",
                "Editorial central frame with minimalist symmetrical border air",
                "Waist-up frontal lookbook framing centered dead-on",
            ],
            "atmospheres": [
                "Seamless matte oatmeal plaster studio cyclorama",
                "Warm walnut wood & travertine architectural backdrop",
                "Crisp cool dove-grey minimalist gallery wall",
                "Deep moody charcoal backdrop with subtle velvet texture",
                "Sun-washed linen curtain studio corner softly out of focus",
                "Muted sage plaster studio background in natural morning light",
            ],
            "enabled_axes": {
                "camera_angles": False,
                "compositions": True,
                "lighting": True,
                "atmospheres": True,
                "custom_axis": True,
            },
            "custom_axis_label": "Expression, Pose & Styling",
            "custom_axis": [
                "Serene poised expression with relaxed shoulders and subtle wardrobe texture",
                "Warm understated confident gaze with clean minimalist collar styling",
                "Editorial high-fashion neutral poise showcasing fine fabric drape",
                "Approachable natural smile resting hands symmetrically near frame edge",
                "Artistic sculptural stillness with wind-kissed natural hair silhouette",
                "Crisp modern luxury styling with subtle jewelry/material accent",
            ],
        },
    },
    {
        "id": "ecommerce_clean",
        "label": "E-Commerce Clean Plinth",
        "description": "Commercial hero angles, top-down flatlays & clean product surfaces with customizable prop styling.",
        "fixed_elements": {
            "subject": "Clean commercial hero product centered cleanly for effortless visual merchandising",
            "style": "Ultra-sharp commercial catalog & studio product photography, 90mm macro prime, color-accurate",
            "color_palette": "Crisp neutral limestone, pure porcelain white, subtle warm oak and soft slate shadows",
            "brand_mood": "Trustworthy, crisp, high-conversion modern retail",
        },
        "variation_axes": {
            "camera_angles": [
                "Straight-on catalog front elevation on clean plinth",
                "Crisp 35-degree three-quarter commercial product angle",
                "Clean 90-degree overhead flatlay arrangement",
                "Macro close-up highlighting packaging finish, seal, and embossing",
                "Slightly elevated 20-degree tabletop lifestyle perspective",
                "Clean profile silhouette showing sculptural bottle/product contour",
            ],
            "lighting": [
                "Clean diffused commercial softbox wrap eliminating glare",
                "Crisp directional morning sunbeams casting clean shadow lines",
                "Bright studio high-key sweep with soft ground contact shadow",
                "Subtle rim glow tracing translucent packaging edges",
                "Warm natural lifestyle window light with creamy soft fill",
                "Gradient studio cyclorama overhead strip light",
            ],
            "compositions": [
                "Clean central pedestal placement with 35% clean breathing margin",
                "Minimalist staggered pair layout using depth separation",
                "Rule-of-thirds flatlay balanced with crisp ingredient accent",
                "Stepped travertine riser composition anchored lower left",
                "Symmetrical podium hero shot with soft surface reflection",
                "Tight detail crop paired with subtle background brand prop",
            ],
            "atmospheres": [
                "Clean matte porcelain pedestal against warm ivory sweep",
                "Brushed cream limestone tabletop in airy daylight studio",
                "Refined frosted acrylic surface with crisp minimalist shadow",
                "Warm pale oak display counter in contemporary boutique light",
                "Cool slate stone surface with subtle water droplets",
                "Minimalist terracotta and raw travertine architectural corner",
            ],
            "enabled_axes": {
                "camera_angles": True,
                "compositions": True,
                "lighting": True,
                "atmospheres": True,
                "custom_axis": True,
            },
            "custom_axis_label": "Surface Prop & Accent",
            "custom_axis": [
                "Paired with minimal raw botanical sprig and clean stone block",
                "Set beside subtle frosted glass dish and raw ceramic tray",
                "Framed by crisp geometric paper shadow and single mineral stone",
                "Styled cleanly on folded neutral linen with zero visual clutter",
                "Resting on rippled clear water mirror plinth",
                "Minimalist pure pedestal with zero extra props for catalog clarity",
            ],
        },
    },
]

# Default Studio Settings stored in SQLite `settings`
DEFAULT_SETTINGS: Dict[str, Any] = {
    "default_model": "chrome-cdp/gemini",
    "default_target_count": 6,
    "default_batch_size": 4,
    "default_session_cap": 20,
    "default_aspect_ratio": "1:1",
    "default_metadata_language": "English",
    "default_metadata_export_mode": "csv",  # csv | none
    "default_filename_style": "picassy_slug",  # picassy_slug | studio_seq
    "default_caption_prompt": DEFAULT_CAPTION_PROMPT,
    "use_ai_caption_prompt": True,
    "metadata_provider": "auto",  # auto | gemini | openai | openai_compatible | browser_cdp | template
    "metadata_model": "gemini-2.0-flash",
    "metadata_api_base_url": "",
    "metadata_api_key": "",
    "metadata_vision_mode": "thumbnail_512",  # thumbnail_512 | text_only
    "picassy_categories": list(DEFAULT_PICASSY_CATEGORIES),
    "cdp_slots": [dict(slot) for slot in DEFAULT_CDP_SLOTS],
    "optimize_prompt_english": True,
    "remove_watermark": True,
    "fresh_chat_per_turn": True,
    "max_turn_retries": 1,
    "cdp_turn_watchdog_sec": 30,
    "cdp_recycle_tab_interval": 20,
    "reference_similarity_check": True,
    "drop_ref_on_similarity_retry": True,
    "export_root_dir": str(EXPORTS_DIR),
    "export_image_format": "original",   # original | png | jpg | webp
    "max_concurrency": 4,
    "dhash_warning_threshold": 6,
    "gemini_api_key": "",
    "openai_api_key": "",
    "pinterest_access_token": "",
}

SENSITIVE_SETTING_KEYS = {
    "gemini_api_key",
    "openai_api_key",
    "pinterest_access_token",
    "metadata_api_key",
}


# =============================================================================
# Browser Detection Utilities (for Chrome CDP :9222)
# =============================================================================
def _browser_candidates(kind: str = "chrome") -> List[str]:
    system = platform.system().lower()
    home = os.path.expanduser("~")
    if system == "darwin":
        apps = {
            "chrome": ["Google Chrome.app/Contents/MacOS/Google Chrome"],
            "brave": ["Brave Browser.app/Contents/MacOS/Brave Browser"],
            "edge": ["Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
        }.get(kind, [])
        return [p for rel in apps for p in (f"/Applications/{rel}", f"{home}/Applications/{rel}")]
    if system == "windows":
        pf = os.environ.get("PROGRAMFILES", r"C:\Program Files")
        pf86 = os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")
        local = os.environ.get("LOCALAPPDATA", "")
        rel = {
            "chrome": [os.path.join("Google", "Chrome", "Application", "chrome.exe")],
            "brave": [os.path.join("BraveSoftware", "Brave-Browser", "Application", "brave.exe")],
            "edge": [os.path.join("Microsoft", "Edge", "Application", "msedge.exe")],
        }.get(kind, [])
        return [os.path.join(root, r) for r in rel for root in (pf, pf86, local) if root]
    names = {
        "chrome": ["google-chrome", "google-chrome-stable", "chromium-browser", "chromium"],
        "brave": ["brave-browser", "brave"],
        "edge": ["microsoft-edge", "microsoft-edge-stable"],
    }.get(kind, [])
    return [found for n in names if (found := shutil.which(n))]


def find_browser_executable(kind: str = "chrome") -> Optional[str]:
    if kind == "chrome":
        env_override = os.environ.get("CHROME_EXECUTABLE_PATH")
        if env_override and os.path.exists(env_override):
            return env_override
    for path in _browser_candidates(kind):
        if path and os.path.exists(path):
            return path
    return None


def get_chrome_executable_path() -> str:
    for kind in ("chrome", "brave", "edge"):
        path = find_browser_executable(kind)
        if path:
            return path
    return "chrome.exe" if platform.system().lower() == "windows" else "google-chrome"
