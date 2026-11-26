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
import tempfile
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from database.db_manager import DatabaseManager, db
from modules.export_manager import (
    build_job_zip_bytes,
    cleanup_and_resequence_after_delete_generation,
    save_generated_image_atomically,
    sync_generation_and_manifest,
    sync_job_manifest,
)
from modules.image_providers import check_cdp_status, list_available_providers
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
    print("\n=== MODULE 3: IMAGE PROVIDERS, PICASSY SEO BOUNDS & MULTI-SLOT POOL ===")
    from modules.metadata_parser import fit_picassy_metadata, validate_picassy_metadata

    providers = list_available_providers()
    cdp = check_cdp_status()
    print(f"[INFO] Registered providers: {[p['id'] for p in providers]} | CDP connected: {cdp['connected']}")
    assert any(p["id"] == "chrome-cdp/gemini" for p in providers)

    prompt_text = build_metadata_prompt(
        theme="Sympathy Messages",
        prompt_final="Soft botanical sympathy watercolor card",
        metadata_language="English",
        index_num=1,
        primary_tag="Sympathy Messages",
        caption_prompt="Keep natural supportive wording",
    )
    assert "Sympathy Messages" in prompt_text
    assert "100 to 125 characters" in prompt_text

    parsed_json = parse_metadata_json(
        '```json\n{"title": "Mẫu Nail Đỏ Cherry Sang Chảnh", "caption": "Đỏ rượu quyến rũ cho mùa lễ hội", "description": "Gợi ý mẫu nail đỏ bóng cực tôn da.", "alt_text": "Close-up aesthetic manicure showing glossy cherry red nail art framed cleanly under soft afternoon light.", "hashtags": "#rednails #naildep"}\n```',
        theme="Red Glossy Nails",
    )
    assert parsed_json and parsed_json["title"] == "Mẫu Nail Đỏ Cherry Sang Chảnh"
    assert "#" not in parsed_json["description"]

    # Validate strict Picassy SEO boundaries (Title <= 60 starts w/ kw, Desc <= 160, Alt 100..125)
    fitted = fit_picassy_metadata(
        {
            "title": "Aesthetic Inspirations for Beautiful Sympathy Messages with Delicate White Lilies and Warm Sunlight",
            "description": "Share comforting Sympathy Messages surrounded by gentle white lilies in warm morning daylight crafted naturally #sympathy #flowers #cards.",
            "alt_text": "White lilies with warm light.",
        },
        primary_tag="Sympathy Messages",
        theme="Sympathy Messages",
        metadata_language="English",
        category="Photography Topics",
    )
    issues = validate_picassy_metadata(fitted, "Sympathy Messages")
    assert not issues, f"Picassy SEO validation failed: {issues} | fitted={fitted}"
    assert fitted["title"].startswith("Sympathy Messages")
    assert len(fitted["title"]) <= 60
    assert len(fitted["description"]) <= 160
    assert 100 <= len(fitted["alt_text"]) <= 125
    assert "#" not in fitted["description"]

    # Validate 4-slot atomic job claiming isolation (1 Job = 1 Slot) on an isolated DB
    with tempfile.TemporaryDirectory(prefix="studio_slot_audit_") as tmp_dir:
        tmp_path = Path(tmp_dir)
        iso_db = DatabaseManager(db_path=tmp_path / "slot_audit.db")
        try:
            iso_db.update_settings({"export_root_dir": str(tmp_path / "exports")})
            j1 = iso_db.create_job(theme="Slot Test 1", primary_tag="Sympathy Messages", category="Art", preferred_cdp_slot=1)
            j2 = iso_db.create_job(theme="Slot Test 2", primary_tag="Friendship Quotes", category="Wallpaper", preferred_cdp_slot=2)
            iso_db.update_job(j1["id"], status="running")
            iso_db.update_job(j2["id"], status="running")
            c1 = iso_db.claim_next_running_job_for_slot(1, slot_online=True)
            c2 = iso_db.claim_next_running_job_for_slot(2, slot_online=True)
            assert c1 == j1["id"] and c2 == j2["id"], f"Slot claim mismatch: c1={c1}, c2={c2}"
            assert iso_db.claim_next_running_job_for_slot(3, slot_online=True) is None
            print("[PASS] Multi-slot job isolation (4-slot pool) + Picassy SEO bounds (60 / 160 / 100-125) verified.")
        finally:
            iso_db.close()


