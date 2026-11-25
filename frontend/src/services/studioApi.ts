export type StudioTab = "create" | "plan" | "run" | "gallery" | "settings"

export type ReferenceMode = "prompt_only" | "local_upload" | "pinterest"
export type RunMode = "fixed" | "continuous"
export type MetadataExportMode = "csv" | "none"

const UPPER_ACRONYMS = new Set([
  "ai", "seo", "3d", "2d", "4k", "8k", "hd", "ui", "ux", "tv", "diy", "led", "uv", "rgb", "y2k",
])

export function formatPicassyKeyword(rawText?: string | null): string {
  let s = (rawText || "").trim()
  if (!s) return ""
  s = s.replace(/\.(?:png|jpe?g|webp|gif|avif)$/i, "").trim()
  if (/^\d{3}_[a-zA-Z]/.test(s)) {
    s = s.replace(/^\d{3}_+/, "")
  } else if (/[-_][a-zA-Z].*[-_]\d+$/.test(s) || /^[a-zA-Z][a-zA-Z0-9]*[-_]\d+$/.test(s)) {
    s = s.replace(/[-_]\d+$/, "")
  }
  s = s.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim()
  if (!s) return ""
  return s
    .split(" ")
    .filter(Boolean)
    .map((w) => {
      const low = w.toLowerCase()
      if (UPPER_ACRONYMS.has(low)) return low.toUpperCase()
      if (w.length >= 2 && w === w.toUpperCase()) return w
      if (/^\d+[a-zA-Z]+$/.test(w)) return w.toLowerCase()
      return w.charAt(0).toUpperCase() + w.slice(1)
    })
    .join(" ")
}
export type ExportImageFormat = "original" | "png" | "jpg" | "webp"
export type FilenameStyle = "picassy_slug" | "studio_seq"
export type MetadataProviderType =
  | "auto"
  | "gemini"
  | "openai"
  | "openai_compatible"
  | "browser_cdp"
  | "template"
export type MetadataVisionMode = "thumbnail_512" | "text_only"

export interface CdpSlotStatus {
  slot_id: number
  label: string
  port: number
  profile_name: string
  profile_dir?: string
  enabled: boolean
  connected: boolean
  online: boolean
  windowless?: boolean
  page_count?: number
  browser?: string | null
  endpoint?: string
  open_engines?: string[]
  active_job_id?: number | null
  active_generation_id?: number | null
}

export const EXPORT_IMAGE_FORMAT_OPTIONS: ReadonlyArray<{
  id: ExportImageFormat
  label: string
  shortLabel: string
  badge: string
  description: string
}> = [
  {
    id: "original",
    label: "Original (Gốc)",
    shortLabel: "Original",
    badge: "AUTO",
    description: "Giữ nguyên byte & định dạng gốc từ AI",
  },
  {
    id: "png",
    label: "PNG (.png)",
    shortLabel: "PNG",
    badge: "LOSSLESS",
    description: "Không nén mất dữ liệu, độ nét cao nhất",
  },
  {
    id: "jpg",
    label: "JPEG (.jpg)",
    shortLabel: "JPG",
    badge: "LIGHT",
    description: "File nhẹ, tương thích mọi nền tảng web",
  },
  {
    id: "webp",
    label: "WebP (.webp)",
    shortLabel: "WebP",
    badge: "COMPACT",
    description: "Tối ưu dung lượng nhẹ, giữ chất lượng cao",
  },
]

export type GenerationStatus =
  | "planned"
  | "generating"
  | "metadata_pending"
  | "completed"
  | "failed"
  | "cancelled"

export type JobStatus =
  | "draft"
  | "planned"
  | "running"
  | "paused"
  | "completed"
  | "completed_with_errors"
  | "cancelled"
  | "failed"

export interface ReferenceItem {
  id: number
  source_type: "local_upload" | "pinterest"
  source_ref: string
  title: string
  file_path: string
  filename: string
  mime_type: string
  width: number
  height: number
  file_size: number
  md5: string
  dhash: string
  usage_rights: string
  exists_on_disk: boolean
  created_at: string
}

export interface EnabledFixed {
  subject?: boolean
  style?: boolean
  color_palette?: boolean
  brand_mood?: boolean
}

export interface FixedElements {
  subject?: string
  style?: string
  color_palette?: string
  brand_mood?: string
  enabled_fixed?: EnabledFixed
}

export interface EnabledAxes {
  camera_angles?: boolean
  compositions?: boolean
  lighting?: boolean
  atmospheres?: boolean
  custom_axis?: boolean
}

