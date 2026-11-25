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
    DEFAULT_CAPTION_PROMPT,
    DEFAULT_PICASSY_CATEGORIES,
    EXPORT_IMAGE_FORMATS,
    EXPORTS_DIR,
    FILENAME_STYLES,
    MAX_CDP_SLOTS,
    METADATA_EXPORT_MODES,
    METADATA_LANGUAGES,
    METADATA_PROVIDERS,
    METADATA_VISION_MODES,
    PROVIDER_MODELS,
    REFERENCES_DIR,
    STUDIO_PRESETS,
    ensure_directories,
    normalize_cdp_slots,
    normalize_export_image_format,
    normalize_filename_style,
    normalize_picassy_categories,
)
from database.db_manager import db, slugify_theme
from modules.app_logging import logger
from modules.export_manager import (
    build_job_zip_file,
    cleanup_and_resequence_after_delete_generation,
    format_caption_text,
    open_export_folder_in_os,
    pick_folder_via_os_dialog,
    relocate_job_export_dir,
    sync_generation_and_manifest,
    sync_job_manifest,
    write_caption_txt,
    write_sidecar_json,
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
from modules.watermark_remover import remove_watermarks_for_job


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


class CreateJobRequest(BaseModel):
    theme: str
    base_prompt: str = ""
    reference_mode: str = "prompt_only"          # prompt_only | local_upload | pinterest
    run_mode: str = "fixed"                      # fixed | continuous
    target_count: int = Field(default=6, ge=1, le=1000)
    batch_size: int = Field(default=4, ge=1, le=50)
    session_cap: int = Field(default=20, ge=1, le=1000)
    cycle_references: bool = True
    aspect_ratio: str = "1:1"
    metadata_language: str = "English"
    metadata_export_mode: str = "json"           # json | caption | none
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
    preset_id: Optional[str] = None
    fixed_elements: Optional[Dict[str, Any]] = None
    variation_axes: Optional[Dict[str, Any]] = None
    reference_ids: Optional[List[int]] = None


class AddGenerationRequest(BaseModel):
    prompt_final: Optional[str] = None
    reference_id: Optional[int] = None
    variation_axes: Optional[Dict[str, Any]] = None


class UpdateGenerationRequest(BaseModel):
    prompt_final: Optional[str] = None
    reference_id: Optional[int] = None
    clear_reference: bool = False
    is_locked: Optional[bool] = None
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


@app.post("/api/providers/cdp/launch")
def api_launch_cdp(req: LaunchCDPRequest) -> Dict[str, Any]:
    return launch_chrome_slot(
        slot_id=req.slot_id,
        engine=req.engine,
        force_restart=req.force_restart,
    )


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
    limit: int = Query(default=100, ge=1, le=500),
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

    resolved_fixed, resolved_axes = resolve_axes_and_fixed(
        preset_id=req.preset_id,
        fixed_elements=req.fixed_elements,
        variation_axes=req.variation_axes,
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
            reference_ids=ref_ids,
            cycle_references=req.cycle_references,
            preset_id=req.preset_id,
            fixed_elements=resolved_fixed,
            variation_axes=resolved_axes,
        )
    except ValueError as verr:
        raise HTTPException(status_code=400, detail=str(verr))

    export_mode = (req.metadata_export_mode or "json").strip().lower()
    if export_mode not in ("json", "caption", "none"):
        export_mode = "json"

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

    clean_primary_tag = (req.primary_tag or "").strip() or req.theme.strip()
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
        preset_id=req.preset_id,
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
        clean_pt = str(updates["primary_tag"]).strip()
        if not clean_pt:
            raise HTTPException(status_code=400, detail="Primary tag cannot be empty.")
        updates["primary_tag"] = clean_pt
        if not has_saved_images:
            updates["slug"] = slugify_theme(clean_pt)

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

    if "preferred_cdp_slot" in updates:
        slot_num = int(updates["preferred_cdp_slot"])
        if slot_num < 0 or slot_num > MAX_CDP_SLOTS:
            raise HTTPException(status_code=400, detail=f"preferred_cdp_slot must be 0..{MAX_CDP_SLOTS}.")
        updates["preferred_cdp_slot"] = slot_num

    if "metadata_export_mode" in updates:
        mode = str(updates["metadata_export_mode"]).strip().lower()
        if mode not in ("json", "caption", "none"):
            raise HTTPException(status_code=400, detail="Invalid metadata_export_mode.")
        updates["metadata_export_mode"] = mode

    if "export_image_format" in updates:
        try:
            updates["export_image_format"] = normalize_export_image_format(
                updates["export_image_format"],
                strict=True,
            )
        except ValueError as verr:
            raise HTTPException(status_code=400, detail=str(verr))

    if any(k in updates for k in ("fixed_elements", "variation_axes")):
        effective_preset = str(updates.get("preset_id") or existing.get("preset_id") or "")
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
        )
        if "fixed_elements" in updates:
            updates["fixed_elements"] = norm_fixed
        if "variation_axes" in updates:
            updates["variation_axes"] = norm_axes

    updated = db.update_job(job_id, **updates) or existing

    # If theme, base_prompt, fixed_elements, or variation_axes (enabled_axes / custom_axis_label)
    # were updated on the job, recompose prompt_final for unlocked `planned` turns so changes apply immediately.
    if any(k in updates for k in ("theme", "base_prompt", "fixed_elements", "variation_axes")):
        job_fixed = updated.get("fixed_elements") or {}
        job_va = updated.get("variation_axes") or {}
        job_enabled = job_va.get("enabled_axes")
        custom_label = str(job_va.get("custom_axis_label") or "Custom Variation")
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

    # If the user switched to 'json' or 'caption' mode and any completed images lack metadata,
    # automatically synthesize Pinterest captions & descriptions for them before syncing disk files!
    if updated.get("metadata_export_mode") in ("json", "caption"):
        needs_refresh = False
        for gen in updated.get("generations") or []:
            if gen.get("image_file") or gen.get("image_path"):
                if not gen.get("title") or not gen.get("description") or not gen.get("caption"):
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
                            hashtags=meta.get("hashtags") or "",
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
    sync_generation_and_manifest(job["id"], gen_id)
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


