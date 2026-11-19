#!/usr/bin/env python3
"""
Modular Audit & Test Runner for Theme Image Set Studio.
Usage:
    ./.venv/bin/python scripts/run_module_audit.py --module all
    ./.venv/bin/python scripts/run_module_audit.py --module 1  # Reference Sources (Upload + Edit + Delete + Pinterest)
    ./.venv/bin/python scripts/run_module_audit.py --module 2  # Prompt Planner & Diversity Rules
    ./.venv/bin/python scripts/run_module_audit.py --module 3  # Image Providers & Pinterest Caption Writer
    ./.venv/bin/python scripts/run_module_audit.py --module 4  # Atomic Export Manager, JSON / Caption TXT / None Switch, Delete & Resequence
"""
import argparse
from io import BytesIO
import json
from pathlib import Path
import shutil
import sys
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from database.db_manager import db
from modules.export_manager import (
    build_job_zip_bytes,
    cleanup_and_resequence_after_delete_generation,
    save_generated_image_atomically,
    sync_generation_and_manifest,
    sync_job_manifest,
)
from modules.image_providers import check_cdp_status, list_available_providers
from modules.image_providers.browser_cdp_provider import (
    _build_full_res_googleusercontent_urls,
    normalize_gemini_asset_url,
)
from modules.metadata_writer import (
    build_metadata_prompt,
    parse_metadata_json,
    write_generation_metadata,
)
from modules.prompt_planner import plan_job_variations
from modules.reference_sources import (
    detect_pinterest_input_kind,
    save_uploaded_reference,
)
from modules.watermark_remover import remove_gemini_watermark_bytes


def _make_sample_image_bytes(color_a: tuple[int, int, int], color_b: tuple[int, int, int]) -> bytes:
    im = Image.new("RGB", (800, 1000), color_a)
    draw = ImageDraw.Draw(im)
    for y in range(0, 1000, 40):
        draw.rectangle([60, y, 740, y + 20], fill=color_b)
    buf = BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


def test_module_1() -> None:
    print("\n=== MODULE 1: REFERENCE SOURCES (UPLOAD, EDIT, DELETE & PINTEREST PARSER) ===")
    raw = _make_sample_image_bytes((220, 210, 195), (70, 65, 60))
    ref = save_uploaded_reference(raw, "ceramic_vase_sample.png", title="Sample Ceramic Vase")
    assert ref["id"] > 0 and ref["exists_on_disk"]
    assert ref["width"] == 800 and ref["height"] == 1000

    renamed = db.update_reference(ref["id"], title="Renamed Ceramic Vase")
    assert renamed and renamed["title"] == "Renamed Ceramic Vase"
    print(f"[PASS] Saved & edited local reference #{ref['id']}: {ref['filename']} (dHash={ref['dhash']})")

    k1 = detect_pinterest_input_kind("https://www.pinterest.com/pin/123456789012345/")
    k2 = detect_pinterest_input_kind("https://www.pinterest.com/studio/autumn-cafe/")
    k3 = detect_pinterest_input_kind("#MinimalistCeramics")
    assert k1["kind"] == "pin_url" and k2["kind"] == "board_url" and k3["kind"] == "keyword"
    print(f"[PASS] Pinterest input detector verified: {k1['kind']}, {k2['kind']}, {k3['kind']}")

    db.delete_reference(ref["id"])
    Path(ref["file_path"]).unlink(missing_ok=True)


def test_module_2() -> None:
    print("\n=== MODULE 2: PROMPT PLANNER & DIVERSITY ENFORCEMENT ===")
    turns = plan_job_variations(
        theme="Quiet Autumn Café",
        count=6,
        aspect_ratio="4:5",
        model="chrome-cdp/gemini",
        reference_mode="local_upload",
        reference_ids=[1, 2, 3],
        cycle_references=True,
        preset_id="architectural_interior",
    )
    assert len(turns) == 6
    prompts = [t["prompt_final"] for t in turns]
    assert len(set(prompts)) == 6, "All 6 planned prompts must be unique!"
    refs = [t["reference_id"] for t in turns]
    assert refs == [1, 2, 3, 1, 2, 3], f"Unexpected reference cycling: {refs}"
    print("[PASS] 6-turn plan with 3 cycled references produced 6/6 distinct prompts.")