export interface TurnVariationAxes {
  camera_angle?: string
  composition?: string
  lighting?: string
  atmosphere?: string
  custom_axis?: string
  custom_axis_label?: string
}

export interface JobVariationAxesPool {
  camera_angles?: string[]
  compositions?: string[]
  lighting?: string[]
  atmospheres?: string[]
  custom_axis?: string[]
  custom_axis_label?: string
  enabled_axes?: EnabledAxes
}

export interface GenerationItem {
  id: number
  job_id: number
  index_num: number
  prompt_final: string
  fixed_elements: FixedElements
  variation_axes: TurnVariationAxes
  reference_id: number | null
  reference: ReferenceItem | null
  is_locked: boolean
  is_peak?: boolean
  model: string
  status: GenerationStatus
  title: string
  caption: string
  description: string
  alt_text?: string
  hashtags: string
  image_file: string
  image_path: string
  sidecar_file: string
  caption_file: string
  mime_type: string
  width: number
  height: number
  file_size: number
  md5: string
  dhash: string
  duplicate_warning: string
  error: string
  created_at: string
  updated_at: string
  completed_at: string | null
}

export interface JobCounts {
  total: number
  planned: number
  generating: number
  metadata_pending: number
  completed: number
  failed: number
  cancelled: number
  duplicates: number
}

export interface ImageSetJob {
  id: number
  theme: string
  slug: string
  primary_tag?: string
  category?: string
  filename_style?: FilenameStyle
  preferred_cdp_slot?: number
  active_cdp_slot?: number
  base_prompt: string
  reference_mode: ReferenceMode
  run_mode: RunMode
  target_count: number
  batch_size: number
  session_cap: number
  cycle_references: boolean
  aspect_ratio: string
  metadata_language: string
  metadata_export_mode: MetadataExportMode
  export_image_format?: ExportImageFormat
  caption_prompt: string
  use_ai_caption_prompt: boolean
  optimize_prompt_english: boolean
  model: string
  export_dir: string
  preset_id: string
  fixed_elements: FixedElements
  variation_axes: JobVariationAxesPool
  reference_ids: number[]
  references: ReferenceItem[]
  generations: GenerationItem[]
  counts: JobCounts
  status: JobStatus
  current_step: string
  error: string
  created_at: string
  updated_at: string
  completed_at: string | null
}

export interface ProviderModel {
  id: string
  label: string
  provider: string
  engine: string
  mode: "browser_cdp" | "official_api"
  supports_reference_image: boolean
  max_reference_images_per_turn: number
  supported_aspect_ratios: string[]
  supported_formats: string[]
  max_concurrency: number
  rate_limit_note: string
  cost_estimate: string
  ready: boolean
  tab_open?: boolean
  status_label: string
}

export interface StudioPreset {
  id: string
  label: string
  description: string
  fixed_elements: FixedElements
  variation_axes: JobVariationAxesPool
}

export interface CaptionStylePreset {
  id: string
  label: string
  prompt: string
}

export interface StudioSettings {
  default_model: string
  default_target_count: number
  default_batch_size: number
  default_session_cap: number
  default_aspect_ratio: string
  default_metadata_language: string
  default_metadata_export_mode?: MetadataExportMode
  default_filename_style?: FilenameStyle
  default_caption_prompt?: string
  use_ai_caption_prompt?: boolean
  metadata_provider?: MetadataProviderType
  metadata_model?: string
  metadata_api_base_url?: string
  metadata_api_key?: string
  metadata_api_key_configured?: boolean
  metadata_vision_mode?: MetadataVisionMode
  picassy_categories?: string[]
  cdp_slots?: Array<Pick<CdpSlotStatus, "slot_id" | "port" | "label" | "enabled"> & Partial<CdpSlotStatus>>
  optimize_prompt_english: boolean
  remove_watermark?: boolean
  fresh_chat_per_turn?: boolean
  max_turn_retries?: number
  cdp_recycle_tab_interval?: number
  reference_similarity_check?: boolean
  drop_ref_on_similarity_retry?: boolean
  export_root_dir: string
  export_image_format: ExportImageFormat
  max_concurrency: number
  dhash_warning_threshold: number
  gemini_api_key: string
  gemini_api_key_configured?: boolean
  openai_api_key: string
  openai_api_key_configured?: boolean
  pinterest_access_token: string
  pinterest_access_token_configured?: boolean
}

export interface CdpStatus {
  slot_id?: number
  port?: number
  connected: boolean
  online: boolean
  browser: string | null
  endpoint: string
  open_engines: string[]
}

