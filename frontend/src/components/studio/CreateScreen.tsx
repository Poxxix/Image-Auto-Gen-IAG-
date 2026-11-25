import * as React from "react"
import {
  Sparkle,
  UploadSimple,
  Compass,
  Sliders,
  ArrowRight,
  Play,
  Trash,
  CheckCircle,
  LockKey,
  ArrowsClockwise,
  FolderOpen,
  Camera,
  SunDim,
  GridFour,
  Wind,
  MagicWand,
  FileCode,
  Sparkle as SparkleIcon,
} from "@phosphor-icons/react"
import { StudioPanel, StudioButton, StudioBadge } from "@/components/shared/StudioPrimitives"
import { BrandIcon } from "@/components/shared/BrandIcon"
import { ExternalAiImportDialog } from "@/components/studio/ExternalAiImportDialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  EXPORT_IMAGE_FORMAT_OPTIONS,
  formatPicassyKeyword,
  getReferenceImageUrl,
  suggestVariationAxes,
  type CaptionStylePreset,
  type CdpSlotStatus,
  type CreateJobPayload,
  type EnabledAxes,
  type EnabledFixed,
  type FilenameStyle,
  type FixedElements,
  type ImageSetJob,
  type JobVariationAxesPool,
  type MetadataExportMode,
  type ExportImageFormat,
  type ProviderModel,
  type ReferenceItem,
  type ReferenceMode,
  type RunMode,
  type StudioPreset,
  type StudioSettings,
  type StudioTab,
  type SuggestAxesResponse,
} from "@/services/studioApi"
import { cn } from "@/lib/utils"

function slugifyKeywordPreview(text: string): string {
  const cleaned = text.replace(/đ/g, "d").replace(/Đ/g, "d")
  const norm = cleaned.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  return (
    norm
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 42) || "keyword"
  )
}

export interface CreateScreenProps {
  providers: ProviderModel[]
  presets: StudioPreset[]
  captionStylePresets: CaptionStylePreset[]
  defaultCaptionPrompt: string
  aspectRatios: string[]
  metadataLanguages: string[]
  picassyCategories?: string[]
  cdpSlots?: CdpSlotStatus[]
  settings: StudioSettings | null
  references: ReferenceItem[]
  recentJobs: ImageSetJob[]
  onUploadReferences: (files: File[]) => Promise<ReferenceItem[]>
  onDiscoverPinterest: (queryOrUrl: string, limit: number) => Promise<ReferenceItem[]>
  onDeleteReference: (refId: number) => Promise<void>
  onCreateJob: (payload: CreateJobPayload) => Promise<void>
  onSelectJob: (job: ImageSetJob, tab: StudioTab) => void
  onDeleteJob: (jobId: number, deleteFiles: boolean) => Promise<void>
  onPickExportFolder: () => Promise<string | null>
  onSaveExportRoot: (dir: string) => Promise<void>
}

const THEME_INSPIRATIONS = [
  {
    theme: "Autumn Rain Café in Hanoi",
    base: "Warm afternoon rain streaking wooden window panes, brass espresso bar, vintage rattan chairs, and steaming ceramic cups.",
    preset: "architectural_interior",
  },
  {
    theme: "Minimalist Ceramic Studio",
    base: "Sunlit pottery workshop with raw clay balls on unbleached linen, potter's wheels, and shelves of earth-toned stoneware.",
    preset: "lifestyle_editorial",
  },
  {
    theme: "Sculptural Botanical Perfume Flacon",
    base: "Heavy architectural glass bottle with warm amber distillation on raw travertine plinths surrounded by dried botanicals.",
    preset: "editorial_product",
  },
  {
    theme: "Monolithic Coastal Tea Sanctuary",
    base: "Board-formed concrete and charred cedar pavilion overlooking calm tidal water at blue hour with paper lanterns.",
    preset: "cinematic_concept",
  },
]

const RATIO_META: Record<
  string,
  { label: string; res: string; wClass: string; hClass: string }
> = {
  "1:1": { label: "Square", res: "1080×1080", wClass: "w-6", hClass: "h-6" },
  "4:5": { label: "Editorial", res: "1080×1350", wClass: "w-5", hClass: "h-6" },
  "9:16": { label: "Vertical", res: "1080×1920", wClass: "w-4", hClass: "h-7" },
  "16:9": { label: "Cinema", res: "1920×1080", wClass: "w-7", hClass: "h-4" },
  "3:2": { label: "35mm Film", res: "1620×1080", wClass: "w-6", hClass: "h-4" },
}

