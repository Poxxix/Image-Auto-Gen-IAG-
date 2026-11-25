import base64
import json
from pathlib import Path
import re
import time
from typing import Any, Dict, List, Optional
import requests

from config import AI_ENGINES, CDP_ENDPOINT, PROVIDER_MODELS, STUDIO_PRESETS
from database.db_manager import db
from modules.app_logging import logger
from modules.reference_sources.image_utils import inspect_image_bytes

DEFAULT_CAMERA_ANGLES = [
    "Three-quarter hero angle focusing on primary subject details",
    "Top-down 90-degree overhead perspective",
    "Low-angle heroic perspective emphasizing form and scale",
    "Intimate macro close-up highlighting fine surface texture and craft",
    "Wide environmental establishing frame with clean depth",
    "Soft eye-level framing with shallow depth of field",
    "Angled profile view with crisp background separation",
    "Symmetrical central-axis perspective",
]

DEFAULT_LIGHTING = [
    "Soft diffused natural light with gentle highlights",
    "Warm golden-hour directional light with luminous tones",
    "High-contrast dramatic key light with sculpted shadows",
    "Crisp studio rim lighting emphasizing silhouette and contour",
    "Bright airy ambient illumination with soft shadow roll-off",
    "Atmospheric twilight glow balanced with warm accent light",
    "Backlit translucent glow highlighting edges and depth",
    "Clean balanced directional light emphasizing texture",
]

DEFAULT_COMPOSITIONS = [
    "Centered hero framing with clean negative space",
    "Rule-of-thirds placement with balanced visual weight",
    "Layered foreground-to-background depth with soft bokeh",
    "Dynamic diagonal arrangement across the frame",
    "Tight detail crop emphasizing form and focal motif",
    "Symmetrical editorial balance with clean geometry",
    "Wide contextual framing anchoring subject in its environment",
    "Asymmetrical gallery framing with strong leading lines",
]

DEFAULT_ATMOSPHERES = [
    "Authentic environment tailored naturally to the core subject",
    "Clean minimalist backdrop with subtle tonal depth",
    "Warm atmospheric setting with rich environmental storytelling",
    "Crisp high-clarity setting emphasizing subject presence",
    "Moody cinematic ambiance with subtle depth and texture",
    "Vibrant natural surroundings complementing the theme palette",
    "Refined curated space with harmonious contextual details",
    "Serene atmospheric sanctuary with soft ambient reflections",
]


DEFAULT_ENABLED_AXES: Dict[str, bool] = {
    "camera_angles": True,
    "compositions": True,
    "lighting": True,
    "atmospheres": True,
    "custom_axis": False,
}

DEFAULT_ENABLED_FIXED: Dict[str, bool] = {
    "subject": True,
    "style": True,
    "color_palette": True,
    "brand_mood": True,
}

MICRO_VARIATION_NUANCES = [
    "natural focal emphasis",
    "subtle tonal contrast",
    "balanced spatial rhythm",
    "rich fine surface detail",
    "soft organic transition",
    "crisp foreground separation",
    "quiet atmospheric depth",
    "refined edge delineation",
    "fresh visual cadence",
    "articulate micro-texture",
]


def _clean_list(items: Any, fallback: List[str]) -> List[str]:
    if isinstance(items, list):
        cleaned = [str(x).strip() for x in items if str(x).strip()]
        if cleaned:
            return cleaned
    elif isinstance(items, str) and items.strip():
        parts = [p.strip() for p in items.replace("\n", ";").split(";") if p.strip()]
        if parts:
            return parts
    return list(fallback)


def normalize_enabled_axes(
    raw_enabled: Any = None,
    preset_enabled: Any = None,
    has_custom_pool: bool = False,
) -> Dict[str, bool]:
    out = dict(DEFAULT_ENABLED_AXES)
    for src in (preset_enabled, raw_enabled):
        if isinstance(src, dict):
            for k in ("camera_angles", "compositions", "lighting", "atmospheres", "custom_axis"):
                if k in src and src[k] is not None:
                    out[k] = bool(src[k])
    if not raw_enabled and not preset_enabled and has_custom_pool:
        out["custom_axis"] = True
    return out


def normalize_enabled_fixed(raw_fixed: Optional[Dict[str, Any]] = None) -> Dict[str, bool]:
    out = dict(DEFAULT_ENABLED_FIXED)
    if isinstance(raw_fixed, dict) and isinstance(raw_fixed.get("enabled_fixed"), dict):
        src = raw_fixed["enabled_fixed"]
        for k in ("subject", "style", "color_palette", "brand_mood"):
            if k in src and src[k] is not None:
                out[k] = bool(src[k])
    return out


TupleAxesFixed = tuple[Dict[str, Any], Dict[str, Any]]


def resolve_axes_and_fixed(
    preset_id: str = "",
    fixed_elements: Optional[Dict[str, Any]] = None,
    variation_axes: Optional[Dict[str, Any]] = None,
) -> TupleAxesFixed:
    preset = next((p for p in STUDIO_PRESETS if p["id"] == preset_id), None)
    base_fixed: Dict[str, Any] = dict(preset["fixed_elements"]) if preset else {
        "subject": "",
        "style": "High-end editorial photography, natural tonal range, crisp micro-detail",
        "color_palette": "Balanced natural neutrals, warm highlights, deep graphite shadows",
        "brand_mood": "Refined, calm, authentic visual storytelling",
    }
    if fixed_elements:
        for k, v in fixed_elements.items():
            if k == "enabled_fixed" and isinstance(v, dict):
                base_fixed["enabled_fixed"] = normalize_enabled_fixed({"enabled_fixed": v})
            elif v is not None and str(v).strip():
                base_fixed[k] = str(v).strip()
    if "enabled_fixed" not in base_fixed:
        base_fixed["enabled_fixed"] = normalize_enabled_fixed(fixed_elements)

    preset_axes = preset["variation_axes"] if preset else {}
    raw_axes = variation_axes or {}

    custom_pool = _clean_list(
        raw_axes.get("custom_axis") if "custom_axis" in raw_axes else preset_axes.get("custom_axis"),
        [],
    )
    custom_label = str(
        raw_axes.get("custom_axis_label")
        or preset_axes.get("custom_axis_label")
        or "Custom Variation Axis"
    ).strip() or "Custom Variation Axis"

    enabled_axes = normalize_enabled_axes(
        raw_enabled=raw_axes.get("enabled_axes"),
        preset_enabled=preset_axes.get("enabled_axes"),
        has_custom_pool=bool(custom_pool),
    )

    resolved_axes: Dict[str, Any] = {
        "camera_angles": _clean_list(
            raw_axes.get("camera_angles") if raw_axes.get("camera_angles") is not None else preset_axes.get("camera_angles"),
            DEFAULT_CAMERA_ANGLES,
        ),
        "lighting": _clean_list(
            raw_axes.get("lighting") if raw_axes.get("lighting") is not None else preset_axes.get("lighting"),
            DEFAULT_LIGHTING,
        ),
        "compositions": _clean_list(
            raw_axes.get("compositions") if raw_axes.get("compositions") is not None else preset_axes.get("compositions"),
            DEFAULT_COMPOSITIONS,
        ),
        "atmospheres": _clean_list(
            raw_axes.get("atmospheres") if raw_axes.get("atmospheres") is not None else preset_axes.get("atmospheres"),
            DEFAULT_ATMOSPHERES,
        ),
        "custom_axis": custom_pool,
        "custom_axis_label": custom_label,
        "enabled_axes": enabled_axes,
    }
    return base_fixed, resolved_axes