export interface SystemStatusResponse {
  ok: boolean
  cdp: CdpStatus
  cdp_slots?: CdpSlotStatus[]
  providers: ProviderModel[]
  presets: StudioPreset[]
  caption_style_presets?: CaptionStylePreset[]
  default_caption_prompt?: string
  aspect_ratios: string[]
  metadata_languages: string[]
  metadata_export_modes?: MetadataExportMode[]
  export_image_formats?: ExportImageFormat[]
  filename_styles?: FilenameStyle[]
  metadata_providers?: MetadataProviderType[]
  metadata_vision_modes?: MetadataVisionMode[]
  picassy_categories?: string[]
  settings: StudioSettings
  summary: {
    total_jobs: number
    running_jobs: number
    completed_images: number
  }
}

export interface ActivityLog {
  id: number
  job_id: number | null
  generation_id: number | null
  level: string
  stage: string
  message: string
  created_at: string
}

export interface CreateJobPayload {
  theme: string
  base_prompt?: string
  primary_tag?: string
  category?: string
  filename_style?: FilenameStyle
  preferred_cdp_slot?: number
  reference_mode: ReferenceMode
  run_mode: RunMode
  target_count: number
  batch_size: number
  session_cap: number
  cycle_references: boolean
  aspect_ratio: string
  metadata_language: string
  metadata_export_mode?: MetadataExportMode
  export_image_format?: ExportImageFormat
  caption_prompt?: string
  use_ai_caption_prompt?: boolean
  optimize_prompt_english: boolean
  model: string
  export_root_dir?: string
  preset_id?: string
  fixed_elements?: FixedElements
  variation_axes?: JobVariationAxesPool
  reference_ids?: number[]
  auto_start?: boolean
}

async function apiJson<T>(
  url: string,
  init?: RequestInit,
  timeoutMs = 20000
): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
      ...init,
      signal: init?.signal || controller.signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s.`)
    }
    throw err
  } finally {
    window.clearTimeout(timer)
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const data = await res.json()
      detail = data.detail || data.message || detail
    } catch {
      // ignore
    }
    throw new Error(detail)
  }
  return res.json()
}

export async function fetchSystemStatus(): Promise<SystemStatusResponse> {
  return apiJson<SystemStatusResponse>("/api/system/status")
}

export async function fetchJobs(includeGenerations = false): Promise<ImageSetJob[]> {
  const data = await apiJson<{ jobs: ImageSetJob[] }>(
    `/api/jobs?include_generations=${includeGenerations ? "true" : "false"}`
  )
  return data.jobs || []
}

export async function fetchJob(jobId: number): Promise<ImageSetJob> {
  const data = await apiJson<{ job: ImageSetJob }>(`/api/jobs/${jobId}`)
  return data.job
}

export async function createJob(payload: CreateJobPayload): Promise<ImageSetJob> {
  const data = await apiJson<{ job: ImageSetJob }>("/api/jobs", {
    method: "POST",
    body: JSON.stringify(payload),
  })
  return data.job
}

export async function updateJob(
  jobId: number,
  updates: Partial<CreateJobPayload>
): Promise<ImageSetJob> {
  const data = await apiJson<{ job: ImageSetJob }>(`/api/jobs/${jobId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  })
  return data.job
}

export async function regenerateAllJobMetadata(
  jobId: number,
  useBrowserTurn = false
): Promise<ImageSetJob> {
  const data = await apiJson<{ job: ImageSetJob }>(
    `/api/jobs/${jobId}/metadata/regenerate`,
    {
      method: "POST",
      body: JSON.stringify({ use_browser_turn: useBrowserTurn }),
    }
  )
  return data.job
}

export async function removeJobWatermarks(jobId: number): Promise<{
  job: ImageSetJob
  cleaned_count: number
  skipped_count: number
}> {
  return apiJson<{
    job: ImageSetJob
    cleaned_count: number
    skipped_count: number
  }>(`/api/jobs/${jobId}/remove-watermarks`, {
    method: "POST",
  })
}

export async function replanJob(jobId: number): Promise<ImageSetJob> {
  const data = await apiJson<{ job: ImageSetJob }>(`/api/jobs/${jobId}/replan`, {
    method: "POST",
  })
  return data.job
}

export async function addGenerationTurn(
  jobId: number,
  payload: {
    prompt_final?: string
    reference_id?: number | null
    variation_axes?: TurnVariationAxes
  }
): Promise<ImageSetJob> {
  const data = await apiJson<{ job: ImageSetJob }>(
    `/api/jobs/${jobId}/generations`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  )
  return data.job
}

