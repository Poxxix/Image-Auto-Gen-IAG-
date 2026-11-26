"""
Pure stateless metadata prompt builder & response parser.

Kept intentionally free of database imports (`database.db_manager`) so isolated
child worker processes (`cdp_worker`) never open or initialize `studio.db`.
"""
import json
import re
import unicodedata
from typing import Any, Dict, List, Optional

from config import (
    DEFAULT_CAPTION_PROMPT,
    format_picassy_keyword,
    format_picassy_keyword_prose,
    format_picassy_sentence_case,
)


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
    primary_tag: str = "",
    category: str = "",
    available_categories: Optional[List[str]] = None,
    include_visual_context: bool = True,
) -> str:
    keyword = format_picassy_keyword(primary_tag or theme) or (primary_tag or theme).strip()
    kw_prose = format_picassy_keyword_prose(keyword) or keyword.lower()
    custom_instruction = (caption_prompt or DEFAULT_CAPTION_PROMPT).strip()
    context_note = f" Visual context: {prompt_final}." if (include_visual_context and prompt_final) else ""
    cat_line = ""
    if not category and available_categories:
        cats_joined = ", ".join(available_categories)
        cat_line = f'  "category": "Pick exact 1 item from: {cats_joined}",\n'

    return (
        f"Write natural, grammatically sound SEO image metadata in {metadata_language} for the attached/generated image. "
        f'Core primary keyword: "{keyword}" (use "{kw_prose}" inside sentences). '
        f"{custom_instruction}{context_note} "
        "STRICT RULES (never keyword-stuff; prioritize natural grammar):\n"
        f'1. "title": MAX 60 characters total. MUST start directly with exact Title-Case keyword "{keyword}". Complete meaningful phrase or sentence.\n'
        f'2. "description": MAX 160 characters total. Sentence case ONLY (capitalize ONLY the first letter of each sentence — do NOT Title-Case "{kw_prose}" mid-sentence). Complete, engaging sentence(s) naturally including "{kw_prose}". NO hashtags (#).\n'
        f'3. "alt_text": STRICTLY 100 to 125 characters (count carefully!). Sentence case ONLY (capitalize ONLY the first letter of the sentence — do NOT Title-Case "{kw_prose}" mid-sentence). Screen-reader & SEO narrative faithfully describing what is visible, naturally containing "{kw_prose}". No hashtags.\n'
        "IMPORTANT: Reply with text ONLY (do NOT generate or edit any image) as a single JSON object:\n"
        "```json\n"
        "{\n"
        f'  "title": "{keyword} ...",\n'
        f'  "description": "Sentence-case 1-2 sentence visual description including {kw_prose} (<=160 chars, no #tags).",\n'
        f'{cat_line}'
        f'  "alt_text": "Sentence-case 100-125 character visual description naturally including {kw_prose}."\n'
        "}\n"
        "```"
    )


def build_picassy_repair_prompt(
    *,
    primary_tag: str,
    metadata_language: str,
    title: str,
    description: str,
    alt_text: str,
    issues: List[str],
) -> str:
    clean_pt = format_picassy_keyword(primary_tag) or primary_tag.strip()
    prose_pt = format_picassy_keyword_prose(clean_pt) or clean_pt.lower()
    return (
        f"Fix the metadata JSON below strictly in {metadata_language} while keeping natural human grammar and zero keyword stuffing.\n"
        f'Primary keyword: "{clean_pt}" (in sentences write as "{prose_pt}")\n'
        f"Current draft:\n"
        f'- title ({len(title)} chars): "{title}"\n'
        f'- description ({len(description)} chars): "{description}"\n'
        f'- alt_text ({len(alt_text)} chars): "{alt_text}"\n'
        f"Issues to fix: {'; '.join(issues)}\n"
        "Rules:\n"
        f'- title: <= 60 chars, MUST start with exact "{clean_pt}" (Title Case, no hyphens/underscores).\n'
        f'- description: <= 160 chars, Sentence case ONLY (only first letter of sentence capitalized), complete sentence containing "{prose_pt}", no hashtags.\n'
        f'- alt_text: STRICTLY 100 to 125 characters inclusive, Sentence case ONLY (only first letter of sentence capitalized), natural visual narrative containing "{prose_pt}", no hashtags.\n'
        "Reply ONLY with valid JSON containing keys title, description, alt_text."
    )


def _strip_hashtags(text: str) -> str:
    cleaned = re.sub(r"(?:^|\s)#[^\s#]+", " ", text or "")
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()
    return cleaned