@app.get("/api/generations/{gen_id}/sidecar")
def api_get_generation_sidecar(gen_id: int):
    gen = db.get_generation(gen_id)
    if not gen:
        raise HTTPException(status_code=404, detail="Generation not found.")
    job = db.get_job(gen["job_id"])
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    sidecar_path = write_sidecar_json(job, gen)
    if not sidecar_path.exists():
        raise HTTPException(status_code=404, detail="Sidecar JSON not found.")
    return FileResponse(
        str(sidecar_path),
        media_type="application/json",
        filename=sidecar_path.name,
    )


@app.get("/api/generations/{gen_id}/caption-file")
def api_get_generation_caption_file(gen_id: int):
    gen = db.get_generation(gen_id)
    if not gen:
        raise HTTPException(status_code=404, detail="Generation not found.")
    job = db.get_job(gen["job_id"])
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    if (job.get("metadata_export_mode") or "json") == "caption":
        cap_path = write_caption_txt(job, gen)
        return FileResponse(
            str(cap_path),
            media_type="text/plain; charset=utf-8",
            filename=cap_path.name,
        )
    text_body = format_caption_text(job, gen)
    filename = gen.get("caption_file") or f"{int(gen['index_num']):03d}_{job['slug']}.txt"
    return PlainTextResponse(
        content=text_body,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/jobs/{job_id}/manifest")
def api_get_job_manifest(job_id: int):
    job = db.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    manifest_path = Path(job["export_dir"]) / "manifest.json"
    if not manifest_path.exists():
        # Temporarily write manifest if requested explicitly
        sync_job_manifest(job_id, job={**job, "metadata_export_mode": "json"})
    if not manifest_path.exists():
        raise HTTPException(status_code=404, detail="Manifest not found.")
    return FileResponse(
        str(manifest_path),
        media_type="application/json",
        filename="manifest.json",
    )


@app.get("/api/jobs/{job_id}/captions-bundle")
def api_get_job_captions_bundle(job_id: int):
    job = db.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    blocks = [
        f"============================================================",
        f"PINTEREST & SOCIAL CAPTIONS · {job['theme'].upper()}",
        f"Set #{job['id']} · Language: {job.get('metadata_language') or 'English'}",
        f"============================================================\n",
    ]
    for gen in job.get("generations") or []:
        if gen.get("image_file") or gen.get("title") or gen.get("description"):
            blocks.append(format_caption_text(job, gen))
    content = "\n".join(blocks)
    return PlainTextResponse(
        content=content,
        headers={"Content-Disposition": f'attachment; filename="captions_{job["slug"]}.txt"'},
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
