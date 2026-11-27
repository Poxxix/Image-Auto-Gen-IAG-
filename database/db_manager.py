import json
import re
import sqlite3
import threading
import unicodedata
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional

from config import (
    DATABASE_PATH,
    DEFAULT_CAPTION_PROMPT,
    DEFAULT_SETTINGS,
    EXPORTS_DIR,
    MAX_CDP_SLOTS,
    SENSITIVE_SETTING_KEYS,
    format_picassy_keyword,
    normalize_carrier_override,
    normalize_cdp_slots,
    normalize_export_image_format,
    normalize_filename_style,
    normalize_metadata_export_mode,
    normalize_picassy_categories,
    normalize_reference_strength,
)


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def slugify_theme(text: str, max_len: int = 42) -> str:
    """
    Converts any Vietnamese/English theme string into a clean filesystem-safe slug.
    Example: 'Cà phê mùa thu ở Hà Nội!' -> 'ca-phe-mua-thu-o-ha-noi'
    """
    if not text:
        return "image-set"
    # Replace Vietnamese đ/Đ explicitly before NFD normalization
    cleaned = text.replace("đ", "d").replace("Đ", "d")
    normalized = unicodedata.normalize("NFD", cleaned)
    ascii_str = "".join(c for c in normalized if unicodedata.category(c) != "Mn")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_str.lower()).strip("-")
    slug = re.sub(r"-{2,}", "-", slug)
    return (slug[:max_len].strip("-")) or "image-set"


SCHEMA: Dict[str, str] = {
    "jobs": """
        CREATE TABLE IF NOT EXISTS jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            theme TEXT NOT NULL,
            slug TEXT NOT NULL,
            base_prompt TEXT DEFAULT '',
            reference_mode TEXT DEFAULT 'prompt_only',
            reference_strength TEXT DEFAULT 'balanced',
            carrier_override TEXT DEFAULT 'auto',
            run_mode TEXT DEFAULT 'fixed',
            target_count INTEGER DEFAULT 6,
            batch_size INTEGER DEFAULT 4,
            session_cap INTEGER DEFAULT 20,
            cycle_references INTEGER DEFAULT 1,
            aspect_ratio TEXT DEFAULT '1:1',
            metadata_language TEXT DEFAULT 'English',
            metadata_export_mode TEXT DEFAULT 'csv',
            export_image_format TEXT DEFAULT 'original',
            primary_tag TEXT DEFAULT '',
            category TEXT DEFAULT '',
            filename_style TEXT DEFAULT 'picassy_slug',
            preferred_cdp_slot INTEGER DEFAULT 0,
            active_cdp_slot INTEGER DEFAULT 0,
            caption_prompt TEXT DEFAULT '',
            use_ai_caption_prompt INTEGER DEFAULT 1,
            optimize_prompt_english INTEGER DEFAULT 1,
            model TEXT DEFAULT 'chrome-cdp/gemini',
            export_dir TEXT NOT NULL,
            preset_id TEXT DEFAULT '',
            fixed_elements_json TEXT DEFAULT '{}',
            variation_axes_json TEXT DEFAULT '{}',
            reference_ids_json TEXT DEFAULT '[]',
            status TEXT DEFAULT 'planned',
            current_step TEXT DEFAULT '',
            error TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            completed_at TEXT
        )
    """,
    "generations": """
        CREATE TABLE IF NOT EXISTS generations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id INTEGER NOT NULL,
            index_num INTEGER NOT NULL,
            prompt_final TEXT NOT NULL,
            fixed_elements_json TEXT DEFAULT '{}',
            variation_axes_json TEXT DEFAULT '{}',
            reference_id INTEGER,
            is_locked INTEGER DEFAULT 0,
            is_peak INTEGER DEFAULT 0,
            model TEXT DEFAULT '',
            status TEXT DEFAULT 'planned',
            title TEXT DEFAULT '',
            caption TEXT DEFAULT '',
            description TEXT DEFAULT '',
            alt_text TEXT DEFAULT '',
            hashtags TEXT DEFAULT '',
            image_file TEXT DEFAULT '',
            image_path TEXT DEFAULT '',
            sidecar_file TEXT DEFAULT '',
            caption_file TEXT DEFAULT '',
            mime_type TEXT DEFAULT '',
            width INTEGER DEFAULT 0,
            height INTEGER DEFAULT 0,
            file_size INTEGER DEFAULT 0,
            md5 TEXT DEFAULT '',
            dhash TEXT DEFAULT '',
            duplicate_warning TEXT DEFAULT '',
            error TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            completed_at TEXT,
            FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
        )
    """,
    "references": """
        CREATE TABLE IF NOT EXISTS "references" (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_type TEXT NOT NULL,
            source_ref TEXT DEFAULT '',
            title TEXT DEFAULT '',
            file_path TEXT NOT NULL,
            filename TEXT NOT NULL,
            mime_type TEXT DEFAULT 'image/jpeg',
            width INTEGER DEFAULT 0,
            height INTEGER DEFAULT 0,
            file_size INTEGER DEFAULT 0,
            md5 TEXT DEFAULT '',
            dhash TEXT DEFAULT '',
            usage_rights TEXT DEFAULT 'user_provided_confirmed',
            metadata_json TEXT DEFAULT '{}',
            created_at TEXT NOT NULL
        )
    """,
    "settings": """
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """,
    "activity_logs": """
        CREATE TABLE IF NOT EXISTS activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id INTEGER,
            generation_id INTEGER,
            level TEXT DEFAULT 'INFO',
            stage TEXT DEFAULT 'STUDIO',
            message TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """,
}

INDEXES: List[str] = [
    "CREATE INDEX IF NOT EXISTS idx_generations_job_id ON generations(job_id, index_num)",
    "CREATE INDEX IF NOT EXISTS idx_generations_job_status ON generations(job_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_activity_logs_job_id ON activity_logs(job_id, id DESC)",
]