def compose_prompt_from_axes(
    theme: str,
    base_prompt: str,
    aspect_ratio: str,
    fixed_elements: Dict[str, Any],
    turn_axes: Dict[str, Any],
    has_reference: bool = False,
    reference_reused: bool = False,
    variation_number: int = 1,
    strong_variation: bool = False,
    enabled_axes: Optional[Dict[str, bool]] = None,
    custom_axis_label: str = "Custom Variation",
    nuance_tag: str = "",
) -> str:
    """
    Constructs a rich, deterministic `prompt_final` from the theme, base prompt,
    active Locked Continuity elements, and only the currently enabled Variation Axes.
    """
    ratio_labels = {
        "1:1": "1:1 square frame (1080x1080)",
        "4:5": "4:5 vertical editorial portrait (1080x1350)",
        "9:16": "9:16 full vertical story frame (1080x1920)",
        "16:9": "16:9 widescreen cinema frame (1920x1080)",
        "3:2": "3:2 classic 35mm landscape frame (1620x1080)",
    }
    ratio_desc = ratio_labels.get(aspect_ratio, f"{aspect_ratio} aspect ratio")
    active_axes = normalize_enabled_axes(raw_enabled=enabled_axes)
    active_fixed = normalize_enabled_fixed(fixed_elements)

    segments: List[str] = []
    if has_reference:
        angle_instruction = (
            "camera angle, framing, pose, object placement, or background"
            if active_axes.get("camera_angles", True)
            else "exact composition, styling, lighting, or background details"
        )
        fresh_phrase = (
            "different camera angle, fresh composition, new pose/arrangement, and new background"
            if active_axes.get("camera_angles", True)
            else "fresh composition, distinct lighting, and newly arranged background details"
        )
        if reference_reused or strong_variation:
            segments.append(
                f"Use the attached reference image ONLY for visual DNA (subject motif, finish/texture, color palette, and aesthetic style) for \"{theme.strip()}\". "
                f"CRITICAL: Do NOT copy, trace, or preserve the reference photo's {angle_instruction} — "
                "invent an unmistakably new scene driven by the creative parameters below."
            )
        else:
            segments.append(
                f"Use the attached reference image purely as style and subject inspiration for \"{theme.strip()}\". "
                f"Create a brand-new original visual with a {fresh_phrase} rather than replicating the input image's framing."
            )

    core_theme = f"Theme: \"{theme.strip()}\"."
    if base_prompt and base_prompt.strip():
        core_theme += f" Core concept: {base_prompt.strip().rstrip('.')}."
    segments.append(core_theme)

    # Fixed / Locked continuity elements (respecting individual toggles)
    fixed_parts: List[str] = []
    if active_fixed.get("subject", True) and fixed_elements.get("subject"):
        fixed_parts.append(f"Primary subject: {str(fixed_elements['subject']).rstrip('.')}")
    if active_fixed.get("style", True) and fixed_elements.get("style"):
        fixed_parts.append(f"Visual style: {str(fixed_elements['style']).rstrip('.')}")
    if active_fixed.get("color_palette", True) and fixed_elements.get("color_palette"):
        fixed_parts.append(f"Color palette: {str(fixed_elements['color_palette']).rstrip('.')}")
    if active_fixed.get("brand_mood", True) and fixed_elements.get("brand_mood"):
        fixed_parts.append(f"Mood: {str(fixed_elements['brand_mood']).rstrip('.')}")
    if fixed_parts:
        segments.append(". ".join(fixed_parts) + ".")

    # Distinct variation axes for this specific turn (strictly honoring enabled_axes)
    axis_parts: List[str] = []
    if active_axes.get("camera_angles", True) and turn_axes.get("camera_angle"):
        axis_parts.append(f"Camera & perspective: {str(turn_axes['camera_angle']).rstrip('.')}")
    if active_axes.get("compositions", True) and turn_axes.get("composition"):
        axis_parts.append(f"Composition: {str(turn_axes['composition']).rstrip('.')}")
    if active_axes.get("lighting", True) and turn_axes.get("lighting"):
        axis_parts.append(f"Lighting: {str(turn_axes['lighting']).rstrip('.')}")
    if active_axes.get("atmospheres", True) and turn_axes.get("atmosphere"):
        axis_parts.append(f"Setting & atmosphere: {str(turn_axes['atmosphere']).rstrip('.')}")
    if turn_axes.get("custom_axis") and (active_axes.get("custom_axis", False) or "custom_axis" in turn_axes):
        lbl = str(turn_axes.get("custom_axis_label") or custom_axis_label or "Custom Detail").strip()
        axis_parts.append(f"{lbl}: {str(turn_axes['custom_axis']).rstrip('.')}")
    if nuance_tag:
        axis_parts.append(f"Study nuance: {nuance_tag.rstrip('.')}")
    if axis_parts:
        segments.append(". ".join(axis_parts) + ".")

    segments.append(
        f"Format: {ratio_desc} (Set variation #{variation_number}). "
        "Pure visual photograph/artwork only — no embedded text, no watermarks, no borders."
    )
    return " ".join(segments)


