import * as React from "react"
import {
  TerminalWindow,
  FloppyDisk,
  FolderOpen,
  Key,
  Trash,
  ShieldCheck,
  ArrowsClockwise,
  Plus,
  X,
} from "@phosphor-icons/react"
import { StudioPanel, StudioButton, StudioBadge } from "@/components/shared/StudioPrimitives"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import type {
  CdpSlotStatus,
  CdpStatus,
  FilenameStyle,
  MetadataProviderType,
  MetadataVisionMode,
  ProviderModel,
  StudioSettings,
} from "@/services/studioApi"

type CdpSlotConfig = {
  slot_id: number
  port: number
  label: string
  enabled: boolean
}

const DEFAULT_PICASSY_CATEGORIES = [
  "AI Prompts",
  "Anime",
  "Art",
  "Fashions",
  "Nail",
  "Photography Topics",
  "Posters & Visuals",
  "Tattoos",
  "Wallpaper",
]

const DEFAULT_SLOTS: CdpSlotConfig[] = [
  { slot_id: 1, port: 9222, label: "Slot 1 (Master)", enabled: true },
  { slot_id: 2, port: 9223, label: "Slot 2", enabled: false },
  { slot_id: 3, port: 9224, label: "Slot 3", enabled: false },
  { slot_id: 4, port: 9225, label: "Slot 4", enabled: false },
]

export interface SettingsPanelProps {
  settings: StudioSettings | null
  providers: ProviderModel[]
  cdp: CdpStatus | null
  cdpSlots?: CdpSlotStatus[]
  picassyCategories?: string[]
  aspectRatios: string[]
  metadataLanguages: string[]
  onSaveSettings: (updates: Partial<StudioSettings>) => Promise<void>
  onPickExportFolder: () => Promise<string | null>
  onLaunchCdp: (engine?: string, forceRestart?: boolean, slotId?: number) => Promise<void>
  onResetWorkspace: (opts: {
    clear_references: boolean
    delete_exports: boolean
  }) => Promise<void>
}