export async function deleteJob(
  jobId: number,
  deleteFiles = false
): Promise<void> {
  await apiJson(`/api/jobs/${jobId}?delete_files=${deleteFiles}`, {
    method: "DELETE",
  })
}

export async function startJob(jobId: number): Promise<ImageSetJob> {
  const data = await apiJson<{ job: ImageSetJob }>(`/api/jobs/${jobId}/start`, {
    method: "POST",
  })
  return data.job
}

export async function pauseJob(jobId: number): Promise<ImageSetJob> {
  const data = await apiJson<{ job: ImageSetJob }>(`/api/jobs/${jobId}/pause`, {
    method: "POST",
  })
  return data.job
}

export async function resumeJob(jobId: number): Promise<ImageSetJob> {
  const data = await apiJson<{ job: ImageSetJob }>(`/api/jobs/${jobId}/resume`, {
    method: "POST",
  })
  return data.job
}

export async function cancelJob(jobId: number): Promise<ImageSetJob> {
  const data = await apiJson<{ job: ImageSetJob }>(`/api/jobs/${jobId}/cancel`, {
    method: "POST",
  })
  return data.job
}

export async function retryFailedTurns(jobId: number): Promise<ImageSetJob> {
  const data = await apiJson<{ job: ImageSetJob }>(
    `/api/jobs/${jobId}/retry-failed`,
    {
      method: "POST",
    }
  )
  return data.job
}

export async function updateGeneration(
  genId: number,
  updates: {
    prompt_final?: string
    reference_id?: number | null
    clear_reference?: boolean
    is_locked?: boolean
    is_peak?: boolean
    title?: string
    caption?: string
    description?: string
    alt_text?: string
    hashtags?: string
    variation_axes?: TurnVariationAxes
    fixed_elements?: FixedElements
  }
): Promise<{ generation: GenerationItem; job: ImageSetJob }> {
  return apiJson<{ generation: GenerationItem; job: ImageSetJob }>(
    `/api/generations/${genId}`,
    {
      method: "PATCH",
      body: JSON.stringify(updates),
    }
  )
}

export async function deleteGeneration(genId: number): Promise<ImageSetJob> {
  const data = await apiJson<{ job: ImageSetJob }>(`/api/generations/${genId}`, {
    method: "DELETE",
  })
  return data.job
}

export async function skipGeneration(
  genId: number
): Promise<{ generation: GenerationItem; job: ImageSetJob }> {
  return apiJson<{ generation: GenerationItem; job: ImageSetJob }>(
    `/api/generations/${genId}/skip`,
    {
      method: "POST",
    }
  )
}

export async function retryGeneration(
  genId: number,
  mutateAxes = false
): Promise<{ generation: GenerationItem; job: ImageSetJob }> {
  return apiJson<{ generation: GenerationItem; job: ImageSetJob }>(
    `/api/generations/${genId}/retry`,
    {
      method: "POST",
      body: JSON.stringify({ mutate_axes: mutateAxes }),
    }
  )
}

export async function retryGenerationMetadata(
  genId: number,
  useBrowserTurn = false
): Promise<{ generation: GenerationItem; job: ImageSetJob }> {
  return apiJson<{ generation: GenerationItem; job: ImageSetJob }>(
    `/api/generations/${genId}/metadata/retry`,
    {
      method: "POST",
      body: JSON.stringify({ use_browser_turn: useBrowserTurn }),
    }
  )
}

export async function fetchReferences(
  sourceType?: "local_upload" | "pinterest"
): Promise<ReferenceItem[]> {
  const q = sourceType ? `?source_type=${sourceType}` : ""
  const data = await apiJson<{ references: ReferenceItem[] }>(`/api/references${q}`)
  return data.references || []
}

export async function uploadReferenceFiles(
  files: File[]
): Promise<ReferenceItem[]> {
  const form = new FormData()
  for (const f of files) {
    form.append("files", f)
  }
  const res = await fetch("/api/references/upload", {
    method: "POST",
    body: form,
  })
  if (!res.ok) {
    let detail = `Upload failed (${res.status})`
    try {
      const err = await res.json()
      detail = err.detail || detail
    } catch {
      // ignore
    }
    throw new Error(detail)
  }
  const data = await res.json()
  return data.references || []
}

export async function discoverPinterestReferences(
  queryOrUrl: string,
  limit = 6
): Promise<{
  input_info: { kind: string; label: string; url: string }
  api_token_configured: boolean
  count: number
  references: ReferenceItem[]
}> {
  return apiJson("/api/references/pinterest/discover", {
    method: "POST",
    body: JSON.stringify({ query_or_url: queryOrUrl, limit }),
  })
}

