from pathlib import Path
import threading
import time
from typing import Any, Dict, List, Optional
from PIL import Image

from database.db_manager import db, now_iso
from modules.app_logging import logger
from modules.export_manager import (
    save_generated_image_atomically,
    sync_generation_and_manifest,
    sync_job_manifest,
)
from modules.image_providers import (
    ProviderAuthError,
    ReferenceTooSimilarError,
    generate_image_for_turn,
)
from modules.metadata_writer import write_generation_metadata
from modules.prompt_planner import (
    compose_prompt_from_axes,
    mutate_generation_variation,
    plan_job_variations,
)
from modules.reference_sources.image_utils import dhash_distance


class JobRunner:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._wake_event = threading.Event()
        self._active_job_id: Optional[int] = None
        self._active_generation_id: Optional[int] = None
        self._paused_jobs: set[int] = set()
        self._cancelled_jobs: set[int] = set()
        self._skipped_generations: set[int] = set()
        self._deferred_generations: set[int] = set()
        self._drop_ref_generations: set[int] = set()
        self._sim_failures: Dict[int, int] = {}
        self._cdp_turns_since_recycle: int = 0
        self._recycle_next_cdp: bool = False
        self._stop_worker = False
        self._worker_thread: Optional[threading.Thread] = None

    def start_worker(self) -> None:
        with self._lock:
            if self._worker_thread and self._worker_thread.is_alive():
                return
            self._stop_worker = False
            self._worker_thread = threading.Thread(
                target=self._worker_loop,
                name="StudioJobRunner",
                daemon=True,
            )
            self._worker_thread.start()

    def recover_interrupted_jobs(self) -> None:
        """
        Recovers jobs & generations that were mid-flight when the server last exited,
        preserving all completed images and metadata on disk.
        """
        jobs = db.list_jobs(limit=100)
        for job in jobs:
            job_id = job["id"]
            changed = False
            for gen in job.get("generations") or []:
                if gen["status"] == "generating":
                    has_file = bool(
                        gen.get("image_path") and Path(gen["image_path"]).exists()
                    )
                    new_status = "metadata_pending" if has_file else "planned"
                    db.update_generation(
                        gen["id"],
                        status=new_status,
                        error="Interrupted by server restart.",
                    )
                    changed = True
            if job["status"] == "running":
                db.update_job(
                    job_id,
                    status="paused",
                    current_step="Recovered after application restart — click Resume to continue.",
                )
                changed = True
            if changed:
                sync_job_manifest(job_id)

    def enqueue_job(self, job_id: int) -> Optional[Dict[str, Any]]:
        job = db.get_job(job_id)
        if not job:
            return None
        with self._lock:
            self._paused_jobs.discard(job_id)
            self._cancelled_jobs.discard(job_id)

        # Ensure there are planned turns ready to run
        gens = job.get("generations") or []
        planned = [g for g in gens if g["status"] == "planned"]
        if not planned and job.get("run_mode") == "continuous":
            self._append_continuous_wave(job)

        db.update_job(
            job_id,
            status="running",
            error="",
            current_step="Queued for sequential execution...",
        )
        sync_job_manifest(job_id)
        self._wake_event.set()
        return db.get_job(job_id)

    def pause_job(self, job_id: int) -> Optional[Dict[str, Any]]:
        with self._lock:
            self._paused_jobs.add(job_id)
        db.update_job(
            job_id,
            status="paused",
            current_step="Paused by operator. Completed images are safely saved.",
        )
        db.log_activity(f"Job #{job_id} paused by operator.", stage="RUNNER", job_id=job_id)
        sync_job_manifest(job_id)
        return db.get_job(job_id)

    def resume_job(self, job_id: int) -> Optional[Dict[str, Any]]:
        return self.enqueue_job(job_id)

    def cancel_job(self, job_id: int) -> Optional[Dict[str, Any]]:
        with self._lock:
            self._cancelled_jobs.add(job_id)
            self._paused_jobs.discard(job_id)
        job = db.get_job(job_id)
        if not job:
            return None
        for gen in job.get("generations") or []:
            if gen["status"] in ("planned", "generating"):
                # Only mark cancelled if it doesn't already have a saved image
                has_img = bool(gen.get("image_path") and Path(gen["image_path"]).exists())
                if not has_img:
                    db.update_generation(
                        gen["id"],
                        status="cancelled",
                        error="Cancelled by operator.",
                    )
        db.update_job(
            job_id,
            status="cancelled",
            current_step="Cancelled remaining planned turns. Completed images are preserved.",
        )
        db.log_activity(
            f"Job #{job_id} cancelled remaining turns.",
            stage="RUNNER",
            job_id=job_id,
        )
        sync_job_manifest(job_id)
        return db.get_job(job_id)

    def retry_failed_turns(self, job_id: int) -> Optional[Dict[str, Any]]:
        job = db.get_job(job_id)
        if not job:
            return None
        retried = 0
        for gen in job.get("generations") or []:
            if gen["status"] in ("failed", "cancelled"):
                with self._lock:
                    self._skipped_generations.discard(gen["id"])
                    self._deferred_generations.discard(gen["id"])
                    self._drop_ref_generations.discard(gen["id"])
                    self._sim_failures.pop(gen["id"], None)
                db.update_generation(gen["id"], status="planned", error="")
                retried += 1
        if retried > 0:
            db.log_activity(
                f"Queued {retried} failed/cancelled turn(s) for retry.",
                stage="RUNNER",
                job_id=job_id,
            )
            return self.enqueue_job(job_id)
        return db.get_job(job_id)

    def retry_single_generation(
        self,
        generation_id: int,
        mutate_axes: bool = False,
    ) -> Optional[Dict[str, Any]]:
        gen = db.get_generation(generation_id)
        if not gen:
            return None
        job_id = gen["job_id"]
        job = db.get_job(job_id)
        if not job:
            return None

        updates: Dict[str, Any] = {"status": "planned", "error": ""}
        if mutate_axes:
            other_prompts = [
                g["prompt_final"]
                for g in (job.get("generations") or [])
                if g["id"] != generation_id
            ]
            mutated = mutate_generation_variation(job, gen, other_prompts)
            updates.update(mutated)

        # Notice: we DO NOT delete or overwrite the existing image_file on disk here!
        # It is only replaced atomically once a new image is actually generated.
        with self._lock:
            self._skipped_generations.discard(generation_id)
            self._deferred_generations.discard(generation_id)
            self._drop_ref_generations.discard(generation_id)
            self._sim_failures.pop(generation_id, None)
        db.update_generation(generation_id, **updates)
        self.enqueue_job(job_id)
        return db.get_generation(generation_id)

    def skip_single_generation(self, generation_id: int) -> Optional[Dict[str, Any]]:
        """
        Immediately defers a `planned` or currently `generating` turn to the end of the set
        and kills any hung worker immediately so the pipeline advances to the next shot.
        (Only `delete` permanently removes a shot.)
        """
        gen = db.get_generation(generation_id)
        if not gen:
            return None
        job_id = int(gen["job_id"])
        idx = int(gen["index_num"])
        with self._lock:
            self._skipped_generations.add(generation_id)
            self._deferred_generations.add(generation_id)

        has_img = bool(gen.get("image_path") and Path(gen["image_path"]).exists())
        new_status = "completed" if has_img else "failed"
        updated = db.update_generation(
            generation_id,
            status=new_status,
            error="" if has_img else "Deferred by operator — will retry at end of set.",
        )
        db.log_activity(
            f"Deferred shot #{idx:03d} — jumping to next shot now; will retry at end of set.",
            level="WARN",
            stage="RUNNER",
            job_id=job_id,
            generation_id=generation_id,
        )
        sync_job_manifest(job_id, rewrite_all_sidecars=False)
        self._wake_event.set()
        return updated

    def notify_generation_deleted(self, generation_id: int) -> None:
        with self._lock:
            self._skipped_generations.add(generation_id)

    def retry_generation_metadata(
        self,
        generation_id: int,
        use_browser_turn: bool = False,
    ) -> Optional[Dict[str, Any]]:
        gen = db.get_generation(generation_id)
        if not gen:
            return None
        job = db.get_job(gen["job_id"])
        if not job:
            return None
        try:
            meta = write_generation_metadata(
                job=job,
                generation=gen,
                use_browser_turn=use_browser_turn,
                log_fn=lambda m: db.log_activity(
                    m, stage="METADATA", job_id=job["id"], generation_id=generation_id
                ),
            )
            updated = db.update_generation(
                generation_id,
                title=meta["title"],
                caption=meta.get("caption") or meta["title"],
                description=meta["description"],
                hashtags=meta.get("hashtags") or "",
                status="completed",
                error="",
                completed_at=gen.get("completed_at") or now_iso(),
            )
            sync_generation_and_manifest(job["id"], generation_id)
            return updated
        except Exception as exc:
            db.update_generation(
                generation_id,
                status="metadata_pending",
                error=f"Metadata error: {exc}",
            )
            sync_generation_and_manifest(job["id"], generation_id)
            return db.get_generation(generation_id)

    def regenerate_all_job_metadata(
        self,
        job_id: int,
        use_browser_turn: bool = False,
    ) -> Optional[Dict[str, Any]]:
        job = db.get_job(job_id)
        if not job:
            return None
        for gen in job.get("generations") or []:
            if gen.get("image_file") or gen.get("image_path"):
                try:
                    meta = write_generation_metadata(
                        job=job,
                        generation=gen,
                        use_browser_turn=use_browser_turn,
                        log_fn=lambda m: db.log_activity(
                            m, stage="METADATA", job_id=job_id, generation_id=gen["id"]
                        ),
                    )
                    db.update_generation(
                        gen["id"],
                        title=meta["title"],
                        caption=meta.get("caption") or meta["title"],
                        description=meta["description"],
                        hashtags=meta.get("hashtags") or "",
                        status="completed",
                        error="",
                        completed_at=gen.get("completed_at") or now_iso(),
                    )
                except Exception as exc:
                    logger.debug("Batch metadata note for #%s: %s", gen["id"], exc)
        sync_job_manifest(job_id)
        return db.get_job(job_id)

    def _should_abort_job(self, job_id: int) -> bool:
        with self._lock:
            return job_id in self._paused_jobs or job_id in self._cancelled_jobs

    def _should_abort_turn(self, job_id: int, gen_id: int) -> bool:
        with self._lock:
            return (
                job_id in self._paused_jobs
                or job_id in self._cancelled_jobs
                or gen_id in self._skipped_generations
            )

    def _is_turn_skipped(self, gen_id: int) -> bool:
        with self._lock:
            return gen_id in self._skipped_generations

    def _resolve_interrupted_turn(self, job_id: int, gen: Dict[str, Any]) -> Optional[bool]:
        """
        Handles skipped, deleted, paused, or cancelled turns consistently after
        generation finishes or raises so no orphan file is saved and loops terminate cleanly.
        """
        gen_id = int(gen["id"])
        still_exists = db.get_generation(gen_id)

        if self._is_turn_skipped(gen_id) or not still_exists:
            with self._lock:
                self._skipped_generations.discard(gen_id)
                is_deferred = gen_id in self._deferred_generations
                self._deferred_generations.discard(gen_id)
            if still_exists:
                has_prev = bool(
                    still_exists.get("image_path") and Path(still_exists["image_path"]).exists()
                )
                db.update_generation(
                    gen_id,
                    status="completed" if has_prev else ("failed" if is_deferred else "cancelled"),
                    error=""
                    if has_prev
                    else (
                        "Deferred by operator — will retry at end of set."
                        if is_deferred
                        else "Skipped by operator — moved to next shot."
                    ),
                )
            sync_job_manifest(job_id, rewrite_all_sidecars=False)
            return True

        if self._should_abort_job(job_id):
            with self._lock:
                is_cancelled = job_id in self._cancelled_jobs
            has_prev_file = bool(
                still_exists.get("image_path") and Path(still_exists["image_path"]).exists()
            )
            fallback_status = (
                "completed"
                if has_prev_file
                else ("cancelled" if is_cancelled else "planned")
            )
            db.update_generation(gen_id, status=fallback_status, error="")
            sync_job_manifest(job_id, rewrite_all_sidecars=False)
            return False

        return None

    def _append_continuous_wave(self, job: Dict[str, Any]) -> int:
        job_id = job["id"]
        gens = job.get("generations") or []
        active_or_done = [g for g in gens if g["status"] != "cancelled"]
        session_cap = int(job.get("session_cap") or 20)
        remaining_cap = session_cap - len(active_or_done)
        if remaining_cap <= 0:
            return 0

        batch_size = min(int(job.get("batch_size") or 4), remaining_cap)
        next_index = (max((int(g["index_num"]) for g in gens), default=0)) + 1
        existing_prompts = [g["prompt_final"] for g in gens]

        new_turns = plan_job_variations(
            theme=job["theme"],
            count=batch_size,
            start_index=next_index,
            base_prompt=job.get("base_prompt") or "",
            aspect_ratio=job.get("aspect_ratio") or "1:1",
            model=job.get("model") or "chrome-cdp/gemini",
            reference_mode=job.get("reference_mode") or "prompt_only",
            reference_ids=job.get("reference_ids") or [],
            cycle_references=bool(job.get("cycle_references", True)),
            preset_id=job.get("preset_id") or "",
            fixed_elements=job.get("fixed_elements"),
            variation_axes=job.get("variation_axes"),
            existing_prompts=existing_prompts,
        )
        db.create_generations_bulk(job_id, new_turns)
        db.log_activity(
            f"Continuous mode: planned next wave of {len(new_turns)} variation(s) "
            f"(#{next_index:03d}–#{next_index + len(new_turns) - 1:03d}, cap {session_cap}).",
            stage="PLANNER",
            job_id=job_id,
        )
        sync_job_manifest(job_id, rewrite_all_sidecars=False)
        return len(new_turns)

    def _check_duplicate_against_completed(
        self,
        job_id: int,
        current_gen_id: int,
        md5: str,
        dhash: str,
        threshold: int = 6,
    ) -> str:
        gens = db.list_job_generation_fingerprints(job_id)
        for other in gens:
            if other["id"] == current_gen_id:
                continue
            if other["status"] not in ("completed", "metadata_pending"):
                continue
            other_idx = int(other["index_num"])
            if md5 and other.get("md5") == md5:
                return f"Exact byte match with #{other_idx:03d}"
            if dhash and other.get("dhash"):
                dist = dhash_distance(dhash, other["dhash"])
                if dist <= threshold:
                    return f"Near-duplicate of #{other_idx:03d} (dHash distance {dist})"
        return ""

    def _is_retryable_turn_error(self, exc: Exception) -> bool:
        if isinstance(exc, (ProviderAuthError, ValueError)):
            return False
        low = str(exc).lower()
        if any(tok in low for tok in ("aborted", "skipped", "not configured")):
            return False
        return True

    def _audit_and_queue_recovery(self, job_id: int) -> int:
        """
        Post-run verification & recovery pass:
        1. Re-queues any completed/metadata_pending turn whose image file is missing or unreadable.
        2. Re-queues transient failed turns (not auth/aborted/skipped) for one recovery pass.
        3. Heals remaining metadata_pending turns when their image file on disk is healthy.
        Returns the number of turns moved back to `planned`.
        """
        job = db.get_job(job_id)
        if not job or self._should_abort_job(job_id):
            return 0

        export_mode = (job.get("metadata_export_mode") or "json").strip().lower()
        requeued = 0

        for gen in job.get("generations") or []:
            if self._should_abort_job(job_id):
                break
            gid = int(gen["id"])
            idx = int(gen["index_num"])
            status = gen.get("status")
            err_lower = str(gen.get("error") or "").lower()

            if status in ("completed", "metadata_pending"):
                img_path_str = gen.get("image_path") or ""
                file_ok = False
                if img_path_str and Path(img_path_str).exists() and Path(img_path_str).stat().st_size >= 4096:
                    try:
                        with Image.open(img_path_str) as im:
                            im.verify()
                        file_ok = True
                    except Exception:
                        file_ok = False

                if not file_ok:
                    db.update_generation(
                        gid,
                        status="planned",
                        image_file="",
                        image_path="",
                        error="Post-run check detected missing/corrupt image file — queued for regeneration.",
                    )
                    db.log_activity(
                        f"Post-run check: #{idx:03d} output file missing/corrupt — re-queued automatically.",
                        level="WARN",
                        stage="AUDIT",
                        job_id=job_id,
                        generation_id=gid,
                    )
                    requeued += 1
                    continue

                if status == "metadata_pending" and export_mode != "none":
                    try:
                        self.retry_generation_metadata(gid, use_browser_turn=False)
                    except Exception:
                        pass

            elif status == "failed":
                permanent = any(
                    tok in err_lower
                    for tok in ("auth", "sign in", "log in", "not configured", "aborted", "skipped")
                )
                if not permanent:
                    db.update_generation(
                        gid,
                        status="planned",
                        error="Queued for automatic post-run recovery pass.",
                    )
                    db.log_activity(
                        f"Post-run check: #{idx:03d} previously failed — queued for 1 recovery pass.",
                        level="INFO",
                        stage="AUDIT",
                        job_id=job_id,
                        generation_id=gid,
                    )
                    requeued += 1

        if requeued > 0:
            sync_job_manifest(job_id, rewrite_all_sidecars=False)
        return requeued

    def _execute_single_generation(self, job: Dict[str, Any], gen: Dict[str, Any]) -> bool:
        """
        Executes 1 generation turn (`planned` -> `generating` -> `metadata_pending` -> `completed`).
        Includes automatic retry with New Chat isolation and Reference Similarity escalation.
        Returns True if the job should continue to the next turn, or False if paused/cancelled/auth-blocked.
        """
        job_id = job["id"]
        gen_id = gen["id"]
        idx = int(gen["index_num"])

        if self._should_abort_job(job_id):
            return False

        # Pre-flight duplicate prompt check against earlier turns in the same job (lightweight SQL)
        all_fp = db.list_job_generation_fingerprints(job_id)
        prior_same_prompt = [
            g
            for g in all_fp
            if g["id"] != gen_id
            and g["index_num"] < idx
            and (g.get("prompt_final") or "").strip().lower()
            == (gen.get("prompt_final") or "").strip().lower()
            and g.get("reference_id") == gen.get("reference_id")
        ]
        if prior_same_prompt and not gen.get("is_locked"):
            mutated = mutate_generation_variation(
                job,
                gen,
                [g["prompt_final"] for g in all_fp if g["id"] != gen_id],
            )
            gen = db.update_generation(gen_id, **mutated) or gen
            db.log_activity(
                f"Auto-shifted variation axes on turn #{idx:03d} to prevent duplicate prompt.",
                stage="DIVERSITY",
                job_id=job_id,
                generation_id=gen_id,
            )

        db.update_generation(gen_id, status="generating", error="")
        db.update_job(
            job_id,
            status="running",
            current_step=f"Generating image #{idx:03d} of {job['counts']['total']}...",
        )

        ref_obj = gen.get("reference")
        ref_path = (
            ref_obj.get("file_path")
            if ref_obj and ref_obj.get("exists_on_disk")
            else None
        )
        model_id = gen.get("model") or job.get("model") or "chrome-cdp/gemini"

        settings = db.get_settings(include_secrets=True)
        fresh_chat = bool(settings.get("fresh_chat_per_turn", True))
        raw_retries = settings.get("max_turn_retries")
        max_retries = max(0, min(4, int(raw_retries if raw_retries is not None else 2)))
        check_ref_sim = bool(settings.get("reference_similarity_check", True))
        drop_ref_on_retry = bool(settings.get("drop_ref_on_similarity_retry", True))

        def _log(msg: str) -> None:
            db.log_activity(msg, stage="GENERATE", job_id=job_id, generation_id=gen_id)
            db.update_job(job_id, current_step=f"[#{idx:03d}] {msg}")

        with self._lock:
            drop_ref_now = gen_id in self._drop_ref_generations
            recycle_interval = max(5, int(settings.get("cdp_recycle_tab_interval") or 20))
            should_recycle_tab = self._recycle_next_cdp or (self._cdp_turns_since_recycle >= recycle_interval)

        active_prompt = gen["prompt_final"]
        active_ref_path = None if drop_ref_now else ref_path
        if drop_ref_now and ref_path:
            active_prompt = compose_prompt_from_axes(
                theme=job["theme"],
                base_prompt=job.get("base_prompt") or "",
                aspect_ratio=job.get("aspect_ratio") or "1:1",
                fixed_elements=gen.get("fixed_elements") or (job.get("fixed_elements") or {}),
                turn_axes=gen.get("variation_axes") or {},
                has_reference=False,
                reference_reused=False,
                variation_number=idx,
                strong_variation=True,
                enabled_axes=(job.get("variation_axes") or {}).get("enabled_axes"),
                custom_axis_label=str((job.get("variation_axes") or {}).get("custom_axis_label") or "Custom Variation"),
            )
            gen = db.update_generation(gen_id, prompt_final=active_prompt) or gen
            _log("Retrying with style-DNA prompt only (dropped sticky input reference).")

        export_mode_pref = (job.get("metadata_export_mode") or "json").strip().lower()
        use_browser_turn_pref = bool(job.get("use_ai_caption_prompt", True))
        gemini_key = str(settings.get("gemini_api_key") or "").strip()
        metadata_req: Optional[Dict[str, Any]] = None
        if (
            model_id.startswith("chrome-cdp/")
            and export_mode_pref != "none"
            and use_browser_turn_pref
            and not gemini_key
        ):
            metadata_req = {
                "theme": job["theme"],
                "prompt_final": active_prompt,
                "metadata_language": job.get("metadata_language") or "English",
                "index_num": idx,
                "caption_prompt": job.get("caption_prompt") or "",
                "timeout_sec": 18.0,
            }

        img_result: Optional[Dict[str, Any]] = None
        try:
            img_result = generate_image_for_turn(
                model_id=model_id,
                prompt_final=active_prompt,
                aspect_ratio=job.get("aspect_ratio") or "1:1",
                reference_path=active_ref_path,
                log_fn=_log,
                should_abort=lambda: self._should_abort_turn(job_id, gen_id),
                new_chat=fresh_chat,
                check_ref_similarity=check_ref_sim,
                recycle_tab=should_recycle_tab,
                metadata_request=metadata_req,
            )
            with self._lock:
                self._cdp_turns_since_recycle = 1 if should_recycle_tab else (self._cdp_turns_since_recycle + 1)
                self._recycle_next_cdp = False
        except ProviderAuthError as auth_err:
            with self._lock:
                self._recycle_next_cdp = True
            db.update_generation(gen_id, status="planned", error=str(auth_err))
            with self._lock:
                self._paused_jobs.add(job_id)
            db.update_job(
                job_id,
                status="paused",
                error=str(auth_err),
                current_step=f"Paused at #{idx:03d}: {auth_err}",
            )
            db.log_activity(str(auth_err), level="WARN", stage="AUTH", job_id=job_id, generation_id=gen_id)
            sync_job_manifest(job_id, rewrite_all_sidecars=False)
            return False
        except ReferenceTooSimilarError as sim_err:
            interrupted = self._resolve_interrupted_turn(job_id, gen)
            if interrupted is not None:
                return interrupted

            with self._lock:
                sim_count = self._sim_failures.get(gen_id, 0) + 1
                self._sim_failures[gen_id] = sim_count
                if drop_ref_on_retry and sim_count >= max(1, max_retries):
                    self._drop_ref_generations.add(gen_id)

            all_fp = db.list_job_generation_fingerprints(job_id)
            mutated = mutate_generation_variation(
                job,
                gen,
                [g["prompt_final"] for g in all_fp if g["id"] != gen_id],
            )
            err_msg = f"Deferred (too similar to input: {sim_err}) — rotated axes for end-of-set retry."
            db.update_generation(gen_id, status="failed", error=err_msg, **mutated)
            db.log_activity(
                f"Turn #{idx:03d} quá giống ảnh input ({sim_err}) — tạm hoãn, chuyển ngay sang ảnh tiếp theo (sẽ chạy lại cuối set).",
                level="WARN",
                stage="DIVERSITY",
                job_id=job_id,
                generation_id=gen_id,
            )
            sync_job_manifest(job_id, rewrite_all_sidecars=False)
            return True
        except Exception as exc:
            with self._lock:
                self._recycle_next_cdp = True
            interrupted = self._resolve_interrupted_turn(job_id, gen)
            if interrupted is not None:
                return interrupted

            err_msg = str(exc)
            retryable = self._is_retryable_turn_error(exc)
            note = (
                f"Deferred ({err_msg}) — will retry at end of set."
                if retryable
                else err_msg
            )
            db.update_generation(gen_id, status="failed", error=note)
            db.log_activity(
                f"Turn #{idx:03d} tạm dừng/lỗi ({err_msg}) — nhảy thẳng qua ảnh tiếp theo"
                + (" (sẽ chạy lại cuối set)." if retryable else "."),
                level="ERROR" if not retryable else "WARN",
                stage="GENERATE",
                job_id=job_id,
                generation_id=gen_id,
            )
            sync_job_manifest(job_id, rewrite_all_sidecars=False)
            return True

        interrupted = self._resolve_interrupted_turn(job_id, gen)
        if interrupted is not None:
            return interrupted

        with self._lock:
            self._drop_ref_generations.discard(gen_id)
            self._deferred_generations.discard(gen_id)
            self._sim_failures.pop(gen_id, None)

        # Save image atomically right away so metadata failure can NEVER lose the image
        settings = db.get_settings(include_secrets=True)
        preferred_fmt = str(settings.get("export_image_format") or "original")
        dhash_thresh = int(settings.get("dhash_warning_threshold") or 6)

        saved_file = save_generated_image_atomically(
            job=job,
            index_num=idx,
            raw_bytes=img_result["raw_bytes"],
            preferred_format=preferred_fmt,
            precomputed_info=img_result,
        )
        dup_warn = self._check_duplicate_against_completed(
            job_id=job_id,
            current_gen_id=gen_id,
            md5=saved_file["md5"],
            dhash=saved_file["dhash"],
            threshold=dhash_thresh,
        )

        # Refresh job state in case export_mode or caption_prompt was changed mid-run
        job = db.get_job(job_id) or job
        export_mode = (job.get("metadata_export_mode") or "json").strip().lower()

        if export_mode == "none":
            gen = db.update_generation(
                gen_id,
                status="completed",
                image_file=saved_file["image_file"],
                image_path=saved_file["image_path"],
                sidecar_file=saved_file["sidecar_file"],
                caption_file=saved_file["caption_file"],
                mime_type=saved_file["mime_type"],
                width=saved_file["width"],
                height=saved_file["height"],
                file_size=saved_file["file_size"],
                md5=saved_file["md5"],
                dhash=saved_file["dhash"],
                duplicate_warning=dup_warn,
                error="",
                completed_at=now_iso(),
            ) or gen
            sync_generation_and_manifest(job_id, gen_id)
            db.log_activity(
                f"Completed #{idx:03d} -> {saved_file['image_file']} ({saved_file['width']}x{saved_file['height']}, image-only mode)",
                stage="EXPORT",
                job_id=job_id,
                generation_id=gen_id,
            )
            return True

        gen = db.update_generation(
            gen_id,
            status="metadata_pending",
            image_file=saved_file["image_file"],
            image_path=saved_file["image_path"],
            sidecar_file=saved_file["sidecar_file"],
            caption_file=saved_file["caption_file"],
            mime_type=saved_file["mime_type"],
            width=saved_file["width"],
            height=saved_file["height"],
            file_size=saved_file["file_size"],
            md5=saved_file["md5"],
            dhash=saved_file["dhash"],
            duplicate_warning=dup_warn,
            error="",
        ) or gen
        sync_generation_and_manifest(job_id, gen_id)

        # Write Title, Caption, Description & Hashtags metadata (reuses inline CDP result; no double browser spin if inline ran)
        inline_meta = img_result.get("inline_meta") if isinstance(img_result, dict) else None
        attempted_inline = metadata_req is not None
        use_browser_turn = bool(job.get("use_ai_caption_prompt", True)) and not attempted_inline
        db.update_job(
            job_id,
            current_step=f"Generating Pin Caption & Description for #{idx:03d} ({saved_file['image_file']})...",
        )
        try:
            meta = write_generation_metadata(
                job=job,
                generation=gen,
                use_browser_turn=use_browser_turn,
                log_fn=_log,
                should_abort=lambda: self._should_abort_turn(job_id, gen_id),
                inline_meta=inline_meta,
            )
            db.update_generation(
                gen_id,
                title=meta["title"],
                caption=meta.get("caption") or meta["title"],
                description=meta["description"],
                hashtags=meta.get("hashtags") or "",
                status="completed",
                error="",
                completed_at=now_iso(),
            )
            sync_generation_and_manifest(job_id, gen_id)
            db.log_activity(
                f"Completed #{idx:03d} -> {saved_file['image_file']} + {export_mode.upper()} metadata ({saved_file['width']}x{saved_file['height']})",
                stage="EXPORT",
                job_id=job_id,
                generation_id=gen_id,
            )
        except Exception as meta_exc:
            db.update_generation(
                gen_id,
                status="metadata_pending",
                error=f"Metadata pending: {meta_exc}",
            )
            sync_generation_and_manifest(job_id, gen_id)
            db.log_activity(
                f"Image #{idx:03d} saved, but metadata needs retry: {meta_exc}",
                level="WARN",
                stage="METADATA",
                job_id=job_id,
                generation_id=gen_id,
            )

        return True

    def _run_job(self, job_id: int) -> None:
        settings = db.get_settings(include_secrets=False)
        raw_rounds = settings.get("max_turn_retries")
        max_recovery_rounds = max(0, min(4, int(raw_rounds if raw_rounds is not None else 2)))
        recovery_rounds = 0

        while True:
            if self._should_abort_job(job_id):
                break

            job = db.get_job(job_id)
            if not job or job["status"] in ("paused", "cancelled"):
                break

            next_gen = db.claim_next_planned_generation(job_id)
            if not next_gen:
                gens = job.get("generations") or []
                any_generating = any(g["status"] == "generating" for g in gens)
                if any_generating:
                    time.sleep(2.0)
                    continue
                # Check if continuous mode should schedule another wave
                if job.get("run_mode") == "continuous" and not self._should_abort_job(job_id):
                    added = self._append_continuous_wave(job)
                    if added > 0:
                        continue
                # Post-run check & end-of-set recovery pass for deferred/failed turns or missing/corrupt files
                if recovery_rounds < max_recovery_rounds and not self._should_abort_job(job_id):
                    recovery_rounds += 1
                    requeued = self._audit_and_queue_recovery(job_id)
                    if requeued > 0:
                        msg = (
                            f"End-of-set recovery pass #{recovery_rounds}/{max_recovery_rounds}: "
                            f"retrying {requeued} deferred/failed shot(s)..."
                        )
                        db.update_job(job_id, current_step=msg)
                        db.log_activity(msg, stage="AUDIT", job_id=job_id)
                        continue
                break

            with self._lock:
                self._active_job_id = job_id
                self._active_generation_id = next_gen["id"]

            should_continue = self._execute_single_generation(job, next_gen)
            with self._lock:
                self._active_generation_id = None

            if not should_continue:
                break

        # Finalize job status if not paused or cancelled
        final_job = db.get_job(job_id)
        if not final_job:
            return
        if final_job["status"] in ("paused", "cancelled"):
            sync_job_manifest(job_id)
            return

        counts = final_job["counts"]
        folder_name = Path(final_job["export_dir"]).name if final_job.get("export_dir") else "exports"
        if counts["total"] == 0:
            db.update_job(
                job_id,
                status="completed",
                current_step="Run finished with no remaining shots in plan.",
                completed_at=now_iso(),
            )
        elif counts["completed"] > 0 and counts["failed"] == 0 and counts["metadata_pending"] == 0:
            db.update_job(
                job_id,
                status="completed",
                current_step=f"Completed {counts['completed']} image(s) in {folder_name}.",
                completed_at=now_iso(),
            )
        elif counts["completed"] > 0 or counts["metadata_pending"] > 0:
            notes: List[str] = []
            if counts["completed"] > 0:
                notes.append(f"{counts['completed']} completed")
            if counts["metadata_pending"] > 0:
                notes.append(f"{counts['metadata_pending']} metadata pending")
            if counts["failed"] > 0:
                notes.append(f"{counts['failed']} failed")
            db.update_job(
                job_id,
                status="completed_with_errors",
                current_step=f"Finished ({', '.join(notes)}); pending/failed items can be retried individually.",
                completed_at=now_iso(),
            )
        elif counts["failed"] > 0:
            db.update_job(
                job_id,
                status="failed",
                current_step=f"All {counts['failed']} turn(s) failed. Check provider status and retry.",
            )
        elif counts["cancelled"] > 0:
            db.update_job(
                job_id,
                status="cancelled",
                current_step=f"All {counts['cancelled']} turn(s) were skipped/cancelled.",
            )
        else:
            db.update_job(
                job_id,
                status="completed",
                current_step=f"Finished set in {folder_name}.",
                completed_at=now_iso(),
            )
        sync_job_manifest(job_id)

    def _worker_loop(self) -> None:
        while not self._stop_worker:
            try:
                next_job_id = db.get_next_running_job_id()
                if next_job_id and not self._should_abort_job(next_job_id):
                    self._run_job(next_job_id)
                    with self._lock:
                        self._active_job_id = None
                    continue
            except Exception as exc:
                logger.exception("JobRunner worker loop error: %s", exc)

            self._wake_event.wait(timeout=1.5)
            self._wake_event.clear()


runner = JobRunner()