def plan_job_variations(
    theme: str,
    count: int = 6,
    start_index: int = 1,
    base_prompt: str = "",
    aspect_ratio: str = "1:1",
    model: str = "chrome-cdp/gemini",
    reference_mode: str = "prompt_only",
    reference_ids: Optional[List[int]] = None,
    cycle_references: bool = True,
    preset_id: str = "",
    fixed_elements: Optional[Dict[str, Any]] = None,
    variation_axes: Optional[Dict[str, Any]] = None,
    existing_prompts: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """
    Plans `count` distinct turns starting at `start_index` (scales cleanly from 1 to 1000+):
    1. Model capability validation (`supports_reference_image`).
    2. Reference pairing and optional cycling (`cycle_references`).
    3. Distinct variation axes across only enabled axes (Camera, Composition, Lighting, Atmosphere, Custom Axis).
    4. Zero duplicate `(prompt_final, reference_id)` pairs even at 1,000-image scale.
    """
    model_info = PROVIDER_MODELS.get(model) or PROVIDER_MODELS["chrome-cdp/gemini"]
    refs = list(reference_ids or []) if reference_mode != "prompt_only" else []

    if refs and not model_info.get("supports_reference_image", True):
        raise ValueError(
            f"Selected model '{model_info['label']}' does not support reference image inputs. "
            "Switch to a model with reference support or select 'Prompt Only' mode."
        )

    resolved_fixed, resolved_axes = resolve_axes_and_fixed(
        preset_id=preset_id,
        fixed_elements=fixed_elements,
        variation_axes=variation_axes,
    )

    enabled_axes = resolved_axes.get("enabled_axes") or dict(DEFAULT_ENABLED_AXES)
    angles = resolved_axes["camera_angles"]
    lights = resolved_axes["lighting"]
    comps = resolved_axes["compositions"]
    atmos = resolved_axes["atmospheres"]
    custom_pool = resolved_axes.get("custom_axis") or []
    custom_label = resolved_axes.get("custom_axis_label") or "Custom Variation Axis"

    # Compute raw Cartesian capacity across enabled axes so large sets (100-1000) seamlessly layer nuances
    raw_capacity = 1
    if enabled_axes.get("camera_angles", True) and angles:
        raw_capacity *= len(angles)
    if enabled_axes.get("compositions", True) and comps:
        raw_capacity *= len(comps)
    if enabled_axes.get("lighting", True) and lights:
        raw_capacity *= len(lights)
    if enabled_axes.get("atmospheres", True) and atmos:
        raw_capacity *= len(atmos)
    if enabled_axes.get("custom_axis", False) and custom_pool:
        raw_capacity *= len(custom_pool)

    used_prompts: set[str] = {p.strip().lower() for p in (existing_prompts or []) if p}
    ref_use_counts: Dict[int, int] = {}
    planned_turns: List[Dict[str, Any]] = []

    for offset in range(count):
        idx = start_index + offset  # 1-based index in the job
        zero_idx = idx - 1

        # Determine reference_id for this turn
        ref_id: Optional[int] = None
        if refs:
            if offset < len(refs):
                ref_id = refs[offset]
            elif cycle_references:
                ref_id = refs[zero_idx % len(refs)]
            else:
                ref_id = None

        ref_reused = False
        if ref_id is not None:
            prev_uses = ref_use_counts.get(ref_id, 0)
            ref_reused = prev_uses > 0
            ref_use_counts[ref_id] = prev_uses + 1

        reuse_shift = ref_use_counts.get(ref_id, 0) if ref_id is not None else 0
        cycle_tier = zero_idx // max(1, raw_capacity)
        attempt = 0
        while True:
            step = zero_idx + attempt + reuse_shift
            # Spread across enabled pools using prime offsets so 100-1000 turns explore full Cartesian space
            a_idx = step % len(angles)
            c_idx = (step // max(1, len(angles)) + step * 2 + 1 + attempt) % len(comps)
            l_idx = (step // max(1, len(angles) * len(comps)) + step * 3 + 2 + attempt * 2) % len(lights)
            m_idx = (step * 5 + 3 + attempt * 3 + (step // max(1, len(lights)))) % len(atmos)

            turn_axes: Dict[str, Any] = {
                "camera_angle": angles[a_idx] if enabled_axes.get("camera_angles", True) else "",
                "composition": comps[c_idx] if enabled_axes.get("compositions", True) else "",
                "lighting": lights[l_idx] if enabled_axes.get("lighting", True) else "",
                "atmosphere": atmos[m_idx] if enabled_axes.get("atmospheres", True) else "",
            }
            if enabled_axes.get("custom_axis", False) and custom_pool:
                x_idx = (step * 7 + attempt + cycle_tier) % len(custom_pool)
                turn_axes["custom_axis"] = custom_pool[x_idx]
                turn_axes["custom_axis_label"] = custom_label

            nuance = ""
            if cycle_tier > 0 or attempt > 0:
                nuance = MICRO_VARIATION_NUANCES[(cycle_tier + attempt + step) % len(MICRO_VARIATION_NUANCES)]

            prompt_final = compose_prompt_from_axes(
                theme=theme,
                base_prompt=base_prompt,
                aspect_ratio=aspect_ratio,
                fixed_elements=resolved_fixed,
                turn_axes=turn_axes,
                has_reference=(ref_id is not None),
                reference_reused=ref_reused,
                variation_number=idx,
                enabled_axes=enabled_axes,
                custom_axis_label=custom_label,
                nuance_tag=nuance,
            )
            norm = prompt_final.strip().lower()
            if norm not in used_prompts or attempt >= 24:
                used_prompts.add(norm)
                break
            attempt += 1

        planned_turns.append(
            {
                "index_num": idx,
                "prompt_final": prompt_final,
                "reference_id": ref_id,
                "fixed_elements": resolved_fixed,
                "variation_axes": turn_axes,
                "model": model,
                "is_locked": False,
                "status": "planned",
            }
        )

    return planned_turns


def mutate_generation_variation(
    job: Dict[str, Any],
    generation: Dict[str, Any],
    existing_prompts: List[str],
) -> Dict[str, Any]:
    """
    Rotates the active variation axes of a single generation to produce a fresh,
    non-duplicate `prompt_final` (used when regenerating a turn or resolving similarity).
    """
    resolved_fixed, resolved_axes = resolve_axes_and_fixed(
        preset_id=job.get("preset_id") or "",
        fixed_elements=job.get("fixed_elements"),
        variation_axes=job.get("variation_axes"),
    )
    enabled_axes = resolved_axes.get("enabled_axes") or dict(DEFAULT_ENABLED_AXES)
    angles = resolved_axes["camera_angles"]
    lights = resolved_axes["lighting"]
    comps = resolved_axes["compositions"]
    atmos = resolved_axes["atmospheres"]
    custom_pool = resolved_axes.get("custom_axis") or []
    custom_label = resolved_axes.get("custom_axis_label") or "Custom Variation Axis"

    current_axes = generation.get("variation_axes") or {}
    used = {p.strip().lower() for p in existing_prompts if p}
    used.add((generation.get("prompt_final") or "").strip().lower())

    idx = int(generation.get("index_num") or 1)
    ref_id = generation.get("reference_id")

    for shift in range(1, 24):
        step = idx + shift * 3
        new_axes: Dict[str, Any] = {
            "camera_angle": angles[step % len(angles)] if enabled_axes.get("camera_angles", True) else "",
            "composition": comps[(step + shift * 2) % len(comps)] if enabled_axes.get("compositions", True) else "",
            "lighting": lights[(step + shift * 5) % len(lights)] if enabled_axes.get("lighting", True) else "",
            "atmosphere": atmos[(step + shift * 7) % len(atmos)] if enabled_axes.get("atmospheres", True) else "",
        }
        if enabled_axes.get("custom_axis", False) and custom_pool:
            new_axes["custom_axis"] = custom_pool[(step + shift * 11) % len(custom_pool)]
            new_axes["custom_axis_label"] = custom_label

        if new_axes == current_axes and shift < 12:
            continue
        nuance = MICRO_VARIATION_NUANCES[shift % len(MICRO_VARIATION_NUANCES)] if shift >= 6 else ""
        new_prompt = compose_prompt_from_axes(
            theme=job["theme"],
            base_prompt=job.get("base_prompt") or "",
            aspect_ratio=job.get("aspect_ratio") or "1:1",
            fixed_elements=resolved_fixed,
            turn_axes=new_axes,
            has_reference=bool(ref_id),
            reference_reused=True,
            variation_number=idx,
            enabled_axes=enabled_axes,
            custom_axis_label=custom_label,
            nuance_tag=nuance,
        )
        if new_prompt.strip().lower() not in used:
            return {
                "prompt_final": new_prompt,
                "variation_axes": new_axes,
                "fixed_elements": resolved_fixed,
            }

    return {
        "prompt_final": generation.get("prompt_final") or "",
        "variation_axes": current_axes,
        "fixed_elements": resolved_fixed,
    }


# =============================================================================
# 3-Tier AI Axes & Continuity Suggestion Engine
# =============================================================================
def build_axes_suggestion_prompt(
    theme: str,
    base_prompt: str = "",
    has_reference: bool = False,
) -> str:
    ref_note = (
        "Also analyze the attached reference image to extract its exact visual medium, lighting mood, and color palette. "
        if has_reference
        else ""
    )
    base_note = (
        f"Base visual direction: \"{base_prompt.strip()}\". "
        if base_prompt and base_prompt.strip()
        else ""
    )
    return (
        f"You are an expert Visual Creative Director planning a cohesive multi-shot image set for the theme: \"{theme.strip()}\". "
        f"{base_note}{ref_note}"
        "Determine whether traditional camera angle rotation makes sense for this theme (for wallpapers, 2D paintings/drawings, or straight-on front-facing portraits, set `enabled_axes.camera_angles` to false and instead use `custom_axis` for brushwork/motif/pose variations). "
        "Design a custom set of Locked Continuity Elements plus Variation Axes (6 distinct options per enabled axis) tailored 100% to this specific theme.\n"
        "IMPORTANT: Do NOT generate any image right now — reply ONLY with a single valid JSON object in this exact schema:\n"
        "```json\n"
        "{\n"
        '  "fixed_elements": {\n'
        '    "subject": "Concise description of the locked primary subject / motif",\n'
        '    "style": "Specific visual medium, rendering/camera style, lens or artistic technique",\n'
        '    "color_palette": "Specific harmonious color palette tailored to this theme",\n'
        '    "brand_mood": "Core emotional tone and aesthetic mood"\n'
        "  },\n"
        '  "variation_axes": {\n'
        '    "enabled_axes": {\n'
        '      "camera_angles": true,\n'
        '      "compositions": true,\n'
        '      "lighting": true,\n'
        '      "atmospheres": true,\n'
        '      "custom_axis": true\n'
        "    },\n"
        '    "custom_axis_label": "Optional 5th Domain Axis (e.g. Brushwork & Surface, Pose & Styling, Pattern Flow)",\n'
        '    "camera_angles": [\n'
        '      "6 distinct camera angles (or 1 straight-on rule if disabled)"\n'
        "    ],\n"
        '    "compositions": [\n'
        '      "6 distinct framing, layout, or staging compositions"\n'
        "    ],\n"
        '    "lighting": [\n'
        '      "6 distinct lighting setups or illumination moods"\n'
        "    ],\n"
        '    "atmospheres": [\n'
        '      "6 distinct environments, backgrounds, or paper/canvas grounds fitting this theme"\n'
        "    ],\n"
        '    "custom_axis": [\n'
        '      "6 distinct medium/motif/expression variations specific to this theme"\n'
        "    ]\n"
        "  }\n"
        "}\n"
        "```"
    )


def build_external_master_prompt(
    theme: str = "",
    base_prompt: str = "",
    template_kind: str = "adaptive",
    target_count: int = 20,
    metadata_language: str = "English",
) -> str:
    """
    Generates a copy-ready Master Prompt users can paste into any external AI
    (ChatGPT, Gemini, Claude, Grok) to co-design their exact Studio JSON configuration
    and import/paste it back into CreateScreen or PlanScreen.
    """
    theme_txt = theme.strip() or "<INSERT YOUR TOPIC / SUBJECT HERE — e.g. Dark Botanical Phone Wallpapers / Charcoal Portraits / Minimalist Skincare>"
    base_txt = base_prompt.strip() or "<Optional style direction, target platform (Pinterest / Etsy / Lockscreen), or constraints>"

    kind_guidance = {
        "wallpaper": "This is a WALLPAPER / SCREEN ART set. Set `enabled_axes.camera_angles = false` (never rotate tilted cameras!). Focus on clean negative space for clocks/widgets, `compositions`, `lighting`, `atmospheres`, and use `custom_axis` for visual motif / color gradient flow.",
        "painting": "This is a PAINTING / DRAWING / FINE ART set (charcoal, watercolor, oil, ink, illustration). Set `enabled_axes.camera_angles = false` so it stays flat frontal artwork. Focus on `compositions`, `lighting`, `atmospheres` (paper/canvas texture), and use `custom_axis` for brushwork / medium / stroke variation.",
        "front_facing": "This is a FRONT-FACING / SYMMETRICAL HERO set. Set `enabled_axes.camera_angles = false` and explicitly lock strict straight-on eye-level 0-degree front perspective inside `fixed_elements.subject`. Use `compositions`, `lighting`, `atmospheres`, and `custom_axis` for expression / pose / styling variations.",
        "photography": "This is an EDITORIAL PHOTOGRAPHY set. Keep `camera_angles`, `compositions`, `lighting`, and `atmospheres` enabled with varied photographic lenses and angles.",
    }.get(
        (template_kind or "adaptive").lower(),
        "Automatically decide whether `camera_angles` should be true or false (set false for wallpapers, paintings, or front-facing portraits) and optionally activate `custom_axis` for subject-specific diversity.",
    )

    options_hint = (
        "6 to 10 diverse options per enabled axis (to easily permute cleanly across large sets)"
        if target_count >= 50
        else "6 distinct, non-overlapping options per enabled axis"
    )

    sample_schema = {
        "theme": theme.strip() or "My Custom Image Set",
        "base_prompt": base_prompt.strip() or "High-craft cohesive visual series",
        "aspect_ratio": "4:5",
        "fixed_elements": {
            "subject": "Locked primary subject, framing rule (e.g. straight-on front view), or focal motif",
            "style": "Locked medium, camera/brush technique, fidelity, finish",
            "color_palette": "Locked cohesive palette (3-5 harmonious tones)",
            "brand_mood": "Locked emotional tone & aesthetic mood",
            "enabled_fixed": {
                "subject": True,
                "style": True,
                "color_palette": True,
                "brand_mood": True,
            },
        },
        "variation_axes": {
            "enabled_axes": {
                "camera_angles": (template_kind or "").lower() == "photography",
                "compositions": True,
                "lighting": True,
                "atmospheres": True,
                "custom_axis": True,
            },
            "custom_axis_label": "Brushwork, Motif & Styling",
            "camera_angles": [
                "Provide 6-8 camera angles if camera_angles is true, or keep empty [] if disabled"
            ],
            "compositions": [
                "Option 1...", "Option 2...", "Option 3...", "Option 4...", "Option 5...", "Option 6..."
            ],
            "lighting": [
                "Option 1...", "Option 2...", "Option 3...", "Option 4...", "Option 5...", "Option 6..."
            ],
            "atmospheres": [
                "Option 1...", "Option 2...", "Option 3...", "Option 4...", "Option 5...", "Option 6..."
            ],
            "custom_axis": [
                "Option 1...", "Option 2...", "Option 3...", "Option 4...", "Option 5...", "Option 6..."
            ],
        },
    }
    schema_json = json.dumps(sample_schema, indent=2, ensure_ascii=False)

    return (
        "Act as a Senior Visual Creative Director & Prompt Architect.\n"
        f"I am creating a batch of ~{max(1, target_count)} consistent, high-converting images.\n\n"
        f"- **Theme / Subject:** {theme_txt}\n"
        f"- **Extra Notes / Visual Direction:** {base_txt}\n"
        f"- **Structure Guidance:** {kind_guidance}\n"
        f"- **Caption Language Target:** {metadata_language}\n\n"
        "Please ask clarifying suggestions only if critical, OR directly generate a ready-to-import Studio Configuration.\n"
        f"Provide {options_hint}, keeping visual prompts in natural English.\n\n"
        "Return a **single valid JSON code block** using this exact structure so I can paste/import it straight back into my app:\n"
        f"```json\n{schema_json}\n```"
    )


def _extract_list_alias(mapping: Dict[str, Any], *keys: str) -> List[str]:
    for key in keys:
        val = mapping.get(key)
        if isinstance(val, list):
            cleaned = [str(x).strip() for x in val if str(x).strip()]
            if cleaned:
                return cleaned
        elif isinstance(val, str) and val.strip():
            parts = [p.strip() for p in val.replace("\n", ";").split(";") if p.strip()]
            if parts:
                return parts
    return []


def parse_external_axes_import(text: str) -> Optional[Dict[str, Any]]:
    """
    Flexibly parses JSON (including Markdown fenced code blocks or partial schemas)
    produced by an external AI assistant (ChatGPT / Gemini / Claude / Grok) or user upload.
    Accepts full configs, partial enabled_axes, custom_axis, and alternate key names.
    """
    if not text or not text.strip():
        return None
    cleaned = text.strip()
    blocks = re.findall(r"```(?:json)?\s*(\{.*?\})\s*```", cleaned, flags=re.DOTALL)
    first_b = cleaned.find("{")
    last_b = cleaned.rfind("}")
    if first_b != -1 and last_b > first_b:
        blocks.append(cleaned[first_b : last_b + 1])

    for cand in reversed(blocks):
        try:
            parsed = json.loads(cand)
            if not isinstance(parsed, dict):
                continue

            fe = parsed.get("fixed_elements") or parsed.get("continuity") or {}
            va = parsed.get("variation_axes") or parsed.get("axes") or {}
            if not isinstance(fe, dict):
                fe = {}
            if not isinstance(va, dict):
                va = {}

            # Also tolerate flat keys at root if user pasted flat JSON
            source_va = va if va else parsed

            angles = _extract_list_alias(source_va, "camera_angles", "camera_angle", "angles", "perspectives")
            comps = _extract_list_alias(source_va, "compositions", "composition", "framing", "layouts")
            lights = _extract_list_alias(source_va, "lighting", "lighting_setups", "light")
            atmos = _extract_list_alias(source_va, "atmospheres", "atmosphere", "settings", "backgrounds", "environments")
            custom_axis = _extract_list_alias(source_va, "custom_axis", "custom", "motif_variations", "style_variations")
            custom_label = str(
                source_va.get("custom_axis_label")
                or parsed.get("custom_axis_label")
                or "Custom Variation Axis"
            ).strip() or "Custom Variation Axis"

            # Must have at least 2 options in at least ONE axis to be a valid axes config
            total_options = len(angles) + len(comps) + len(lights) + len(atmos) + len(custom_axis)
            if total_options < 2 and not fe:
                continue

            raw_enabled = source_va.get("enabled_axes") or parsed.get("enabled_axes")
            if isinstance(raw_enabled, dict):
                enabled_axes = normalize_enabled_axes(raw_enabled=raw_enabled, has_custom_pool=bool(custom_axis))
            else:
                enabled_axes = {
                    "camera_angles": len(angles) > 0,
                    "compositions": len(comps) > 0 or total_options == 0,
                    "lighting": len(lights) > 0 or total_options == 0,
                    "atmospheres": len(atmos) > 0 or total_options == 0,
                    "custom_axis": len(custom_axis) > 0,
                }

            enabled_fixed = normalize_enabled_fixed(fe)

            out: Dict[str, Any] = {
                "fixed_elements": {
                    "subject": str(fe.get("subject") or parsed.get("subject") or "").strip(),
                    "style": str(fe.get("style") or parsed.get("style") or "").strip(),
                    "color_palette": str(fe.get("color_palette") or fe.get("palette") or parsed.get("color_palette") or "").strip(),
                    "brand_mood": str(fe.get("brand_mood") or fe.get("mood") or parsed.get("brand_mood") or "").strip(),
                    "enabled_fixed": enabled_fixed,
                },
                "variation_axes": {
                    "camera_angles": (angles or [])[:24],
                    "compositions": (comps or [])[:24],
                    "lighting": (lights or [])[:24],
                    "atmospheres": (atmos or [])[:24],
                    "custom_axis": (custom_axis or [])[:24],
                    "custom_axis_label": custom_label,
                    "enabled_axes": enabled_axes,
                },
            }
            if parsed.get("theme"):
                out["theme"] = str(parsed["theme"]).strip()
            if parsed.get("base_prompt"):
                out["base_prompt"] = str(parsed["base_prompt"]).strip()
            if parsed.get("aspect_ratio") and str(parsed["aspect_ratio"]).strip() in ("1:1", "4:5", "9:16", "16:9", "3:2"):
                out["aspect_ratio"] = str(parsed["aspect_ratio"]).strip()
            return out
        except Exception:
            continue
    return None


def parse_suggested_axes_json(text: str) -> Optional[Dict[str, Any]]:
    res = parse_external_axes_import(text)
    if not res:
        return None
    va = res.get("variation_axes") or {}
    # Require reasonable richness for AI Suggest autocomplete
    non_empty_axes = sum(
        1
        for k in ("camera_angles", "compositions", "lighting", "atmospheres", "custom_axis")
        if len(va.get(k) or []) >= 2
    )
    if non_empty_axes < 2:
        return None
    return res


def _suggest_via_gemini_api(
    api_key: str,
    theme: str,
    base_prompt: str = "",
    image_path: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={api_key}"
    parts: List[Dict[str, Any]] = []
    has_ref = False

    if image_path:
        path_obj = Path(image_path)
        if path_obj.exists():
            try:
                raw_bytes = path_obj.read_bytes()
                info = inspect_image_bytes(raw_bytes)
                b64_img = base64.b64encode(raw_bytes).decode("ascii")
                parts.append(
                    {
                        "inline_data": {
                            "mime_type": info["mime_type"],
                            "data": b64_img,
                        }
                    }
                )
                has_ref = True
            except Exception:
                pass

    parts.append(
        {
            "text": build_axes_suggestion_prompt(
                theme=theme,
                base_prompt=base_prompt,
                has_reference=has_ref,
            )
        }
    )

    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": {"temperature": 0.7},
    }
    resp = requests.post(url, json=payload, timeout=22)
    if resp.status_code != 200:
        return None
    data = resp.json()
    candidates = data.get("candidates") or []
    if not candidates:
        return None
    out_parts = ((candidates[0].get("content") or {}).get("parts")) or []
    text = "\n".join(str(p.get("text") or "") for p in out_parts)
    return parse_suggested_axes_json(text)


def _suggest_via_openai_api(
    api_key: str,
    theme: str,
    base_prompt: str = "",
    image_path: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    url = "https://api.openai.com/v1/chat/completions"
    content_list: List[Dict[str, Any]] = []
    has_ref = False

    if image_path:
        path_obj = Path(image_path)
        if path_obj.exists():
            try:
                raw_bytes = path_obj.read_bytes()
                info = inspect_image_bytes(raw_bytes)
                b64_img = base64.b64encode(raw_bytes).decode("ascii")
                content_list.append(
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{info['mime_type']};base64,{b64_img}"
                        },
                    }
                )
                has_ref = True
            except Exception:
                pass

    content_list.append(
        {
            "type": "text",
            "text": build_axes_suggestion_prompt(
                theme=theme,
                base_prompt=base_prompt,
                has_reference=has_ref,
            ),
        }
    )

    resp = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": "gpt-4o-mini",
            "messages": [{"role": "user", "content": content_list}],
            "temperature": 0.7,
        },
        timeout=22,
    )
    if resp.status_code != 200:
        return None
    data = resp.json()
    choices = data.get("choices") or []
    if not choices:
        return None
    text = str((choices[0].get("message") or {}).get("content") or "")
    return parse_suggested_axes_json(text)


def _suggest_via_cdp_turn(
    engine: str,
    theme: str,
    base_prompt: str = "",
    timeout_sec: float = 15.0,
) -> Optional[Dict[str, Any]]:
    from playwright.sync_api import sync_playwright
    from modules.image_providers.browser_cdp_provider import (
        _clear_composer_attachments,
        _find_or_open_engine_page,
        _inspect_generation_dom,
        _send_chat_message,
        check_cdp_status,
        get_preferred_online_cdp_port,
    )

    target_port = get_preferred_online_cdp_port()
    if not target_port or not check_cdp_status(cdp_port=target_port).get("connected"):
        return None

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{target_port}", timeout=8000)
        context = browser.contexts[0] if browser.contexts else browser.new_context()
        page = _find_or_open_engine_page(context, engine)
        try:
            page.set_default_timeout(10000)
        except Exception:
            pass

        _clear_composer_attachments(page)
        before = _inspect_generation_dom(page)
        prev_count = int(before.get("assistantCount") or 0)
        prev_text = str(before.get("latestText") or "").strip()

        prompt = build_axes_suggestion_prompt(
            theme=theme,
            base_prompt=base_prompt,
            has_reference=False,
        )
        _send_chat_message(page, prompt)
        start = time.time()
        saw_new_turn = False

        while time.time() - start < timeout_sec:
            time.sleep(0.5)
            elapsed = time.time() - start
            state = _inspect_generation_dom(page)
            streaming = bool(state.get("streaming"))
            curr_count = int(state.get("assistantCount") or 0)
            latest_text = str(state.get("latestText") or "").strip()

            if curr_count > prev_count or (latest_text and latest_text != prev_text):
                saw_new_turn = True

            if not saw_new_turn and not streaming and elapsed >= 5.5:
                return None

            if saw_new_turn and latest_text and latest_text != prev_text:
                parsed = parse_suggested_axes_json(latest_text)
                if parsed:
                    return parsed
    return None


def _synthesize_contextual_axes(theme: str, base_prompt: str = "") -> Dict[str, Any]:
    """
    Domain-aware smart fallback synthesizer when neither Official API nor Browser CDP is active.
    Detects visual domain/medium from `theme` + `base_prompt` so non-preset topics
    (Anime, 3D, Food, Nature, Cyberpunk, Streetwear, etc.) get tailored continuity & axes.
    """
    combined = f"{theme} {base_prompt}".lower()
    clean_theme = theme.strip()

    # 1. Anime / Illustration / 2D / Fantasy / Concept Art
    if any(
        kw in combined
        for kw in (
            "anime",
            "manga",
            "illustration",
            "2d",
            "vector",
            "watercolor",
            "sketch",
            "comic",
            "chibi",
            "ghibli",
            "cel-shaded",
            "painting",
            "fantasy",
            "dragon",
            "magic",
        )
    ):
        return {
            "fixed_elements": {
                "subject": clean_theme,
                "style": "Masterpiece digital illustration, expressive linework, rich painterly shading and cohesive art direction",
                "color_palette": "Vibrant harmonious anime/illustrative palette with luminous highlights and atmospheric depth",
                "brand_mood": "Evocative, imaginative, story-driven visual art",
            },
            "variation_axes": {
                "camera_angles": [
                    "Dynamic low-angle hero perspective with expressive foreshortening",
                    "Cinematic wide establishing shot showcasing world scale",
                    "Intimate character/subject close-up focusing on expressive detail",
                    "High-angle bird's-eye view over the scene",
                    "Three-quarter mid-shot in fluid motion",
                    "Dramatic profile silhouette against the sky",
                ],
                "compositions": [
                    "Dynamic diagonal action framing with flowing leading lines",
                    "Centered iconic poster composition with layered elements",
                    "Rule-of-thirds storytelling frame with foreground depth",
                    "Frame-within-a-frame through environmental elements",
                    "Symmetrical emblem-style balance",
                    "Panoramic scenic layout with atmospheric perspective",
                ],
                "lighting": [
                    "Dappled golden-hour sunlight with luminous cel-shaded rim glow",
                    "Magical bioluminescent and ambient twilight illumination",
                    "Dramatic sunset backlight with floating light particles",
                    "Crisp azure midday sky light with soft painterly shadows",
                    "Warm lantern glow contrasting against cool night shadows",
                    "Ethereal volumetric rays breaking through clouds",
                ],
                "atmospheres": [
                    f"Breezy open vista tailored to {clean_theme} with drifting petals or particles",
                    f"Cozy atmospheric interior scene fitting {clean_theme}",
                    f"Twilight sky with dramatic clouds surrounding {clean_theme}",
                    f"Lush fantastical environment with rich organic detail",
                    f"Serene rain-washed moment with glowing reflections",
                    f"Epic high-altitude lookout with expansive horizon",
                ],
            },
        }

    # 2. 3D / Isometric / CGI / Clay / Blender / Toy / Game Asset
    if any(
        kw in combined
        for kw in (
            "3d",
            "isometric",
            "blender",
            "octane",
            "unreal",
            "cgi",
            "clay",
            "diorama",
            "figurine",
            "toy",
            "low-poly",
            "voxel",
            "render",
        )
    ):
        return {
            "fixed_elements": {
                "subject": clean_theme,
                "style": "3D Octane/Blender studio render, tactile subsurface scattering, physically based materials, ultra-clean geometry",
                "color_palette": "Cohesive stylized 3D color harmony with soft gradients and vibrant accents",
                "brand_mood": "Playful precision, tactile 3D craftsmanship, modern digital art",
            },
            "variation_axes": {
                "camera_angles": [
                    "Orthographic 45-degree isometric cutaway perspective",
                    "Close-up macro tilt-shift view on miniature 3D details",
                    "Front-facing three-quarter hero turntable angle",
                    "Top-down 90-degree diorama layout view",
                    "Low-angle hero shot inside the 3D miniature world",
                    "Floating exploded-view perspective showcasing components",
                ],
                "compositions": [
                    "Centered floating island diorama on clean backdrop",
                    "Modular grid arrangement with balanced micro-props",
                    "Layered depth with soft tilt-shift foreground blur",
                    "Symmetrical pedestal showcase with geometric balance",
                    "Rule-of-thirds hero asset with contextual mini-scene",
                    "Tight detail crop on tactile 3D material shaders",
                ],
                "lighting": [
                    "Soft global illumination with warm key and pastel fill light",
                    "Three-point studio area lighting with glossy specular catchlights",
                    "Cozy miniature interior glow against soft cool ambient light",
                    "Bright sunlit clay-render daylight with soft contact shadows",
                    "Neon rim lighting with smooth gradient backdrop",
                    "Warm sunset directional light across volumetric fog",
                ],
                "atmospheres": [
                    f"Clean seamless pastel cyclorama tailored to {clean_theme}",
                    f"Miniature cutaway diorama box with glowing details",
                    f"Stylized floating platform environment for {clean_theme}",
                    f"Tactile matte studio stage with soft ambient occlusion",
                    f"Playful collector showcase with subtle depth of field",
                    f"Luminous night-mode 3D scene with warm practical lights",
                ],
            },
        }

    # 3. Food / Culinary / Drink / Cafe / Bakery / Gastronomy
    if any(
        kw in combined
        for kw in (
            "food",
            "dish",
            "cuisine",
            "coffee",
            "matcha",
            "cake",
            "bakery",
            "pastry",
            "cocktail",
            "drink",
            "tea",
            "ramen",
            "pizza",
            "burger",
            "dessert",
            "ẩm thực",
            "món ăn",
            "bánh",
            "trà",
            "cà phê",
        )
    ):
        return {
            "fixed_elements": {
                "subject": clean_theme,
                "style": "Editorial culinary photography, 85mm macro prime lens, appetizing fresh textures and natural steam/condensation",
                "color_palette": "Rich appetizing culinary tones, warm golden highlights, natural ingredient colors",
                "brand_mood": "Artisanal, sensory, mouth-watering gastronomic storytelling",
            },
            "variation_axes": {
                "camera_angles": [
                    "90-degree overhead flatlay table spread perspective",
                    "45-degree diner's eye-level hero angle",
                    "Extreme macro close-up on glaze, crumb, or condensation texture",
                    "Eye-level straight-on stack/pour perspective",
                    "Three-quarter close-up capturing rising steam or garnish action",
                    "Wide chef's table documentary angle",
                ],
                "compositions": [
                    "Hero dish centered with scattered raw ingredients in negative space",
                    "Rule-of-thirds plating with artisanal cutlery and napkin",
                    "Dynamic action shot (pouring sauce/syrup or dusting powder)",
                    "Layered table scene with blurred beverage in background",
                    "Tight crop emphasizing fresh texture and cross-section",
                    "Shared tasting board arrangement with diagonal flow",
                ],
                "lighting": [
                    "Natural morning side-window light with crisp specular highlights on glaze",
                    "Warm golden-hour sunlight streaming across the table",
                    "Moody chiaroscuro bistro lighting with warm focal spotlight",
                    "Bright airy café daylight with soft diffused shadows",
                    "Backlit morning light illuminating steam and translucent liquids",
                    "Warm candlelit / tungsten evening dining ambiance",
                ],
                "atmospheres": [
                    f"Artisanal kitchen counter with raw ingredients for {clean_theme}",
                    f"Sunlit bistro table setting complementing {clean_theme}",
                    f"Rustic ceramic plating on textured stone or warm timber",
                    f"Modern minimalist dining bar with clean styling",
                    f"Cozy morning café corner with warm aromatic steam",
                    f"Chef's plating station at the moment of finishing touch",
                ],
            },
        }

    # 4. Cyberpunk / Sci-Fi / Futuristic / Tech / Neon / Gaming
    if any(
        kw in combined
        for kw in (
            "cyberpunk",
            "sci-fi",
            "scifi",
            "futuristic",
            "neon",
            "mecha",
            "robot",
            "cyborg",
            "hologram",
            "spaceship",
            "synthwave",
            "techwear",
        )
    ):
        return {
            "fixed_elements": {
                "subject": clean_theme,
                "style": "High-contrast anamorphic sci-fi cinematography, razor-sharp micro-detail, wet specular reflections and chromatic depth",
                "color_palette": "Electric cyan, magenta/amber neon accents against deep obsidian and gunmetal shadows",
                "brand_mood": "Futuristic, high-tech, atmospheric neo-noir intensity",
            },
            "variation_axes": {
                "camera_angles": [
                    "Low-angle anamorphic hero shot looking up against neon skyline",
                    "Close-up macro on intricate cybernetic/tech surface & HUD glow",
                    "Wide cinematic corridor or street-level tracking perspective",
                    "Over-the-shoulder tactical perspective into holographic scene",
                    "High-angle drone surveillance perspective through rain and steam",
                    "Profile silhouette framed against glowing megastructure",
                ],
                "compositions": [
                    "Rule-of-thirds subject balanced by glowing signage and reflections",
                    "Symmetrical futuristic corridor with deep vanishing point",
                    "Layered foreground rain/cables leading to sharp focal subject",
                    "Dynamic diagonal framing with anamorphic lens flare",
                    "Tight detail crop on illuminated circuitry and carbon/metal finish",
                    "Wide environmental scale contrast in high-tech metropolis",
                ],
                "lighting": [
                    "Dual-tone neon rim lighting (cyan & amber) cutting through mist",
                    "Volumetric laser/searchlight beams in rain-slicked darkness",
                    "Holographic interface glow illuminating subject details",
                    "High-contrast laboratory overhead strip lighting",
                    "Moody twilight smog pierced by glowing signage",
                    "Crisp specular reflections on wet asphalt and brushed titanium",
                ],
                "atmospheres": [
                    f"Rain-slicked neo-noir alley with neon reflections around {clean_theme}",
                    f"High-tech cleanroom laboratory bay housing {clean_theme}",
                    f"Rooftop overlook above a sprawling futuristic skyline",
                    f"Atmospheric transit hub with steam vents and hologram displays",
                    f"Orbital observation deck with deep space backdrop",
                    f"Underground cyber-workshop filled with glowing diagnostics",
                ],
            },
        }

    # 5. Nature / Wildlife / Landscape / Botanical / Travel
    if any(
        kw in combined
        for kw in (
            "nature",
            "wildlife",
            "forest",
            "mountain",
            "ocean",
            "animal",
            "landscape",
            "jungle",
            "waterfall",
            "desert",
            "botanical",
            "flower",
            "thiên nhiên",
            "rừng",
            "biển",
            "núi",
            "động vật",
        )
    ):
        return {
            "fixed_elements": {
                "subject": clean_theme,
                "style": "National Geographic / fine-art nature photography, crisp telephoto & wide-angle optical clarity, authentic organic textures",
                "color_palette": "True-to-nature earth, foliage, sky, and water tones with rich dynamic range",
                "brand_mood": "Majestic, untamed, serene natural wonder",
            },
            "variation_axes": {
                "camera_angles": [
                    "Wide panoramic establishing vista capturing environmental grandeur",
                    "Eye-level telephoto portrait with creamy background compression",
                    "Intimate macro close-up on organic patterns, dew, or texture",
                    "Low-angle ground-level perspective looking through foreground flora",
                    "Aerial top-down drone perspective revealing natural geometry",
                    "Side profile silhouette against the horizon",
                ],
                "compositions": [
                    "Leading natural lines (river, ridge, or branches) toward focal subject",
                    "Rule-of-thirds placement with expansive sky or habitat",
                    "Frame-within-a-frame through natural foliage or rock arch",
                    "Symmetrical reflection across calm water surface",
                    "Layered foreground, midground, and misty distant peaks",
                    "Tight detail study of natural form and texture",
                ],
                "lighting": [
                    "First light of dawn breaking through low valley mist",
                    "Warm golden-hour alpenglow / sunset rim light",
                    "Dappled sunlight filtering through dense forest canopy",
                    "Dramatic storm-clearing sunbeams against dark clouds",
                    "Soft overcast diffused light revealing rich saturated colors",
                    "Crisp blue-hour twilight with tranquil atmospheric glow",
                ],
                "atmospheres": [
                    f"Pristine natural habitat surrounding {clean_theme} at dawn",
                    f"Misty morning atmosphere with dew-covered organic textures",
                    f"Sun-drenched wild landscape with crystal-clear air",
                    f"After-rain freshness with wet stone and vibrant foliage",
                    f"Wind-swept golden-hour expanse with dynamic cloudscape",
                    f"Quiet twilight sanctuary in untouched nature",
                ],
            },
        }

    # 5B. Wallpaper / Lockscreen / Screen Background (disables awkward camera rotation)
    if any(kw in combined for kw in ("wallpaper", "lockscreen", "homescreen", "background", "hình nền", "desktop art")):
        wp_preset = next((p for p in STUDIO_PRESETS if p["id"] == "wallpaper_abstract"), None)
        if wp_preset:
            fe = dict(wp_preset["fixed_elements"])
            fe["subject"] = clean_theme
            return {"fixed_elements": fe, "variation_axes": dict(wp_preset["variation_axes"])}

    # 5C. Traditional Painting / Charcoal / Sketch / Watercolor / Oil / Ink (disables 3D camera angles)
    if any(
        kw in combined
        for kw in (
            "charcoal", "painting", "watercolor", "acrylic", "gouache", "oil paint",
            "sketch", "drawing", "ink", "pastel", "tranh", "vẽ", "chì", "sơn dầu", "màu nước",
        )
    ):
        pa_preset = next((p for p in STUDIO_PRESETS if p["id"] == "fine_art_painting"), None)
        if pa_preset:
            fe = dict(pa_preset["fixed_elements"])
            fe["subject"] = clean_theme
            return {"fixed_elements": fe, "variation_axes": dict(pa_preset["variation_axes"])}

    # 5D. Front-Facing / Straight-On / Symmetrical / Avatar / Headshot
    if any(
        kw in combined
        for kw in ("front-facing", "front view", "straight-on", "symmetrical", "headshot", "chính diện", "đối xứng", "avatar")
    ):
        ff_preset = next((p for p in STUDIO_PRESETS if p["id"] == "front_facing_portrait"), None)
        if ff_preset:
            fe = dict(ff_preset["fixed_elements"])
            fe["subject"] = f"Strict straight-on front-facing view of {clean_theme}"
            return {"fixed_elements": fe, "variation_axes": dict(ff_preset["variation_axes"])}

    # 6. Universal Subject-Centric Adaptive (Clean, zero unrelated studio props)
    return {
        "fixed_elements": {
            "subject": clean_theme,
            "style": f"High-resolution visual photography & art direction tailored specifically to {clean_theme}, crisp focus, authentic textures",
            "color_palette": f"Harmonious, true-to-theme color palette complementing {clean_theme}",
            "brand_mood": "Cohesive, expressive, high-impact visual storytelling",
        },
        "variation_axes": {
            "camera_angles": [
                f"Three-quarter hero angle focusing on {clean_theme}",
                "Intimate macro close-up highlighting fine texture and signature details",
                "Eye-level medium shot anchoring subject in its natural context",
                "Top-down 90-degree overhead perspective",
                "Low-angle dynamic perspective emphasizing presence and form",
                "Wide establishing shot showing full environment and scale",
            ],
            "compositions": [
                "Centered hero framing with clean, balanced negative space",
                "Rule-of-thirds composition with natural contextual elements",
                "Layered foreground-to-background depth with soft bokeh separation",
                "Tight detail crop emphasizing craftsmanship and focal motif",
                "Dynamic diagonal flow across the frame",
                "Symmetrical editorial balance",
            ],
            "lighting": [
                "Soft diffused natural light with gentle highlight roll-off",
                "Warm golden-hour directional sunlight with luminous tones",
                "Clean high-clarity key light emphasizing surface texture",
                "Atmospheric rim lighting separating subject from background",
                "Moody directional side-lighting with rich shadow depth",
                "Bright airy ambient illumination with crisp color fidelity",
            ],
            "atmospheres": [
                f"Authentic setting naturally suited to {clean_theme}",
                f"Clean minimalist backdrop highlighting {clean_theme}",
                f"Warm atmospheric environment with subtle depth and storytelling",
                f"Sunlit natural context with organic depth and realism",
                f"Refined contemporary environment tailored to {clean_theme}",
                f"Moody cinematic setting with subtle ambient reflections",
            ],
        },
    }


def suggest_axes_for_theme(
    theme: str,
    base_prompt: str = "",
    model: str = "chrome-cdp/gemini",
    reference_ids: Optional[List[int]] = None,
    use_browser_turn: bool = True,
) -> Dict[str, Any]:
    """
    3-Tier AI Suggestion Engine for Locked Continuity & Variation Axes:
    1. Official Vision/Text API (Gemini 2.0 Flash or OpenAI GPT-4o-mini) if configured in Settings.
    2. Browser CDP Session (:9222 — Gemini / ChatGPT / Grok) if connected and `use_browser_turn=True`.
    3. Smart Domain-Aware Contextual Synthesizer fallback (instant, zero studio-linen bias).
    """
    clean_theme = (theme or "").strip()
    if not clean_theme:
        raise ValueError("Please enter a Theme / Subject first so AI can suggest matching axes.")

    from config import split_api_keys

    settings = db.get_settings(include_secrets=True)
    meta_keys = split_api_keys(settings.get("metadata_api_key"))
    gemini_keys = split_api_keys(settings.get("gemini_api_key"))
    openai_keys = split_api_keys(settings.get("openai_api_key"))
    gemini_key = (meta_keys[0] if meta_keys and not meta_keys[0].startswith("sk-") else "") or (
        gemini_keys[0] if gemini_keys else ""
    )
    openai_key = (meta_keys[0] if meta_keys and meta_keys[0].startswith("sk-") else "") or (
        openai_keys[0] if openai_keys else ""
    )

    # Check if user selected a reference image so Vision API can inspect it
    ref_image_path: Optional[str] = None
    if reference_ids:
        for rid in reference_ids:
            ref_obj = db.get_reference(int(rid))
            if ref_obj and ref_obj.get("file_path") and Path(ref_obj["file_path"]).exists():
                ref_image_path = str(ref_obj["file_path"])
                break

    # Tier 1A: Gemini API (with optional Reference Image Vision)
    if gemini_key:
        try:
            res = _suggest_via_gemini_api(
                api_key=gemini_key,
                theme=clean_theme,
                base_prompt=base_prompt,
                image_path=ref_image_path,
            )
            if res:
                return {
                    **res,
                    "source": "gemini_api",
                    "source_label": "Gemini Flash Vision API" if ref_image_path else "Gemini Flash API",
                }
        except Exception as exc:
            logger.debug("Gemini API axes suggestion fallback: %s", exc)

    # Tier 1B: OpenAI API (with optional Reference Image Vision)
    if openai_key:
        try:
            res = _suggest_via_openai_api(
                api_key=openai_key,
                theme=clean_theme,
                base_prompt=base_prompt,
                image_path=ref_image_path,
            )
            if res:
                return {
                    **res,
                    "source": "openai_api",
                    "source_label": "OpenAI GPT-4o-mini Vision API" if ref_image_path else "OpenAI GPT-4o-mini API",
                }
        except Exception as exc:
            logger.debug("OpenAI API axes suggestion fallback: %s", exc)

    # Tier 2: Active Browser CDP Slot
    if use_browser_turn:
        engine = model.split("/")[-1] if "/" in (model or "") else "gemini"
        if engine not in AI_ENGINES:
            engine = "gemini"
        try:
            res = _suggest_via_cdp_turn(
                engine=engine,
                theme=clean_theme,
                base_prompt=base_prompt,
            )
            if res:
                return {
                    **res,
                    "source": "browser_cdp",
                    "source_label": f"{AI_ENGINES[engine]['label']} Browser Slot",
                }
        except Exception as exc:
            logger.debug("Browser CDP axes suggestion fallback: %s", exc)

    # Tier 3: Smart Domain-Aware Contextual Synthesizer
    synth = _synthesize_contextual_axes(theme=clean_theme, base_prompt=base_prompt)
    return {
        **synth,
        "source": "smart_synthesizer",
        "source_label": "Studio Smart Domain Analyzer",
    }