export function SettingsPanel({
  settings,
  providers,
  cdp,
  cdpSlots = [],
  picassyCategories = DEFAULT_PICASSY_CATEGORIES,
  aspectRatios,
  metadataLanguages,
  onSaveSettings,
  onPickExportFolder,
  onLaunchCdp,
  onResetWorkspace,
}: SettingsPanelProps) {
  const [form, setForm] = React.useState<StudioSettings>({
    default_model: settings?.default_model || "chrome-cdp/gemini",
    default_target_count: settings?.default_target_count || 6,
    default_batch_size: settings?.default_batch_size || 4,
    default_session_cap: settings?.default_session_cap || 20,
    default_aspect_ratio: settings?.default_aspect_ratio || "1:1",
    default_metadata_language: settings?.default_metadata_language || "English",
    default_metadata_export_mode:
      settings?.default_metadata_export_mode || "csv",
    default_filename_style: settings?.default_filename_style || "picassy_slug",
    default_caption_prompt: settings?.default_caption_prompt || "",
    use_ai_caption_prompt: settings?.use_ai_caption_prompt ?? true,
    metadata_provider: settings?.metadata_provider || "auto",
    metadata_model: settings?.metadata_model || "gemini-2.0-flash",
    metadata_api_base_url: settings?.metadata_api_base_url || "",
    metadata_api_key: settings?.metadata_api_key || "",
    metadata_vision_mode: settings?.metadata_vision_mode || "thumbnail_512",
    picassy_categories:
      settings?.picassy_categories ||
      picassyCategories ||
      DEFAULT_PICASSY_CATEGORIES,
    cdp_slots: settings?.cdp_slots || DEFAULT_SLOTS,
    optimize_prompt_english: settings?.optimize_prompt_english ?? true,
    remove_watermark: settings?.remove_watermark ?? true,
    fresh_chat_per_turn: settings?.fresh_chat_per_turn ?? true,
    max_turn_retries: settings?.max_turn_retries ?? 2,
    reference_similarity_check: settings?.reference_similarity_check ?? true,
    drop_ref_on_similarity_retry: settings?.drop_ref_on_similarity_retry ?? true,
    export_root_dir: settings?.export_root_dir || "",
    export_image_format: settings?.export_image_format || "original",
    max_concurrency: settings?.max_concurrency || 1,
    dhash_warning_threshold: settings?.dhash_warning_threshold || 6,
    gemini_api_key: settings?.gemini_api_key || "",
    openai_api_key: settings?.openai_api_key || "",
    pinterest_access_token: settings?.pinterest_access_token || "",
  })

  const [saving, setSaving] = React.useState(false)
  const [launchingSlotId, setLaunchingSlotId] = React.useState<number | null>(null)
  const [newCategoryInput, setNewCategoryInput] = React.useState("")
  const [clearRefs, setClearRefs] = React.useState(false)
  const [deleteExports, setDeleteExports] = React.useState(false)
  const [resetting, setResetting] = React.useState(false)

  React.useEffect(() => {
    if (settings) {
      setForm((prev) => ({
        ...prev,
        ...settings,
        cdp_slots: settings.cdp_slots || prev.cdp_slots || DEFAULT_SLOTS,
        picassy_categories:
          settings.picassy_categories ||
          prev.picassy_categories ||
          DEFAULT_PICASSY_CATEGORIES,
      }))
    }
  }, [settings])

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSaveSettings(form)
    } finally {
      setSaving(false)
    }
  }

  const handleLaunchSlot = async (
    slotId = 1,
    forceRestart = false,
    engine = "gemini"
  ) => {
    setLaunchingSlotId(slotId)
    try {
      await onLaunchCdp(engine, forceRestart, slotId)
    } finally {
      setLaunchingSlotId(null)
    }
  }

  const handleToggleSlotEnabled = async (slotId: number, checked: boolean) => {
    const nextSlots = (form.cdp_slots || DEFAULT_SLOTS).map((item) =>
      item.slot_id === slotId ? { ...item, enabled: checked } : item
    )
    setForm((f) => ({ ...f, cdp_slots: nextSlots }))
    setLaunchingSlotId(slotId)
    try {
      await onSaveSettings({ cdp_slots: nextSlots })
    } finally {
      setLaunchingSlotId(null)
    }
  }

  const handleAddCategory = () => {
    const cleaned = newCategoryInput.trim()
    if (!cleaned) return
    const existing = form.picassy_categories || DEFAULT_PICASSY_CATEGORIES
    if (existing.some((c) => c.toLowerCase() === cleaned.toLowerCase())) {
      setNewCategoryInput("")
      return
    }
    setForm((f) => ({ ...f, picassy_categories: [...existing, cleaned] }))
    setNewCategoryInput("")
  }

  const handleRemoveCategory = (cat: string) => {
    const existing = form.picassy_categories || DEFAULT_PICASSY_CATEGORIES
    if (existing.length <= 1) return
    setForm((f) => ({
      ...f,
      picassy_categories: existing.filter((c) => c !== cat),
    }))
  }

  const handleReset = async () => {
    setResetting(true)
    try {
      await onResetWorkspace({
        clear_references: clearRefs,
        delete_exports: deleteExports,
      })
    } finally {
      setResetting(false)
    }
  }

  const isCdpOnline = Boolean(cdp?.connected || cdp?.online)

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#2E2E2E] pb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-[#F5F5F5]">
            Settings
          </h1>
          <p className="mt-0.5 max-w-2xl text-xs sm:text-sm text-[#A3A3A3]">
            Manage Chrome CDP browser slots, Picassy categories, SEO metadata routing, and generation safety limits.
          </p>
        </div>

        <StudioButton
          variant="primary"
          loading={saving}
          onClick={handleSave}
          icon={<FloppyDisk size={15} />}
        >
          {saving ? "Saving…" : "Save settings"}
        </StudioButton>
      </div>

      {/* 2-Column Settings Sheet */}
      <StudioPanel noPadding>
        <div className="divide-y divide-[#2E2E2E]">
          {/* SECTION 1: Chrome CDP Multi-Slot Pool */}
          <div className="grid grid-cols-1 gap-6 p-5 sm:p-6 lg:grid-cols-12">
            <div className="lg:col-span-4 space-y-1.5">
              <h2 className="text-sm font-semibold text-[#F5F5F5]">
                Chrome CDP 4-slot pool
              </h2>
              <p className="text-xs leading-relaxed text-[#A3A3A3]">
                Run up to 4 isolated Chrome profiles (:9222–:9225) in parallel. Each running set locks to a single slot so one paused session never blocks the others.
              </p>
            </div>

            <div className="lg:col-span-8 flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {(form.cdp_slots || DEFAULT_SLOTS).map((slotCfg) => {
                  const live = cdpSlots.find((s) => s.slot_id === slotCfg.slot_id)
                  const online = Boolean(
                    live?.connected || (slotCfg.slot_id === 1 && isCdpOnline)
                  )
                  const isBusy = launchingSlotId === slotCfg.slot_id
                  return (
                    <div
                      key={slotCfg.slot_id}
                      className="flex flex-col gap-2.5 rounded-md border border-[#2E2E2E] bg-[#171717] p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="font-mono-tech text-xs font-semibold text-[#D4D4D4]">
                            :{slotCfg.port}
                          </span>
                          <input
                            type="text"
                            value={slotCfg.label}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                cdp_slots: (f.cdp_slots || DEFAULT_SLOTS).map(
                                  (item) =>
                                    item.slot_id === slotCfg.slot_id
                                      ? { ...item, label: e.target.value }
                                      : item
                                ),
                              }))
                            }
                            className="h-7 min-w-0 flex-1 rounded border border-[#2E2E2E] bg-[#262626] px-2 text-xs text-[#F5F5F5] outline-none focus:border-[#A3A3A3]"
                          />
                        </div>
                        <Switch
                          checked={slotCfg.enabled}
                          disabled={isBusy}
                          onCheckedChange={(checked) =>
                            handleToggleSlotEnabled(slotCfg.slot_id, checked)
                          }
                        />
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <StudioBadge
                          tone={
                            live?.active_job_id || (slotCfg.enabled && online)
                              ? "emerald"
                              : "neutral"
                          }
                          label={
                            live?.active_job_id
                              ? `Set #${live.active_job_id}`
                              : !slotCfg.enabled
                                ? online
                                  ? "Paused"
                                  : "Off"
                                : online
                                  ? "Online"
                                  : "Standby"
                          }
                        />
                        <div className="flex items-center gap-1.5">
                          <StudioButton
                            variant="secondary"
                            loading={isBusy}
                            onClick={() => handleLaunchSlot(slotCfg.slot_id, false)}
                            icon={<TerminalWindow size={12} />}
                            className="h-7 px-2.5 text-[11px]"
                          >
                            {online
                              ? slotCfg.enabled
                                ? "Focus"
                                : "Enable"
                              : "Launch"}
                          </StudioButton>
                          {online && (
                            <StudioButton
                              variant="secondary"
                              loading={isBusy}
                              onClick={() => handleLaunchSlot(slotCfg.slot_id, true)}
                              icon={<ArrowsClockwise size={12} />}
                              className="h-7 px-2 text-[11px]"
                              title={`Restart Chrome slot #${slotCfg.slot_id} (:${slotCfg.port})`}
                            >
                              Restart
                            </StudioButton>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-[#A3A3A3]">
                    Default generation model
                  </label>
                  <Select
                    value={form.default_model}
                    onValueChange={(v) =>
                      v && setForm((f) => ({ ...f, default_model: v }))
                    }
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {providers.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-[#A3A3A3]">
                    Default metadata language
                  </label>
                  <Select
                    value={form.default_metadata_language}
                    onValueChange={(v) =>
                      v && setForm((f) => ({ ...f, default_metadata_language: v }))
                    }
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {metadataLanguages.map((lang) => (
                        <SelectItem key={lang} value={lang}>
                          {lang}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 2: Picassy Categories & Export Defaults */}
          <div className="grid grid-cols-1 gap-6 p-5 sm:p-6 lg:grid-cols-12">
            <div className="lg:col-span-4 space-y-1.5">
              <h2 className="text-sm font-semibold text-[#F5F5F5]">
                Picassy categories &amp; export defaults
              </h2>
              <p className="text-xs leading-relaxed text-[#A3A3A3]">
                Set your default save folder, image file format, filename convention, and the list of Picassy categories available when creating sets.
              </p>
            </div>

            <div className="lg:col-span-8 flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[#A3A3A3]">
                  Default export root folder
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={form.export_root_dir}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, export_root_dir: e.target.value }))
                    }
                    className="h-9 flex-1 rounded-md border border-[#2E2E2E] bg-[#262626] px-3 font-mono-tech text-xs text-[#F5F5F5] outline-none focus:border-[#A3A3A3]"
                  />
                  <StudioButton
                    variant="secondary"
                    onClick={async () => {
                      const chosen = await onPickExportFolder()
                      if (chosen) {
                        setForm((f) => ({ ...f, export_root_dir: chosen }))
                      }
                    }}
                    icon={<FolderOpen size={14} />}
                  >
                    Browse…
                  </StudioButton>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-[#A3A3A3]">
                    Default image format
                  </label>
                  <Select
                    value={form.export_image_format}
                    onValueChange={(v) =>
                      v &&
                      setForm((f) => ({
                        ...f,
                        export_image_format:
                          v as StudioSettings["export_image_format"],
                      }))
                    }
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="original">
                        Original (preserve provenance)
                      </SelectItem>
                      <SelectItem value="png">PNG (.png)</SelectItem>
                      <SelectItem value="jpg">JPEG (.jpg)</SelectItem>
                      <SelectItem value="webp">WebP (.webp)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-[#A3A3A3]">
                    Default aspect ratio
                  </label>
                  <Select
                    value={form.default_aspect_ratio}
                    onValueChange={(v) =>
                      v && setForm((f) => ({ ...f, default_aspect_ratio: v }))
                    }
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {aspectRatios.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-[#A3A3A3]">
                    Default post-image export mode
                  </label>
                  <Select
                    value={form.default_metadata_export_mode || "csv"}
                    onValueChange={(v) =>
                      v &&
                      setForm((f) => ({
                        ...f,
                        default_metadata_export_mode:
                          v as StudioSettings["default_metadata_export_mode"],
                      }))
                    }
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="csv">Picassy CSV (pin-import.csv)</SelectItem>
                      <SelectItem value="none">Images only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-[#A3A3A3]">
                    Default filename style
                  </label>
                  <Select
                    value={form.default_filename_style || "picassy_slug"}
                    onValueChange={(v) =>
                      v &&
                      setForm((f) => ({
                        ...f,
                        default_filename_style: v as FilenameStyle,
                      }))
                    }
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="picassy_slug">
                        Picassy (keyword-1, 2…)
                      </SelectItem>
                      <SelectItem value="studio_seq">Legacy (001_slug)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-[#A3A3A3]">
                    Default set size
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={form.default_target_count}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        default_target_count: Math.max(
                          1,
                          Math.min(1000, Number(e.target.value) || 6)
                        ),
                      }))
                    }
                    className="h-9 rounded-md border border-[#2E2E2E] bg-[#262626] px-3 text-center font-mono-tech text-xs text-[#F5F5F5]"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-[#A3A3A3]">
                    Wave batch
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={form.default_batch_size}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        default_batch_size: Math.max(
                          1,
                          Math.min(50, Number(e.target.value) || 4)
                        ),
                      }))
                    }
                    className="h-9 rounded-md border border-[#2E2E2E] bg-[#262626] px-3 text-center font-mono-tech text-xs text-[#F5F5F5]"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-[#A3A3A3]">
                    Session cap
                  </label>
                  <input
                    type="number"
                    min={2}
                    max={1000}
                    value={form.default_session_cap}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        default_session_cap: Math.max(
                          2,
                          Math.min(1000, Number(e.target.value) || 20)
                        ),
                      }))
                    }
                    className="h-9 rounded-md border border-[#2E2E2E] bg-[#262626] px-3 text-center font-mono-tech text-xs text-[#F5F5F5]"
                  />
                </div>
              </div>

              {/* Picassy Categories Manager */}
              <div className="rounded-md border border-[#2E2E2E] bg-[#171717] p-3.5 flex flex-col gap-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#F5F5F5]">
                    Picassy categories (
                    {(form.picassy_categories || DEFAULT_PICASSY_CATEGORIES).length})
                  </span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={newCategoryInput}
                      onChange={(e) => setNewCategoryInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          handleAddCategory()
                        }
                      }}
                      placeholder="New category…"
                      className="h-7 w-40 rounded border border-[#2E2E2E] bg-[#262626] px-2.5 text-xs text-[#F5F5F5] outline-none focus:border-[#A3A3A3]"
                    />
                    <button
                      type="button"
                      onClick={handleAddCategory}
                      className="inline-flex h-7 items-center gap-1 rounded bg-[#FAFAFA] px-2.5 text-xs font-semibold text-[#121212] hover:bg-[#E5E5E5] cursor-pointer"
                    >
                      <Plus size={12} /> Add
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(form.picassy_categories || DEFAULT_PICASSY_CATEGORIES).map(
                    (cat) => (
                      <span
                        key={cat}
                        className="inline-flex items-center gap-1 rounded border border-[#2E2E2E] bg-[#262626] px-2.5 py-1 text-xs text-[#F5F5F5]"
                      >
                        {cat}
                        <button
                          type="button"
                          onClick={() => handleRemoveCategory(cat)}
                          title={`Remove ${cat}`}
                          className="rounded p-0.5 text-[#A3A3A3] hover:bg-[#EF4444]/15 hover:text-[#FCA5A5] cursor-pointer"
                        >
                          <X size={10} />
                        </button>
                      </span>
                    )
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 3: Metadata AI Router & API Keys */}
          <div className="grid grid-cols-1 gap-6 p-5 sm:p-6 lg:grid-cols-12">
            <div className="lg:col-span-4 space-y-1.5">
              <h2 className="text-sm font-semibold text-[#F5F5F5]">
                Metadata AI router &amp; API keys
              </h2>
              <p className="text-xs leading-relaxed text-[#A3A3A3]">
                Offload post-image SEO writing (Option 1A) to a lightweight Vision/Text model or grammatical engine so Chrome CDP saves 100% of its quota for image rendering. Keys stay in local SQLite only.
              </p>
            </div>

            <div className="lg:col-span-8 flex flex-col gap-4">
              <div className="flex items-center justify-between rounded-md border border-[#2E2E2E] bg-[#171717] px-3.5 py-2.5">
                <div>
                  <p className="text-xs font-semibold text-[#F5F5F5]">
                    Enable AI Picassy metadata after each image
                  </p>
                  <p className="text-[11px] text-[#737373]">
                    Generates Title (&le;60), sentence-case Description (&le;160), and Alt text (100–125)
                  </p>
                </div>
                <Switch
                  checked={form.use_ai_caption_prompt ?? true}
                  onCheckedChange={(checked) =>
                    setForm((f) => ({ ...f, use_ai_caption_prompt: checked }))
                  }
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-[#A3A3A3]">
                    Metadata router
                  </label>
                  <Select
                    value={form.metadata_provider || "auto"}
                    onValueChange={(v) =>
                      v &&
                      setForm((f) => ({
                        ...f,
                        metadata_provider: v as MetadataProviderType,
                      }))
                    }
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto (API key → template)</SelectItem>
                      <SelectItem value="gemini">Google Gemini REST</SelectItem>
                      <SelectItem value="openai">OpenAI mini REST</SelectItem>
                      <SelectItem value="openai_compatible">
                        OpenAI-compatible (Ollama/OpenRouter)
                      </SelectItem>
                      <SelectItem value="template">
                        Instant grammatical (0 tokens)
                      </SelectItem>
                      <SelectItem value="browser_cdp">
                        Browser CDP turn #2
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-[#A3A3A3]">
                    Small model ID
                  </label>
                  <input
                    type="text"
                    value={form.metadata_model || ""}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, metadata_model: e.target.value }))
                    }
                    placeholder="gemini-2.0-flash / gpt-4o-mini"
                    className="h-9 rounded-md border border-[#2E2E2E] bg-[#262626] px-3 font-mono-tech text-xs text-[#F5F5F5]"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-[#A3A3A3]">
                    Vision payload
                  </label>
                  <Select
                    value={form.metadata_vision_mode || "thumbnail_512"}
                    onValueChange={(v) =>
                      v &&
                      setForm((f) => ({
                        ...f,
                        metadata_vision_mode: v as MetadataVisionMode,
                      }))
                    }
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="thumbnail_512">
                        512px JPEG thumbnail (~35KB)
                      </SelectItem>
                      <SelectItem value="text_only">
                        Text prompt only (0 image tokens)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-[#A3A3A3]">
                    OpenAI-compatible base URL (optional)
                  </label>
                  <input
                    type="text"
                    value={form.metadata_api_base_url || ""}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        metadata_api_base_url: e.target.value,
                      }))
                    }
                    placeholder="https://openrouter.ai/api/v1"
                    className="h-9 rounded-md border border-[#2E2E2E] bg-[#262626] px-3 font-mono-tech text-xs text-[#F5F5F5]"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-[#A3A3A3]">
                    Metadata API key pool (optional, 1 per line)
                  </label>
                  <textarea
                    rows={2}
                    value={form.metadata_api_key || ""}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, metadata_api_key: e.target.value }))
                    }
                    placeholder="Leave blank to reuse Gemini/OpenAI keys below, or paste multiple keys for rotation…"
                    className="rounded-md border border-[#2E2E2E] bg-[#262626] p-2 font-mono-tech text-[11px] text-[#F5F5F5]"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[#A3A3A3]">
                  Default SEO caption prompt
                </label>
                <textarea
                  rows={2}
                  value={form.default_caption_prompt || ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      default_caption_prompt: e.target.value,
                    }))
                  }
                  className="w-full rounded-md border border-[#2E2E2E] bg-[#262626] p-2.5 text-xs text-[#F5F5F5]"
                />
              </div>

              <div className="rounded-md border border-[#2E2E2E] bg-[#171717] p-3.5 flex flex-col gap-3">
                <div className="flex items-center gap-2 text-xs text-[#A3A3A3]">
                  <ShieldCheck size={15} weight="fill" />
                  <span>
                    Stored locally in SQLite — never written to manifest.json, CSV, or logs.
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="flex flex-col gap-1">
                    <label className="flex items-center gap-1 text-xs font-medium text-[#A3A3A3]">
                      <Key size={12} /> Gemini / Imagen key
                    </label>
                    <input
                      type="password"
                      value={form.gemini_api_key}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, gemini_api_key: e.target.value }))
                      }
                      placeholder="AIzaSy…"
                      className="h-9 rounded-md border border-[#2E2E2E] bg-[#262626] px-3 font-mono-tech text-xs text-[#F5F5F5]"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="flex items-center gap-1 text-xs font-medium text-[#A3A3A3]">
                      <Key size={12} /> OpenAI key
                    </label>
                    <input
                      type="password"
                      value={form.openai_api_key}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, openai_api_key: e.target.value }))
                      }
                      placeholder="sk-…"
                      className="h-9 rounded-md border border-[#2E2E2E] bg-[#262626] px-3 font-mono-tech text-xs text-[#F5F5F5]"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="flex items-center gap-1 text-xs font-medium text-[#A3A3A3]">
                      <Key size={12} /> Pinterest v5 token
                    </label>
                    <input
                      type="password"
                      value={form.pinterest_access_token}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          pinterest_access_token: e.target.value,
                        }))
                      }
                      placeholder="pina_…"
                      className="h-9 rounded-md border border-[#2E2E2E] bg-[#262626] px-3 font-mono-tech text-xs text-[#F5F5F5]"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 4: Generation Guards & Workspace Maintenance */}
          <div className="grid grid-cols-1 gap-6 p-5 sm:p-6 lg:grid-cols-12">
            <div className="lg:col-span-4 space-y-1.5">
              <h2 className="text-sm font-semibold text-[#F5F5F5]">
                Generation guards &amp; workspace reset
              </h2>
              <p className="text-xs leading-relaxed text-[#A3A3A3]">
                Control automatic Gemini watermark removal, isolated chat threads per shot, similarity checks, browser tab recycling, and clean workspace resets.
              </p>
            </div>

            <div className="lg:col-span-8 flex flex-col gap-3">
              <div className="divide-y divide-[#2E2E2E] rounded-md border border-[#2E2E2E] bg-[#171717] px-3.5">
                <div className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="text-xs font-medium text-[#F5F5F5]">
                      Auto-remove Gemini watermark
                    </p>
                    <p className="text-[11px] text-[#737373]">
                      Lossless reverse alpha blending + subpixel polish after each image
                    </p>
                  </div>
                  <Switch
                    checked={form.remove_watermark ?? true}
                    onCheckedChange={(checked) =>
                      setForm((f) => ({ ...f, remove_watermark: checked }))
                    }
                  />
                </div>

                <div className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="text-xs font-medium text-[#F5F5F5]">
                      Open fresh chat per shot
                    </p>
                    <p className="text-[11px] text-[#737373]">
                      Starts an isolated chat thread for each shot so prior frames cannot bias composition
                    </p>
                  </div>
                  <Switch
                    checked={form.fresh_chat_per_turn ?? true}
                    onCheckedChange={(checked) =>
                      setForm((f) => ({ ...f, fresh_chat_per_turn: checked }))
                    }
                  />
                </div>

                <div className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="text-xs font-medium text-[#F5F5F5]">
                      Reference similarity guard &amp; auto re-roll
                    </p>
                    <p className="text-[11px] text-[#737373]">
                      Rejects near-clones of reference inputs, rotates variation axes, and drops raw ref on final retry
                    </p>
                  </div>
                  <Switch
                    checked={form.reference_similarity_check ?? true}
                    onCheckedChange={(checked) =>
                      setForm((f) => ({
                        ...f,
                        reference_similarity_check: checked,
                        drop_ref_on_similarity_retry: checked,
                      }))
                    }
                  />
                </div>

                <div className="flex items-center justify-between gap-4 py-3">
                  <span className="text-xs text-[#F5F5F5]">
                    Max auto-retries per shot (network drop or clone rejection)
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={4}
                    value={form.max_turn_retries ?? 2}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        max_turn_retries: Math.max(
                          0,
                          Math.min(4, Number(e.target.value) || 0)
                        ),
                      }))
                    }
                    className="h-8 w-16 rounded border border-[#2E2E2E] bg-[#262626] text-center font-mono-tech text-xs text-[#F5F5F5]"
                  />
                </div>

                <div className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="text-xs font-medium text-[#F5F5F5]">
                      Recycle Chrome tab interval (shots)
                    </p>
                    <p className="text-[11px] text-[#737373]">
                      Opens a fresh browser tab every N shots to keep RAM flat on 100–1000 image sets
                    </p>
                  </div>
                  <input
                    type="number"
                    min={5}
                    max={100}
                    value={form.cdp_recycle_tab_interval ?? 20}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        cdp_recycle_tab_interval: Math.max(
                          5,
                          Math.min(100, Number(e.target.value) || 20)
                        ),
                      }))
                    }
                    className="h-8 w-16 rounded border border-[#2E2E2E] bg-[#262626] text-center font-mono-tech text-xs text-[#F5F5F5]"
                  />
                </div>

                <div className="flex items-center justify-between gap-4 py-3">
                  <span className="text-xs text-[#F5F5F5]">
                    dHash near-duplicate warning threshold (0–16 bits)
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={16}
                    value={form.dhash_warning_threshold}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        dhash_warning_threshold: Number(e.target.value) || 6,
                      }))
                    }
                    className="h-8 w-16 rounded border border-[#2E2E2E] bg-[#262626] text-center font-mono-tech text-xs text-[#F5F5F5]"
                  />
                </div>
              </div>

              {/* Workspace Reset Box */}
              <div className="rounded-md border border-[#2E2E2E] bg-[#171717] p-4 flex flex-col gap-2.5">
                <p className="text-xs font-semibold text-[#F5F5F5]">
                  Reset studio workspace history
                </p>
                <div className="flex items-center justify-between text-xs text-[#A3A3A3]">
                  <span>Also delete uploaded reference images</span>
                  <Switch checked={clearRefs} onCheckedChange={setClearRefs} />
                </div>
                <div className="flex items-center justify-between text-xs text-[#A3A3A3]">
                  <span>Also delete exported folders inside ./exports/</span>
                  <Switch
                    checked={deleteExports}
                    onCheckedChange={setDeleteExports}
                  />
                </div>
                <div className="pt-1">
                  <StudioButton
                    variant="danger"
                    loading={resetting}
                    onClick={handleReset}
                    icon={<Trash size={14} />}
                  >
                    Reset studio workspace
                  </StudioButton>
                </div>
              </div>
            </div>
          </div>
        </div>
      </StudioPanel>

      {/* Bottom Save Button */}
      <div className="flex justify-end">
        <StudioButton
          variant="primary"
          loading={saving}
          onClick={handleSave}
          icon={<FloppyDisk size={15} />}
        >
          {saving ? "Saving…" : "Save settings"}
        </StudioButton>
      </div>
    </div>
  )
}
