"""
Pure stateless metadata prompt builder & response parser.

Kept intentionally free of database imports (`database.db_manager`) so isolated
child worker processes (`cdp_worker`) never open or initialize `studio.db`.
"""
import json
import re
import unicodedata
from typing import Any, Dict, List, Optional

from config import DEFAULT_CAPTION_PROMPT


def _slugify_plain(text: str, max_len: int = 42) -> str:
    if not text:
        return "image-set"
    cleaned = text.replace("đ", "d").replace("Đ", "d")
    normalized = unicodedata.normalize("NFD", cleaned)
    ascii_str = "".join(c for c in normalized if unicodedata.category(c) != "Mn")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_str.lower()).strip("-")
    slug = re.sub(r"-{2,}", "-", slug)
    return (slug[:max_len].strip("-")) or "image-set"


def build_metadata_prompt(
    theme: str,
    prompt_final: str,
    metadata_language: str = "English",
    index_num: int = 1,
    caption_prompt: str = "",
) -> str:
    custom_instruction = (caption_prompt or DEFAULT_CAPTION_PROMPT).strip()
    return (
        f"Based on the image you just created for theme \"{theme}\" "
        f"(Variation #{index_num}, visual context: {prompt_final}), "
        f"{custom_instruction} "
        f"Write strictly in {metadata_language}. "
        "IMPORTANT: Do NOT generate or edit any image in this turn — reply with text ONLY as a single JSON object:\n"
        "```json\n"
        "{\n"
        '  "title": "Catchy aesthetic Pinterest Pin Title (4 to 10 words)",\n'
        '  "caption": "Engaging 1-sentence social hook caption for Pinterest / Instagram",\n'
        '  "description": "2 to 3 natural SEO-rich sentences describing the visual aesthetic, details, mood, and styling inspiration.",\n'
        '  "hashtags": "#tag1 #tag2 #tag3 #tag4 #tag5 #tag6"\n'
        "}\n"
        "```"
    )


def _normalize_hashtags(raw_tags: Any, theme: str) -> str:
    if isinstance(raw_tags, list):
        tokens = [str(t).strip() for t in raw_tags if str(t).strip()]
    else:
        tokens = re.split(r"[\s,]+", str(raw_tags or "").strip())
    cleaned: List[str] = []
    for tok in tokens:
        if not tok:
            continue
        tag = tok if tok.startswith("#") else f"#{tok}"
        tag = re.sub(r"[^#\w\u00C0-\u024F\u1E00-\u1EFF]", "", tag)
        if len(tag) > 2 and tag.lower() not in [c.lower() for c in cleaned]:
            cleaned.append(tag)
    if not cleaned:
        return _build_theme_hashtags(theme)
    return " ".join(cleaned[:12])


def _build_theme_hashtags(theme: str, extra_words: Optional[List[str]] = None) -> str:
    words = [
        w.lower()
        for w in re.findall(r"[a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF]+", theme or "")
        if len(w) >= 3
    ]
    slug_compact = _slugify_plain(theme, max_len=28).replace("-", "")
    tags: List[str] = []
    if slug_compact and slug_compact != "imageset":
        tags.append(f"#{slug_compact}")
        tags.append(f"#{slug_compact}inspo")
    for w in words[:3]:
        clean_w = _slugify_plain(w, max_len=18).replace("-", "")
        if clean_w and f"#{clean_w}" not in tags:
            tags.append(f"#{clean_w}aesthetic")
    if extra_words:
        for ew in extra_words:
            cw = _slugify_plain(ew, max_len=18).replace("-", "")
            if cw and len(cw) >= 3 and f"#{cw}" not in tags:
                tags.append(f"#{cw}")
    for fallback in ("#pinterestinspired", "#aestheticinspo", "#visualmoodboard", "#editorialstyle", "#dailyinspo"):
        if fallback not in tags:
            tags.append(fallback)
    return " ".join(tags[:8])


