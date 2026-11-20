# Theme Image Set Studio (v4.1)

A high-precision local creative workbench for planning, generating, auditing, and exporting cohesive multi-shot image sets (from small curated collections up to **100–1,000+ images**), featuring **Chrome CDP (`:9222`) browser automation** (Gemini, ChatGPT, Grok), **official API providers** (Gemini/Imagen, OpenAI GPT-Image-1), **modular variation axes**, **perceptual similarity guards**, **lossless Gemini watermark removal**, and **atomic disk exports**.

---

## 1. Key Capabilities

### Create · Plan · Run · Gallery · Settings
1. **Create (`01`) — Creative Brief & Flexible Frameworks:**
   - **3 Reference Modes:** Pure Prompt, Local Image Upload (`PNG`/`JPG`/`WEBP`), or Pinterest Discovery (keyword, Pin URL, or Board URL) with Round-Robin cycling.
   - **Per-Set Output Image Format:** Choose `Original`, `PNG (.png)`, `JPG (.jpg)`, or `WebP (.webp)` right at the Create Brief step (defaults to Settings if unchanged).
   - **10 Domain Presets:** Universal Adaptive, Beauty/Nails/Fashion, Product Studio, Architecture & Interior, Editorial Lifestyle, Cinematic Concept, **Wallpaper & Screen Art**, **Painting / Charcoal & Fine Art**, **Front-Facing & Symmetrical**, and **E-Commerce Clean Plinth**.
   - **Toggleable Continuity & Variation Axes + 5th Custom Axis:** Enable or disable individual Locked Continuity fields (`Subject`, `Style`, `Color Palette`, `Brand Mood`) and any Variation Axis (`Camera Angles`, `Compositions`, `Lighting`, `Atmospheres`, plus a custom-named 5th axis) so wallpapers, flat artwork, and straight-on portraits never receive unwanted camera rotations.
   - **3-Tier AI Axis Suggest + Sample Prompt & JSON Import:** Auto-tailor Continuity & Variation Axes via Official Vision API, Chrome CDP session, or the built-in Smart Domain Analyzer — or copy a tailored **Sample Master Prompt** into ChatGPT / Gemini / Claude / Grok and paste/upload the returned JSON back via **Sample Prompt & Import**.
2. **Plan (`02`) — Large-Scale Set Management (1–1,000 Shots):**
   - Supports **Fixed Sets (1–1,000)** and **Continuous Waves (up to 1,000)** with fast bulk SQLite inserts and paginated shot inspection (`24/page`).
   - Edit individual prompts, shuffle or cycle single axes, swap reference pairings, lock (`is_locked`) specific shots before replanning, and highlight duplicates.
3. **Run (`03`) — Resilient Sequential Engine:**
   - Sequential execution (`concurrency = 1`) via isolated child worker process groups (`cdp_worker`) with real heartbeat watchdogs (`30s` default) and periodic Chrome tab recycling (every `20` shots by default) for 100–1,000 shot stability.
   - **Fresh New Chat per Shot** (`fresh_chat_per_turn`) to prevent layout bleed across turns.
   - **Input Similarity Guard:** Compares generated output against the paired reference using `dHash`, `aHash`, and structural luminance cosine similarity (`image_utils.py`); automatically defers and rotates axes (dropping sticky raw reference on final retry) to retry at the end of the set.
   - **Same-Session Metadata Capture & 3 Export Modes:** Captures **Title**, **Caption**, **Description**, and **Hashtags** inside the active Turn-1 browser session (`json` sidecars + `manifest.json`, `caption` `.txt` + `captions.txt`, or `none` pure-image mode).
4. **Gallery (`04`) — Paginated Review, Re-Sequencing & Streaming ZIP:**
   - Inline edit Pin Title, Social Caption, Description, Hashtags, and prompts; switch export modes cleanly (`json` / `caption` / `none`); delete shots with automatic disk/SQLite `index_num` re-sequencing; download streamed ZIP archives; or clean watermarks in batch.
5. **Settings (`05`) — Providers, Paths & Tuning:**
   - Launch & manage the isolated **AI Master Browser (`:9222`)**, configure optional Gemini / OpenAI / Pinterest API keys (stored locally in SQLite, never written into `manifest.json` or logs), export root directory, image format (`original` / `png` / `jpg` / `webp`), watermark remover, and dHash thresholds.

---

## 2. Quick Start (For Anyone Cloning from GitHub)

### Prerequisites
- **Python 3.10+**
- **Node.js 18+ & npm** (used to build the React UI and run the lossless watermark-removal JS bridge)
- **Google Chrome** (or Brave / Edge) installed locally if using Browser CDP (`:9222`) mode

