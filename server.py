from contextlib import asynccontextmanager
from pathlib import Path
import shutil
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse, Response
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

from config import (
    ASPECT_RATIOS,
    BASE_DIR,
    CAPTION_STYLE_PRESETS,
    CARRIER_OVERRIDE_MODES,
    DEFAULT_CAPTION_PROMPT,
    DEFAULT_PICASSY_CATEGORIES,
    DEFAULT_REFERENCE_PROFILES,
    EXPORT_IMAGE_FORMATS,
    EXPORTS_DIR,
    FILENAME_STYLES,
    MAX_CDP_SLOTS,
    METADATA_EXPORT_MODES,
    METADATA_LANGUAGES,
    METADATA_PROVIDERS,
    METADATA_VISION_MODES,
    PROVIDER_MODELS,
    REFERENCE_STRENGTH_MODES,
    REFERENCES_DIR,
    STUDIO_PRESETS,
    ensure_directories,
    format_picassy_keyword,
    get_effective_reference_profiles,
    normalize_carrier_override,
    normalize_cdp_slots,
    normalize_export_image_format,
    normalize_filename_style,
    normalize_metadata_export_mode,
    normalize_picassy_categories,
    normalize_reference_mode_profiles,
    normalize_reference_strength,
)
from database.db_manager import db, slugify_theme
from modules.app_logging import logger
from modules.export_manager import (
    build_job_zip_file,
    cleanup_and_resequence_after_delete_generation,
    get_or_build_job_csv_bytes,
    open_export_folder_in_os,
    pick_folder_via_os_dialog,
    reconcile_job_export_folder,
    relocate_job_export_dir,
    sync_generation_and_manifest,
    sync_job_manifest,
)
from modules.image_providers import (
    check_cdp_status,
    launch_chrome_slot,
    list_available_providers,
    list_cdp_slots_status,
)
from modules.job_runner import runner
from modules.metadata_writer import write_generation_metadata
from modules.prompt_planner import (
    build_external_master_prompt,
    compose_prompt_from_axes,
    parse_external_axes_import,
    plan_job_variations,
    resolve_axes_and_fixed,
    suggest_axes_for_theme,
)
from modules.reference_sources import (
    discover_pinterest_references,
    save_uploaded_reference,
)
from modules.reference_sources.image_utils import inspect_image_bytes
from modules.watermark_remover import (
    inpaint_image_bytes,
    remove_gemini_watermark_bytes,
    remove_watermark_for_generation,
    remove_watermarks_for_job,
    replace_generation_image_on_disk,
    trim_image_edges_bytes,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_directories()
    runner.recover_interrupted_jobs()
    runner.start_worker()
    logger.info("Theme Image Set Studio server started.")
    try:
        yield
    finally:
        db.close()


app = FastAPI(
    title="Theme Image Set Studio",
    version="4.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =============================================================================
# Request Schemas
# =============================================================================
class LaunchCDPRequest(BaseModel):
    engine: str = "gemini"
    force_restart: bool = False
    slot_id: int = Field(default=1, ge=1, le=MAX_CDP_SLOTS)


class PinterestDiscoverRequest(BaseModel):
    query_or_url: str
    limit: int = Field(default=6, ge=1, le=20)


class UpdateReferenceRequest(BaseModel):
    title: str


class BulkDeleteReferencesRequest(BaseModel):
    reference_ids: List[int] = Field(default_factory=list)
    source_type: Optional[str] = None
    delete_all: bool = False


class BulkDeleteGenerationsRequest(BaseModel):
    generation_ids: List[int] = Field(default_factory=list)


class CreateJobRequest(BaseModel):
    theme: str
    base_prompt: str = ""
    reference_mode: str = "prompt_only"          # prompt_only | local_upload | pinterest
    reference_strength: str = "balanced"         # balanced | fashion_vibe | character_lock | layout_map | subject_keep | style_only
    carrier_override: str = "auto"               # auto | flat_2d | in_situ
    run_mode: str = "fixed"                      # fixed | continuous
    target_count: int = Field(default=6, ge=1, le=1000)
    batch_size: int = Field(default=4, ge=1, le=50)
    session_cap: int = Field(default=20, ge=1, le=1000)
    cycle_references: bool = True
    aspect_ratio: str = "1:1"
    metadata_language: str = "English"
    metadata_export_mode: str = "csv"            # csv | none
    export_image_format: Optional[str] = None    # original | png | jpg | webp
    primary_tag: Optional[str] = None
    category: Optional[str] = None
    filename_style: Optional[str] = None         # picassy_slug | studio_seq
    preferred_cdp_slot: int = Field(default=0, ge=0, le=MAX_CDP_SLOTS)
    caption_prompt: str = DEFAULT_CAPTION_PROMPT
    use_ai_caption_prompt: bool = True
    optimize_prompt_english: bool = True
    model: str = "chrome-cdp/gemini"
    export_root_dir: Optional[str] = None
    preset_id: str = ""
    fixed_elements: Optional[Dict[str, Any]] = None
    variation_axes: Optional[Dict[str, Any]] = None
    reference_ids: List[int] = Field(default_factory=list)
    auto_start: bool = False


class UpdateJobRequest(BaseModel):
    theme: Optional[str] = None
    base_prompt: Optional[str] = None
    reference_mode: Optional[str] = None
    reference_strength: Optional[str] = None
    carrier_override: Optional[str] = None
    run_mode: Optional[str] = None
    target_count: Optional[int] = None
    batch_size: Optional[int] = None
    session_cap: Optional[int] = None
    cycle_references: Optional[bool] = None
    aspect_ratio: Optional[str] = None
    metadata_language: Optional[str] = None
    metadata_export_mode: Optional[str] = None
    export_image_format: Optional[str] = None
    primary_tag: Optional[str] = None
    category: Optional[str] = None
    filename_style: Optional[str] = None
    preferred_cdp_slot: Optional[int] = None
    caption_prompt: Optional[str] = None
    use_ai_caption_prompt: Optional[bool] = None
    optimize_prompt_english: Optional[bool] = None
    model: Optional[str] = None
    export_root_dir: Optional[str] = None
    preset_id: Optional[str] = None
    fixed_elements: Optional[Dict[str, Any]] = None
    variation_axes: Optional[Dict[str, Any]] = None
    reference_ids: Optional[List[int]] = None
    replan_unlocked: bool = False


class AddGenerationRequest(BaseModel):
    prompt_final: Optional[str] = None
    reference_id: Optional[int] = None
    variation_axes: Optional[Dict[str, Any]] = None


class UpdateGenerationRequest(BaseModel):
    prompt_final: Optional[str] = None
    reference_id: Optional[int] = None
    clear_reference: bool = False
    is_locked: Optional[bool] = None
    is_peak: Optional[bool] = None
    title: Optional[str] = None
    caption: Optional[str] = None
    description: Optional[str] = None
    alt_text: Optional[str] = None
    hashtags: Optional[str] = None
    variation_axes: Optional[Dict[str, Any]] = None
    fixed_elements: Optional[Dict[str, Any]] = None


class RetryGenerationRequest(BaseModel):
    mutate_axes: bool = False


class RetryMetadataRequest(BaseModel):
    use_browser_turn: Optional[bool] = None


class ResetWorkspaceRequest(BaseModel):
    clear_references: bool = False
    delete_exports: bool = False


class PickFolderRequest(BaseModel):
    job_id: Optional[int] = None
    save_as_default: bool = True


class ChangeFolderRequest(BaseModel):
    export_root_dir: str
    save_as_default: bool = True


class SuggestAxesRequest(BaseModel):
    theme: str
    base_prompt: str = ""
    model: str = "chrome-cdp/gemini"
    reference_ids: List[int] = Field(default_factory=list)
    use_browser_turn: bool = True


class SamplePromptRequest(BaseModel):
    theme: str = ""
    base_prompt: str = ""
    template_kind: str = "adaptive"
    target_count: int = Field(default=20, ge=1, le=1000)
    metadata_language: str = "English"


class ImportAxesRequest(BaseModel):
    raw_text: str


class EditGenerationImageRequest(BaseModel):
    operation: str = "inpaint"                   # inpaint | force_star | trim | commit_base64
    source_base64: Optional[str] = None          # Optional working image dataURL/base64 for chained edits
    mask_base64: Optional[str] = None            # PNG mask dataURL/base64 for freehand brush
    boxes: Optional[List[Dict[str, float]]] = None  # Normalized [0..1] {x, y, w, h}
    trim_percent: float = Field(default=3.0, ge=0.5, le=15.0)
    trim_anchor: str = "bottom_right"            # bottom_right | center
    save_to_disk: bool = False                   # False = return preview base64; True = overwrite export file atomically


def _build_enriched_cdp_slots(settings: Dict[str, Any]) -> List[Dict[str, Any]]:
    slots = normalize_cdp_slots(settings.get("cdp_slots"))
    statuses = list_cdp_slots_status(slots=slots, force=False)
    runtime_map = runner.get_slot_runtime_map()
    for st in statuses:
        rt = runtime_map.get(int(st["slot_id"])) or {}
        st["active_job_id"] = rt.get("active_job_id")
        st["active_generation_id"] = rt.get("active_generation_id")
    return statuses


# =============================================================================
# System & Provider Endpoints
# =============================================================================
@app.get("/api/system/status")
def get_system_status() -> Dict[str, Any]:
    settings = db.get_settings(include_secrets=False)
    slots_info = _build_enriched_cdp_slots(settings)
    primary_cdp = slots_info[0] if slots_info else check_cdp_status()
    return {
        "ok": True,
        "cdp": primary_cdp,
        "cdp_slots": slots_info,
        "providers": list_available_providers(),
        "presets": STUDIO_PRESETS,
        "caption_style_presets": CAPTION_STYLE_PRESETS,
        "default_caption_prompt": DEFAULT_CAPTION_PROMPT,
        "aspect_ratios": list(ASPECT_RATIOS.keys()),
        "metadata_languages": METADATA_LANGUAGES,
        "metadata_export_modes": METADATA_EXPORT_MODES,
        "export_image_formats": EXPORT_IMAGE_FORMATS,
        "filename_styles": FILENAME_STYLES,
        "reference_strength_modes": REFERENCE_STRENGTH_MODES,
        "carrier_override_modes": CARRIER_OVERRIDE_MODES,
        "reference_profiles": get_effective_reference_profiles(
            settings.get("reference_mode_profiles")
        ),
        "factory_reference_profiles": DEFAULT_REFERENCE_PROFILES,
        "metadata_providers": METADATA_PROVIDERS,
        "metadata_vision_modes": METADATA_VISION_MODES,
        "picassy_categories": normalize_picassy_categories(
            settings.get("picassy_categories") or DEFAULT_PICASSY_CATEGORIES
        ),
        "settings": settings,
        "summary": db.get_system_summary(),
    }


@app.get("/api/providers")
def get_providers() -> Dict[str, Any]:
    settings = db.get_settings(include_secrets=False)
    slots_info = _build_enriched_cdp_slots(settings)
    return {
        "providers": list_available_providers(),
        "cdp": slots_info[0] if slots_info else check_cdp_status(),
        "cdp_slots": slots_info,
    }


def _ensure_cdp_slot_enabled(slot_id: int) -> bool:
    """Enables `slot_id` inside persisted settings when operator launches or binds an online slot."""
    sid = int(slot_id or 1)
    settings = db.get_settings(include_secrets=False)
    slots = normalize_cdp_slots(settings.get("cdp_slots"))
    changed = False
    for s in slots:
        if int(s["slot_id"]) == sid and not s.get("enabled", False):
            s["enabled"] = True
            changed = True
    if changed:
        db.update_settings({"cdp_slots": slots})
        runner.wake_workers()
    return changed


@app.post("/api/providers/cdp/launch")
def api_launch_cdp(req: LaunchCDPRequest) -> Dict[str, Any]:
    res = launch_chrome_slot(
        slot_id=req.slot_id,
        engine=req.engine,
        force_restart=req.force_restart,
    )
    st = res.get("status") or {}
    if res.get("launched") or st.get("connected"):
        was_auto_enabled = _ensure_cdp_slot_enabled(req.slot_id)
        if was_auto_enabled:
            res["auto_enabled"] = True
            res["message"] = f"{res.get('message', '')} Worker enabled for Slot #{req.slot_id}.".strip()
        if isinstance(res.get("status"), dict):
            res["status"]["enabled"] = True
        runner.wake_workers()
    return res


@app.post("/api/axes/suggest")
def api_suggest_axes(req: SuggestAxesRequest) -> Dict[str, Any]:
    try:
        res = suggest_axes_for_theme(
            theme=req.theme,
            base_prompt=req.base_prompt,
            model=req.model,
            reference_ids=req.reference_ids,
            use_browser_turn=req.use_browser_turn,
        )
        db.log_activity(
            f"Suggested custom Continuity & 4 Variation Axes for '{req.theme.strip()}' via {res.get('source_label')}.",
            stage="PLANNER",
        )
        return res
    except ValueError as verr:
        raise HTTPException(status_code=400, detail=str(verr))
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to suggest variation axes: {exc}",
        )


@app.post("/api/axes/sample-prompt")
def api_axes_sample_prompt(req: SamplePromptRequest) -> Dict[str, Any]:
    return {
        "prompt": build_external_master_prompt(
            theme=req.theme,
            base_prompt=req.base_prompt,
            template_kind=req.template_kind,
            target_count=req.target_count,
            metadata_language=req.metadata_language,
        )
    }


@app.post("/api/axes/import")
def api_import_axes(req: ImportAxesRequest) -> Dict[str, Any]:
    parsed = parse_external_axes_import(req.raw_text)
    if not parsed:
        raise HTTPException(
            status_code=400,
            detail=(
                "Could not parse valid Studio JSON from the pasted text. "
                "Make sure your AI output includes a JSON block with `fixed_elements` and/or `variation_axes` lists."
            ),
        )
    va = parsed.get("variation_axes") or {}
    enabled = va.get("enabled_axes") or {}
    active_counts = {
        k: len(va.get(k) or [])
        for k in ("camera_angles", "compositions", "lighting", "atmospheres", "custom_axis")
        if enabled.get(k, True) and len(va.get(k) or []) > 0
    }
    db.log_activity(
        f"Imported external AI Studio configuration ({sum(active_counts.values())} options across {len(active_counts)} active axes).",
        stage="PLANNER",
    )
    return {
        **parsed,
        "source": "external_import",
        "source_label": "External AI JSON Import",
        "active_counts": active_counts,
    }


# =============================================================================
# Reference Endpoints (Local Upload & Pinterest Discovery)
# =============================================================================
@app.get("/api/references")
def api_list_references(
    source_type: Optional[str] = Query(default=None),
    limit: int = Query(default=500, ge=1, le=2000),
) -> Dict[str, Any]:
    return {
        "references": db.list_references(source_type=source_type, limit=limit),
    }


@app.post("/api/references/upload")
async def api_upload_references(
    files: List[UploadFile] = File(...),
    usage_rights: str = Form(default="user_provided_confirmed"),
) -> Dict[str, Any]:
    saved: List[Dict[str, Any]] = []
    errors: List[str] = []
    for up in files:
        try:
            raw = await up.read()
            rec = save_uploaded_reference(
                raw_bytes=raw,
                original_filename=up.filename or "reference.jpg",
                usage_rights=usage_rights,
            )
            saved.append(rec)
        except Exception as exc:
            errors.append(f"{up.filename}: {exc}")

    if not saved and errors:
        raise HTTPException(status_code=400, detail="; ".join(errors))

    return {
        "uploaded": len(saved),
        "references": saved,
        "errors": errors,
    }


@app.post("/api/references/pinterest/discover")
def api_discover_pinterest(req: PinterestDiscoverRequest) -> Dict[str, Any]:
    if not req.query_or_url or not req.query_or_url.strip():
        raise HTTPException(status_code=400, detail="Enter a Pinterest keyword, Pin URL, or Board URL.")
    result = discover_pinterest_references(
        query_or_url=req.query_or_url.strip(),
        limit=req.limit,
        log_fn=lambda m: db.log_activity(m, stage="PINTEREST"),
    )
    return result


@app.get("/api/references/{ref_id}/image")
def api_get_reference_image(ref_id: int):
    ref = db.get_reference(ref_id)
    if not ref or not ref.get("exists_on_disk"):
        raise HTTPException(status_code=404, detail="Reference image not found on disk.")
    return FileResponse(
        ref["file_path"],
        media_type=ref.get("mime_type") or "image/jpeg",
        filename=ref.get("filename") or f"reference_{ref_id}.jpg",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@app.patch("/api/references/{ref_id}")
def api_update_reference(ref_id: int, req: UpdateReferenceRequest) -> Dict[str, Any]:
    updated = db.update_reference(ref_id, title=req.title)
    if not updated:
        raise HTTPException(status_code=404, detail="Reference not found.")
    return {"reference": updated}


@app.delete("/api/references/{ref_id}")
def api_delete_reference(ref_id: int) -> Dict[str, Any]:
    deleted = db.delete_reference(ref_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Reference not found.")
    path_obj = Path(deleted.get("file_path") or "")
    if path_obj.exists():
        try:
            path_obj.unlink()
        except Exception:
            pass
    return {"deleted": True, "id": ref_id}


@app.post("/api/references/bulk-delete")
def api_bulk_delete_references(req: BulkDeleteReferencesRequest) -> Dict[str, Any]:
    deleted_list = db.delete_references_bulk(
        ref_ids=req.reference_ids or None,
        source_type=req.source_type,
        delete_all=req.delete_all,
    )
    deleted_ids: List[int] = []
    for item in deleted_list:
        deleted_ids.append(int(item["id"]))
        path_obj = Path(item.get("file_path") or "")
        if path_obj.exists():
            try:
                path_obj.unlink()
            except Exception:
                pass
    return {
        "deleted": True,
        "deleted_count": len(deleted_ids),
        "deleted_ids": deleted_ids,
    }


# =============================================================================
# Jobs & Variation Planning Endpoints
# =============================================================================
@app.get("/api/jobs")
def api_list_jobs(
    limit: int = Query(default=50, ge=1, le=200),
    include_generations: bool = Query(default=True),
) -> Dict[str, Any]:
    return {"jobs": db.list_jobs(limit=limit, include_generations=include_generations)}


@app.get("/api/jobs/{job_id}")
def api_get_job(job_id: int) -> Dict[str, Any]:
    job = db.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job #{job_id} not found.")
    return {"job": job}


@app.post("/api/jobs")
def api_create_job(req: CreateJobRequest) -> Dict[str, Any]:
    if not req.theme or not req.theme.strip():
        raise HTTPException(status_code=400, detail="Theme is required.")

    model_info = PROVIDER_MODELS.get(req.model)
    if not model_info:
        raise HTTPException(status_code=400, detail=f"Unknown model provider: {req.model}")

    ref_ids = list(req.reference_ids) if req.reference_mode != "prompt_only" else []
    if ref_ids and not model_info.get("supports_reference_image", True):
        raise HTTPException(
            status_code=400,
            detail=f"Model '{model_info['label']}' does not support reference images.",
        )

    settings = db.get_settings(include_secrets=True)
    raw_root = (
        req.export_root_dir.strip()
        if req.export_root_dir and req.export_root_dir.strip()
        else str(settings.get("export_root_dir") or EXPORTS_DIR)
    )
    try:
        resolved_root = Path(raw_root).expanduser().resolve()
        if not resolved_root.exists():
            resolved_root.mkdir(parents=True, exist_ok=True)
        export_root = str(resolved_root)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid export folder path '{raw_root}': {exc}",
        )

    if req.export_root_dir and req.export_root_dir.strip():
        db.update_settings({"export_root_dir": export_root})

    ref_strength = normalize_reference_strength(req.reference_strength, default="balanced")
    carrier_ov = normalize_carrier_override(req.carrier_override, default="auto")

    effective_preset_id = (
        req.preset_id
        if req.preset_id
        else ("reference_adaptive" if req.reference_mode != "prompt_only" else "")
    )
    resolved_fixed, resolved_axes = resolve_axes_and_fixed(
        preset_id=effective_preset_id,
        fixed_elements=req.fixed_elements,
        variation_axes=req.variation_axes,
        reference_mode=req.reference_mode,
        reference_strength=ref_strength,
    )

    initial_count = (
        req.batch_size if req.run_mode == "continuous" else req.target_count
    )
    if req.run_mode == "continuous":
        initial_count = min(initial_count, req.session_cap)

    try:
        planned_turns = plan_job_variations(
            theme=req.theme,
            count=initial_count,
            start_index=1,
            base_prompt=req.base_prompt,
            aspect_ratio=req.aspect_ratio,
            model=req.model,
            reference_mode=req.reference_mode,
            reference_strength=ref_strength,
            carrier_override=carrier_ov,
            reference_ids=ref_ids,
            cycle_references=req.cycle_references,
            preset_id=effective_preset_id,
            fixed_elements=resolved_fixed,
            variation_axes=resolved_axes,
        )
    except ValueError as verr:
        raise HTTPException(status_code=400, detail=str(verr))

    try:
        export_mode = normalize_metadata_export_mode(
            req.metadata_export_mode, default="csv", strict=False
        )
    except ValueError as verr:
        raise HTTPException(status_code=400, detail=str(verr))

    settings_snapshot = db.get_settings(include_secrets=False)
    default_fmt = settings_snapshot.get("export_image_format") or "original"
    try:
        image_format = normalize_export_image_format(
            req.export_image_format if req.export_image_format is not None else default_fmt,
            default=default_fmt,
            strict=req.export_image_format is not None,
        )
    except ValueError as verr:
        raise HTTPException(status_code=400, detail=str(verr))

    default_fname_style = settings_snapshot.get("default_filename_style") or "picassy_slug"
    try:
        fname_style = normalize_filename_style(
            req.filename_style if req.filename_style is not None else default_fname_style,
            default=default_fname_style,
            strict=req.filename_style is not None,
        )
    except ValueError as verr:
        raise HTTPException(status_code=400, detail=str(verr))

    raw_pt = (req.primary_tag or "").strip() or req.theme.strip()
    clean_primary_tag = format_picassy_keyword(raw_pt) or raw_pt
    allowed_cats = normalize_picassy_categories(
        settings_snapshot.get("picassy_categories") or DEFAULT_PICASSY_CATEGORIES
    )
    clean_category = (req.category or "").strip()
    if clean_category:
        matched_cat = next((c for c in allowed_cats if c.lower() == clean_category.lower()), None)
        if not matched_cat:
            raise HTTPException(
                status_code=400,
                detail=f"Category '{clean_category}' is not in configured Picassy categories: {', '.join(allowed_cats)}.",
            )
        clean_category = matched_cat

    job = db.create_job(
        theme=req.theme,
        base_prompt=req.base_prompt,
        reference_mode=req.reference_mode,
        reference_strength=ref_strength,
        carrier_override=carrier_ov,
        run_mode=req.run_mode,
        target_count=req.target_count,
        batch_size=req.batch_size,
        session_cap=req.session_cap,
        cycle_references=req.cycle_references,
        aspect_ratio=req.aspect_ratio,
        metadata_language=req.metadata_language,
        metadata_export_mode=export_mode,
        export_image_format=image_format,
        primary_tag=clean_primary_tag,
        category=clean_category,
        filename_style=fname_style,
        preferred_cdp_slot=req.preferred_cdp_slot,
        caption_prompt=req.caption_prompt,
        use_ai_caption_prompt=req.use_ai_caption_prompt,
        optimize_prompt_english=req.optimize_prompt_english,
        model=req.model,
        export_root_dir=export_root,
        preset_id=effective_preset_id,
        fixed_elements=resolved_fixed,
        variation_axes=resolved_axes,
        reference_ids=ref_ids,
    )

    db.create_generations_bulk(job["id"], planned_turns)

    sync_job_manifest(job["id"], rewrite_all_sidecars=False)
    db.log_activity(
        f"Created image set #{job['id']} '{job['theme']}' ({len(planned_turns)} shots · tag='{clean_primary_tag}' · cat='{clean_category or 'Auto'}' · export={export_mode} · format={image_format}).",
        stage="PLANNER",
        job_id=job["id"],
    )

    if req.preferred_cdp_slot > 0:
        slot_statuses = list_cdp_slots_status(
            slots=normalize_cdp_slots(settings_snapshot.get("cdp_slots")),
            force=False,
        )
        target_st = next((s for s in slot_statuses if int(s["slot_id"]) == int(req.preferred_cdp_slot)), None)
        if target_st and target_st.get("connected") and not target_st.get("enabled"):
            _ensure_cdp_slot_enabled(req.preferred_cdp_slot)

    if req.auto_start:
        job = runner.enqueue_job(job["id"]) or db.get_job(job["id"])  # type: ignore
    else:
        job = db.get_job(job["id"])  # type: ignore

    return {"job": job}


@app.patch("/api/jobs/{job_id}")
def api_update_job(job_id: int, req: UpdateJobRequest) -> Dict[str, Any]:
    existing = db.get_job(job_id)
    if not existing:
        raise HTTPException(status_code=404, detail=f"Job #{job_id} not found.")
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    has_saved_images = any(
        (g.get("image_file") or g.get("image_path"))
        for g in (existing.get("generations") or [])
    )
    if "theme" in updates:
        clean_t = str(updates["theme"]).strip()
        if not clean_t:
            raise HTTPException(status_code=400, detail="Theme cannot be empty.")
        updates["theme"] = clean_t
        if not has_saved_images and "primary_tag" not in updates:
            updates["slug"] = slugify_theme(clean_t)

    if "primary_tag" in updates:
        raw_pt_up = str(updates["primary_tag"]).strip()
        if not raw_pt_up:
            raise HTTPException(status_code=400, detail="Primary tag cannot be empty.")
        clean_pt = format_picassy_keyword(raw_pt_up) or raw_pt_up
        updates["primary_tag"] = clean_pt
        if not has_saved_images:
            updates["slug"] = slugify_theme(raw_pt_up)

    if "category" in updates:
        clean_cat = str(updates["category"]).strip()
        if clean_cat:
            allowed_cats = normalize_picassy_categories(
                db.get_settings(include_secrets=False).get("picassy_categories")
                or DEFAULT_PICASSY_CATEGORIES
            )
            matched = next((c for c in allowed_cats if c.lower() == clean_cat.lower()), None)
            if not matched:
                raise HTTPException(
                    status_code=400,
                    detail=f"Category '{clean_cat}' is not in configured Picassy categories.",
                )
            updates["category"] = matched
        else:
            updates["category"] = ""

    if "filename_style" in updates:
        try:
            updates["filename_style"] = normalize_filename_style(
                updates["filename_style"], strict=True
            )
        except ValueError as verr:
            raise HTTPException(status_code=400, detail=str(verr))

    if "reference_strength" in updates:
        try:
            updates["reference_strength"] = normalize_reference_strength(
                updates["reference_strength"], strict=True
            )
        except ValueError as verr:
            raise HTTPException(status_code=400, detail=str(verr))

    if "carrier_override" in updates:
        try:
            updates["carrier_override"] = normalize_carrier_override(
                updates["carrier_override"], strict=True
            )
        except ValueError as verr:
            raise HTTPException(status_code=400, detail=str(verr))

    replan_unlocked_flag = bool(updates.pop("replan_unlocked", False))
    new_export_root = str(updates.pop("export_root_dir", "") or "").strip()

    if "preferred_cdp_slot" in updates:
        slot_num = int(updates["preferred_cdp_slot"])
        if slot_num < 0 or slot_num > MAX_CDP_SLOTS:
            raise HTTPException(status_code=400, detail=f"preferred_cdp_slot must be 0..{MAX_CDP_SLOTS}.")
        updates["preferred_cdp_slot"] = slot_num
        if slot_num > 0:
            slot_statuses = list_cdp_slots_status(force=False)
            target_st = next((s for s in slot_statuses if int(s["slot_id"]) == slot_num), None)
            if target_st and target_st.get("connected") and not target_st.get("enabled"):
                _ensure_cdp_slot_enabled(slot_num)

    if "metadata_export_mode" in updates:
        try:
            updates["metadata_export_mode"] = normalize_metadata_export_mode(
                updates["metadata_export_mode"], strict=True
            )
        except ValueError as verr:
            raise HTTPException(status_code=400, detail=str(verr))

    if "export_image_format" in updates:
        try:
            updates["export_image_format"] = normalize_export_image_format(
                updates["export_image_format"],
                strict=True,
            )
        except ValueError as verr:
            raise HTTPException(status_code=400, detail=str(verr))

    if any(k in updates for k in ("preset_id", "fixed_elements", "variation_axes", "reference_strength", "reference_mode")):
        effective_preset = str(
            updates["preset_id"]
            if "preset_id" in updates
            else (existing.get("preset_id") or "")
        )
        effective_ref_mode = str(
            updates.get("reference_mode") or existing.get("reference_mode") or "prompt_only"
        )
        effective_ref_strength = str(
            updates.get("reference_strength") or existing.get("reference_strength") or "balanced"
        )
        effective_fixed = (
            updates["fixed_elements"]
            if "fixed_elements" in updates
            else existing.get("fixed_elements")
        )
        effective_axes = (
            updates["variation_axes"]
            if "variation_axes" in updates
            else existing.get("variation_axes")
        )
        norm_fixed, norm_axes = resolve_axes_and_fixed(
            preset_id=effective_preset,
            fixed_elements=effective_fixed,
            variation_axes=effective_axes,
            reference_mode=effective_ref_mode,
            reference_strength=effective_ref_strength,
        )
        updates["fixed_elements"] = norm_fixed
        updates["variation_axes"] = norm_axes

    if "reference_mode" in updates and updates["reference_mode"] == "prompt_only":
        updates["reference_ids"] = []

    updated = db.update_job(job_id, **updates) or existing

    if new_export_root:
        try:
            resolved_root = str(Path(new_export_root).expanduser().resolve())
            cur_parent = str(Path(updated["export_dir"]).resolve().parent)
            if resolved_root != cur_parent:
                updated = relocate_job_export_dir(job_id, resolved_root) or updated
        except Exception as exc:
            logger.warning("Could not relocate job #%s folder: %s", job_id, exc)

    structural_replan_needed = replan_unlocked_flag or any(
        k in updates
        for k in (
            "target_count",
            "run_mode",
            "batch_size",
            "session_cap",
            "reference_mode",
            "reference_ids",
            "cycle_references",
            "model",
        )
    )

    if structural_replan_needed:
        db.clear_unlocked_planned_generations(job_id)
        refreshed = db.get_job(job_id) or updated
        kept_gens = refreshed.get("generations") or []
        desired_total = (
            min(int(refreshed["batch_size"]), int(refreshed["session_cap"]))
            if refreshed.get("run_mode") == "continuous"
            else int(refreshed["target_count"])
        )
        needed = max(0, desired_total - len(kept_gens))
        if needed > 0:
            next_index = (max((int(g["index_num"]) for g in kept_gens), default=0)) + 1
            existing_prompts = [g["prompt_final"] for g in kept_gens]
            new_turns = plan_job_variations(
                theme=refreshed["theme"],
                count=needed,
                start_index=next_index,
                base_prompt=refreshed.get("base_prompt") or "",
                aspect_ratio=refreshed.get("aspect_ratio") or "1:1",
                model=refreshed.get("model") or "chrome-cdp/gemini",
                reference_mode=refreshed.get("reference_mode") or "prompt_only",
                reference_strength=str(refreshed.get("reference_strength") or "balanced"),
                carrier_override=str(refreshed.get("carrier_override") or "auto"),
                reference_ids=refreshed.get("reference_ids") or [],
                cycle_references=bool(refreshed.get("cycle_references", True)),
                preset_id=refreshed.get("preset_id") or "",
                fixed_elements=refreshed.get("fixed_elements"),
                variation_axes=refreshed.get("variation_axes"),
                existing_prompts=existing_prompts,
            )
            db.create_generations_bulk(job_id, new_turns)
        updated = db.get_job(job_id) or refreshed
    elif any(
        k in updates
        for k in (
            "theme",
            "base_prompt",
            "aspect_ratio",
            "preset_id",
            "fixed_elements",
            "variation_axes",
            "reference_strength",
            "carrier_override",
        )
    ):
        job_fixed = updated.get("fixed_elements") or {}
        job_va = updated.get("variation_axes") or {}
        job_enabled = job_va.get("enabled_axes")
        custom_label = str(job_va.get("custom_axis_label") or "Custom Variation")
        ref_str = str(updated.get("reference_strength") or "balanced")
        car_ov = str(updated.get("carrier_override") or "auto")
        for gen in updated.get("generations") or []:
            if gen.get("status") == "planned" and not gen.get("is_locked"):
                turn_axes = dict(gen.get("variation_axes") or {})
                if custom_label and "custom_axis" in turn_axes:
                    turn_axes["custom_axis_label"] = custom_label
                new_prompt = compose_prompt_from_axes(
                    theme=updated["theme"],
                    base_prompt=updated.get("base_prompt") or "",
                    aspect_ratio=updated.get("aspect_ratio") or "1:1",
                    fixed_elements=job_fixed,
                    turn_axes=turn_axes,
                    has_reference=bool(gen.get("reference_id")),
                    reference_reused=False,
                    reference_strength=ref_str,
                    carrier_override=car_ov,
                    variation_number=int(gen["index_num"]),
                    enabled_axes=job_enabled,
                    custom_axis_label=custom_label,
                )
                db.update_generation(
                    gen["id"],
                    fixed_elements=job_fixed,
                    variation_axes=turn_axes,
                    prompt_final=new_prompt,
                )
        updated = db.get_job(job_id) or updated

    # If the user switched to 'csv' mode and any completed images lack metadata,
    # automatically synthesize Picassy Title, Description & Alt Text before syncing `pin-import.csv`.
    if updated.get("metadata_export_mode") == "csv":
        needs_refresh = False
        for gen in updated.get("generations") or []:
            if gen.get("image_file") or gen.get("image_path"):
                if not gen.get("title") or not gen.get("description") or not gen.get("alt_text"):
                    try:
                        meta = write_generation_metadata(
                            job=updated,
                            generation=gen,
                            use_browser_turn=False,
                        )
                        db.update_generation(
                            gen["id"],
                            title=meta["title"],
                            caption=meta.get("caption") or meta["title"],
                            description=meta["description"],
                            alt_text=meta.get("alt_text") or "",
                            hashtags="",
                        )
                        needs_refresh = True
                    except Exception:
                        pass
        if needs_refresh:
            updated = db.get_job(job_id) or updated

    sync_job_manifest(job_id, job=updated)
    return {"job": db.get_job(job_id)}


@app.post("/api/jobs/{job_id}/metadata/regenerate")
def api_regenerate_job_metadata(
    job_id: int,
    req: RetryMetadataRequest,
) -> Dict[str, Any]:
    job = runner.regenerate_all_job_metadata(
        job_id=job_id,
        use_browser_turn=req.use_browser_turn,
    )
    if not job:
        raise HTTPException(status_code=404, detail=f"Job #{job_id} not found.")
    return {"job": job}


@app.post("/api/jobs/{job_id}/remove-watermarks")
def api_remove_job_watermarks(job_id: int) -> Dict[str, Any]:
    res = remove_watermarks_for_job(job_id)
    if not res:
        raise HTTPException(status_code=404, detail=f"Job #{job_id} not found.")
    return res


@app.post("/api/jobs/{job_id}/replan")
def api_replan_job(job_id: int) -> Dict[str, Any]:
    job = db.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job #{job_id} not found.")

    # Remove unlocked `planned` turns while preserving locked or completed turns
    db.clear_unlocked_planned_generations(job_id)
    refreshed = db.get_job(job_id) or job
    kept_gens = refreshed.get("generations") or []
    desired_total = (
        int(refreshed["batch_size"])
        if refreshed.get("run_mode") == "continuous"
        else int(refreshed["target_count"])
    )
    needed = max(1, desired_total - len(kept_gens))
    next_index = (max((int(g["index_num"]) for g in kept_gens), default=0)) + 1
    existing_prompts = [g["prompt_final"] for g in kept_gens]

    new_turns = plan_job_variations(
        theme=refreshed["theme"],
        count=needed,
        start_index=next_index,
        base_prompt=refreshed.get("base_prompt") or "",
        aspect_ratio=refreshed.get("aspect_ratio") or "1:1",
        model=refreshed.get("model") or "chrome-cdp/gemini",
        reference_mode=refreshed.get("reference_mode") or "prompt_only",
        reference_strength=refreshed.get("reference_strength") or "balanced",
        carrier_override=str(refreshed.get("carrier_override") or "auto"),
        reference_ids=refreshed.get("reference_ids") or [],
        cycle_references=bool(refreshed.get("cycle_references", True)),
        preset_id=refreshed.get("preset_id") or "",
        fixed_elements=refreshed.get("fixed_elements"),
        variation_axes=refreshed.get("variation_axes"),
        existing_prompts=existing_prompts,
    )

    db.create_generations_bulk(job_id, new_turns)

    sync_job_manifest(job_id, rewrite_all_sidecars=False)
    return {"job": db.get_job(job_id)}


@app.post("/api/jobs/{job_id}/generations")
def api_add_generation(job_id: int, req: AddGenerationRequest) -> Dict[str, Any]:
    job = db.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job #{job_id} not found.")

    gens = job.get("generations") or []
    next_idx = (max((int(g["index_num"]) for g in gens), default=0)) + 1

    if req.prompt_final and req.prompt_final.strip():
        prompt_final = req.prompt_final.strip()
        turn_axes = req.variation_axes or {}
        fixed_el = job.get("fixed_elements") or {}
        ref_id = req.reference_id
    else:
        planned = plan_job_variations(
            theme=job["theme"],
            count=1,
            start_index=next_idx,
            base_prompt=job.get("base_prompt") or "",
            aspect_ratio=job.get("aspect_ratio") or "1:1",
            model=job.get("model") or "chrome-cdp/gemini",
            reference_mode=job.get("reference_mode") or "prompt_only",
            reference_strength=job.get("reference_strength") or "balanced",
            carrier_override=str(job.get("carrier_override") or "auto"),
            reference_ids=[req.reference_id] if req.reference_id else (job.get("reference_ids") or []),
            cycle_references=True,
            preset_id=job.get("preset_id") or "",
            fixed_elements=job.get("fixed_elements"),
            variation_axes=job.get("variation_axes"),
            existing_prompts=[g["prompt_final"] for g in gens],
        )[0]
        prompt_final = planned["prompt_final"]
        turn_axes = planned["variation_axes"]
        fixed_el = planned["fixed_elements"]
        ref_id = req.reference_id if req.reference_id is not None else planned["reference_id"]

    db.create_generation(
        job_id=job_id,
        index_num=next_idx,
        prompt_final=prompt_final,
        model=job.get("model") or "chrome-cdp/gemini",
        reference_id=ref_id,
        fixed_elements=fixed_el,
        variation_axes=turn_axes,
        is_locked=False,
        status="planned",
    )
    sync_job_manifest(job_id)
    return {"job": db.get_job(job_id)}


@app.delete("/api/jobs/{job_id}")
def api_delete_job(
    job_id: int,
    delete_files: bool = Query(default=False),
) -> Dict[str, Any]:
    job = db.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job #{job_id} not found.")
    runner.cancel_job(job_id)
    if delete_files and job.get("export_dir"):
        exp_path = Path(job["export_dir"]).expanduser().resolve()
        settings = db.get_settings(include_secrets=False)
        configured_root = str(settings.get("export_root_dir") or "").strip()
        protected_roots = {EXPORTS_DIR.resolve(), BASE_DIR.resolve(), Path.home().resolve()}
        if configured_root:
            protected_roots.add(Path(configured_root).expanduser().resolve())
        if (
            exp_path.exists()
            and exp_path.is_dir()
            and exp_path not in protected_roots
            and exp_path.parent != exp_path
        ):
            shutil.rmtree(exp_path, ignore_errors=True)
    db.delete_job(job_id)
    return {"deleted": True, "id": job_id}


# =============================================================================
# Job Execution Control Endpoints (Start / Pause / Resume / Cancel / Retry)
# =============================================================================
@app.post("/api/jobs/{job_id}/start")
def api_start_job(job_id: int) -> Dict[str, Any]:
    job = runner.enqueue_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job #{job_id} not found.")
    return {"job": job}


@app.post("/api/jobs/{job_id}/pause")
def api_pause_job(job_id: int) -> Dict[str, Any]:
    job = runner.pause_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job #{job_id} not found.")
    return {"job": job}


@app.post("/api/jobs/{job_id}/resume")
def api_resume_job(job_id: int) -> Dict[str, Any]:
    job = runner.resume_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job #{job_id} not found.")
    return {"job": job}


@app.post("/api/jobs/{job_id}/cancel")
def api_cancel_job(job_id: int) -> Dict[str, Any]:
    job = runner.cancel_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job #{job_id} not found.")
    return {"job": job}


@app.post("/api/jobs/{job_id}/retry-failed")
def api_retry_failed(job_id: int) -> Dict[str, Any]:
    job = runner.retry_failed_turns(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job #{job_id} not found.")
    return {"job": job}


# =============================================================================
# Individual Generation & Metadata Endpoints
# =============================================================================
@app.patch("/api/generations/{gen_id}")
def api_update_generation(gen_id: int, req: UpdateGenerationRequest) -> Dict[str, Any]:
    gen = db.get_generation(gen_id)
    if not gen:
        raise HTTPException(status_code=404, detail=f"Generation #{gen_id} not found.")
    job = db.get_job(gen["job_id"])
    if not job:
        raise HTTPException(status_code=404, detail="Parent job not found.")

    updates: Dict[str, Any] = {}
    if req.clear_reference:
        updates["reference_id"] = None
    elif req.reference_id is not None:
        updates["reference_id"] = req.reference_id

    if req.is_locked is not None:
        updates["is_locked"] = req.is_locked
    if req.is_peak is not None:
        updates["is_peak"] = req.is_peak
    if req.title is not None:
        updates["title"] = req.title.strip()
    if req.caption is not None:
        updates["caption"] = req.caption.strip()
    if req.description is not None:
        updates["description"] = req.description.strip()
    if req.alt_text is not None:
        updates["alt_text"] = req.alt_text.strip()
    if req.hashtags is not None:
        updates["hashtags"] = req.hashtags.strip()
    if req.fixed_elements is not None:
        updates["fixed_elements"] = req.fixed_elements
    if req.variation_axes is not None:
        updates["variation_axes"] = req.variation_axes

    if req.prompt_final is not None:
        updates["prompt_final"] = req.prompt_final.strip()
    elif (
        req.variation_axes is not None
        or req.clear_reference
        or req.reference_id is not None
    ) and not gen.get("is_locked"):
        # Rebuild prompt_final from updated variation axes or reference pairing
        ref_id = updates.get("reference_id", gen.get("reference_id"))
        turn_axes = req.variation_axes if req.variation_axes is not None else (gen.get("variation_axes") or {})
        job_va = job.get("variation_axes") or {}
        updates["prompt_final"] = compose_prompt_from_axes(
            theme=job["theme"],
            base_prompt=job.get("base_prompt") or "",
            aspect_ratio=job.get("aspect_ratio") or "1:1",
            fixed_elements=req.fixed_elements or gen.get("fixed_elements") or job.get("fixed_elements") or {},
            turn_axes=turn_axes,
            has_reference=bool(ref_id),
            reference_reused=False,
            reference_strength=str(job.get("reference_strength") or "balanced"),
            carrier_override=str(job.get("carrier_override") or "auto"),
            variation_number=int(gen["index_num"]),
            enabled_axes=job_va.get("enabled_axes"),
            custom_axis_label=str(turn_axes.get("custom_axis_label") or job_va.get("custom_axis_label") or "Custom Variation"),
        )

    # If title and description are both provided on a metadata_pending item, mark it completed
    if (
        gen["status"] == "metadata_pending"
        and (updates.get("title") or gen.get("title"))
        and (updates.get("description") or gen.get("description"))
    ):
        updates["status"] = "completed"
        updates["error"] = ""

    updated_gen = db.update_generation(gen_id, **updates)
    sync_generation_and_manifest(job["id"], gen_id, force_manifest=True)
    return {
        "generation": updated_gen,
        "job": db.get_job(job["id"]),
    }


@app.delete("/api/generations/{gen_id}")
def api_delete_generation(gen_id: int) -> Dict[str, Any]:
    gen = db.get_generation(gen_id)
    if not gen:
        raise HTTPException(status_code=404, detail=f"Generation #{gen_id} not found.")
    job_id = gen["job_id"]
    runner.notify_generation_deleted(gen_id)
    del_res = db.delete_generation_with_resequence(gen_id)
    if del_res:
        cleanup_and_resequence_after_delete_generation(job_id, del_res)
    return {"deleted": True, "job": db.get_job(job_id)}


@app.post("/api/jobs/{job_id}/generations/bulk-delete")
def api_bulk_delete_generations(
    job_id: int,
    req: BulkDeleteGenerationsRequest,
) -> Dict[str, Any]:
    job = db.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job #{job_id} not found.")
    clean_ids = [int(x) for x in (req.generation_ids or []) if int(x) > 0]
    if not clean_ids:
        return {"deleted": False, "deleted_count": 0, "job": job}
    for gid in clean_ids:
        runner.notify_generation_deleted(gid)
    del_res = db.delete_generations_bulk_with_resequence(job_id, clean_ids)
    deleted_count = 0
    if del_res:
        deleted_count = len(del_res.get("deleted_items") or [])
        cleanup_and_resequence_after_delete_generation(job_id, del_res)
    return {
        "deleted": deleted_count > 0,
        "deleted_count": deleted_count,
        "job": db.get_job(job_id),
    }


@app.post("/api/jobs/{job_id}/reconcile-folder")
def api_reconcile_job_folder(job_id: int) -> Dict[str, Any]:
    job = db.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job #{job_id} not found.")
    res = reconcile_job_export_folder(job_id)
    return res


@app.post("/api/generations/{gen_id}/skip")
def api_skip_generation(gen_id: int) -> Dict[str, Any]:
    gen = runner.skip_single_generation(gen_id)
    if not gen:
        raise HTTPException(status_code=404, detail=f"Generation #{gen_id} not found.")
    return {
        "generation": gen,
        "job": db.get_job(gen["job_id"]),
    }


@app.post("/api/generations/{gen_id}/retry")
def api_retry_generation(gen_id: int, req: RetryGenerationRequest) -> Dict[str, Any]:
    gen = runner.retry_single_generation(gen_id, mutate_axes=req.mutate_axes)
    if not gen:
        raise HTTPException(status_code=404, detail=f"Generation #{gen_id} not found.")
    return {
        "generation": gen,
        "job": db.get_job(gen["job_id"]),
    }


@app.post("/api/generations/{gen_id}/metadata/retry")
def api_retry_metadata(gen_id: int, req: RetryMetadataRequest) -> Dict[str, Any]:
    gen = runner.retry_generation_metadata(gen_id, use_browser_turn=req.use_browser_turn)
    if not gen:
        raise HTTPException(status_code=404, detail=f"Generation #{gen_id} not found.")
    return {
        "generation": gen,
        "job": db.get_job(gen["job_id"]),
    }


def _decode_data_url_or_b64(raw_val: str) -> bytes:
    import base64

    clean = raw_val.strip()
    if "," in clean and clean.lower().startswith("data:"):
        clean = clean.split(",", 1)[1]
    return base64.b64decode(clean)


@app.post("/api/generations/{gen_id}/edit-image")
def api_edit_generation_image(
    gen_id: int,
    req: EditGenerationImageRequest,
) -> Dict[str, Any]:
    import base64

    gen = db.get_generation(gen_id)
    if not gen or not gen.get("image_path"):
        raise HTTPException(status_code=404, detail=f"Generated image #{gen_id} not found.")
    img_path = Path(gen["image_path"])
    if not img_path.exists():
        raise HTTPException(status_code=404, detail="Image file missing on disk.")

    try:
        working_bytes = (
            _decode_data_url_or_b64(req.source_base64)
            if req.source_base64
            else img_path.read_bytes()
        )
        op = (req.operation or "inpaint").strip().lower()

        if op == "force_star":
            res = remove_gemini_watermark_bytes(working_bytes, force=True)
            out_bytes = res["raw_bytes"]
            label = "Force-cleaned Gemini star watermark"
        elif op == "trim":
            out_bytes = trim_image_edges_bytes(
                working_bytes,
                trim_percent=req.trim_percent,
                anchor=req.trim_anchor,
            )
            label = f"Trimmed {req.trim_percent:.1f}% ({req.trim_anchor})"
        elif op == "commit_base64":
            out_bytes = working_bytes
            label = "Saved edited image in Review Deck"
        else:
            mask_bytes = _decode_data_url_or_b64(req.mask_base64) if req.mask_base64 else None
            out_bytes = inpaint_image_bytes(
                working_bytes,
                mask_png_bytes=mask_bytes,
                boxes=req.boxes,
            )
            label = "Removed logo/watermark via Inpaint"

        if req.save_to_disk:
            saved = replace_generation_image_on_disk(
                gen_id,
                out_bytes,
                action_label=label,
            )
            if not saved:
                raise HTTPException(status_code=404, detail="Generation not found.")
            return {
                "saved": True,
                "generation": saved["generation"],
                "job": saved["job"],
            }

        info = inspect_image_bytes(out_bytes)
        b64_str = base64.b64encode(out_bytes).decode("ascii")
        return {
            "saved": False,
            "preview_data_url": f"data:{info['mime_type']};base64,{b64_str}",
            "width": info["width"],
            "height": info["height"],
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Image edit failed: {exc}")


# =============================================================================
# Export, Image Serving, Sidecar JSON, Caption TXT, Manifest & ZIP Endpoints
# =============================================================================
@app.get("/api/generations/{gen_id}/image")
def api_get_generation_image(
    gen_id: int,
    download: bool = Query(default=False),
):
    gen = db.get_generation(gen_id)
    if not gen or not gen.get("image_path"):
        raise HTTPException(status_code=404, detail="Generated image not found.")
    img_path = Path(gen["image_path"])
    if not img_path.exists():
        raise HTTPException(status_code=404, detail="Image file missing on disk.")

    headers = {}
    if download:
        headers["Content-Disposition"] = f'attachment; filename="{img_path.name}"'
    else:
        headers["Cache-Control"] = "public, max-age=86400"
    return FileResponse(
        str(img_path),
        media_type=gen.get("mime_type") or "image/jpeg",
        headers=headers,
    )


@app.get("/api/jobs/{job_id}/csv")
def api_download_job_csv(job_id: int):
    try:
        csv_bytes, csv_filename = get_or_build_job_csv_bytes(job_id)
    except ValueError as verr:
        raise HTTPException(status_code=404, detail=str(verr))
    return Response(
        content=csv_bytes,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{csv_filename}"'},
    )


@app.get("/api/jobs/{job_id}/zip")
def api_download_job_zip(job_id: int):
    try:
        zip_path, zip_filename = build_job_zip_file(job_id)
    except ValueError as verr:
        raise HTTPException(status_code=404, detail=str(verr))
    return FileResponse(
        path=str(zip_path),
        media_type="application/zip",
        filename=zip_filename,
        background=BackgroundTask(lambda: zip_path.unlink(missing_ok=True)),
    )


@app.post("/api/jobs/{job_id}/open-folder")
def api_open_job_folder(job_id: int) -> Dict[str, Any]:
    try:
        return open_export_folder_in_os(job_id)
    except ValueError as verr:
        raise HTTPException(status_code=404, detail=str(verr))


@app.post("/api/system/pick-folder")
def api_pick_folder(req: PickFolderRequest) -> Dict[str, Any]:
    chosen = pick_folder_via_os_dialog()
    if not chosen:
        return {"cancelled": True, "path": None}
    if req.save_as_default:
        db.update_settings({"export_root_dir": chosen})
    updated_job = None
    if req.job_id:
        updated_job = relocate_job_export_dir(req.job_id, chosen)
    return {
        "cancelled": False,
        "path": chosen,
        "settings": db.get_settings(include_secrets=False),
        "job": updated_job,
    }


@app.post("/api/jobs/{job_id}/change-folder")
def api_change_job_folder(job_id: int, req: ChangeFolderRequest) -> Dict[str, Any]:
    if not req.export_root_dir or not req.export_root_dir.strip():
        raise HTTPException(status_code=400, detail="Enter a valid folder path.")
    try:
        resolved = str(Path(req.export_root_dir.strip()).expanduser().resolve())
        if req.save_as_default:
            db.update_settings({"export_root_dir": resolved})
        updated_job = relocate_job_export_dir(job_id, resolved)
        return {
            "job": updated_job,
            "settings": db.get_settings(include_secrets=False),
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not move export folder: {exc}")


# =============================================================================
# Settings, Logs & Workspace Reset
# =============================================================================
@app.get("/api/settings")
def api_get_settings() -> Dict[str, Any]:
    return {"settings": db.get_settings(include_secrets=False)}


@app.put("/api/settings")
def api_update_settings(updates: Dict[str, Any]) -> Dict[str, Any]:
    if "default_metadata_export_mode" in updates:
        try:
            updates["default_metadata_export_mode"] = normalize_metadata_export_mode(
                updates["default_metadata_export_mode"],
                strict=True,
            )
        except ValueError as verr:
            raise HTTPException(status_code=400, detail=str(verr))

    if "export_image_format" in updates:
        try:
            updates["export_image_format"] = normalize_export_image_format(
                updates["export_image_format"],
                strict=True,
            )
        except ValueError as verr:
            raise HTTPException(status_code=400, detail=str(verr))

    if "default_filename_style" in updates:
        try:
            updates["default_filename_style"] = normalize_filename_style(
                updates["default_filename_style"],
                strict=True,
            )
        except ValueError as verr:
            raise HTTPException(status_code=400, detail=str(verr))

    if "metadata_provider" in updates:
        mp = str(updates["metadata_provider"] or "").strip().lower()
        if mp not in METADATA_PROVIDERS:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid metadata_provider. Expected one of: {', '.join(METADATA_PROVIDERS)}.",
            )
        updates["metadata_provider"] = mp

    if "reference_mode_profiles" in updates:
        updates["reference_mode_profiles"] = normalize_reference_mode_profiles(
            updates["reference_mode_profiles"]
        )

    if "metadata_vision_mode" in updates:
        mvm = str(updates["metadata_vision_mode"] or "").strip().lower()
        if mvm not in METADATA_VISION_MODES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid metadata_vision_mode. Expected one of: {', '.join(METADATA_VISION_MODES)}.",
            )
        updates["metadata_vision_mode"] = mvm

    if "picassy_categories" in updates:
        updates["picassy_categories"] = normalize_picassy_categories(
            updates["picassy_categories"]
        )

    if "cdp_slots" in updates:
        updates["cdp_slots"] = normalize_cdp_slots(updates["cdp_slots"])

    if "export_root_dir" in updates and updates["export_root_dir"]:
        raw_dir = str(updates["export_root_dir"]).strip()
        try:
            resolved_dir = Path(raw_dir).expanduser().resolve()
            resolved_dir.mkdir(parents=True, exist_ok=True)
            updates["export_root_dir"] = str(resolved_dir)
            for j in db.list_jobs(limit=50, include_generations=False):
                if j["status"] == "planned" and j["counts"]["completed"] == 0:
                    relocate_job_export_dir(j["id"], str(resolved_dir))
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot create export folder '{raw_dir}': {exc}",
            )
    updated = db.update_settings(updates)
    runner.wake_workers()
    return {"settings": updated}


@app.get("/api/logs")
def api_get_logs(
    job_id: Optional[int] = Query(default=None),
    limit: int = Query(default=150, ge=1, le=500),
) -> Dict[str, Any]:
    return {"logs": db.list_activity_logs(job_id=job_id, limit=limit)}


@app.post("/api/workspace/reset")
def api_reset_workspace(req: ResetWorkspaceRequest) -> Dict[str, Any]:
    for j in db.list_jobs(limit=100, include_generations=False):
        runner.cancel_job(j["id"])
    db.reset_workspace(clear_references=req.clear_references)
    if req.clear_references and REFERENCES_DIR.exists():
        for child in REFERENCES_DIR.iterdir():
            if child.is_file():
                child.unlink(missing_ok=True)
    if req.delete_exports and EXPORTS_DIR.exists():
        for child in EXPORTS_DIR.iterdir():
            if child.is_dir():
                shutil.rmtree(child, ignore_errors=True)
    return {"reset": True}


# =============================================================================
# Static Frontend Bundle Serving (Production)
# =============================================================================
FRONTEND_DIST = BASE_DIR / "frontend" / "dist"


@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="API route not found")
    candidate = FRONTEND_DIST / full_path
    if full_path and candidate.exists() and candidate.is_file():
        return FileResponse(
            str(candidate),
            headers={"Cache-Control": "no-cache"},
        )
    index_file = FRONTEND_DIST / "index.html"
    if not index_file.exists():
        return HTMLResponse("<h1>Frontend bundle not built. Run npm run build.</h1>", status_code=503)
    html_content = index_file.read_text(encoding="utf-8")
    return HTMLResponse(
        content=html_content,
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
            "Clear-Site-Data": '"cache"',
        },
    )