class DatabaseManager:
    """
    Thread-safe SQLite manager using ONE persistent WAL connection serialized via a
    re-entrant `threading.RLock()`. Eliminates concurrent `sqlite3.connect()` / `conn.close()`
    churn across FastAPI worker threads & JobRunner (preventing macOS `libsqlite3`
    `findReusableFd` / `sqlite3WalClose` pthread mutex deadlocks).
    """

    def __init__(self, db_path: Path = DATABASE_PATH):
        self.db_path = db_path
        self._settings_cache: Optional[Dict[str, Any]] = None
        self._db_lock = threading.RLock()
        self._tx_depth = 0
        self._shared_conn: Optional[sqlite3.Connection] = None
        self._init_db()

    def _get_or_open_conn(self) -> sqlite3.Connection:
        if self._shared_conn is None:
            conn = sqlite3.connect(str(self.db_path), timeout=20, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA busy_timeout=20000")
            conn.execute("PRAGMA foreign_keys=ON")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.execute("PRAGMA temp_store=MEMORY")
            conn.execute("PRAGMA cache_size=-16000")
            self._shared_conn = conn
        return self._shared_conn

    def close(self) -> None:
        with self._db_lock:
            if self._shared_conn is not None:
                try:
                    self._shared_conn.commit()
                except Exception:
                    pass
                try:
                    self._shared_conn.close()
                except Exception:
                    pass
                self._shared_conn = None

    @contextmanager
    def _conn(self) -> Iterator[sqlite3.Connection]:
        with self._db_lock:
            conn = self._get_or_open_conn()
            self._tx_depth += 1
            outermost = self._tx_depth == 1
            try:
                yield conn
                if outermost:
                    conn.commit()
            except Exception:
                if outermost:
                    try:
                        conn.rollback()
                    except Exception:
                        pass
                raise
            finally:
                self._tx_depth = max(0, self._tx_depth - 1)

    def _init_db(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            for ddl in SCHEMA.values():
                conn.execute(ddl)
            self._migrate(conn)
            for idx_sql in INDEXES:
                conn.execute(idx_sql)
        self._ensure_default_settings()

    def _migrate(self, conn: sqlite3.Connection) -> None:
        for table, ddl in SCHEMA.items():
            table_ident = f'"{table}"' if table == "references" else table
            existing = {
                row["name"]
                for row in conn.execute(f"PRAGMA table_info({table_ident})").fetchall()
            }
            for line in ddl.splitlines():
                stripped = line.strip().rstrip(",")
                if (
                    not stripped
                    or stripped.upper().startswith(("CREATE", "(", ")", "FOREIGN"))
                ):
                    continue
                col_name = stripped.split()[0]
                if col_name not in existing:
                    try:
                        conn.execute(f"ALTER TABLE {table_ident} ADD COLUMN {stripped}")
                    except sqlite3.OperationalError:
                        pass

    def _ensure_default_settings(self) -> None:
        with self._conn() as conn:
            for k, v in DEFAULT_SETTINGS.items():
                row = conn.execute("SELECT key FROM settings WHERE key = ?", (k,)).fetchone()
                if not row:
                    conn.execute(
                        "INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)",
                        (k, json.dumps(v), now_iso()),
                    )
            # Auto-upgrade legacy 'json' / 'caption' export modes to 'csv'
            conn.execute(
                """
                UPDATE jobs
                SET metadata_export_mode = 'csv'
                WHERE metadata_export_mode IN ('json', 'caption')
                   OR metadata_export_mode IS NULL
                   OR metadata_export_mode = ''
                """
            )
            mode_row = conn.execute(
                "SELECT value_json FROM settings WHERE key = 'default_metadata_export_mode'"
            ).fetchone()
            if mode_row:
                try:
                    cur_mode = json.loads(mode_row["value_json"])
                except Exception:
                    cur_mode = mode_row["value_json"]
                if str(cur_mode or "").strip().lower() in ("json", "caption", ""):
                    conn.execute(
                        "UPDATE settings SET value_json = ?, updated_at = ? WHERE key = 'default_metadata_export_mode'",
                        (json.dumps("csv"), now_iso()),
                    )
            # One-time migration: keep reference attached on similarity retry by default
            mig_row = conn.execute(
                "SELECT key FROM settings WHERE key = '_mig_keep_ref_retry_v1'"
            ).fetchone()
            if not mig_row:
                conn.execute(
                    "UPDATE settings SET value_json = ?, updated_at = ? WHERE key = 'drop_ref_on_similarity_retry'",
                    (json.dumps(False), now_iso()),
                )
                conn.execute(
                    "INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)",
                    ("_mig_keep_ref_retry_v1", json.dumps(True), now_iso()),
                )
        self._settings_cache = None

    # =========================================================================
    # Settings Operations (with in-memory cache for fast reads)
    # =========================================================================
    def get_settings(self, include_secrets: bool = False) -> Dict[str, Any]:
        if self._settings_cache is not None:
            result = dict(self._settings_cache)
        else:
            result = dict(DEFAULT_SETTINGS)
            with self._conn() as conn:
                rows = conn.execute("SELECT key, value_json FROM settings").fetchall()
                for r in rows:
                    k = r["key"]
                    if k in result:
                        try:
                            result[k] = json.loads(r["value_json"])
                        except Exception:
                            result[k] = r["value_json"]
            self._settings_cache = dict(result)

        if not include_secrets:
            masked: Dict[str, Any] = {}
            for k, v in result.items():
                if k in SENSITIVE_SETTING_KEYS:
                    raw = str(v or "").strip()
                    masked[f"{k}_configured"] = bool(raw)
                    masked[k] = (
                        f"{raw[:4]}••••{raw[-4:]}" if len(raw) > 8 else ("••••" if raw else "")
                    )
                else:
                    masked[k] = v
            return masked
        return result

    def update_settings(self, updates: Dict[str, Any]) -> Dict[str, Any]:
        with self._conn() as conn:
            for k, v in updates.items():
                if k not in DEFAULT_SETTINGS:
                    continue
                if k in SENSITIVE_SETTING_KEYS:
                    val_str = str(v or "").strip()
                    if "••••" in val_str:
                        continue
                    v = val_str
                conn.execute(
                    """
                    INSERT INTO settings (key, value_json, updated_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(key) DO UPDATE SET
                        value_json = excluded.value_json,
                        updated_at = excluded.updated_at
                    """,
                    (k, json.dumps(v), now_iso()),
                )
        self._settings_cache = None
        return self.get_settings(include_secrets=False)

    # =========================================================================
    # References Operations
    # =========================================================================
    def _hydrate_reference(self, row: sqlite3.Row) -> Dict[str, Any]:
        data = dict(row)
        try:
            data["metadata"] = json.loads(data.get("metadata_json") or "{}")
        except Exception:
            data["metadata"] = {}
        data["exists_on_disk"] = Path(data.get("file_path") or "").exists()
        return data

    def add_reference(
        self,
        source_type: str,
        file_path: str,
        filename: str,
        source_ref: str = "",
        title: str = "",
        mime_type: str = "image/jpeg",
        width: int = 0,
        height: int = 0,
        file_size: int = 0,
        md5: str = "",
        dhash: str = "",
        usage_rights: str = "user_provided_confirmed",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        with self._conn() as conn:
            cur = conn.execute(
                """
                INSERT INTO "references" (
                    source_type, source_ref, title, file_path, filename,
                    mime_type, width, height, file_size, md5, dhash,
                    usage_rights, metadata_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    source_type,
                    source_ref,
                    title or filename,
                    file_path,
                    filename,
                    mime_type,
                    width,
                    height,
                    file_size,
                    md5,
                    dhash,
                    usage_rights,
                    json.dumps(metadata or {}),
                    now_iso(),
                ),
            )
            ref_id = cur.lastrowid
        return self.get_reference(ref_id)  # type: ignore

    def get_reference(self, ref_id: int) -> Optional[Dict[str, Any]]:
        if not ref_id:
            return None
        with self._conn() as conn:
            row = conn.execute('SELECT * FROM "references" WHERE id = ?', (ref_id,)).fetchone()
        return self._hydrate_reference(row) if row else None

    def update_reference(self, ref_id: int, title: str) -> Optional[Dict[str, Any]]:
        if not ref_id:
            return None
        with self._conn() as conn:
            conn.execute(
                'UPDATE "references" SET title = ? WHERE id = ?',
                (title.strip(), ref_id),
            )
        return self.get_reference(ref_id)

    def list_references(
        self,
        ids: Optional[List[int]] = None,
        source_type: Optional[str] = None,
        limit: int = 500,
    ) -> List[Dict[str, Any]]:
        with self._conn() as conn:
            if ids is not None:
                if not ids:
                    return []
                marks = ",".join("?" for _ in ids)
                rows = conn.execute(
                    f'SELECT * FROM "references" WHERE id IN ({marks})', ids
                ).fetchall()
                by_id = {r["id"]: self._hydrate_reference(r) for r in rows}
                return [by_id[i] for i in ids if i in by_id]
            if source_type:
                rows = conn.execute(
                    'SELECT * FROM "references" WHERE source_type = ? ORDER BY id DESC LIMIT ?',
                    (source_type, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    'SELECT * FROM "references" ORDER BY id DESC LIMIT ?',
                    (limit,),
                ).fetchall()
        return [self._hydrate_reference(r) for r in rows]

    def delete_references_bulk(
        self,
        ref_ids: Optional[List[int]] = None,
        source_type: Optional[str] = None,
        delete_all: bool = False,
    ) -> List[Dict[str, Any]]:
        with self._conn() as conn:
            if ref_ids is not None and len(ref_ids) > 0:
                clean_ids = [int(x) for x in ref_ids if int(x) > 0]
                if not clean_ids:
                    return []
                marks = ",".join("?" for _ in clean_ids)
                rows = conn.execute(
                    f'SELECT * FROM "references" WHERE id IN ({marks})', clean_ids
                ).fetchall()
            elif source_type and source_type in ("local_upload", "pinterest"):
                rows = conn.execute(
                    'SELECT * FROM "references" WHERE source_type = ?', (source_type,)
                ).fetchall()
            elif delete_all:
                rows = conn.execute('SELECT * FROM "references"').fetchall()
            else:
                return []

            if not rows:
                return []

            deleted_records = [self._hydrate_reference(r) for r in rows]
            target_ids = [int(r["id"]) for r in rows]
            target_set = set(target_ids)
            marks = ",".join("?" for _ in target_ids)
            ts = now_iso()

            affected_job_rows = conn.execute(
                f"SELECT DISTINCT job_id FROM generations WHERE reference_id IN ({marks})",
                target_ids,
            ).fetchall()
            affected_job_ids = {int(r["job_id"]) for r in affected_job_rows if r["job_id"]}

            conn.execute(f'DELETE FROM "references" WHERE id IN ({marks})', target_ids)
            conn.execute(
                f"UPDATE generations SET reference_id = NULL, updated_at = ? WHERE reference_id IN ({marks})",
                (ts, *target_ids),
            )

            job_rows = conn.execute("SELECT id, reference_ids_json FROM jobs").fetchall()
            for j in job_rows:
                jid = int(j["id"])
                try:
                    r_ids = json.loads(j["reference_ids_json"] or "[]")
                    if any(int(x) in target_set for x in r_ids):
                        new_ids = [x for x in r_ids if int(x) not in target_set]
                        conn.execute(
                            "UPDATE jobs SET reference_ids_json = ?, updated_at = ? WHERE id = ?",
                            (json.dumps(new_ids), ts, jid),
                        )
                        affected_job_ids.discard(jid)
                except Exception:
                    pass

            if affected_job_ids:
                j_marks = ",".join("?" for _ in affected_job_ids)
                conn.execute(
                    f"UPDATE jobs SET updated_at = ? WHERE id IN ({j_marks})",
                    (ts, *affected_job_ids),
                )

        return deleted_records

    def delete_reference(self, ref_id: int) -> Optional[Dict[str, Any]]:
        deleted = self.delete_references_bulk(ref_ids=[int(ref_id)])
        return deleted[0] if deleted else None

    # =========================================================================
    # Generations Operations
    # =========================================================================
    def _hydrate_generation(
        self,
        row: sqlite3.Row,
        refs_cache: Optional[Dict[int, Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        data = dict(row)
        data["is_locked"] = bool(data.get("is_locked"))
        data["is_peak"] = bool(data.get("is_peak"))
        data["caption"] = data.get("caption") or ""
        data["alt_text"] = data.get("alt_text") or ""
        data["hashtags"] = data.get("hashtags") or ""
        data["caption_file"] = data.get("caption_file") or ""
        try:
            data["fixed_elements"] = json.loads(data.get("fixed_elements_json") or "{}")
        except Exception:
            data["fixed_elements"] = {}
        try:
            data["variation_axes"] = json.loads(data.get("variation_axes_json") or "{}")
        except Exception:
            data["variation_axes"] = {}

        ref_id = data.get("reference_id")
        if ref_id:
            if refs_cache is not None and ref_id in refs_cache:
                data["reference"] = refs_cache[ref_id]
            else:
                data["reference"] = self.get_reference(ref_id)
        else:
            data["reference"] = None
        return data

    def create_generation(
        self,
        job_id: int,
        index_num: int,
        prompt_final: str,
        model: str,
        reference_id: Optional[int] = None,
        fixed_elements: Optional[Dict[str, Any]] = None,
        variation_axes: Optional[Dict[str, Any]] = None,
        is_locked: bool = False,
        status: str = "planned",
    ) -> Dict[str, Any]:
        ts = now_iso()
        with self._conn() as conn:
            cur = conn.execute(
                """
                INSERT INTO generations (
                    job_id, index_num, prompt_final, fixed_elements_json,
                    variation_axes_json, reference_id, is_locked, model,
                    status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    job_id,
                    index_num,
                    prompt_final.strip(),
                    json.dumps(fixed_elements or {}, ensure_ascii=False),
                    json.dumps(variation_axes or {}, ensure_ascii=False),
                    reference_id,
                    1 if is_locked else 0,
                    model,
                    status,
                    ts,
                    ts,
                ),
            )
            gen_id = cur.lastrowid
        return self.get_generation(gen_id)  # type: ignore

    def create_generations_bulk(
        self,
        job_id: int,
        turns: List[Dict[str, Any]],
    ) -> int:
        """Inserts up to thousands of planned turns in one SQLite transaction."""
        if not turns:
            return 0
        ts = now_iso()
        rows = [
            (
                job_id,
                int(t["index_num"]),
                str(t["prompt_final"]).strip(),
                json.dumps(t.get("fixed_elements") or {}, ensure_ascii=False),
                json.dumps(t.get("variation_axes") or {}, ensure_ascii=False),
                t.get("reference_id"),
                1 if t.get("is_locked") else 0,
                str(t.get("model") or "chrome-cdp/gemini"),
                str(t.get("status") or "planned"),
                ts,
                ts,
            )
            for t in turns
        ]
        with self._conn() as conn:
            conn.executemany(
                """
                INSERT INTO generations (
                    job_id, index_num, prompt_final, fixed_elements_json,
                    variation_axes_json, reference_id, is_locked, model,
                    status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )
        return len(rows)

    def get_generation(self, gen_id: int) -> Optional[Dict[str, Any]]:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM generations WHERE id = ?", (gen_id,)).fetchone()
        return self._hydrate_generation(row) if row else None

    def list_job_generation_fingerprints(self, job_id: int) -> List[Dict[str, Any]]:
        """Lightweight SQL scan for prompt uniqueness & dHash/MD5 duplicate checks (scales to 1000+ turns)."""
        with self._conn() as conn:
            rows = conn.execute(
                """
                SELECT id, index_num, prompt_final, reference_id, status, md5, dhash
                FROM generations
                WHERE job_id = ?
                ORDER BY index_num ASC, id ASC
                """,
                (job_id,),
            ).fetchall()
        return [dict(r) for r in rows]

    def get_next_running_job_id(self) -> Optional[int]:
        """Ultra-fast poll query for JobRunner without hydrating jobs or generations."""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT id FROM jobs WHERE status = 'running' ORDER BY id ASC LIMIT 1"
            ).fetchone()
        return int(row["id"]) if row else None

    def get_pinned_running_job_ids_for_slot(self, slot_id: int) -> List[int]:
        sid = int(slot_id)
        with self._conn() as conn:
            rows = conn.execute(
                """
                SELECT id FROM jobs
                WHERE status = 'running'
                  AND preferred_cdp_slot = ?
                  AND (active_cdp_slot IS NULL OR active_cdp_slot = 0)
                ORDER BY id ASC
                """,
                (sid,),
            ).fetchall()
        return [int(r["id"]) for r in rows]

    def claim_next_running_job_for_slot(
        self,
        slot_id: int,
        *,
        slot_online: bool = True,
        allow_auto_cdp: bool = True,
        allow_api_jobs: bool = True,
        pinned_only: bool = False,
    ) -> Optional[int]:
        """
        Atomically claims the next unclaimed `status = 'running'` job eligible for `slot_id`.
        - Enforces 1 Job = 1 Slot across up to 4 concurrent Chrome CDP slots.
        - Respects `preferred_cdp_slot` (`0 = Auto`, `1..4 = Pinned Slot`).
        - Prefers jobs pinned explicitly to `slot_id` before auto-queued jobs.
        """
        sid = int(slot_id)
        with self._conn() as conn:
            if not conn.in_transaction:
                conn.execute("BEGIN IMMEDIATE")
            rows = conn.execute(
                """
                SELECT id, model, preferred_cdp_slot, active_cdp_slot
                FROM jobs
                WHERE status = 'running'
                  AND (active_cdp_slot IS NULL OR active_cdp_slot = 0)
                ORDER BY CASE WHEN preferred_cdp_slot = ? THEN 0 ELSE 1 END ASC, id ASC
                """,
                (sid,),
            ).fetchall()

            for row in rows:
                pref = int(row["preferred_cdp_slot"] or 0)
                model_str = str(row["model"] or "chrome-cdp/gemini")
                is_cdp = model_str.startswith("chrome-cdp/")

                if pinned_only and pref != sid:
                    continue
                if pref != 0 and pref != sid:
                    continue
                if is_cdp:
                    # Auto CDP jobs should go to an online slot unless pinned or fallback Slot #1
                    if pref == 0 and not slot_online and not allow_auto_cdp:
                        continue
                else:
                    if not allow_api_jobs:
                        continue

                jid = int(row["id"])
                conn.execute(
                    "UPDATE jobs SET active_cdp_slot = ?, updated_at = ? WHERE id = ?",
                    (sid, now_iso(), jid),
                )
                return jid
        return None

    def release_job_slot(self, job_id: int, expected_slot: Optional[int] = None) -> None:
        with self._conn() as conn:
            if expected_slot is not None:
                conn.execute(
                    "UPDATE jobs SET active_cdp_slot = 0 WHERE id = ? AND active_cdp_slot = ?",
                    (job_id, int(expected_slot)),
                )
            else:
                conn.execute(
                    "UPDATE jobs SET active_cdp_slot = 0 WHERE id = ?",
                    (job_id,),
                )

    def list_job_generations(self, job_id: int) -> List[Dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM generations WHERE job_id = ? ORDER BY index_num ASC, id ASC",
                (job_id,),
            ).fetchall()
        ref_ids = list({r["reference_id"] for r in rows if r["reference_id"]})
        refs_cache = {r["id"]: r for r in self.list_references(ids=ref_ids)} if ref_ids else {}
        return [self._hydrate_generation(r, refs_cache=refs_cache) for r in rows]

    def update_generation(self, gen_id: int, **fields: Any) -> Optional[Dict[str, Any]]:
        existing = self.get_generation(gen_id)
        if not existing:
            return None
        updates: Dict[str, Any] = {"updated_at": now_iso()}
        allowed_scalar = (
            "index_num",
            "prompt_final",
            "reference_id",
            "model",
            "status",
            "title",
            "caption",
            "description",
            "alt_text",
            "hashtags",
            "image_file",
            "image_path",
            "sidecar_file",
            "caption_file",
            "mime_type",
            "width",
            "height",
            "file_size",
            "md5",
            "dhash",
            "duplicate_warning",
            "error",
            "completed_at",
        )
        for key in allowed_scalar:
            if key in fields:
                updates[key] = fields[key]
        if "is_locked" in fields:
            updates["is_locked"] = 1 if fields["is_locked"] else 0
        if "is_peak" in fields and fields["is_peak"] is not None:
            updates["is_peak"] = 1 if fields["is_peak"] else 0
        if "fixed_elements" in fields and fields["fixed_elements"] is not None:
            updates["fixed_elements_json"] = json.dumps(fields["fixed_elements"], ensure_ascii=False)
        if "variation_axes" in fields and fields["variation_axes"] is not None:
            updates["variation_axes_json"] = json.dumps(fields["variation_axes"], ensure_ascii=False)

        cols = ", ".join(f"{k} = ?" for k in updates)
        with self._conn() as conn:
            conn.execute(
                f"UPDATE generations SET {cols} WHERE id = ?",
                (*updates.values(), gen_id),
            )
        return self.get_generation(gen_id)

    def _refresh_job_after_generation_delete(
        self,
        conn: sqlite3.Connection,
        job_id: int,
    ) -> None:
        ts = now_iso()
        job_row = conn.execute(
            "SELECT status, run_mode, target_count FROM jobs WHERE id = ?",
            (job_id,),
        ).fetchone()
        if not job_row:
            return
        rem_rows = conn.execute(
            "SELECT status FROM generations WHERE job_id = ?",
            (job_id,),
        ).fetchall()
        total = len(rem_rows)
        completed_like = sum(1 for r in rem_rows if r["status"] in ("completed", "metadata_pending"))
        failed_like = sum(1 for r in rem_rows if r["status"] in ("failed", "cancelled"))
        active_like = sum(1 for r in rem_rows if r["status"] in ("planned", "generating"))

        new_status = str(job_row["status"] or "planned")
        new_target = int(job_row["target_count"] or 1)
        if job_row["run_mode"] == "fixed" and total > 0 and active_like == 0:
            new_target = total
        elif job_row["run_mode"] == "fixed" and total > 0 and new_target > total and new_status == "planned":
            new_target = total

        if total > 0 and active_like == 0 and failed_like == 0 and completed_like == total:
            if new_status in ("completed_with_errors", "failed", "completed"):
                new_status = "completed"
                conn.execute(
                    """
                    UPDATE jobs
                    SET status = ?, target_count = ?, error = '',
                        current_step = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        new_status,
                        new_target,
                        f"Completed {total}/{total} images cleanly.",
                        ts,
                        job_id,
                    ),
                )
                return

        conn.execute(
            "UPDATE jobs SET target_count = ?, updated_at = ? WHERE id = ?",
            (new_target, ts, job_id),
        )

    def delete_generations_bulk_with_resequence(
        self,
        job_id: int,
        gen_ids: List[int],
    ) -> Optional[Dict[str, Any]]:
        clean_ids = [int(x) for x in gen_ids if int(x) > 0]
        if not clean_ids:
            return None
        reindexed: List[Dict[str, Any]] = []
        with self._conn() as conn:
            marks = ",".join("?" for _ in clean_ids)
            del_rows = conn.execute(
                f"SELECT * FROM generations WHERE job_id = ? AND id IN ({marks})",
                (job_id, *clean_ids),
            ).fetchall()
            if not del_rows:
                return None
            deleted_items = [self._hydrate_generation(r) for r in del_rows]
            found_ids = [int(r["id"]) for r in del_rows]
            f_marks = ",".join("?" for _ in found_ids)
            conn.execute(
                f"DELETE FROM generations WHERE job_id = ? AND id IN ({f_marks})",
                (job_id, *found_ids),
            )

            rows = conn.execute(
                "SELECT id, index_num, image_file, image_path, sidecar_file, caption_file FROM generations WHERE job_id = ? ORDER BY index_num ASC, id ASC",
                (job_id,),
            ).fetchall()
            ts = now_iso()
            for idx, r in enumerate(rows, start=1):
                old_idx = int(r["index_num"])
                if old_idx != idx:
                    conn.execute(
                        "UPDATE generations SET index_num = ?, updated_at = ? WHERE id = ?",
                        (idx, ts, r["id"]),
                    )
                    reindexed.append(
                        {
                            "id": r["id"],
                            "old_index": old_idx,
                            "new_index": idx,
                            "image_file": r["image_file"] or "",
                            "image_path": r["image_path"] or "",
                            "sidecar_file": r["sidecar_file"] or "",
                            "caption_file": r["caption_file"] or "",
                        }
                    )
            self._refresh_job_after_generation_delete(conn, job_id)
        return {
            "deleted": deleted_items[0],
            "deleted_items": deleted_items,
            "reindexed": reindexed,
        }

    def delete_generation_with_resequence(self, gen_id: int) -> Optional[Dict[str, Any]]:
        """
        Deletes a generation and re-sequences remaining generations' index_num (1..N),
        returning the deleted record and any re-indexed sibling transitions so disk files
        can be cleaned up and renamed atomically.
        """
        gen = self.get_generation(gen_id)
        if not gen:
            return None
        return self.delete_generations_bulk_with_resequence(int(gen["job_id"]), [int(gen_id)])

    def delete_generation(self, gen_id: int) -> bool:
        res = self.delete_generation_with_resequence(gen_id)
        return res is not None

    def clear_unlocked_planned_generations(self, job_id: int) -> None:
        with self._conn() as conn:
            conn.execute(
                "DELETE FROM generations WHERE job_id = ? AND status = 'planned' AND is_locked = 0",
                (job_id,),
            )

    def claim_next_planned_generation(self, job_id: int) -> Optional[Dict[str, Any]]:
        """
        Atomically claims the next `planned` generation for `job_id` using an immediate
        transaction on the synchronized shared connection.
        """
        with self._conn() as conn:
            if not conn.in_transaction:
                conn.execute("BEGIN IMMEDIATE")
            active = conn.execute(
                "SELECT id FROM generations WHERE job_id = ? AND status = 'generating' LIMIT 1",
                (job_id,),
            ).fetchone()
            if active:
                return None

            row = conn.execute(
                "SELECT * FROM generations WHERE job_id = ? AND status = 'planned' ORDER BY index_num ASC, id ASC LIMIT 1",
                (job_id,),
            ).fetchone()
            if not row:
                return None

            gen_id = row["id"]
            conn.execute(
                "UPDATE generations SET status = 'generating', error = '', updated_at = ? WHERE id = ?",
                (now_iso(), gen_id),
            )
        return self.get_generation(gen_id)

    # =========================================================================
    # Jobs Operations (Optimized with Batch Hydration)
    # =========================================================================
    def _build_counts(self, gens: List[Dict[str, Any]]) -> Dict[str, int]:
        return {
            "total": len(gens),
            "planned": sum(1 for g in gens if g["status"] == "planned"),
            "generating": sum(1 for g in gens if g["status"] == "generating"),
            "metadata_pending": sum(1 for g in gens if g["status"] == "metadata_pending"),
            "completed": sum(1 for g in gens if g["status"] == "completed"),
            "failed": sum(1 for g in gens if g["status"] == "failed"),
            "cancelled": sum(1 for g in gens if g["status"] == "cancelled"),
            "duplicates": sum(1 for g in gens if g.get("duplicate_warning")),
        }

    def _hydrate_job(
        self,
        row: sqlite3.Row,
        include_generations: bool = True,
        preloaded_gens: Optional[List[Dict[str, Any]]] = None,
        refs_cache: Optional[Dict[int, Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        data = dict(row)
        data["cycle_references"] = bool(data.get("cycle_references"))
        data["optimize_prompt_english"] = bool(data.get("optimize_prompt_english"))
        data["metadata_export_mode"] = normalize_metadata_export_mode(
            data.get("metadata_export_mode"), default="csv"
        )
        data["export_image_format"] = normalize_export_image_format(
            data.get("export_image_format")
        )
        raw_pt = (data.get("primary_tag") or "").strip() or (data.get("theme") or "")
        data["primary_tag"] = format_picassy_keyword(raw_pt) or raw_pt
        data["category"] = (data.get("category") or "").strip()
        data["filename_style"] = normalize_filename_style(
            data.get("filename_style"), default="picassy_slug"
        )
        data["reference_strength"] = normalize_reference_strength(
            data.get("reference_strength"), default="balanced"
        )
        data["carrier_override"] = normalize_carrier_override(
            data.get("carrier_override"), default="auto"
        )
        data["preferred_cdp_slot"] = int(data.get("preferred_cdp_slot") or 0)
        data["active_cdp_slot"] = int(data.get("active_cdp_slot") or 0)
        data["caption_prompt"] = data.get("caption_prompt") or ""
        data["use_ai_caption_prompt"] = bool(
            data.get("use_ai_caption_prompt")
            if data.get("use_ai_caption_prompt") is not None
            else True
        )
        try:
            data["fixed_elements"] = json.loads(data.get("fixed_elements_json") or "{}")
        except Exception:
            data["fixed_elements"] = {}
        try:
            data["variation_axes"] = json.loads(data.get("variation_axes_json") or "{}")
        except Exception:
            data["variation_axes"] = {}
        try:
            data["reference_ids"] = json.loads(data.get("reference_ids_json") or "[]")
        except Exception:
            data["reference_ids"] = []

        if refs_cache is not None:
            data["references"] = [
                refs_cache[rid] for rid in data["reference_ids"] if rid in refs_cache
            ]
        else:
            data["references"] = (
                self.list_references(ids=data["reference_ids"]) if data["reference_ids"] else []
            )

        if preloaded_gens is not None:
            gens = preloaded_gens
        elif include_generations:
            gens = self.list_job_generations(data["id"])
        else:
            gens = []

        data["generations"] = gens
        data["counts"] = self._build_counts(gens)
        return data

    def get_system_summary(self) -> Dict[str, int]:
        """Fast SQL summary count for /api/system/status without hydrating all jobs."""
        with self._conn() as conn:
            total_jobs = conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0]
            running_jobs = conn.execute(
                "SELECT COUNT(*) FROM jobs WHERE status = 'running'"
            ).fetchone()[0]
            completed_images = conn.execute(
                "SELECT COUNT(*) FROM generations WHERE status = 'completed'"
            ).fetchone()[0]
        return {
            "total_jobs": int(total_jobs),
            "running_jobs": int(running_jobs),
            "completed_images": int(completed_images),
        }

    def create_job(
        self,
        theme: str,
        base_prompt: str = "",
        reference_mode: str = "prompt_only",
        reference_strength: str = "balanced",
        carrier_override: str = "auto",
        run_mode: str = "fixed",
        target_count: int = 6,
        batch_size: int = 4,
        session_cap: int = 20,
        cycle_references: bool = True,
        aspect_ratio: str = "1:1",
        metadata_language: str = "English",
        metadata_export_mode: str = "csv",
        export_image_format: str = "original",
        primary_tag: str = "",
        category: str = "",
        filename_style: str = "picassy_slug",
        preferred_cdp_slot: int = 0,
        caption_prompt: str = "",
        use_ai_caption_prompt: bool = True,
        optimize_prompt_english: bool = True,
        model: str = "chrome-cdp/gemini",
        export_root_dir: Optional[str] = None,
        preset_id: str = "",
        fixed_elements: Optional[Dict[str, Any]] = None,
        variation_axes: Optional[Dict[str, Any]] = None,
        reference_ids: Optional[List[int]] = None,
    ) -> Dict[str, Any]:
        clean_theme = theme.strip()
        raw_pt = (primary_tag or "").strip() or clean_theme
        clean_primary_tag = format_picassy_keyword(raw_pt) or raw_pt
        clean_category = (category or "").strip()
        clean_filename_style = normalize_filename_style(filename_style, default="picassy_slug")
        clean_pref_slot = int(preferred_cdp_slot or 0)
        if clean_pref_slot < 0 or clean_pref_slot > MAX_CDP_SLOTS:
            clean_pref_slot = 0

        slug = slugify_theme(raw_pt or clean_theme)
        ts_folder = datetime.now().strftime("%Y-%m-%d_%H%M%S")
        root = Path(export_root_dir).expanduser() if export_root_dir else EXPORTS_DIR
        export_dir = root / f"{ts_folder}_{slug}"
        export_dir.mkdir(parents=True, exist_ok=True)

        clean_mode = normalize_metadata_export_mode(metadata_export_mode, default="csv")
        clean_image_format = normalize_export_image_format(export_image_format)
        clean_ref_strength = normalize_reference_strength(reference_strength, default="balanced")
        clean_carrier = normalize_carrier_override(carrier_override, default="auto")

        now = now_iso()
        with self._conn() as conn:
            cur = conn.execute(
                """
                INSERT INTO jobs (
                    theme, slug, base_prompt, reference_mode, reference_strength, carrier_override, run_mode,
                    target_count, batch_size, session_cap, cycle_references,
                    aspect_ratio, metadata_language, metadata_export_mode,
                    export_image_format, primary_tag, category, filename_style,
                    preferred_cdp_slot, active_cdp_slot,
                    caption_prompt, use_ai_caption_prompt, optimize_prompt_english,
                    model, export_dir, preset_id, fixed_elements_json,
                    variation_axes_json, reference_ids_json, status,
                    current_step, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    clean_theme,
                    slug,
                    base_prompt.strip(),
                    reference_mode,
                    clean_ref_strength,
                    clean_carrier,
                    run_mode,
                    int(target_count),
                    int(batch_size),
                    int(session_cap),
                    1 if cycle_references else 0,
                    aspect_ratio,
                    metadata_language,
                    clean_mode,
                    clean_image_format,
                    clean_primary_tag,
                    clean_category,
                    clean_filename_style,
                    clean_pref_slot,
                    0,
                    (caption_prompt or DEFAULT_CAPTION_PROMPT).strip(),
                    1 if use_ai_caption_prompt else 0,
                    1 if optimize_prompt_english else 0,
                    model,
                    str(export_dir),
                    preset_id,
                    json.dumps(fixed_elements or {}, ensure_ascii=False),
                    json.dumps(variation_axes or {}, ensure_ascii=False),
                    json.dumps(reference_ids or []),
                    "planned",
                    "Variation plan initialized.",
                    now,
                    now,
                ),
            )
            job_id = cur.lastrowid
        return self.get_job(job_id)  # type: ignore

    def get_job(self, job_id: int) -> Optional[Dict[str, Any]]:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return self._hydrate_job(row) if row else None

    def _build_counts_map(self, conn: sqlite3.Connection, job_ids: List[int]) -> Dict[int, Dict[str, int]]:
        counts_map: Dict[int, Dict[str, int]] = {
            jid: {
                "total": 0,
                "planned": 0,
                "generating": 0,
                "metadata_pending": 0,
                "completed": 0,
                "failed": 0,
                "cancelled": 0,
                "duplicates": 0,
            }
            for jid in job_ids
        }
        if not job_ids:
            return counts_map
        marks = ",".join("?" for _ in job_ids)
        rows = conn.execute(
            f"""
            SELECT job_id, status, COUNT(*) AS cnt,
                   SUM(CASE WHEN COALESCE(duplicate_warning, '') != '' THEN 1 ELSE 0 END) AS dups
            FROM generations
            WHERE job_id IN ({marks})
            GROUP BY job_id, status
            """,
            job_ids,
        ).fetchall()
        for r in rows:
            c = counts_map.get(r["job_id"])
            if not c:
                continue
            st = r["status"]
            cnt = int(r["cnt"] or 0)
            c["total"] += cnt
            c["duplicates"] += int(r["dups"] or 0)
            if st in c:
                c[st] += cnt
        return counts_map

    def list_jobs(self, limit: int = 50, include_generations: bool = True) -> List[Dict[str, Any]]:
        """
        Batch-hydrates `jobs`, their paired `references`, and optionally all `generations`.
        When `include_generations=False`, computes exact `counts` via SQL aggregation so
        100–1000 image workspaces load in milliseconds.
        """
        with self._conn() as conn:
            job_rows = conn.execute(
                "SELECT * FROM jobs ORDER BY id DESC LIMIT ?", (limit,)
            ).fetchall()
            if not job_rows:
                return []

            job_ids = [r["id"] for r in job_rows]
            j_marks = ",".join("?" for _ in job_ids)

            if include_generations:
                gen_rows = conn.execute(
                    f"SELECT * FROM generations WHERE job_id IN ({j_marks}) ORDER BY index_num ASC, id ASC",
                    job_ids,
                ).fetchall()
                counts_map: Dict[int, Dict[str, int]] = {}
            else:
                gen_rows = []
                counts_map = self._build_counts_map(conn, job_ids)

            all_ref_ids: set[int] = set()
            for r in job_rows:
                try:
                    for rid in json.loads(r["reference_ids_json"] or "[]"):
                        if rid:
                            all_ref_ids.add(int(rid))
                except Exception:
                    pass
            for gr in gen_rows:
                if gr["reference_id"]:
                    all_ref_ids.add(int(gr["reference_id"]))

            refs_cache: Dict[int, Dict[str, Any]] = {}
            if all_ref_ids:
                r_list = list(all_ref_ids)
                r_marks = ",".join("?" for _ in r_list)
                ref_rows = conn.execute(
                    f'SELECT * FROM "references" WHERE id IN ({r_marks})',
                    r_list,
                ).fetchall()
                refs_cache = {rr["id"]: self._hydrate_reference(rr) for rr in ref_rows}

        gens_by_job: Dict[int, List[Dict[str, Any]]] = {jid: [] for jid in job_ids}
        for gr in gen_rows:
            gens_by_job[gr["job_id"]].append(
                self._hydrate_generation(gr, refs_cache=refs_cache)
            )

        out: List[Dict[str, Any]] = []
        for jr in job_rows:
            hydrated = self._hydrate_job(
                jr,
                include_generations=include_generations,
                preloaded_gens=gens_by_job.get(jr["id"], []) if include_generations else [],
                refs_cache=refs_cache,
            )
            if not include_generations:
                hydrated["counts"] = counts_map.get(jr["id"], hydrated["counts"])
            out.append(hydrated)
        return out

    def update_job(self, job_id: int, **fields: Any) -> Optional[Dict[str, Any]]:
        existing = self.get_job(job_id)
        if not existing:
            return None
        updates: Dict[str, Any] = {"updated_at": now_iso()}
        allowed_scalar = (
            "theme",
            "slug",
            "base_prompt",
            "reference_mode",
            "reference_strength",
            "carrier_override",
            "run_mode",
            "target_count",
            "batch_size",
            "session_cap",
            "aspect_ratio",
            "metadata_language",
            "metadata_export_mode",
            "export_image_format",
            "primary_tag",
            "category",
            "filename_style",
            "preferred_cdp_slot",
            "active_cdp_slot",
            "caption_prompt",
            "model",
            "export_dir",
            "preset_id",
            "status",
            "current_step",
            "error",
            "completed_at",
        )
        for key in allowed_scalar:
            if key in fields and fields[key] is not None:
                updates[key] = fields[key]
        if "metadata_export_mode" in updates:
            updates["metadata_export_mode"] = normalize_metadata_export_mode(
                updates["metadata_export_mode"], default="csv"
            )
        if "primary_tag" in updates:
            raw_u_pt = str(updates["primary_tag"] or "").strip()
            updates["primary_tag"] = format_picassy_keyword(raw_u_pt) or raw_u_pt
        if "export_image_format" in updates:
            updates["export_image_format"] = normalize_export_image_format(
                updates["export_image_format"]
            )
        if "filename_style" in updates:
            updates["filename_style"] = normalize_filename_style(
                updates["filename_style"], default="picassy_slug"
            )
        if "reference_strength" in updates:
            updates["reference_strength"] = normalize_reference_strength(
                updates["reference_strength"], default="balanced"
            )
        if "carrier_override" in updates:
            updates["carrier_override"] = normalize_carrier_override(
                updates["carrier_override"], default="auto"
            )
        if "preferred_cdp_slot" in updates:
            val = int(updates["preferred_cdp_slot"] or 0)
            updates["preferred_cdp_slot"] = val if 0 <= val <= MAX_CDP_SLOTS else 0
        if "active_cdp_slot" in updates:
            val = int(updates["active_cdp_slot"] or 0)
            updates["active_cdp_slot"] = val if 0 <= val <= MAX_CDP_SLOTS else 0
        if "cycle_references" in fields and fields["cycle_references"] is not None:
            updates["cycle_references"] = 1 if fields["cycle_references"] else 0
        if "use_ai_caption_prompt" in fields and fields["use_ai_caption_prompt"] is not None:
            updates["use_ai_caption_prompt"] = 1 if fields["use_ai_caption_prompt"] else 0
        if "optimize_prompt_english" in fields and fields["optimize_prompt_english"] is not None:
            updates["optimize_prompt_english"] = 1 if fields["optimize_prompt_english"] else 0
        if "fixed_elements" in fields and fields["fixed_elements"] is not None:
            updates["fixed_elements_json"] = json.dumps(fields["fixed_elements"], ensure_ascii=False)
        if "variation_axes" in fields and fields["variation_axes"] is not None:
            updates["variation_axes_json"] = json.dumps(fields["variation_axes"], ensure_ascii=False)
        if "reference_ids" in fields and fields["reference_ids"] is not None:
            updates["reference_ids_json"] = json.dumps(fields["reference_ids"])

        cols = ", ".join(f"{k} = ?" for k in updates)
        with self._conn() as conn:
            conn.execute(
                f"UPDATE jobs SET {cols} WHERE id = ?",
                (*updates.values(), job_id),
            )
        return self.get_job(job_id)

    def delete_job(self, job_id: int) -> bool:
        with self._conn() as conn:
            conn.execute("DELETE FROM generations WHERE job_id = ?", (job_id,))
            conn.execute("DELETE FROM activity_logs WHERE job_id = ?", (job_id,))
            cur = conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
            return cur.rowcount > 0

    # =========================================================================
    # Activity Logs & Workspace Reset
    # =========================================================================
    def log_activity(
        self,
        message: str,
        level: str = "INFO",
        stage: str = "STUDIO",
        job_id: Optional[int] = None,
        generation_id: Optional[int] = None,
    ) -> None:
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO activity_logs (job_id, generation_id, level, stage, message, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (job_id, generation_id, level.upper(), stage.upper(), message, now_iso()),
            )

    def list_activity_logs(
        self,
        job_id: Optional[int] = None,
        limit: int = 200,
    ) -> List[Dict[str, Any]]:
        with self._conn() as conn:
            if job_id is not None:
                rows = conn.execute(
                    "SELECT * FROM activity_logs WHERE job_id = ? ORDER BY id DESC LIMIT ?",
                    (job_id, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM activity_logs ORDER BY id DESC LIMIT ?",
                    (limit,),
                ).fetchall()
        return [dict(r) for r in rows]

    def reset_workspace(self, clear_references: bool = True) -> None:
        with self._conn() as conn:
            conn.execute("DELETE FROM generations")
            conn.execute("DELETE FROM jobs")
            conn.execute("DELETE FROM activity_logs")
            if clear_references:
                conn.execute('DELETE FROM "references"')
            conn.execute(
                "DELETE FROM sqlite_sequence WHERE name IN ('jobs','generations','activity_logs','references')"
            )
        self._settings_cache = None


db = DatabaseManager()