def test_module_4() -> None:
    import csv
    from io import StringIO
    from modules.export_manager import CSV_FILENAME, CSV_HEADERS

    print("\n=== MODULE 4: PICASSY CSV EXPORT (pin-import.csv), PEAK FLAG, TITLE CASE & RESEQUENCE ===")
    job = db.create_job(
        theme="beautiful-girl-with-bikini",
        primary_tag="beautiful-girl-with-bikini",
        category="Photography Topics",
        filename_style="picassy_slug",
        base_prompt="Warm golden sunset at a clean coastal beach",
        reference_mode="prompt_only",
        run_mode="fixed",
        target_count=2,
        aspect_ratio="1:1",
        metadata_language="English",
        metadata_export_mode="csv",
        caption_prompt="Describe naturally for Picassy SEO",
        model="chrome-cdp/gemini",
    )
    job_id = job["id"]
    assert job["primary_tag"] == "Beautiful Girl With Bikini", f"Expected Title Case tag, got {job['primary_tag']}"
    try:
        for idx, color in [(1, (45, 40, 38)), (2, (80, 65, 55))]:
            gen = db.create_generation(
                job_id=job_id,
                index_num=idx,
                prompt_final=f"Coastal sunset portrait #{idx}, 35mm editorial angle.",
                model="chrome-cdp/gemini",
                variation_axes={
                    "camera_angle": "35mm editorial angle",
                    "lighting": "Warm golden hour glow",
                    "composition": "Rule-of-thirds ocean framing",
                    "atmosphere": "Calm coastal breeze",
                },
            )
            img_bytes = _make_sample_image_bytes(color, (210, 175, 130))
            saved = save_generated_image_atomically(job, idx, img_bytes, preferred_format="original")
            gen = db.update_generation(
                gen["id"],
                status="metadata_pending",
                is_peak=(idx == 1),
                **saved,
            )
            meta = write_generation_metadata(job, gen, use_browser_turn=False)
            assert meta["title"].startswith("Beautiful Girl With Bikini") and len(meta["title"]) <= 60
            assert len(meta["description"]) <= 160
            assert 100 <= len(meta["alt_text"]) <= 125
            gen = db.update_generation(
                gen["id"],
                title=meta["title"],
                caption=meta["caption"],
                description=meta["description"],
                alt_text=meta["alt_text"],
                hashtags=meta["hashtags"],
                status="completed",
            )
            sync_generation_and_manifest(job_id, gen["id"], force_manifest=True)

        exp_dir = Path(job["export_dir"])
        csv_file = exp_dir / CSV_FILENAME
        assert (exp_dir / "beautiful-girl-with-bikini-1.png").exists()
        assert (exp_dir / "beautiful-girl-with-bikini-2.png").exists()
        assert csv_file.exists()
        assert not list(exp_dir.glob("*.json")) and not list(exp_dir.glob("*.txt"))

        raw_csv_bytes = csv_file.read_bytes()
        assert not raw_csv_bytes.startswith(b"\xef\xbb\xbf"), "CSV must not contain UTF-8 BOM"
        rows = list(csv.reader(StringIO(raw_csv_bytes.decode("utf-8"))))
        assert rows[0] == CSV_HEADERS, f"Unexpected CSV headers: {rows[0]}"
        assert len(rows) == 3, f"Expected header + 2 rows, got {len(rows)}"
        assert rows[1][0] == "beautiful-girl-with-bikini-1.png"
        assert rows[1][1].startswith("Beautiful Girl With Bikini")
        assert rows[1][2][0].isupper() and "Beautiful Girl With Bikini" not in rows[1][2][1:], (
            f"description must use Sentence case, got: {rows[1][2]}"
        )
        assert "beautiful girl with bikini" in rows[1][2].lower()
        assert rows[1][3][0].isupper() and "Beautiful Girl With Bikini" not in rows[1][3][1:], (
            f"alt_text must use Sentence case, got: {rows[1][3]}"
        )
        assert "beautiful girl with bikini" in rows[1][3].lower()
        assert rows[1][4] == "Photography Topics"
        assert rows[1][5] == "Beautiful Girl With Bikini"
        assert rows[1][6] == "TRUE"
        assert "Coastal sunset portrait #1" in rows[1][7]
        assert rows[2][6] == "FALSE"
        print("[PASS] Picassy slug naming & 8-column `pin-import.csv` (Title Case title/tags + Sentence case desc/alt + Peak + Prompt) verified.")

        # 2. Switch to 'none' mode and verify pure image-only directory (no .csv/.json/.txt)
        job = db.update_job(job_id, metadata_export_mode="none")
        sync_job_manifest(job_id, job=job)
        assert (exp_dir / "beautiful-girl-with-bikini-1.png").exists()
        assert not csv_file.exists()
        print("[PASS] Export Mode 'none': verified pure image-only directory.")

        # 3. Switch back to 'csv' and test deleting Shot #1 -> Shot #2 re-sequences to -1 on disk & inside pin-import.csv
        job = db.update_job(job_id, metadata_export_mode="csv")
        sync_job_manifest(job_id, job=job)
        first_gen_id = job["generations"][0]["id"]
        del_res = db.delete_generation_with_resequence(first_gen_id)
        assert del_res is not None
        cleanup_and_resequence_after_delete_generation(job_id, del_res)

        refreshed = db.get_job(job_id)
        assert len(refreshed["generations"]) == 1
        remaining = refreshed["generations"][0]
        assert remaining["index_num"] == 1
        assert remaining["image_file"] == "beautiful-girl-with-bikini-1.png"
        assert (exp_dir / "beautiful-girl-with-bikini-1.png").exists()
        assert not (exp_dir / "beautiful-girl-with-bikini-2.png").exists()
        rows_after = list(csv.reader(StringIO(csv_file.read_text(encoding="utf-8"))))
        assert len(rows_after) == 2 and rows_after[1][0] == "beautiful-girl-with-bikini-1.png"
        print("[PASS] Delete & Resequence: deleted -1, renamed -2 -> -1, and synced `pin-import.csv`.")

        # 5. Verify per-job export_image_format conversion (.jpg & .webp)
        jpg_job = db.create_job(
            theme="Format Check",
            primary_tag="Format Check",
            metadata_export_mode="none",
            export_image_format="jpg",
        )
        try:
            assert jpg_job["export_image_format"] == "jpg"
            sample_png = _make_sample_image_bytes((60, 70, 90), (200, 180, 140))
            saved_jpg = save_generated_image_atomically(jpg_job, 1, sample_png, preferred_format="jpg")
            assert saved_jpg["image_file"] == "format-check-1.jpg"
            assert saved_jpg["mime_type"] == "image/jpeg"
            assert Path(saved_jpg["image_path"]).exists()
            saved_webp = save_generated_image_atomically(jpg_job, 2, sample_png, preferred_format="webp")
            assert saved_webp["image_file"] == "format-check-2.webp"
            assert saved_webp["mime_type"] == "image/webp"
            assert Path(saved_webp["image_path"]).exists()
            print("[PASS] Per-job export_image_format verified: .jpg (image/jpeg) & .webp (image/webp) conversion.")
        finally:
            shutil.rmtree(Path(jpg_job["export_dir"]), ignore_errors=True)
            db.delete_job(jpg_job["id"])

        zip_bytes, zip_name = build_job_zip_bytes(job_id)
        assert len(zip_bytes) > 500
        print(f"[PASS] Packaged ZIP archive: {zip_name} ({len(zip_bytes)} bytes).")
    finally:
        exp_dir = Path(job["export_dir"])
        if exp_dir.exists():
            shutil.rmtree(exp_dir, ignore_errors=True)
        db.delete_job(job_id)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--module", default="all", choices=["1", "2", "3", "4", "all"])
    args = parser.parse_args()

    if args.module in ("1", "all"):
        test_module_1()
    if args.module in ("2", "all"):
        test_module_2()
    if args.module in ("3", "all"):
        test_module_3()
    if args.module in ("4", "all"):
        test_module_4()
    print("\nALL REQUESTED STUDIO MODULE AUDITS PASSED.")


if __name__ == "__main__":
    main()