### Automated Setup & Launch

**macOS / Linux:**
```bash
git clone <YOUR_GITHUB_REPO_URL>
cd AI_Social
chmod +x setup.sh start.sh
./setup.sh
./start.sh
```

**Windows (PowerShell):**
```powershell
git clone <YOUR_GITHUB_REPO_URL>
cd AI_Social
.\setup.ps1
.\start.bat
```

Then open **http://127.0.0.1:8000** in your browser.

### Manual Setup (Step-by-Step)
```bash
# 1. Create Python virtual environment & install dependencies
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt

# 2. Install frontend packages & build production bundle
npm --prefix frontend ci
npm --prefix frontend run build

# 3. Verify modules & launch the server
./.venv/bin/python scripts/run_module_audit.py --module all
./.venv/bin/python app.py
```

*(Optional)* If Chrome is installed in a non-standard location, set `CHROME_EXECUTABLE_PATH` before running `app.py`.

---

## 3. First-Time Browser CDP Setup (`:9222`)

To generate images without official API keys using your own Gemini, ChatGPT, or Grok web session:
1. Open Studio (`http://127.0.0.1:8000`) -> **Settings** (or use **Create**).
2. Click **Launch AI Master Browser (:9222)**. Studio opens a dedicated Chrome window using a clean local profile inside `browser_profiles/chrome_ai_master` (never touching your personal Chrome profile).
3. Sign into Gemini / ChatGPT / Grok inside that `:9222` window.
4. Keep the window open (can run minimized/in background) and start your image set!

---

## 4. Export Directory Contract

Each image set writes to a timestamped subfolder inside your configured Export Root (default `./exports/`):

```text
exports/
└── 2026-11-19_143000_charcoal-painting/
    ├── 001_charcoal-painting.webp
    ├── 001_charcoal-painting.json   # (or .txt in caption mode)
    ├── 002_charcoal-painting.webp
    ├── 002_charcoal-painting.json
    └── manifest.json                # (or captions.txt in caption mode)
```

---

## 5. Project Architecture

```text
app.py                              # Preflight checks, stale server cleanup & uvicorn launcher (:8000)
server.py                           # FastAPI REST API, SPA static serving & startup recovery
config.py                           # Directory paths, presets, aspect ratios, provider specs & defaults
setup.sh / start.sh                 # macOS & Linux setup + launch helpers
setup.ps1 / start.bat               # Windows setup + launch helpers
requirements.txt                    # Python dependencies
frontend/                           # React 19 + TypeScript + Vite + Tailwind v4 UI
database/
  db_manager.py                     # Thread-safe single-connection WAL SQLite manager
modules/
  app_logging.py                    # Rotating file + console logging
  prompt_planner.py                 # Variation planning (1–1,000), axis toggles, AI suggest & JSON import
  job_runner.py                     # Sequential job runner, similarity retry & end-of-set recovery
  metadata_parser.py                # Stateless prompt builder & JSON/caption parser
  metadata_writer.py                # Multi-tier Title/Caption/Description/Hashtag writer
  export_manager.py                 # Atomic disk writes, sidecars, manifest throttling & disk-backed ZIP
  watermark_remover.py              # Node GWR bridge + NumPy reverse-alpha fallback
  gwr_bridge.mjs                    # Node ESM bridge for lossless watermark removal
  image_providers/                  # Isolated cdp_worker, Chrome CDP engine driver & official API adapters
  reference_sources/                # Local upload, Pinterest discovery & dHash/aHash/luma utilities
vendor/gemini-watermark-remover/    # Vendored MIT runtime (`src/core` & `src/sdk`) for Gemini watermark removal
scripts/
  run_module_audit.py               # Modular offline verification suite
```

---

## 6. Privacy & Git Hygiene

All local user data is excluded from version control via `.gitignore`:
- `browser_profiles/` (Chrome login sessions & cookies)
- `database/*.db*` (local job history & API keys)
- `data/` & `exports/` (uploaded references & generated images)
- `logs/`, `.venv/`, `frontend/node_modules/`, `frontend/dist/`

---

## 7. Verification Suite

Run the offline verification suite anytime after modifying backend modules:

```bash
./.venv/bin/python scripts/run_module_audit.py --module all
```


## Acknowledgements

- Lossless Gemini visible watermark removal uses the core reverse-alpha blending SDK from **[GargantuaX/gemini-watermark-remover](https://github.com/GargantuaX/gemini-watermark-remover)** (MIT License, preserved in `vendor/gemini-watermark-remover/LICENSE`).