def parse_metadata_json(
    text: str,
    theme: str = "",
    allow_freeform: bool = False,
) -> Optional[Dict[str, str]]:
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
            title = str(parsed.get("title") or parsed.get("pin_title") or "").strip()
            caption = str(parsed.get("caption") or parsed.get("hook") or "").strip()
            desc = str(parsed.get("description") or parsed.get("pin_description") or "").strip()
            hashtags = _normalize_hashtags(parsed.get("hashtags") or parsed.get("tags") or "", theme)
            if not title and caption:
                title = caption[:90]
            if not caption and title:
                caption = title
            if (
                title
                and desc
                and "concise evocative title" not in title.lower()
                and "catchy aesthetic pinterest" not in title.lower()
            ):
                if hashtags and hashtags not in desc:
                    full_desc = f"{desc.rstrip()} {hashtags}".strip()
                else:
                    full_desc = desc
                return {
                    "title": title[:160],
                    "caption": caption[:240],
                    "description": full_desc[:600],
                    "hashtags": hashtags,
                }
        except Exception:
            continue

    # Fallback 1: parse labeled lines (Title: ... / Caption: ... / Description: ... / Hashtags: ...)
    title_m = re.search(r"(?:^|\n)\s*(?:\*\*|#)?\s*(?:pin\s+)?title\s*(?:\*\*)?\s*:\s*(.+)", cleaned, re.IGNORECASE)
    cap_m = re.search(r"(?:^|\n)\s*(?:\*\*|#)?\s*caption\s*(?:\*\*)?\s*:\s*(.+)", cleaned, re.IGNORECASE)
    desc_m = re.search(r"(?:^|\n)\s*(?:\*\*|#)?\s*description\s*(?:\*\*)?\s*:\s*(.+?)(?=\n\s*(?:\*\*|#)?\s*(?:hashtags|tags)|$)", cleaned, re.IGNORECASE | re.DOTALL)
    tags_m = re.search(r"(?:^|\n)\s*(?:\*\*|#)?\s*(?:hashtags|tags)\s*(?:\*\*)?\s*:\s*(.+)", cleaned, re.IGNORECASE)

    if title_m and desc_m:
        t_val = title_m.group(1).strip().strip('"').strip("*")
        c_val = (cap_m.group(1).strip().strip('"').strip("*") if cap_m else t_val)
        d_val = " ".join(desc_m.group(1).strip().split())
        h_val = _normalize_hashtags(tags_m.group(1) if tags_m else "", theme)
        if t_val and d_val:
            full_desc = f"{d_val.rstrip()} {h_val}".strip() if h_val and h_val not in d_val else d_val
            return {
                "title": t_val[:160],
                "caption": c_val[:240],
                "description": full_desc[:600],
                "hashtags": h_val,
            }

    # Fallback 2: Freeform prose response when streaming has finished
    if allow_freeform and len(cleaned) >= 30 and "{" not in cleaned:
        lines = [
            ln.strip().strip("*").strip("#").strip()
            for ln in cleaned.splitlines()
            if ln.strip() and not ln.strip().startswith("```")
        ]
        if lines:
            found_tags = re.findall(r"#[\w\u00C0-\u024F\u1E00-\u1EFF]+", cleaned)
            h_val = _normalize_hashtags(found_tags, theme)
            non_tag_lines = [
                re.sub(r"#[\w\u00C0-\u024F\u1E00-\u1EFF]+", "", ln).strip()
                for ln in lines
            ]
            non_tag_lines = [ln for ln in non_tag_lines if len(ln) >= 4]
            if non_tag_lines:
                t_val = non_tag_lines[0][:140]
                c_val = (non_tag_lines[1] if len(non_tag_lines) > 1 else t_val)[:220]
                d_val = " ".join(non_tag_lines[1:] if len(non_tag_lines) > 1 else non_tag_lines)
                full_desc = f"{d_val.rstrip()} {h_val}".strip() if h_val and h_val not in d_val else d_val
                return {
                    "title": t_val,
                    "caption": c_val,
                    "description": full_desc[:600],
                    "hashtags": h_val,
                }
    return None