def _trim_grammatical_phrase(text: str, max_len: int, keep_terminal_punct: bool = False) -> str:
    s = re.sub(r"\s+", " ", (text or "").strip())
    if len(s) <= max_len:
        if keep_terminal_punct and s and s[-1] not in ".!?":
            if len(s) + 1 <= max_len:
                return s + "."
        return s

    target = max_len - (1 if keep_terminal_punct else 0)
    cut = s[:target].rstrip()
    # Try last complete sentence first
    last_sent = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    if last_sent >= max(35, int(target * 0.55)):
        res = cut[: last_sent + 1].strip()
        return res

    # Fallback: trim to last space / clause separator
    sp = cut.rfind(" ")
    if sp > 12:
        cut = cut[:sp].rstrip(" ,;:-")
    dangling = {
        "with", "and", "or", "in", "on", "at", "by", "for", "of", "to", "from",
        "the", "a", "an", "that", "which", "featuring", "showing", "while",
        "và", "với", "của", "trong", "trên", "cho", "tại", "từ", "những", "các",
    }
    words = cut.split()
    while len(words) > 2 and words[-1].lower().strip(",;:-") in dangling:
        words.pop()
    res = " ".join(words).rstrip(" ,;:-")
    if keep_terminal_punct and res and res[-1] not in ".!?":
        res = f"{res}."
    return res[:max_len].strip()


def _ensure_keyword_casing(text: str, keyword: str) -> str:
    if not keyword:
        return text
    pattern = re.compile(re.escape(keyword), re.IGNORECASE)
    if pattern.search(text):
        return pattern.sub(lambda _: keyword, text, count=1)
    return text


def validate_picassy_metadata(
    meta: Dict[str, Any],
    primary_tag: str,
) -> List[str]:
    kw = format_picassy_keyword(primary_tag) or (primary_tag or "").strip()
    title = (meta.get("title") or "").strip()
    desc = (meta.get("description") or "").strip()
    alt = (meta.get("alt_text") or "").strip()
    issues: List[str] = []

    if not title or len(title) > 60:
        issues.append(f"title must be 1..60 chars (got {len(title)})")
    if kw and not title.lower().startswith(kw.lower()):
        issues.append(f'title must start with exact "{kw}"')

    if not desc or len(desc) > 160:
        issues.append(f"description must be 1..160 chars (got {len(desc)})")
    if kw and kw.lower() not in desc.lower():
        issues.append(f'description must include exact "{kw}"')
    if "#" in desc:
        issues.append("description must not contain hashtags")

    if len(alt) < 100 or len(alt) > 125:
        issues.append(f"alt_text must be strictly 100..125 chars (got {len(alt)})")
    if kw and kw.lower() not in alt.lower():
        issues.append(f'alt_text must include exact "{kw}"')
    if "#" in alt:
        issues.append("alt_text must not contain hashtags")
    return issues