export async function updateReference(
  refId: number,
  title: string
): Promise<ReferenceItem> {
  const data = await apiJson<{ reference: ReferenceItem }>(
    `/api/references/${refId}`,
    {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }
  )
  return data.reference
}

export async function deleteReference(refId: number): Promise<void> {
  await apiJson(`/api/references/${refId}`, { method: "DELETE" })
}

export async function openExportFolder(
  jobId: number
): Promise<{ opened: boolean; export_dir: string }> {
  return apiJson(`/api/jobs/${jobId}/open-folder`, { method: "POST" })
}

export async function pickExportFolder(
  jobId?: number,
  saveAsDefault = true
): Promise<{
  cancelled: boolean
  path: string | null
  settings?: StudioSettings
  job?: ImageSetJob | null
}> {
  return apiJson(
    "/api/system/pick-folder",
    {
      method: "POST",
      body: JSON.stringify({ job_id: jobId, save_as_default: saveAsDefault }),
    },
    95000
  )
}

export async function changeJobExportFolder(
  jobId: number,
  exportRootDir: string,
  saveAsDefault = true
): Promise<{ job: ImageSetJob; settings: StudioSettings }> {
  return apiJson(`/api/jobs/${jobId}/change-folder`, {
    method: "POST",
    body: JSON.stringify({
      export_root_dir: exportRootDir,
      save_as_default: saveAsDefault,
    }),
  })
}

export async function launchCdpBrowser(
  engine = "gemini",
  forceRestart = false,
  slotId = 1
): Promise<{
  launched: boolean
  slot_id?: number
  port?: number
  message: string
  status: CdpStatus
}> {
  return apiJson(
    "/api/providers/cdp/launch",
    {
      method: "POST",
      body: JSON.stringify({
        engine,
        force_restart: forceRestart,
        slot_id: slotId,
      }),
    },
    30000
  )
}

export async function updateStudioSettings(
  updates: Partial<StudioSettings>
): Promise<StudioSettings> {
  const data = await apiJson<{ settings: StudioSettings }>("/api/settings", {
    method: "PUT",
    body: JSON.stringify(updates),
  })
  return data.settings
}

export async function fetchActivityLogs(jobId?: number): Promise<ActivityLog[]> {
  const q = jobId ? `?job_id=${jobId}&limit=120` : "?limit=120"
  const data = await apiJson<{ logs: ActivityLog[] }>(`/api/logs${q}`)
  return data.logs || []
}

export async function resetWorkspace(options: {
  clear_references: boolean
  delete_exports: boolean
}): Promise<void> {
  await apiJson("/api/workspace/reset", {
    method: "POST",
    body: JSON.stringify(options),
  })
}

export function getGenerationImageUrl(
  genId: number,
  updatedAt?: string,
  download = false
): string {
  const params = new URLSearchParams()
  if (download) params.set("download", "true")
  if (updatedAt) params.set("v", updatedAt)
  const qs = params.toString()
  return `/api/generations/${genId}/image${qs ? `?${qs}` : ""}`
}

export function getReferenceImageUrl(refId: number): string {
  return `/api/references/${refId}/image`
}

export function getJobZipUrl(jobId: number): string {
  return `/api/jobs/${jobId}/zip`
}

export function getJobCsvUrl(jobId: number): string {
  return `/api/jobs/${jobId}/csv`
}

export interface SuggestAxesPayload {
  theme: string
  base_prompt?: string
  model?: string
  reference_ids?: number[]
  use_browser_turn?: boolean
}

export interface SuggestAxesResponse {
  fixed_elements: FixedElements
  variation_axes: JobVariationAxesPool
  source: "gemini_api" | "openai_api" | "browser_cdp" | "smart_synthesizer" | "external_import"
  source_label: string
  theme?: string
  base_prompt?: string
  aspect_ratio?: string
  active_counts?: Record<string, number>
}

export async function suggestVariationAxes(
  payload: SuggestAxesPayload
): Promise<SuggestAxesResponse> {
  return apiJson<SuggestAxesResponse>(
    "/api/axes/suggest",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    60000
  )
}

export async function fetchSampleMasterPrompt(payload: {
  theme?: string
  base_prompt?: string
  template_kind?: string
  target_count?: number
  metadata_language?: string
}): Promise<{ prompt: string }> {
  return apiJson<{ prompt: string }>("/api/axes/sample-prompt", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export async function importExternalAxes(
  rawText: string
): Promise<SuggestAxesResponse> {
  return apiJson<SuggestAxesResponse>("/api/axes/import", {
    method: "POST",
    body: JSON.stringify({ raw_text: rawText }),
  })
}