def test_module_3() -> None:
    print("\n=== MODULE 3: IMAGE PROVIDERS & PINTEREST CAPTION PROMPT PARSER ===")
    providers = list_available_providers()
    cdp = check_cdp_status()
    print(f"[INFO] Registered providers: {[p['id'] for p in providers]} | CDP connected: {cdp['connected']}")
    assert any(p["id"] == "chrome-cdp/gemini" for p in providers)

    prompt_text = build_metadata_prompt(
        theme="Red Glossy Nails",
        prompt_final="Close-up manicure in warm sunlight",
        metadata_language="Vietnamese",
        index_num=1,
        caption_prompt="Viết caption thả thính sang chảnh để đăng Pinterest",
    )
    assert "Viết caption thả thính sang chảnh" in prompt_text

    parsed_json = parse_metadata_json(
        '```json\n{"title": "Mẫu Nail Đỏ Cherry Sang Chảnh", "caption": "Đỏ rượu quyến rũ cho mùa lễ hội", "description": "Gợi ý mẫu nail đỏ bóng cực tôn da.", "hashtags": "#rednails #naildep"}\n```',
        theme="Red Glossy Nails",
    )
    assert parsed_json and parsed_json["title"] == "Mẫu Nail Đỏ Cherry Sang Chảnh"
    assert "#rednails" in parsed_json["hashtags"]
    print("[PASS] Provider registry & Pinterest Caption/Description parser verified.")