def fit_picassy_metadata(
    raw_meta: Dict[str, Any],
    *,
    primary_tag: str,
    theme: str = "",
    metadata_language: str = "English",
    visual_hints: Optional[Dict[str, str]] = None,
    category: str = "",
    available_categories: Optional[List[str]] = None,
) -> Dict[str, str]:
    """
    Guarantees Picassy SEO schema compliance cleanly without mid-word truncation or hashtag stuffing:
    - title <= 60 chars, starts with exact `primary_tag`
    - description <= 160 chars, natural complete sentence(s) containing `primary_tag`
    - alt_text strictly 100..125 chars, truthful visual sentence containing `primary_tag`
    """
    raw_kw_source = (primary_tag or theme or "Artwork").strip()
    kw = format_picassy_keyword(raw_kw_source) or "Artwork"
    kw_prose = format_picassy_keyword_prose(raw_kw_source) or kw.lower()
    lang_low = (metadata_language or "English").strip().lower()
    is_vi = lang_low in ("vietnamese", "tiếng việt", "vi")
    hints = visual_hints or {}

    def _scrub_slug_variants(s: str, replacement: str) -> str:
        out_s = s
        for cand_raw in {raw_kw_source, (theme or "").strip()}:
            if cand_raw and ("-" in cand_raw or "_" in cand_raw) and cand_raw.lower() != replacement.lower():
                out_s = re.sub(re.escape(cand_raw), replacement, out_s, flags=re.IGNORECASE)
        return out_s

    # 1. Title (<= 60 chars, MUST start with exact Title-Cased `kw` without hyphens/underscores)
    raw_title = _scrub_slug_variants(_strip_hashtags(str(raw_meta.get("title") or "")).strip(' "\''), kw)
    raw_title = _ensure_keyword_casing(raw_title, kw)
    if not raw_title or not raw_title.lower().startswith(kw.lower()):
        tail = re.sub(re.escape(kw), "", raw_title, flags=re.IGNORECASE).strip(" :-–—|.,")
        if tail and len(f"{kw} {tail}") <= 60:
            raw_title = f"{kw} {tail}"
        elif tail:
            raw_title = f"{kw}: {tail}"
        else:
            default_tail = "với ánh sáng tinh tế" if is_vi else "in Soft Natural Light"
            raw_title = f"{kw} {default_tail}"
    if len(kw) >= 60:
        title = kw[:60].rstrip()
    else:
        title = _trim_grammatical_phrase(raw_title, 60, keep_terminal_punct=False)
        if not title.lower().startswith(kw.lower()):
            title = kw[:60]

    # 2. Description (<= 160 chars, Sentence case ONLY, natural sentence(s) containing keyword, zero hashtags)
    raw_desc = _scrub_slug_variants(_strip_hashtags(str(raw_meta.get("description") or "")).strip(' "\''), kw_prose)
    if not raw_desc:
        angle_h = hints.get("camera_angle") or ("góc nhìn tự nhiên" if is_vi else "balanced framing")
        light_h = hints.get("lighting") or ("ánh sáng hài hòa" if is_vi else "soft natural light")
        raw_desc = (
            f"Hình ảnh {kw_prose} được thể hiện tự nhiên với {angle_h.lower()} và {light_h.lower()}."
            if is_vi
            else f"A captivating {kw_prose} composition shaped with {angle_h.lower()} and {light_h.lower()}."
        )
    elif kw_prose.lower() not in raw_desc.lower():
        prefix_lead = f"Khám phá {kw_prose}: " if is_vi else f"Featuring {kw_prose}, "
        raw_desc = f"{prefix_lead}{raw_desc}"
    desc = _trim_grammatical_phrase(raw_desc, 160, keep_terminal_punct=True)
    if kw_prose.lower() not in desc.lower():
        desc = _trim_grammatical_phrase(
            f"{kw_prose} portrayed with refined visual balance and authentic atmosphere.",
            160,
            keep_terminal_punct=True,
        )
    desc = format_picassy_sentence_case(desc)

    # 3. Alt text (STRICTLY 100..125 chars, Sentence case ONLY, natural narrative describing real image)
    raw_alt = _scrub_slug_variants(_strip_hashtags(str(raw_meta.get("alt_text") or "")).strip(' "\''), kw_prose)
    if not raw_alt:
        angle_h = hints.get("camera_angle") or ("góc nhìn cân đối" if is_vi else "clear balanced framing")
        light_h = hints.get("lighting") or ("ánh sáng tự nhiên ấm áp" if is_vi else "soft natural light")
        atmos_h = hints.get("atmosphere") or ("bối cảnh hài hòa giàu chi tiết" if is_vi else "a calm, detailed setting")
        raw_alt = (
            f"Bức ảnh ghi lại {kw_prose} ở {angle_h.lower()}, nổi bật dưới {light_h.lower()} giữa {atmos_h.lower()}."
            if is_vi
            else f"View of {kw_prose} captured with {angle_h.lower()}, illuminated by {light_h.lower()} in {atmos_h.lower()}."
        )
    elif kw_prose.lower() not in raw_alt.lower():
        raw_alt = (
            f"Hình ảnh {kw_prose}: {raw_alt}"
            if is_vi
            else f"{kw_prose} shown as {raw_alt}"
        )

    alt = _trim_grammatical_phrase(raw_alt, 125, keep_terminal_punct=True)

    # If alt_text < 100 chars, naturally enrich with descriptive visual phrasing until 100..125
    vi_clauses = [
        "với đường nét sắc sảo và màu sắc hài hòa",
        "mang lại cảm giác chân thực, giàu chiều sâu",
        "cân đối nhẹ nhàng trong từng chi tiết ánh sáng",
        "tạo nên khung hình tự nhiên và rõ nét",
    ]
    en_clauses = [
        "with crisp visual texture and balanced natural tones",
        "highlighting gentle shadows and clear foreground detail",
        "composed harmoniously in natural daylight and calm depth",
        "offering a clear view of texture, form, and mood",
    ]
    clauses = vi_clauses if is_vi else en_clauses
    for clause in clauses:
        if 100 <= len(alt) <= 125:
            break
        if len(alt) >= 100:
            break
        base_no_dot = alt.rstrip(".!? ")
        candidate = f"{base_no_dot}, {clause}."
        if len(candidate) <= 125:
            alt = candidate
        else:
            # Find shorter clause or gentle trim inside 100..125
            fitted = _trim_grammatical_phrase(candidate, 125, keep_terminal_punct=True)
            if len(fitted) >= 100:
                alt = fitted
                break
            else:
                alt = candidate[:125]
                alt = _trim_grammatical_phrase(alt, 125, keep_terminal_punct=True)

    if len(alt) < 100:
        pad_phrase = "trong ánh sáng dịu nhẹ" if is_vi else "under soft natural light"
        base_no_dot = alt.rstrip(".!? ")
        cand = f"{base_no_dot} {pad_phrase}."
        alt = cand if len(cand) <= 125 else _trim_grammatical_phrase(cand, 125, keep_terminal_punct=True)

    alt = format_picassy_sentence_case(alt)

    # Exact category validation
    resolved_cat = (category or "").strip()
    if not resolved_cat and available_categories:
        ai_cat = str(raw_meta.get("category") or "").strip()
        for c in available_categories:
            if c.lower() == ai_cat.lower():
                resolved_cat = c
                break

    out: Dict[str, str] = {
        "primary_tag": kw,
        "title": title,
        "caption": title,
        "description": desc,
        "alt_text": alt,
        "hashtags": "",
    }
    if resolved_cat:
        out["category"] = resolved_cat
    return out


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
            alt_text = str(parsed.get("alt_text") or parsed.get("alt") or parsed.get("altText") or "").strip()
            cat = str(parsed.get("category") or "").strip()
            hashtags = _normalize_hashtags(parsed.get("hashtags") or parsed.get("tags") or "", theme)
            if not caption and title:
                caption = title
            if (
                title
                and desc
                and "concise evocative title" not in title.lower()
                and "catchy aesthetic pinterest" not in title.lower()
            ):
                clean_desc = _strip_hashtags(desc) or desc
                out_parsed: Dict[str, str] = {
                    "title": title[:160],
                    "caption": caption[:240],
                    "description": clean_desc[:600],
                    "alt_text": _strip_hashtags(alt_text)[:200],
                    "hashtags": hashtags,
                }
                if cat:
                    out_parsed["category"] = cat
                return out_parsed
        except Exception:
            continue

    # Fallback 1: parse labeled lines (Title: ... / Description: ... / Alt text: ...)
    title_m = re.search(r"(?:^|\n)\s*(?:\*\*|#)?\s*(?:pin\s+)?title\s*(?:\*\*)?\s*:\s*(.+)", cleaned, re.IGNORECASE)
    cap_m = re.search(r"(?:^|\n)\s*(?:\*\*|#)?\s*caption\s*(?:\*\*)?\s*:\s*(.+)", cleaned, re.IGNORECASE)
    desc_m = re.search(r"(?:^|\n)\s*(?:\*\*|#)?\s*description\s*(?:\*\*)?\s*:\s*(.+?)(?=\n\s*(?:\*\*|#)?\s*(?:alt[\s_-]*text|hashtags|tags)|$)", cleaned, re.IGNORECASE | re.DOTALL)
    alt_m = re.search(r"(?:^|\n)\s*(?:\*\*|#)?\s*alt[\s_-]*text\s*(?:\*\*)?\s*:\s*(.+?)(?=\n\s*(?:\*\*|#)?\s*(?:hashtags|tags|category)|$)", cleaned, re.IGNORECASE | re.DOTALL)
    tags_m = re.search(r"(?:^|\n)\s*(?:\*\*|#)?\s*(?:hashtags|tags)\s*(?:\*\*)?\s*:\s*(.+)", cleaned, re.IGNORECASE)

    if title_m and desc_m:
        t_val = title_m.group(1).strip().strip('"').strip("*")
        c_val = (cap_m.group(1).strip().strip('"').strip("*") if cap_m else t_val)
        d_val = _strip_hashtags(" ".join(desc_m.group(1).strip().split()))
        a_val = _strip_hashtags(" ".join(alt_m.group(1).strip().split())) if alt_m else ""
        h_val = _normalize_hashtags(tags_m.group(1) if tags_m else "", theme)
        if t_val and d_val:
            return {
                "title": t_val[:160],
                "caption": c_val[:240],
                "description": d_val[:600],
                "alt_text": a_val[:200],
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
                _strip_hashtags(ln)
                for ln in lines
            ]
            non_tag_lines = [ln for ln in non_tag_lines if len(ln) >= 4]
            if non_tag_lines:
                t_val = non_tag_lines[0][:140]
                c_val = (non_tag_lines[1] if len(non_tag_lines) > 1 else t_val)[:220]
                d_val = " ".join(non_tag_lines[1:] if len(non_tag_lines) > 1 else non_tag_lines)
                return {
                    "title": t_val,
                    "caption": c_val,
                    "description": d_val[:600],
                    "alt_text": "",
                    "hashtags": h_val,
                }
    return None