const DEFAULT_CREATE_CATEGORIES = [
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

export function CreateScreen({
  providers,
  presets,
  captionStylePresets,
  defaultCaptionPrompt,
  aspectRatios,
  metadataLanguages,
  picassyCategories = DEFAULT_CREATE_CATEGORIES,
  cdpSlots = [],
  settings,
  references,
  recentJobs,
  onUploadReferences,
  onDiscoverPinterest,
  onDeleteReference,
  onCreateJob,
  onSelectJob,
  onDeleteJob,
  onPickExportFolder,
  onSaveExportRoot,
}: CreateScreenProps) {
  const categoryOptions =
    picassyCategories.length > 0 ? picassyCategories : DEFAULT_CREATE_CATEGORIES
  const [theme, setTheme] = React.useState("")
  const [primaryTag, setPrimaryTag] = React.useState("")
  const primaryTagManualRef = React.useRef(false)
  const [category, setCategory] = React.useState<string>(categoryOptions[0] || "Art")
  const [filenameStyle, setFilenameStyle] = React.useState<FilenameStyle>(
    settings?.default_filename_style || "picassy_slug"
  )
  const [preferredCdpSlot, setPreferredCdpSlot] = React.useState<number>(0)
  const [basePrompt, setBasePrompt] = React.useState("")
  const [referenceMode, setReferenceMode] = React.useState<ReferenceMode>("prompt_only")
  const [runMode, setRunMode] = React.useState<RunMode>("fixed")
  const [targetCount, setTargetCount] = React.useState<number>(
    settings?.default_target_count || 6
  )
  const [batchSize, setBatchSize] = React.useState<number>(
    settings?.default_batch_size || 4
  )
  const [sessionCap, setSessionCap] = React.useState<number>(
    settings?.default_session_cap || 20
  )
  const [cycleReferences, setCycleReferences] = React.useState(true)
  const [aspectRatio, setAspectRatio] = React.useState<string>(
    settings?.default_aspect_ratio || "1:1"
  )
  const [metadataLanguage, setMetadataLanguage] = React.useState<string>(
    settings?.default_metadata_language || "English"
  )
  const [metadataExportMode, setMetadataExportMode] =
    React.useState<MetadataExportMode>(
      settings?.default_metadata_export_mode || "csv"
    )
  const [exportImageFormat, setExportImageFormat] =
    React.useState<ExportImageFormat>(
      settings?.export_image_format || "original"
    )
  const [captionPrompt, setCaptionPrompt] = React.useState<string>(
    settings?.default_caption_prompt || defaultCaptionPrompt
  )
  const [useAiCaptionPrompt, setUseAiCaptionPrompt] = React.useState<boolean>(
    settings?.use_ai_caption_prompt ?? true
  )
  const [optimizePromptEnglish, setOptimizePromptEnglish] = React.useState<boolean>(
    settings?.optimize_prompt_english ?? true
  )
  const [selectedModel, setSelectedModel] = React.useState<string>(
    settings?.default_model || "chrome-cdp/gemini"
  )
  const [exportRootDir, setExportRootDir] = React.useState<string>(
    settings?.export_root_dir || ""
  )

  const hasHydratedSettingsRef = React.useRef(Boolean(settings))

  React.useEffect(() => {
    if (!settings) return
    if (!hasHydratedSettingsRef.current) {
      hasHydratedSettingsRef.current = true
      if (settings.default_target_count) setTargetCount(settings.default_target_count)
      if (settings.default_batch_size) setBatchSize(settings.default_batch_size)
      if (settings.default_session_cap) setSessionCap(settings.default_session_cap)
      if (settings.default_aspect_ratio) setAspectRatio(settings.default_aspect_ratio)
      if (settings.default_metadata_language) {
        setMetadataLanguage(settings.default_metadata_language)
      }
      if (settings.default_metadata_export_mode) {
        setMetadataExportMode(settings.default_metadata_export_mode)
      }
      if (settings.default_filename_style) {
        setFilenameStyle(settings.default_filename_style)
      }
      if (settings.export_image_format) {
        setExportImageFormat(settings.export_image_format)
      }
      if (settings.default_caption_prompt) {
        setCaptionPrompt(settings.default_caption_prompt)
      }
      if (typeof settings.use_ai_caption_prompt === "boolean") {
        setUseAiCaptionPrompt(settings.use_ai_caption_prompt)
      }
      if (typeof settings.optimize_prompt_english === "boolean") {
        setOptimizePromptEnglish(settings.optimize_prompt_english)
      }
      if (settings.default_model) setSelectedModel(settings.default_model)
      if (settings.export_root_dir) setExportRootDir(settings.export_root_dir)
      return
    }
    if (settings.export_root_dir && !exportRootDir) {
      setExportRootDir(settings.export_root_dir)
    }
  }, [settings])

  const [selectedPresetId, setSelectedPresetId] = React.useState<string>(
    presets[0]?.id || "auto_universal"
  )
  const [fixedElements, setFixedElements] = React.useState<FixedElements>({
    subject: "",
    style: presets[0]?.fixed_elements?.style || "",
    color_palette: presets[0]?.fixed_elements?.color_palette || "",
    brand_mood: presets[0]?.fixed_elements?.brand_mood || "",
  })
  const [enabledFixed, setEnabledFixed] = React.useState<EnabledFixed>({
    subject: true,
    style: true,
    color_palette: true,
    brand_mood: true,
  })
  const [axesText, setAxesText] = React.useState({
    camera_angles: (presets[0]?.variation_axes?.camera_angles || []).join("\n"),
    lighting: (presets[0]?.variation_axes?.lighting || []).join("\n"),
    compositions: (presets[0]?.variation_axes?.compositions || []).join("\n"),
    atmospheres: (presets[0]?.variation_axes?.atmospheres || []).join("\n"),
    custom_axis: (presets[0]?.variation_axes?.custom_axis || []).join("\n"),
  })
  const [customAxisLabel, setCustomAxisLabel] = React.useState<string>(
    presets[0]?.variation_axes?.custom_axis_label || "Custom Variation Axis"
  )
  const [enabledAxes, setEnabledAxes] = React.useState<EnabledAxes>({
    camera_angles: presets[0]?.variation_axes?.enabled_axes?.camera_angles ?? true,
    compositions: presets[0]?.variation_axes?.enabled_axes?.compositions ?? true,
    lighting: presets[0]?.variation_axes?.enabled_axes?.lighting ?? true,
    atmospheres: presets[0]?.variation_axes?.enabled_axes?.atmospheres ?? true,
    custom_axis: presets[0]?.variation_axes?.enabled_axes?.custom_axis ?? false,
  })

  const [selectedRefIds, setSelectedRefIds] = React.useState<number[]>([])
  const [pinterestQuery, setPinterestQuery] = React.useState("")
  const [pinterestLimit, setPinterestLimit] = React.useState(6)
  const [uploading, setUploading] = React.useState(false)
  const [dragActive, setDragActive] = React.useState(false)
  const [discovering, setDiscovering] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [showAxesConfig, setShowAxesConfig] = React.useState(false)
  const [showImportDialog, setShowImportDialog] = React.useState(false)
  const [suggestingAxes, setSuggestingAxes] = React.useState(false)
  const [aiSuggestSource, setAiSuggestSource] = React.useState<string | null>(null)
  const [suggestError, setSuggestError] = React.useState<string | null>(null)

  const fileInputRef = React.useRef<HTMLInputElement | null>(null)

  const currentModelInfo = React.useMemo(
    () => providers.find((p) => p.id === selectedModel) || providers[0],
    [providers, selectedModel]
  )

  const handleApplyPreset = (presetId: string) => {
    setSelectedPresetId(presetId)
    setAiSuggestSource(null)
    setSuggestError(null)
    const found = presets.find((p) => p.id === presetId)
    if (found) {
      setFixedElements({
        subject: fixedElements.subject || found.fixed_elements.subject || "",
        style: found.fixed_elements.style || "",
        color_palette: found.fixed_elements.color_palette || "",
        brand_mood: found.fixed_elements.brand_mood || "",
      })
      setEnabledFixed({
        subject: found.fixed_elements.enabled_fixed?.subject ?? true,
        style: found.fixed_elements.enabled_fixed?.style ?? true,
        color_palette: found.fixed_elements.enabled_fixed?.color_palette ?? true,
        brand_mood: found.fixed_elements.enabled_fixed?.brand_mood ?? true,
      })
      setAxesText({
        camera_angles: (found.variation_axes.camera_angles || []).join("\n"),
        lighting: (found.variation_axes.lighting || []).join("\n"),
        compositions: (found.variation_axes.compositions || []).join("\n"),
        atmospheres: (found.variation_axes.atmospheres || []).join("\n"),
        custom_axis: (found.variation_axes.custom_axis || []).join("\n"),
      })
      setCustomAxisLabel(found.variation_axes.custom_axis_label || "Custom Variation Axis")
      setEnabledAxes({
        camera_angles: found.variation_axes.enabled_axes?.camera_angles ?? true,
        compositions: found.variation_axes.enabled_axes?.compositions ?? true,
        lighting: found.variation_axes.enabled_axes?.lighting ?? true,
        atmospheres: found.variation_axes.enabled_axes?.atmospheres ?? true,
        custom_axis:
          found.variation_axes.enabled_axes?.custom_axis ??
          Boolean(found.variation_axes.custom_axis?.length),
      })
    }
  }

  const applyAxesSuggestionResult = (
    res: SuggestAxesResponse,
    applyMetaFields = false
  ) => {
    setSelectedPresetId("ai_custom")
    setAiSuggestSource(res.source_label)
    if (applyMetaFields) {
      if (res.theme) setTheme(res.theme)
      if (res.base_prompt) setBasePrompt(res.base_prompt)
      if (res.aspect_ratio && supportedRatios.includes(res.aspect_ratio)) {
        setAspectRatio(res.aspect_ratio)
      }
    }
    setFixedElements({
      subject: res.fixed_elements?.subject || theme.trim(),
      style: res.fixed_elements?.style || "",
      color_palette: res.fixed_elements?.color_palette || "",
      brand_mood: res.fixed_elements?.brand_mood || "",
    })
    if (res.fixed_elements?.enabled_fixed) {
      setEnabledFixed({
        subject: res.fixed_elements.enabled_fixed.subject ?? true,
        style: res.fixed_elements.enabled_fixed.style ?? true,
        color_palette: res.fixed_elements.enabled_fixed.color_palette ?? true,
        brand_mood: res.fixed_elements.enabled_fixed.brand_mood ?? true,
      })
    }
    setAxesText({
      camera_angles: (res.variation_axes?.camera_angles || []).join("\n"),
      lighting: (res.variation_axes?.lighting || []).join("\n"),
      compositions: (res.variation_axes?.compositions || []).join("\n"),
      atmospheres: (res.variation_axes?.atmospheres || []).join("\n"),
      custom_axis: (res.variation_axes?.custom_axis || []).join("\n"),
    })
    if (res.variation_axes?.custom_axis_label) {
      setCustomAxisLabel(res.variation_axes.custom_axis_label)
    }
    const ea = res.variation_axes?.enabled_axes
    setEnabledAxes({
      camera_angles: ea?.camera_angles ?? true,
      compositions: ea?.compositions ?? true,
      lighting: ea?.lighting ?? true,
      atmospheres: ea?.atmospheres ?? true,
      custom_axis: ea?.custom_axis ?? Boolean(res.variation_axes?.custom_axis?.length),
    })
    setShowAxesConfig(true)
  }

  const handleSuggestAxes = async () => {
    if (!theme.trim()) {
      setSuggestError("Please enter a Set Theme / Subject above first so AI can tailor the axes.")
      return
    }
    setSuggestingAxes(true)
    setSuggestError(null)
    try {
      const res = await suggestVariationAxes({
        theme: theme.trim(),
        base_prompt: basePrompt.trim(),
        model: selectedModel,
        reference_ids: referenceMode === "prompt_only" ? [] : selectedRefIds,
        use_browser_turn: true,
      })
      applyAxesSuggestionResult(res, false)
    } catch (err) {
      setSuggestError(
        err instanceof Error ? err.message : "Could not generate AI axes suggestion."
      )
    } finally {
      setSuggestingAxes(false)
    }
  }

  const handleFilesUpload = async (files: File[]) => {
    if (!files.length) return
    setUploading(true)
    try {
      const uploaded = await onUploadReferences(files)
      setSelectedRefIds((prev) => [
        ...prev,
        ...uploaded.map((r) => r.id).filter((id) => !prev.includes(id)),
      ])
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    await handleFilesUpload(Array.from(e.target.files || []))
  }

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragActive(false)
    const dropped = Array.from(e.dataTransfer.files || []).filter((f) =>
      f.type.startsWith("image/")
    )
    await handleFilesUpload(dropped)
  }

  const handlePinterestDiscover = async () => {
    const q = pinterestQuery.trim() || theme.trim()
    if (!q) return
    setDiscovering(true)
    try {
      const discovered = await onDiscoverPinterest(q, pinterestLimit)
      setSelectedRefIds((prev) => [
        ...prev,
        ...discovered.map((r) => r.id).filter((id) => !prev.includes(id)),
      ])
    } finally {
      setDiscovering(false)
    }
  }

  const toggleRefSelection = (id: number) => {
    setSelectedRefIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const splitLines = (txt: string) =>
    txt
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)

  const buildPayload = (autoStart: boolean): CreateJobPayload => {
    const variation_axes: JobVariationAxesPool = {
      camera_angles: splitLines(axesText.camera_angles),
      lighting: splitLines(axesText.lighting),
      compositions: splitLines(axesText.compositions),
      atmospheres: splitLines(axesText.atmospheres),
      custom_axis: splitLines(axesText.custom_axis),
      custom_axis_label: customAxisLabel.trim() || "Custom Variation Axis",
      enabled_axes: enabledAxes,
    }

    return {
      theme: theme.trim(),
      primary_tag: (primaryTag.trim() || theme.trim()),
      category: category.trim(),
      filename_style: filenameStyle,
      preferred_cdp_slot: preferredCdpSlot,
      base_prompt: basePrompt.trim(),
      reference_mode: referenceMode,
      run_mode: runMode,
      target_count: targetCount,
      batch_size: batchSize,
      session_cap: sessionCap,
      cycle_references: cycleReferences,
      aspect_ratio: aspectRatio,
      metadata_language: metadataLanguage,
      metadata_export_mode: metadataExportMode,
      export_image_format: exportImageFormat,
      caption_prompt: captionPrompt.trim(),
      use_ai_caption_prompt: useAiCaptionPrompt,
      optimize_prompt_english: optimizePromptEnglish,
      model: selectedModel,
      export_root_dir: exportRootDir.trim() || undefined,
      preset_id: selectedPresetId,
      fixed_elements: {
        ...fixedElements,
        enabled_fixed: enabledFixed,
      },
      variation_axes,
      reference_ids: referenceMode === "prompt_only" ? [] : selectedRefIds,
      auto_start: autoStart,
    }
  }

  const handleSubmit = async (autoStart: boolean) => {
    if (!theme.trim()) return
    setSubmitting(true)
    try {
      await onCreateJob(buildPayload(autoStart))
    } finally {
      setSubmitting(false)
    }
  }

  const filteredRefs = React.useMemo(() => {
    if (referenceMode === "local_upload") {
      return references.filter((r) => r.source_type === "local_upload")
    }
    if (referenceMode === "pinterest") {
      return references.filter((r) => r.source_type === "pinterest")
    }
    return []
  }, [references, referenceMode])

  const referenceUnsupported =
    referenceMode !== "prompt_only" &&
    selectedRefIds.length > 0 &&
    currentModelInfo &&
    !currentModelInfo.supports_reference_image

  const supportedRatios =
    currentModelInfo?.supported_aspect_ratios || aspectRatios

  const supportedImageFormats = (
    (currentModelInfo?.supported_formats as ExportImageFormat[] | undefined) || [
      "original",
      "png",
      "jpg",
      "webp",
    ]
  )

  const parsedAngles = splitLines(axesText.camera_angles)
  const parsedLighting = splitLines(axesText.lighting)
  const parsedComps = splitLines(axesText.compositions)
  const parsedAtmos = splitLines(axesText.atmospheres)
  const parsedCustom = splitLines(axesText.custom_axis)

  return (
    <div className="flex flex-col gap-8">
      {/* Studio Header */}
      <div className="flex flex-col justify-between gap-6 border-b border-white/[0.06] pb-7 lg:flex-row lg:items-end">
        <div>
          <p className="font-mono-tech text-[11px] uppercase tracking-[0.22em] text-[#9ca3af]">
            01 · VISUAL BRIEF & VARIATION ATELIER
          </p>
          <h1 className="mt-2 font-display text-3xl sm:text-5xl font-semibold tracking-tight text-[#f4f5f7]">
            Compose a theme-driven image set.
          </h1>
          <p className="mt-2 max-w-2xl text-sm sm:text-base text-[#9ca3af]">
            Enter a theme, choose your inspiration source, and lock your brand continuity while the studio plans distinct camera, lighting, composition, and atmosphere variations.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <StudioBadge
            tone={currentModelInfo?.ready ? "emerald" : "amber"}
            label={currentModelInfo?.status_label || "Provider Standby"}
          />
        </div>
      </div>

      {/* Main 12-Col Bento Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left 8 Columns: Visual Brief Composer */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          <StudioPanel
            eyebrow="THEME & INSPIRATION SOURCE"
            title="1. Creative Brief & Reference Mode"
          >
            <div className="flex flex-col gap-6">
              {/* Theme Input + Quick Inspiration Chips */}
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium uppercase tracking-wider text-[#9ca3af]">
                    Set Theme / Subject *
                  </label>
                  <span className="font-mono-tech text-[10px] text-[#646b78]">
                    Used for folder slug & metadata synthesis
                  </span>
                </div>
                <input
                  type="text"
                  value={theme}
                  onChange={(e) => {
                    const nextVal = e.target.value
                    setTheme(nextVal)
                    if (!primaryTagManualRef.current) {
                      setPrimaryTag(formatPicassyKeyword(nextVal))
                    }
                  }}
                  placeholder="What theme are we exploring? (e.g., beautiful-image or Sympathy Messages)"
                  className="min-h-[54px] w-full rounded-2xl bg-white/[0.035] px-4 text-base font-medium text-white placeholder:text-[#646b78] ring-1 ring-white/[0.1] outline-none focus:ring-2 focus:ring-white/30"
                />

                {/* 1-Click Sample Theme Inspiration Pills */}
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  <span className="mr-1 font-mono-tech text-[10px] uppercase tracking-wider text-[#646b78]">
                    Try brief:
                  </span>
                  {THEME_INSPIRATIONS.map((sample) => (
                    <button
                      key={sample.theme}
                      type="button"
                      onClick={() => {
                        setTheme(sample.theme)
                        if (!primaryTagManualRef.current) {
                          setPrimaryTag(formatPicassyKeyword(sample.theme))
                        }
                        setBasePrompt(sample.base)
                        handleApplyPreset(sample.preset)
                      }}
                      className="rounded-full bg-white/[0.03] px-3 py-1 text-[11px] text-[#9ca3af] ring-1 ring-white/[0.06] transition-colors hover:bg-white/[0.08] hover:text-white cursor-pointer"
                    >
                      {sample.theme}
                    </button>
                  ))}
                </div>

                {/* Picassy Primary Tag (Keyword), 1 Category & Filename Pattern */}
                <div className="mt-2 grid grid-cols-1 gap-3 rounded-2xl bg-white/[0.02] p-4 ring-1 ring-white/[0.08] sm:grid-cols-12">
                  <div className="sm:col-span-5 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-[11px] font-medium uppercase tracking-wider text-amber-200/90">
                        Tag chính (Primary Keyword) *
                      </label>
                      <span className="font-mono-tech text-[10px] text-[#9ca3af] truncate">
                        {filenameStyle === "picassy_slug"
                          ? `${slugifyKeywordPreview(primaryTag || theme)}-1`
                          : `001_${slugifyKeywordPreview(theme || primaryTag)}`}
                      </span>
                    </div>
                    <input
                      type="text"
                      value={primaryTag}
                      onChange={(e) => {
                        primaryTagManualRef.current = e.target.value.trim().length > 0
                        setPrimaryTag(e.target.value)
                      }}
                      placeholder="Exact keyword (e.g., Sympathy Messages)"
                      className="h-10 rounded-xl bg-black/30 px-3 text-xs text-white placeholder:text-[#646b78] ring-1 ring-white/[0.1] outline-none focus:ring-2 focus:ring-amber-400/40"
                    />
                  </div>

                  <div className="sm:col-span-4 flex flex-col gap-1.5">
                    <label className="text-[11px] font-medium uppercase tracking-wider text-[#d1d5db]">
                      Category (1 Category / Job)
                    </label>
                    <Select
                      value={categoryOptions.includes(category) ? category : categoryOptions[0]}
                      onValueChange={(v) => v && setCategory(v)}
                    >
                      <SelectTrigger className="h-10 rounded-xl bg-black/30 px-3 text-xs text-white ring-1 ring-white/[0.1]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {categoryOptions.map((cat) => (
                          <SelectItem key={cat} value={cat}>
                            {cat}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="sm:col-span-3 flex flex-col gap-1.5">
                    <label className="text-[11px] font-medium uppercase tracking-wider text-[#d1d5db]">
                      Filename Rule
                    </label>
                    <Select
                      value={filenameStyle}
                      onValueChange={(v) => v && setFilenameStyle(v as FilenameStyle)}
                    >
                      <SelectTrigger className="h-10 rounded-xl bg-black/30 px-3 text-xs text-white ring-1 ring-white/[0.1]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="picassy_slug">slug-1, 2...</SelectItem>
                        <SelectItem value="studio_seq">001_slug</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Base Visual Direction */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium uppercase tracking-wider text-[#9ca3af]">
                  Base Visual Direction (Optional)
                </label>
                <textarea
                  rows={2}
                  value={basePrompt}
                  onChange={(e) => setBasePrompt(e.target.value)}
                  placeholder="Describe focal objects, materials, or narrative details shared across every variation in the set..."
                  className="w-full rounded-2xl bg-white/[0.03] p-4 text-sm text-white placeholder:text-[#646b78] ring-1 ring-white/[0.09] outline-none focus:ring-2 focus:ring-white/30"
                />
              </div>

              {/* 3 Starting Modes */}
              <div className="flex flex-col gap-2.5">
                <label className="text-xs font-medium uppercase tracking-wider text-[#9ca3af]">
                  Three Ways to Start
                </label>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {[
                    {
                      id: "prompt_only" as ReferenceMode,
                      label: "Pure Prompt",
                      badge: "Default",
                      sub: "Generates diverse prompts around the theme independently of Pinterest or uploads.",
                      icon: <Sparkle size={17} weight="light" />,
                    },
                    {
                      id: "local_upload" as ReferenceMode,
                      label: "User Reference Images",
                      badge: "Local Files",
                      sub: "Pair each turn with your own image; optionally cycle with forced axis shifts.",
                      icon: <UploadSimple size={17} weight="light" />,
                    },
                    {
                      id: "pinterest" as ReferenceMode,
                      label: "Pinterest Discovery",
                      badge: "Conditional",
                      sub: "Search by keyword, Pin URL, or Board URL and pick candidate references.",
                      icon: <Compass size={17} weight="light" />,
                    },
                  ].map((mode) => {
                    const active = referenceMode === mode.id
                    return (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() => setReferenceMode(mode.id)}
                        className={cn(
                          "flex flex-col items-start justify-between rounded-2xl p-4 text-left ring-1 transition-all cursor-pointer",
                          active
                            ? "bg-white/[0.08] text-white ring-white/[0.24] shadow-[0_8px_28px_rgba(0,0,0,0.4)]"
                            : "bg-white/[0.02] text-[#9ca3af] ring-white/[0.06] hover:bg-white/[0.04]"
                        )}
                      >
                        <div className="flex w-full items-center justify-between">
                          <span className="flex size-8 items-center justify-center rounded-xl bg-white/[0.06] text-[#f4f5f7]">
                            {mode.icon}
                          </span>
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 font-mono-tech text-[10px] uppercase tracking-wider",
                              active
                                ? "bg-emerald-500/20 text-emerald-300"
                                : "bg-white/[0.04] text-[#646b78]"
                            )}
                          >
                            {mode.badge}
                          </span>
                        </div>
                        <div className="mt-3">
                          <p className="text-sm font-semibold text-[#f4f5f7]">
                            {mode.label}
                          </p>
                          <p className="mt-1 text-[11px] leading-relaxed text-[#9ca3af]">
                            {mode.sub}
                          </p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Conditional Reference Workspace */}
              {referenceMode !== "prompt_only" && (
                <div className="rounded-2xl bg-white/[0.02] p-5 ring-1 ring-white/[0.08] flex flex-col gap-4">
                  {referenceMode === "local_upload" ? (
                    <div
                      onDragOver={(e) => {
                        e.preventDefault()
                        setDragActive(true)
                      }}
                      onDragLeave={() => setDragActive(false)}
                      onDrop={handleDrop}
                      className={cn(
                        "flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-6 text-center transition-colors",
                        dragActive
                          ? "border-emerald-400 bg-emerald-500/[0.06]"
                          : "border-white/[0.14] bg-white/[0.015]"
                      )}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        multiple
                        onChange={handleFileChange}
                        className="hidden"
                      />
                      <span className="flex size-10 items-center justify-center rounded-2xl bg-white/[0.06] text-white">
                        <UploadSimple size={20} weight="light" />
                      </span>
                      <div>
                        <p className="text-sm font-medium text-white">
                          Drag & drop reference images here, or browse from disk
                        </p>
                        <p className="mt-0.5 text-xs text-[#9ca3af]">
                          Supports PNG, JPG, and WebP · Max 1 reference paired per generation turn
                        </p>
                      </div>
                      <StudioButton
                        variant="secondary"
                        loading={uploading}
                        onClick={() => fileInputRef.current?.click()}
                        icon={<UploadSimple size={15} weight="light" />}
                      >
                        {uploading ? "Uploading…" : "Choose Reference Files"}
                      </StudioButton>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-white">
                            Pinterest Candidate Discovery
                          </p>
                          <p className="text-xs text-[#9ca3af]">
                            Supports Search Keywords/Tags, Pin URLs (pinterest.com/pin/...), or Board URLs. Candidate images are never copied into your export folder.
                          </p>
                        </div>
                        <span className="rounded-full bg-white/[0.05] px-2.5 py-1 font-mono-tech text-[10px] text-[#d1d5db]">
                          {settings?.pinterest_access_token_configured
                            ? "API v5 Token Connected"
                            : "Candidate Preview Mode"}
                        </span>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2.5">
                        <input
                          type="text"
                          value={pinterestQuery}
                          onChange={(e) => setPinterestQuery(e.target.value)}
                          placeholder={
                            theme
                              ? `Keyword, Pin URL, or Board URL (defaults to "${theme}")`
                              : "Enter keyword, Pin URL (https://www.pinterest.com/pin/...), or Board URL"
                          }
                          className="min-h-[44px] flex-1 rounded-full bg-white/[0.04] px-4 text-sm text-white placeholder:text-[#646b78] ring-1 ring-white/[0.09] outline-none focus:ring-2 focus:ring-white/30"
                        />
                        <input
                          type="number"
                          min={1}
                          max={12}
                          value={pinterestLimit}
                          onChange={(e) =>
                            setPinterestLimit(
                              Math.max(1, Math.min(12, Number(e.target.value) || 6))
                            )
                          }
                          aria-label="Candidate count"
                          className="min-h-[44px] w-20 rounded-full bg-white/[0.04] px-3 text-center font-mono-tech text-sm text-white ring-1 ring-white/[0.09]"
                        />
                        <StudioButton
                          variant="secondary"
                          loading={discovering}
                          onClick={handlePinterestDiscover}
                          icon={<Compass size={15} weight="light" />}
                        >
                          {discovering ? "Discovering…" : "Fetch Candidates"}
                        </StudioButton>
                      </div>
                    </div>
                  )}

                  {/* Reference Candidate Selection Grid */}
                  {filteredRefs.length > 0 && (
                    <div className="flex flex-col gap-3 pt-1">
                      <div className="flex items-center justify-between text-xs text-[#9ca3af]">
                        <span>
                          Selected <strong>{selectedRefIds.length}</strong> of{" "}
                          {filteredRefs.length} candidate(s) for pairing
                        </span>
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedRefIds(filteredRefs.map((r) => r.id))
                            }
                            className="text-xs text-[#d1d5db] hover:text-white cursor-pointer"
                          >
                            Select all
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedRefIds([])}
                            className="text-xs text-[#646b78] hover:text-white cursor-pointer"
                          >
                            Clear
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
                        {filteredRefs.map((ref, idx) => {
                          const isSelected = selectedRefIds.includes(ref.id)
                          const orderIdx = selectedRefIds.indexOf(ref.id)
                          return (
                            <div
                              key={ref.id}
                              className={cn(
                                "group relative overflow-hidden rounded-2xl bg-black/40 ring-1 transition-all",
                                isSelected
                                  ? "ring-2 ring-emerald-400"
                                  : "ring-white/[0.08] opacity-75 hover:opacity-100"
                              )}
                            >
                              <button
                                type="button"
                                onClick={() => toggleRefSelection(ref.id)}
                                className="block aspect-square w-full overflow-hidden cursor-pointer"
                              >
                                <img
                                  src={getReferenceImageUrl(ref.id)}
                                  alt={ref.title}
                                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                                />
                              </button>
                              <div className="flex items-center justify-between bg-[#090a0d]/95 px-2.5 py-1.5 text-[10px]">
                                <span className="font-mono-tech text-[#d1d5db] truncate">
                                  #{ref.id} · {ref.width}×{ref.height}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedRefIds((prev) =>
                                      prev.filter((x) => x !== ref.id)
                                    )
                                    onDeleteReference(ref.id)
                                  }}
                                  aria-label={`Remove reference ${ref.id}`}
                                  className="text-[#646b78] hover:text-rose-300 cursor-pointer"
                                >
                                  <Trash size={12} weight="light" />
                                </button>
                              </div>
                              {isSelected && (
                                <span className="pointer-events-none absolute top-2 left-2 flex h-5 items-center gap-1 rounded-full bg-emerald-500 px-2 font-mono-tech text-[10px] font-bold text-black">
                                  <CheckCircle size={11} weight="bold" />
                                  #{orderIdx + 1}
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </div>

                      <div className="flex items-center justify-between border-t border-white/[0.06] pt-3">
                        <div>
                          <p className="text-xs font-medium text-white">
                            Round-Robin Reference Cycling
                          </p>
                          <p className="text-[11px] text-[#9ca3af]">
                            When target count ({targetCount}) exceeds selected references ({selectedRefIds.length}), cycle references and force variation axis rotation.
                          </p>
                        </div>
                        <Switch
                          checked={cycleReferences}
                          onCheckedChange={setCycleReferences}
                        />
                      </div>
                    </div>
                  )}

                  {referenceUnsupported && (
                    <div className="rounded-xl bg-rose-500/10 p-3 text-xs text-rose-200 ring-1 ring-rose-400/30">
                      Model <strong>{currentModelInfo?.label}</strong> does not support reference image inputs. Switch to a model with reference support or select Pure Prompt mode.
                    </div>
                  )}
                </div>
              )}
            </div>
          </StudioPanel>

          {/* Card 2: Frame Geometry, Set Volume & Model */}
          <StudioPanel
            eyebrow="GEOMETRY, VOLUME & ENGINE"
            title="2. Aspect Ratio, Set Size & Model"
          >
            <div className="flex flex-col gap-6">
              {/* Visual Proportional Aspect Ratio Cards */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium uppercase tracking-wider text-[#9ca3af]">
                  Aspect Ratio & Frame Geometry
                </label>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
                  {supportedRatios.map((r) => {
                    const meta = RATIO_META[r] || {
                      label: r,
                      res: "",
                      wClass: "w-5",
                      hClass: "h-5",
                    }
                    const active = aspectRatio === r
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setAspectRatio(r)}
                        className={cn(
                          "flex flex-col items-center justify-center gap-2 rounded-2xl p-3.5 ring-1 transition-all cursor-pointer",
                          active
                            ? "bg-white/[0.09] text-white ring-white/[0.28]"
                            : "bg-white/[0.02] text-[#9ca3af] ring-white/[0.06] hover:bg-white/[0.05]"
                        )}
                      >
                        <div className="flex h-8 items-center justify-center">
                          <span
                            className={cn(
                              "rounded-[4px] border-[1.5px] transition-colors",
                              meta.wClass,
                              meta.hClass,
                              active
                                ? "border-emerald-300 bg-emerald-400/15"
                                : "border-white/30 bg-white/[0.04]"
                            )}
                          />
                        </div>
                        <div className="text-center">
                          <p className="font-mono-tech text-xs font-semibold text-[#f4f5f7]">
                            {r} · {meta.label}
                          </p>
                          <p className="font-mono-tech text-[10px] text-[#646b78]">
                            {meta.res}
                          </p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Volume, Run Mode, Metadata Language, Model & Export Folder */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">
                    Batch Strategy
                  </label>
                  <div className="grid grid-cols-2 rounded-full bg-white/[0.03] p-1 ring-1 ring-white/[0.08]">
                    <button
                      type="button"
                      onClick={() => setRunMode("fixed")}
                      className={cn(
                        "rounded-full py-1.5 text-xs font-medium transition-colors cursor-pointer",
                        runMode === "fixed"
                          ? "bg-[#f4f5f7] text-[#050505]"
                          : "text-[#9ca3af] hover:text-white"
                      )}
                    >
                      Fixed Set
                    </button>
                    <button
                      type="button"
                      onClick={() => setRunMode("continuous")}
                      className={cn(
                        "rounded-full py-1.5 text-xs font-medium transition-colors cursor-pointer",
                        runMode === "continuous"
                          ? "bg-[#f4f5f7] text-[#050505]"
                          : "text-[#9ca3af] hover:text-white"
                      )}
                    >
                      Continuous
                    </button>
                  </div>
                </div>

                {runMode === "fixed" ? (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">
                      Target Set Size (Default 6)
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setTargetCount((c) => Math.max(1, c - 1))}
                        className="flex size-10 items-center justify-center rounded-full bg-white/[0.04] text-white ring-1 ring-white/[0.08] hover:bg-white/[0.08] cursor-pointer"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        value={targetCount}
                        onChange={(e) =>
                          setTargetCount(
                            Math.max(1, Math.min(1000, Number(e.target.value) || 6))
                          )
                        }
                        className="h-10 flex-1 rounded-full bg-white/[0.04] text-center font-mono-tech text-sm font-semibold text-white ring-1 ring-white/[0.08]"
                      />
                      <button
                        type="button"
                        onClick={() => setTargetCount((c) => Math.min(1000, c + 1))}
                        className="flex size-10 items-center justify-center rounded-full bg-white/[0.04] text-white ring-1 ring-white/[0.08] hover:bg-white/[0.08] cursor-pointer"
                      >
                        +
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {[6, 20, 50, 100, 300, 1000].map((quickN) => (
                        <button
                          key={quickN}
                          type="button"
                          onClick={() => setTargetCount(quickN)}
                          className={cn(
                            "rounded-full px-2 py-0.5 font-mono-tech text-[10px] ring-1 transition-all cursor-pointer",
                            targetCount === quickN
                              ? "bg-white text-[#050505] ring-white font-semibold"
                              : "bg-white/[0.03] text-[#9ca3af] ring-white/[0.06] hover:text-white"
                          )}
                        >
                          {quickN}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">
                      Wave Size / Session Cap
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={batchSize}
                        onChange={(e) =>
                          setBatchSize(
                            Math.max(1, Math.min(50, Number(e.target.value) || 4))
                          )
                        }
                        title="Images per wave (up to 50)"
                        className="h-10 rounded-full bg-white/[0.04] px-3 text-center font-mono-tech text-xs text-white ring-1 ring-white/[0.08]"
                      />
                      <input
                        type="number"
                        min={2}
                        max={1000}
                        value={sessionCap}
                        onChange={(e) =>
                          setSessionCap(
                            Math.max(2, Math.min(1000, Number(e.target.value) || 20))
                          )
                        }
                        title="Max session cap (up to 1,000)"
                        className="h-10 rounded-full bg-white/[0.04] px-3 text-center font-mono-tech text-xs text-white ring-1 ring-white/[0.08]"
                      />
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">
                    Title & Description Language
                  </label>
                  <Select
                    value={metadataLanguage}
                    onValueChange={(v) => v && setMetadataLanguage(v)}
                  >
                    <SelectTrigger className="h-10 rounded-full bg-white/[0.04] px-4 text-xs text-white ring-1 ring-white/[0.08]">
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

              {/* Export Image File Format Selector (Original / PNG / JPG / WebP) */}
              <div className="rounded-2xl bg-white/[0.025] p-4 ring-1 ring-white/[0.08] flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-white">
                      Export Image Format (Loại ảnh xuất)
                    </p>
                    <p className="text-[11px] text-[#9ca3af]">
                      Chọn định dạng ảnh lưu trên ổ đĩa cho bộ ảnh này (mặc định đồng bộ từ Settings).
                    </p>
                  </div>
                  <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 font-mono-tech text-[10px] font-semibold uppercase text-emerald-300 ring-1 ring-emerald-400/25">
                    .{exportImageFormat === "original" ? "orig" : exportImageFormat}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {EXPORT_IMAGE_FORMAT_OPTIONS.filter((fmt) =>
                    supportedImageFormats.includes(fmt.id)
                  ).map((fmt) => {
                    const active = exportImageFormat === fmt.id
                    return (
                      <button
                        key={fmt.id}
                        type="button"
                        onClick={() => setExportImageFormat(fmt.id)}
                        className={cn(
                          "flex flex-col items-start gap-1 rounded-xl p-3 text-left ring-1 transition-all cursor-pointer",
                          active
                            ? "bg-emerald-400/12 text-white ring-emerald-400/45 shadow-sm"
                            : "bg-white/[0.02] text-[#9ca3af] ring-white/[0.06] hover:bg-white/[0.05] hover:text-white"
                        )}
                      >
                        <div className="flex w-full items-center justify-between gap-1.5">
                          <span className="text-xs font-semibold text-white">
                            {fmt.label}
                          </span>
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-0.5 font-mono-tech text-[9px] font-semibold",
                              active
                                ? "bg-emerald-400 text-[#050505]"
                                : "bg-white/[0.06] text-[#9ca3af]"
                            )}
                          >
                            {fmt.badge}
                          </span>
                        </div>
                        <span className="text-[10px] leading-snug text-[#9ca3af]">
                          {fmt.description}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Post-Image Caption & Description Prompt + Export Mode Switch */}
              <div className="rounded-2xl bg-amber-400/[0.04] p-4 ring-1 ring-amber-400/20 flex flex-col gap-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold text-white">
                          Post-Image Picassy CSV Export (pin-import.csv)
                        </p>
                        <p className="text-[11px] text-[#9ca3af]">
                          Xuất 1 file <code className="text-amber-300">pin-import.csv</code> chuẩn 8 cột (File name, Title Case không gạch, Description, Alt text, Category, Tag, Peak, Prompt) hoặc chỉ xuất ảnh.
                        </p>
                      </div>

                      {/* 2-Way Switch: Xuất CSV | Không (Chỉ ảnh) */}
                      <div className="flex items-center rounded-full bg-black/40 p-1 ring-1 ring-white/[0.1] shrink-0">
                        {(
                          [
                            ["csv", "Xuất CSV (pin-import.csv)"],
                            ["none", "Không (Chỉ ảnh)"],
                          ] as const
                        ).map(([mKey, mLabel]) => {
                      const active = metadataExportMode === mKey
                      return (
                        <button
                          key={mKey}
                          type="button"
                          onClick={() => setMetadataExportMode(mKey)}
                          className={cn(
                            "rounded-full px-3 py-1.5 text-xs font-medium transition-all cursor-pointer",
                            active
                              ? "bg-amber-400 text-[#050505] font-semibold shadow-sm"
                              : "text-[#9ca3af] hover:text-white"
                          )}
                        >
                          {mLabel}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {metadataExportMode !== "none" ? (
                  <div className="flex flex-col gap-3 border-t border-white/[0.06] pt-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="text-[11px] font-medium uppercase tracking-wider text-amber-200/90">
                        Prompt tạo Caption & Description sau mỗi ảnh
                      </label>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {captionStylePresets.map((cp) => (
                          <button
                            key={cp.id}
                            type="button"
                            onClick={() => setCaptionPrompt(cp.prompt)}
                            className="rounded-full bg-white/[0.05] px-2.5 py-0.5 text-[10px] text-[#d1d5db] ring-1 ring-white/[0.08] hover:bg-white/[0.12] hover:text-white cursor-pointer"
                          >
                            {cp.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <textarea
                      rows={2}
                      value={captionPrompt}
                      onChange={(e) => setCaptionPrompt(e.target.value)}
                      placeholder="Nhập prompt hướng dẫn AI viết Caption (Pin Title), Description chuẩn SEO và Hashtags sau khi tạo xong mỗi ảnh..."
                      className="w-full rounded-xl bg-black/30 p-3 text-xs text-white placeholder:text-[#646b78] ring-1 ring-white/[0.09] outline-none focus:ring-2 focus:ring-amber-400/40"
                    />

                    <div className="flex items-center justify-between gap-4 pt-0.5">
                      <div>
                        <p className="text-xs font-medium text-white">
                          Tạo Picassy Metadata bằng AI sau mỗi ảnh (Option 1A)
                        </p>
                        <p className="text-[11px] text-[#9ca3af]">
                          Router hiện tại: <span className="text-sky-300 font-mono-tech">{settings?.metadata_provider || "auto"}</span>
                          {settings?.metadata_provider === "browser_cdp"
                            ? " — gửi Prompt #2 trên Chrome CDP (tốn thêm quota ảnh)."
                            : " — dùng Small Vision/Text Model (512px) hoặc Grammatical Engine để giữ trọn 100% quota Chrome CDP cho Prompt #1 tạo ảnh."}
                        </p>
                      </div>
                      <Switch
                        checked={useAiCaptionPrompt}
                        onCheckedChange={setUseAiCaptionPrompt}
                      />
                    </div>
                  </div>
                ) : (
                  <p className="border-t border-white/[0.06] pt-2.5 text-[11px] text-emerald-300">
                    Chế độ Chỉ xuất ảnh: Bỏ qua bước tạo Caption/JSON sau mỗi ảnh để tối ưu tốc độ render nhanh nhất.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">
                    Image Generation Model
                  </label>
                  <Select
                    value={selectedModel}
                    onValueChange={(v) => v && setSelectedModel(v)}
                  >
                    <SelectTrigger className="h-11 rounded-2xl bg-white/[0.04] px-4 text-xs text-white ring-1 ring-white/[0.08]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {providers.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          <span className="inline-flex items-center gap-2">
                            <BrandIcon name={p.engine.replace("_api", "")} size={14} />
                            <span>{p.label}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {currentModelInfo && (
                    <span className="text-[11px] text-[#646b78]">
                      {currentModelInfo.rate_limit_note}
                    </span>
                  )}
                  {selectedModel.startsWith("chrome-cdp/") && (
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <label className="text-[10px] font-mono-tech uppercase tracking-wider text-sky-300">
                        Chrome CDP Slot
                      </label>
                      <Select
                        value={String(preferredCdpSlot)}
                        onValueChange={(v) => setPreferredCdpSlot(Number(v) || 0)}
                      >
                        <SelectTrigger className="h-8 w-52 rounded-xl bg-white/[0.04] px-2.5 text-[11px] text-white ring-1 ring-white/[0.08]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0">Auto (Next Free Enabled Slot)</SelectItem>
                          {(cdpSlots.length > 0
                            ? cdpSlots
                            : [{ slot_id: 1, port: 9222, label: "Slot 1", enabled: true, connected: false, open_engines: [] as string[], active_job_id: null, active_generation_id: null }]
                          ).map((s) => (
                            <SelectItem key={s.slot_id} value={String(s.slot_id)}>
                              {`Slot #${s.slot_id} (:${s.port}) · ${s.enabled ? (s.connected ? "Online" : "Standby") : s.connected ? "Connected (Disabled)" : "Disabled"}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">
                    Export Folder Root (Save Location)
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="relative flex flex-1 items-center">
                      <FolderOpen
                        size={15}
                        weight="light"
                        className="pointer-events-none absolute left-3.5 text-[#9ca3af]"
                      />
                      <input
                        type="text"
                        value={exportRootDir}
                        onChange={(e) => setExportRootDir(e.target.value)}
                        onBlur={() => {
                          if (
                            exportRootDir.trim() &&
                            exportRootDir.trim() !== settings?.export_root_dir
                          ) {
                            onSaveExportRoot(exportRootDir.trim())
                          }
                        }}
                        placeholder="Default: ./exports/<YYYY-MM-DD_HHMMSS_slug>/"
                        className="h-11 w-full rounded-2xl bg-white/[0.04] pl-10 pr-4 font-mono-tech text-xs text-white placeholder:text-[#646b78] ring-1 ring-white/[0.08] outline-none focus:ring-2 focus:ring-white/30"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        const chosen = await onPickExportFolder()
                        if (chosen) setExportRootDir(chosen)
                      }}
                      className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-2xl bg-white/[0.06] px-3.5 text-xs font-medium text-[#f4f5f7] ring-1 ring-white/[0.1] hover:bg-white/[0.12] cursor-pointer"
                      title="Open macOS Finder to select export folder"
                    >
                      <FolderOpen size={15} weight="light" />
                      Browse…
                    </button>
                  </div>
                </div>
              </div>

              {/* Continuity & Variation Axes Matrix */}
              <div className="rounded-2xl bg-white/[0.02] p-4 ring-1 ring-white/[0.07]">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <Sliders size={16} weight="light" className="text-[#d1d5db]" />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs font-medium text-white">
                          Style Presets, Locked Continuity & Variation Axes
                        </p>
                        {aiSuggestSource && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2.5 py-0.5 font-mono-tech text-[10px] font-medium text-amber-300 ring-1 ring-amber-400/30">
                            <Sparkle size={10} weight="fill" />
                            AI Tailored · {aiSuggestSource}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[#9ca3af]">
                        Pick a preset, or click <strong>AI Suggest Axes</strong> when your theme doesn&apos;t fit standard presets.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowImportDialog(true)}
                      title="Copy Sample Master Prompt to external AI (ChatGPT/Gemini/Claude) and import/paste back JSON config"
                      className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/15 px-3.5 py-1.5 text-[11px] font-semibold text-sky-200 ring-1 ring-sky-400/35 hover:bg-sky-500/25 cursor-pointer"
                    >
                      <FileCode size={13} weight="fill" />
                      Sample Prompt &amp; Import
                    </button>
                    <button
                      type="button"
                      disabled={suggestingAxes}
                      onClick={handleSuggestAxes}
                      title="Use AI (API / Browser :9222 / Smart Domain Analyzer) to generate custom Locked Continuity & Variation Axes tailored to your Theme"
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11px] font-semibold transition-all cursor-pointer",
                        selectedPresetId === "ai_custom"
                          ? "bg-amber-400 text-[#050505] shadow-[0_4px_14px_rgba(251,191,36,0.25)]"
                          : "bg-amber-400/15 text-amber-200 ring-1 ring-amber-400/35 hover:bg-amber-400/25"
                      )}
                    >
                      <MagicWand
                        size={13}
                        weight="fill"
                        className={suggestingAxes ? "animate-spin" : ""}
                      />
                      {suggestingAxes ? "AI Analyzing Theme…" : "AI Suggest Axes"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAxesConfig((v) => !v)}
                      className="rounded-full bg-white/[0.06] px-3.5 py-1.5 text-[11px] font-medium text-[#e5e7eb] hover:bg-white/[0.12] cursor-pointer"
                    >
                      {showAxesConfig ? "Close Axis Editor" : "Toggle / Edit Axes"}
                    </button>
                  </div>
                </div>

                {suggestError && (
                  <div className="mt-3 rounded-xl bg-amber-500/10 px-3.5 py-2 text-xs text-amber-200 ring-1 ring-amber-400/30">
                    {suggestError}
                  </div>
                )}

                {/* Preset Selector Strip */}
                <div className="mt-3.5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {presets.map((p) => {
                    const isSelected = selectedPresetId === p.id
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleApplyPreset(p.id)}
                        className={cn(
                          "flex flex-col items-start rounded-xl p-3 text-left ring-1 transition-all cursor-pointer",
                          isSelected
                            ? "bg-[#f4f5f7] text-[#050505] ring-white"
                            : "bg-white/[0.03] text-[#9ca3af] ring-white/[0.06] hover:bg-white/[0.06] hover:text-white"
                        )}
                      >
                        <span className="text-xs font-semibold">{p.label}</span>
                        <span
                          className={cn(
                            "mt-0.5 line-clamp-2 text-[10px]",
                            isSelected ? "text-[#050505]/75" : "text-[#646b78]"
                          )}
                        >
                          {p.description}
                        </span>
                      </button>
                    )
                  })}

                  {/* Dynamic AI Custom Card in Strip */}
                  <button
                    type="button"
                    disabled={suggestingAxes}
                    onClick={handleSuggestAxes}
                    className={cn(
                      "flex flex-col items-start justify-between rounded-xl p-3 text-left ring-1 transition-all cursor-pointer",
                      selectedPresetId === "ai_custom"
                        ? "bg-amber-400 text-[#050505] ring-amber-300 shadow-[0_6px_20px_rgba(251,191,36,0.2)]"
                        : "bg-amber-400/[0.05] text-amber-200/90 ring-amber-400/25 hover:bg-amber-400/[0.12] hover:text-amber-100"
                    )}
                  >
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                      <Sparkle size={13} weight="fill" />
                      {selectedPresetId === "ai_custom"
                        ? "AI Custom Tailored"
                        : "Other Topic? AI Suggest"}
                    </span>
                    <span
                      className={cn(
                        "mt-0.5 line-clamp-2 text-[10px]",
                        selectedPresetId === "ai_custom"
                          ? "text-[#050505]/80"
                          : "text-amber-200/65"
                      )}
                    >
                      {aiSuggestSource
                        ? `Generated via ${aiSuggestSource} for "${theme || "your theme"}"`
                        : "Auto-synthesizes custom style, palette & 4 axes for any niche (3D, Anime, Food, Sci-Fi, etc.)"}
                    </span>
                  </button>
                </div>

                {showAxesConfig && (
                  <div className="mt-5 flex flex-col gap-5 border-t border-white/[0.06] pt-5">
                    <div>
                      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                        <p className="flex items-center gap-1.5 font-mono-tech text-[11px] uppercase tracking-wider text-[#d1d5db]">
                          <LockKey size={13} weight="light" />
                          Locked Continuity Elements (Consistent Across Entire Set)
                        </p>
                        <button
                          type="button"
                          onClick={() =>
                            setFixedElements({
                              subject: "",
                              style: "",
                              color_palette: "",
                              brand_mood: "",
                            })
                          }
                          className="font-mono-tech text-[10px] text-[#9ca3af] hover:text-white cursor-pointer"
                        >
                          Clear fixed overrides
                        </button>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className={cn("flex flex-col gap-1 transition-opacity", !(enabledFixed.subject ?? true) && "opacity-45")}>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono-tech uppercase text-[#646b78]">
                              Subject / Framing Lock
                            </span>
                            <Switch
                              checked={enabledFixed.subject ?? true}
                              onCheckedChange={(v) => setEnabledFixed((ef) => ({ ...ef, subject: v }))}
                            />
                          </div>
                          <input
                            type="text"
                            disabled={!(enabledFixed.subject ?? true)}
                            value={fixedElements.subject || ""}
                            onChange={(e) =>
                              setFixedElements((f) => ({ ...f, subject: e.target.value }))
                            }
                            placeholder="Locked Subject / Front-Facing Rule"
                            className="h-10 rounded-xl bg-white/[0.03] px-3.5 text-xs text-white ring-1 ring-white/[0.08]"
                          />
                        </div>
                        <div className={cn("flex flex-col gap-1 transition-opacity", !(enabledFixed.style ?? true) && "opacity-45")}>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono-tech uppercase text-[#646b78]">
                              Visual Style / Medium / Lens
                            </span>
                            <Switch
                              checked={enabledFixed.style ?? true}
                              onCheckedChange={(v) => setEnabledFixed((ef) => ({ ...ef, style: v }))}
                            />
                          </div>
                          <input
                            type="text"
                            disabled={!(enabledFixed.style ?? true)}
                            value={fixedElements.style || ""}
                            onChange={(e) =>
                              setFixedElements((f) => ({ ...f, style: e.target.value }))
                            }
                            placeholder="Locked Visual Style / Lens / Medium"
                            className="h-10 rounded-xl bg-white/[0.03] px-3.5 text-xs text-white ring-1 ring-white/[0.08]"
                          />
                        </div>
                        <div className={cn("flex flex-col gap-1 transition-opacity", !(enabledFixed.color_palette ?? true) && "opacity-45")}>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono-tech uppercase text-[#646b78]">
                              Color Palette
                            </span>
                            <Switch
                              checked={enabledFixed.color_palette ?? true}
                              onCheckedChange={(v) => setEnabledFixed((ef) => ({ ...ef, color_palette: v }))}
                            />
                          </div>
                          <input
                            type="text"
                            disabled={!(enabledFixed.color_palette ?? true)}
                            value={fixedElements.color_palette || ""}
                            onChange={(e) =>
                              setFixedElements((f) => ({
                                ...f,
                                color_palette: e.target.value,
                              }))
                            }
                            placeholder="Locked Brand / Color Palette"
                            className="h-10 rounded-xl bg-white/[0.03] px-3.5 text-xs text-white ring-1 ring-white/[0.08]"
                          />
                        </div>
                        <div className={cn("flex flex-col gap-1 transition-opacity", !(enabledFixed.brand_mood ?? true) && "opacity-45")}>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono-tech uppercase text-[#646b78]">
                              Brand Mood / Tone
                            </span>
                            <Switch
                              checked={enabledFixed.brand_mood ?? true}
                              onCheckedChange={(v) => setEnabledFixed((ef) => ({ ...ef, brand_mood: v }))}
                            />
                          </div>
                          <input
                            type="text"
                            disabled={!(enabledFixed.brand_mood ?? true)}
                            value={fixedElements.brand_mood || ""}
                            onChange={(e) =>
                              setFixedElements((f) => ({
                                ...f,
                                brand_mood: e.target.value,
                              }))
                            }
                            placeholder="Locked Mood / Tone"
                            className="h-10 rounded-xl bg-white/[0.03] px-3.5 text-xs text-white ring-1 ring-white/[0.08]"
                          />
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                        <p className="flex items-center gap-1.5 font-mono-tech text-[11px] uppercase tracking-wider text-[#d1d5db]">
                          <ArrowsClockwise size={13} weight="light" />
                          Modular Variation Axes (Toggle Any Axis ON/OFF per Theme)
                        </p>
                        <span className="font-mono-tech text-[10px] text-[#9ca3af]">
                          Turn OFF Camera Angles for Wallpaper, Painting &amp; Front-Facing sets
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className={cn("flex flex-col gap-1 rounded-2xl bg-white/[0.02] p-3 ring-1 ring-white/[0.06] transition-opacity", !(enabledAxes.camera_angles ?? true) && "opacity-50")}>
                          <div className="flex items-center justify-between text-[11px] text-[#9ca3af]">
                            <span className="inline-flex items-center gap-1.5 text-white">
                              <Camera size={12} className="text-amber-300" /> Camera Angles
                              <span className="font-mono-tech text-[10px] text-[#646b78]">({parsedAngles.length})</span>
                            </span>
                            <Switch
                              checked={enabledAxes.camera_angles ?? true}
                              onCheckedChange={(v) => setEnabledAxes((ea) => ({ ...ea, camera_angles: v }))}
                            />
                          </div>
                          <textarea
                            rows={4}
                            disabled={!(enabledAxes.camera_angles ?? true)}
                            value={axesText.camera_angles}
                            onChange={(e) =>
                              setAxesText((a) => ({ ...a, camera_angles: e.target.value }))
                            }
                            placeholder="Disabled — camera perspective will NOT be rotated..."
                            className="rounded-xl bg-black/30 p-2.5 font-mono-tech text-[11px] text-white ring-1 ring-white/[0.08]"
                          />
                        </div>
                        <div className={cn("flex flex-col gap-1 rounded-2xl bg-white/[0.02] p-3 ring-1 ring-white/[0.06] transition-opacity", !(enabledAxes.compositions ?? true) && "opacity-50")}>
                          <div className="flex items-center justify-between text-[11px] text-[#9ca3af]">
                            <span className="inline-flex items-center gap-1.5 text-white">
                              <GridFour size={12} className="text-sky-300" /> Compositions
                              <span className="font-mono-tech text-[10px] text-[#646b78]">({parsedComps.length})</span>
                            </span>
                            <Switch
                              checked={enabledAxes.compositions ?? true}
                              onCheckedChange={(v) => setEnabledAxes((ea) => ({ ...ea, compositions: v }))}
                            />
                          </div>
                          <textarea
                            rows={4}
                            disabled={!(enabledAxes.compositions ?? true)}
                            value={axesText.compositions}
                            onChange={(e) =>
                              setAxesText((a) => ({ ...a, compositions: e.target.value }))
                            }
                            className="rounded-xl bg-black/30 p-2.5 font-mono-tech text-[11px] text-white ring-1 ring-white/[0.08]"
                          />
                        </div>
                        <div className={cn("flex flex-col gap-1 rounded-2xl bg-white/[0.02] p-3 ring-1 ring-white/[0.06] transition-opacity", !(enabledAxes.lighting ?? true) && "opacity-50")}>
                          <div className="flex items-center justify-between text-[11px] text-[#9ca3af]">
                            <span className="inline-flex items-center gap-1.5 text-white">
                              <SunDim size={12} className="text-amber-200" /> Lighting Setups
                              <span className="font-mono-tech text-[10px] text-[#646b78]">({parsedLighting.length})</span>
                            </span>
                            <Switch
                              checked={enabledAxes.lighting ?? true}
                              onCheckedChange={(v) => setEnabledAxes((ea) => ({ ...ea, lighting: v }))}
                            />
                          </div>
                          <textarea
                            rows={4}
                            disabled={!(enabledAxes.lighting ?? true)}
                            value={axesText.lighting}
                            onChange={(e) =>
                              setAxesText((a) => ({ ...a, lighting: e.target.value }))
                            }
                            className="rounded-xl bg-black/30 p-2.5 font-mono-tech text-[11px] text-white ring-1 ring-white/[0.08]"
                          />
                        </div>
                        <div className={cn("flex flex-col gap-1 rounded-2xl bg-white/[0.02] p-3 ring-1 ring-white/[0.06] transition-opacity", !(enabledAxes.atmospheres ?? true) && "opacity-50")}>
                          <div className="flex items-center justify-between text-[11px] text-[#9ca3af]">
                            <span className="inline-flex items-center gap-1.5 text-white">
                              <Wind size={12} className="text-emerald-300" /> Settings &amp; Canvas Grounds
                              <span className="font-mono-tech text-[10px] text-[#646b78]">({parsedAtmos.length})</span>
                            </span>
                            <Switch
                              checked={enabledAxes.atmospheres ?? true}
                              onCheckedChange={(v) => setEnabledAxes((ea) => ({ ...ea, atmospheres: v }))}
                            />
                          </div>
                          <textarea
                            rows={4}
                            disabled={!(enabledAxes.atmospheres ?? true)}
                            value={axesText.atmospheres}
                            onChange={(e) =>
                              setAxesText((a) => ({ ...a, atmospheres: e.target.value }))
                            }
                            className="rounded-xl bg-black/30 p-2.5 font-mono-tech text-[11px] text-white ring-1 ring-white/[0.08]"
                          />
                        </div>

                        {/* Optional 5th Flexible Custom Axis (Brushwork / Pose / Pattern / Styling) */}
                        <div className={cn("sm:col-span-2 flex flex-col gap-2 rounded-2xl bg-white/[0.025] p-3 ring-1 ring-amber-400/20 transition-opacity", !(enabledAxes.custom_axis ?? false) && "opacity-60")}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                              <SparkleIcon size={13} className="text-amber-300 shrink-0" />
                              <input
                                type="text"
                                value={customAxisLabel}
                                onChange={(e) => setCustomAxisLabel(e.target.value)}
                                placeholder="5th Axis Name (e.g. Brushwork, Pose & Expression, Color Flow)"
                                className="h-7 flex-1 rounded-lg bg-black/40 px-2.5 text-xs font-medium text-amber-200 ring-1 ring-white/[0.08] outline-none"
                              />
                              <span className="font-mono-tech text-[10px] text-[#646b78]">
                                ({parsedCustom.length} options)
                              </span>
                            </div>
                            <Switch
                              checked={enabledAxes.custom_axis ?? false}
                              onCheckedChange={(v) => setEnabledAxes((ea) => ({ ...ea, custom_axis: v }))}
                            />
                          </div>
                          <textarea
                            rows={3}
                            disabled={!(enabledAxes.custom_axis ?? false)}
                            value={axesText.custom_axis}
                            onChange={(e) =>
                              setAxesText((a) => ({ ...a, custom_axis: e.target.value }))
                            }
                            placeholder="Optional 5th axis options (1 per line) — e.g. Willow charcoal strokes, Wet watercolor washes, Minimalist floating botanicals..."
                            className="rounded-xl bg-black/30 p-2.5 font-mono-tech text-[11px] text-white ring-1 ring-white/[0.08]"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between border-t border-white/[0.06] pt-3">
                      <span className="text-xs text-[#9ca3af]">
                        Optimize visual generation prompts in English while writing Title & Description in {metadataLanguage}
                      </span>
                      <Switch
                        checked={optimizePromptEnglish}
                        onCheckedChange={setOptimizePromptEnglish}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Action Bar */}
              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/[0.06] pt-4">
                <p className="text-xs text-[#9ca3af]">
                  {runMode === "fixed"
                    ? `Plans ${targetCount} distinct variations for inspection in Step 02 (Plan).`
                    : `Plans waves of ${batchSize} variations up to a session cap of ${sessionCap}.`}
                </p>

                <div className="flex flex-wrap items-center gap-3">
                  <StudioButton
                    variant="secondary"
                    disabled={!theme.trim() || submitting || Boolean(referenceUnsupported)}
                    loading={submitting}
                    onClick={() => handleSubmit(true)}
                    icon={<Play size={15} weight="fill" />}
                  >
                    Plan & Start Run
                  </StudioButton>

                  <StudioButton
                    variant="primary"
                    disabled={!theme.trim() || submitting || Boolean(referenceUnsupported)}
                    loading={submitting}
                    onClick={() => handleSubmit(false)}
                    icon={<ArrowRight size={16} weight="light" />}
                  >
                    Build Variation Plan
                  </StudioButton>
                </div>
              </div>
            </div>
          </StudioPanel>
        </div>

        {/* Right 4 Columns: Live Variation Matrix Preview & Recent Sets */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          <StudioPanel
            eyebrow="LIVE VARIATION MATRIX"
            title="Shot Diversity Preview"
          >
            <div className="flex flex-col gap-4">
              {/* Active Locked Continuity Summary Card */}
              <div className="rounded-2xl bg-white/[0.03] p-3.5 ring-1 ring-white/[0.08] space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 font-mono-tech text-[10px] uppercase tracking-wider text-amber-300">
                    <LockKey size={12} weight="fill" />
                    Locked Continuity
                  </span>
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono-tech text-[10px] text-[#d1d5db]">
                    {selectedPresetId === "ai_custom"
                      ? "AI Custom"
                      : presets.find((p) => p.id === selectedPresetId)?.label || "Preset"}
                  </span>
                </div>
                <p className="text-xs font-medium text-white line-clamp-2">
                  {fixedElements.style || "Adaptive high-resolution visual style"}
                </p>
                {fixedElements.color_palette && (
                  <p className="text-[11px] text-[#9ca3af] line-clamp-1">
                    Palette: <span className="text-[#d1d5db]">{fixedElements.color_palette}</span>
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between">
                <p className="text-xs text-[#9ca3af]">
                  Rotated axes preview across first 4 shots:
                </p>
                <span className="font-mono-tech text-[10px] text-emerald-300">
                  {runMode === "fixed" ? `${targetCount} shots total` : `${batchSize}/wave`}
                </span>
              </div>

              <div className="flex flex-col gap-2.5">
                {[0, 1, 2, 3].map((idx) => {
                  const angle = parsedAngles[idx % Math.max(1, parsedAngles.length)] || "Hero angle"
                  const comp = parsedComps[(idx * 2 + 1) % Math.max(1, parsedComps.length)] || "Rule of thirds"
                  const light = parsedLighting[(idx * 3 + 2) % Math.max(1, parsedLighting.length)] || "Natural light"
                  const atmos = parsedAtmos[(idx * 5 + 3) % Math.max(1, parsedAtmos.length)] || "Authentic setting"
                  const customVal = parsedCustom[(idx * 7) % Math.max(1, parsedCustom.length)] || ""
                  const pairedRefId =
                    referenceMode !== "prompt_only" && selectedRefIds.length > 0
                      ? cycleReferences || idx < selectedRefIds.length
                        ? selectedRefIds[idx % selectedRefIds.length]
                        : null
                      : null

                  return (
                    <div
                      key={idx}
                      className="rounded-2xl bg-white/[0.025] p-3 ring-1 ring-white/[0.06] hover:ring-white/[0.12] transition-all space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="inline-flex items-center gap-1.5 font-mono-tech text-[11px] font-semibold text-white">
                          <span className="flex size-5 items-center justify-center rounded-full bg-white/[0.08] text-[10px]">
                            {idx + 1}
                          </span>
                          Shot #{String(idx + 1).padStart(3, "0")}
                        </span>
                        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-mono-tech text-[10px] text-emerald-300 ring-1 ring-emerald-400/20">
                          {pairedRefId ? `Ref #${pairedRefId}` : "Pure Prompt"} · {aspectRatio}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 text-[10px] text-[#9ca3af]">
                        {(enabledAxes.camera_angles ?? true) && (
                          <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.02] px-2 py-1 truncate ring-1 ring-white/[0.04]" title={angle}>
                            <Camera size={11} className="shrink-0 text-amber-300/90" />
                            <span className="truncate">{angle}</span>
                          </span>
                        )}
                        {(enabledAxes.compositions ?? true) && (
                          <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.02] px-2 py-1 truncate ring-1 ring-white/[0.04]" title={comp}>
                            <GridFour size={11} className="shrink-0 text-sky-300/90" />
                            <span className="truncate">{comp}</span>
                          </span>
                        )}
                        {(enabledAxes.lighting ?? true) && (
                          <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.02] px-2 py-1 truncate ring-1 ring-white/[0.04]" title={light}>
                            <SunDim size={11} className="shrink-0 text-amber-200/90" />
                            <span className="truncate">{light}</span>
                          </span>
                        )}
                        {(enabledAxes.atmospheres ?? true) && (
                          <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.02] px-2 py-1 truncate ring-1 ring-white/[0.04]" title={atmos}>
                            <Wind size={11} className="shrink-0 text-emerald-300/90" />
                            <span className="truncate">{atmos}</span>
                          </span>
                        )}
                        {(enabledAxes.custom_axis ?? false) && customVal && (
                          <span className="col-span-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-400/[0.05] px-2 py-1 truncate text-amber-200/90 ring-1 ring-amber-400/20" title={customVal}>
                            <SparkleIcon size={11} className="shrink-0 text-amber-300" />
                            <span className="truncate">{customAxisLabel}: {customVal}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Export Contract Summary */}
              {(() => {
                const kwSlug = slugifyKeywordPreview(primaryTag || theme)
                const cleanTitleKw =
                  formatPicassyKeyword(primaryTag || theme) || "Beautiful Image"
                const ext = exportImageFormat === "original" ? "orig" : exportImageFormat
                const f1 = filenameStyle === "studio_seq" ? `001_${kwSlug}` : `${kwSlug}-1`
                const f2 = filenameStyle === "studio_seq" ? `002_${kwSlug}` : `${kwSlug}-2`
                return (
                  <div className="rounded-2xl bg-black/40 p-3.5 ring-1 ring-white/[0.06] font-mono-tech text-[11px] text-[#9ca3af] space-y-1">
                    <p className="text-[#e5e7eb] font-medium">
                      exports/YYYY-MM-DD_HHMMSS_{kwSlug.slice(0, 20)}/
                    </p>
                    <p className="pl-2 text-[10px] text-amber-200/80">
                      Title Prefix &amp; Tag: &quot;{cleanTitleKw}&quot; · Category: {category}
                    </p>
                    {metadataExportMode === "csv" ? (
                      <>
                        <p className="pl-2 text-[#d1d5db]">
                          ├── {f1}.{ext}
                        </p>
                        <p className="pl-2 text-[#d1d5db]">
                          ├── {f2}.{ext}
                        </p>
                        <p className="pl-2 text-amber-300">
                          └── pin-import.csv (8 cols · Peak + Prompt)
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="pl-2 text-emerald-300/80">
                          ├── {f1}.{ext} (Image only)
                        </p>
                        <p className="pl-2 text-emerald-300/80">
                          └── {f2}.{ext} (Max speed)
                        </p>
                      </>
                    )}
                  </div>
                )
              })()}
            </div>
          </StudioPanel>

          <StudioPanel
            eyebrow="WORKSPACE ARCHIVE"
            title="Recent Image Sets"
          >
            {recentJobs.length === 0 ? (
              <p className="text-xs text-[#646b78]">
                No image sets created yet. Enter a theme or click one of the sample briefs on the left to start.
              </p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {recentJobs.slice(0, 6).map((job) => (
                  <div
                    key={job.id}
                    className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.025] p-3.5 ring-1 ring-white/[0.06] hover:bg-white/[0.05]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[#f4f5f7]">
                        {job.theme}
                      </p>
                      <p className="mt-0.5 font-mono-tech text-[11px] text-[#9ca3af]">
                        #{job.id} · {job.counts.completed}/{job.counts.total} done · {job.aspect_ratio} ·{" "}
                        {(job.export_image_format || "original").toUpperCase()} ·{" "}
                        {(job.metadata_export_mode || "csv").toUpperCase()}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onSelectJob(job, "plan")}
                        className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[11px] text-[#d1d5db] hover:bg-white/[0.1] cursor-pointer"
                      >
                        Plan
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onSelectJob(
                            job,
                            job.counts.completed > 0 ? "gallery" : "run"
                          )
                        }
                        className="rounded-full bg-white/[0.08] px-2.5 py-1 text-[11px] text-white hover:bg-white/[0.15] cursor-pointer"
                      >
                        {job.counts.completed > 0 ? "Gallery" : "Run"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteJob(job.id, false)}
                        title={`Delete set #${job.id}`}
                        className="flex size-7 items-center justify-center rounded-full bg-white/[0.04] text-[#646b78] hover:bg-rose-500/20 hover:text-rose-300 cursor-pointer"
                      >
                        <Trash size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </StudioPanel>
        </div>
      </div>

      <ExternalAiImportDialog
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        theme={theme}
        basePrompt={basePrompt}
        targetCount={runMode === "continuous" ? sessionCap : targetCount}
        metadataLanguage={metadataLanguage}
        onApplyImported={(data, opts) =>
          applyAxesSuggestionResult(data, opts.applyMetaFields)
        }
      />
    </div>
  )
}