def test_module_4() -> None:
    print("\n=== MODULE 4: EXPORT MODES (JSON / CAPTION TXT / NONE) & DELETE RESEQUENCE ===")
    job = db.create_job(
        theme="Cafe Mua Thu",
        base_prompt="Warm afternoon rain by the wooden window",
        reference_mode="prompt_only",
        run_mode="fixed",
        target_count=2,
        aspect_ratio="1:1",
        metadata_language="Vietnamese",
        metadata_export_mode="json",
        caption_prompt="Viết caption chuẩn Pinterest cho quán cafe mùa thu",
        model="chrome-cdp/gemini",
    )
    job_id = job["id"]
    try:
        for idx, color in [(1, (45, 40, 38)), (2, (80, 65, 55))]:
            gen = db.create_generation(
                job_id=job_id,
                index_num=idx,
                prompt_final=f"Warm café window in autumn rain #{idx}, 35mm editorial angle.",
                model="chrome-cdp/gemini",
                variation_axes={
                    "camera_angle": "35mm editorial angle",
                    "lighting": "Warm tungsten window glow",
                    "composition": "Rule-of-thirds table foreground",
                    "atmosphere": "Autumn rain outside glass",
                },
            )
            img_bytes = _make_sample_image_bytes(color, (210, 175, 130))
            saved = save_generated_image_atomically(job, idx, img_bytes, preferred_format="original")
            gen = db.update_generation(
                gen["id"],
                status="metadata_pending",
                **saved,
            )
            meta = write_generation_metadata(job, gen, use_browser_turn=False)
            gen = db.update_generation(
                gen["id"],
                title=meta["title"],
                caption=meta["caption"],
                description=meta["description"],
                hashtags=meta["hashtags"],
                status="completed",
            )
            sync_generation_and_manifest(job_id, gen["id"])

        exp_dir = Path(job["export_dir"])
        # 1. Verify JSON mode
        assert (exp_dir / "001_cafe-mua-thu.json").exists()
        assert (exp_dir / "002_cafe-mua-thu.json").exists()
        assert (exp_dir / "manifest.json").exists()
        print("[PASS] Export Mode 'json': verified 001/002 .json sidecars + manifest.json.")

        # 2. Switch to 'caption' mode and verify .txt files replace .json files
        job = db.update_job(job_id, metadata_export_mode="caption")
        sync_job_manifest(job_id, job=job)
        assert (exp_dir / "001_cafe-mua-thu.txt").exists()
        assert (exp_dir / "002_cafe-mua-thu.txt").exists()
        assert (exp_dir / "captions.txt").exists()
        assert not (exp_dir / "001_cafe-mua-thu.json").exists()
        print("[PASS] Export Mode 'caption': verified 001/002 .txt captions + captions.txt (cleaned .json).")

        # 3. Switch to 'none' mode and verify only images remain
        job = db.update_job(job_id, metadata_export_mode="none")
        sync_job_manifest(job_id, job=job)
        assert (exp_dir / "001_cafe-mua-thu.png").exists()
        assert not (exp_dir / "001_cafe-mua-thu.txt").exists()
        assert not (exp_dir / "captions.txt").exists()
        print("[PASS] Export Mode 'none': verified pure image-only directory.")

        # 4. Switch back to 'json' and test deleting Shot #1 -> Shot #2 re-sequences to #001 on disk
        job = db.update_job(job_id, metadata_export_mode="json")
        sync_job_manifest(job_id, job=job)
        first_gen_id = job["generations"][0]["id"]
        del_res = db.delete_generation_with_resequence(first_gen_id)
        assert del_res is not None
        cleanup_and_resequence_after_delete_generation(job_id, del_res)

        refreshed = db.get_job(job_id)
        assert len(refreshed["generations"]) == 1
        remaining = refreshed["generations"][0]
        assert remaining["index_num"] == 1
        assert remaining["image_file"] == "001_cafe-mua-thu.png"
        assert (exp_dir / "001_cafe-mua-thu.png").exists()
        assert not (exp_dir / "002_cafe-mua-thu.png").exists()
        print("[PASS] Delete & Resequence: deleted #001 and renamed #002 -> #001 on disk & SQLite.")

        zip_bytes, zip_name = build_job_zip_bytes(job_id)
        assert len(zip_bytes) > 500
        print(f"[PASS] Packaged ZIP archive: {zip_name} ({len(zip_bytes)} bytes).")
    finally:
        exp_dir = Path(job["export_dir"])
        if exp_dir.exists():
            shutil.rmtree(exp_dir, ignore_errors=True)
        db.delete_job(job_id)


def test_module_5() -> None:
    print("\n=== MODULE 5: GEMINI =s0 FULL-RES UPGRADE & REVERSE-ALPHA WATERMARK REMOVER ===")
    preview_url = "https://lh3.googleusercontent.com/gg-dl/AJfQ9KR_test_asset=s1024-rj"
    norm_url = normalize_gemini_asset_url(preview_url)
    candidates = _build_full_res_googleusercontent_urls(preview_url)
    assert "=s0" in norm_url
    assert candidates[0].endswith("=s0")
    print(f"[PASS] Full-res =s0 URL normalizer verified: {preview_url} -> {candidates[0]}")

    # Verify non-watermarked image is safely skipped (auto-detection gate)
    clean_sample = _make_sample_image_bytes((140, 120, 105), (95, 80, 70))
    res_skip = remove_gemini_watermark_bytes(clean_sample)
    assert res_skip["applied"] is False
    print(f"[PASS] Auto-detection safety gate skipped unwatermarked image ({res_skip['meta'].get('skipReason')}).")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--module", default="all", choices=["1", "2", "3", "4", "5", "all"])
    args = parser.parse_args()

    if args.module in ("1", "all"):
        test_module_1()
    if args.module in ("2", "all"):
        test_module_2()
    if args.module in ("3", "all"):
        test_module_3()
    if args.module in ("4", "all"):
        test_module_4()
    if args.module in ("5", "all"):
        test_module_5()
    print("\nALL REQUESTED STUDIO MODULE AUDITS PASSED.")


if __name__ == "__main__":
    main()
