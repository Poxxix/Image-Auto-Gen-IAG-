import * as React from "react"
import {
  Sparkle,
  UploadSimple,
  Compass,
  Sliders,
  Play,
  ListChecks,
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
  CaretDown,
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
  REFERENCE_STRENGTH_OPTIONS,
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
  type ReferenceStrengthMode,
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
  onBulkDeleteReferences?: (options: {
    reference_ids?: number[]
    source_type?: "local_upload" | "pinterest"
    delete_all?: boolean
  }) => Promise<void>
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
  "1:1": { label: "Square", res: "1080×1080", wClass: "w-5", hClass: "h-5" },
  "4:5": { label: "Editorial", res: "1080×1350", wClass: "w-4", hClass: "h-5" },
  "9:16": { label: "Vertical", res: "1080×1920", wClass: "w-3.5", hClass: "h-6" },
  "16:9": { label: "Cinema", res: "1920×1080", wClass: "w-6", hClass: "h-3.5" },
  "3:2": { label: "35mm", res: "1620×1080", wClass: "w-5", hClass: "h-3.5" },
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
  onBulkDeleteReferences,
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
  const [referenceStrength, setReferenceStrength] =
    React.useState<ReferenceStrengthMode>("balanced")
  const [deletingRefBusy, setDeletingRefBusy] = React.useState(false)
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
  }, [settings, exportRootDir])

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
  const [showShotPreview, setShowShotPreview] = React.useState(false)
  const [showCaptionEditor, setShowCaptionEditor] = React.useState(false)
  const [showImportDialog, setShowImportDialog] = React.useState(false)
  const [suggestingAxes, setSuggestingAxes] = React.useState(false)
  const [aiSuggestSource, setAiSuggestSource] = React.useState<string | null>(null)
  const [suggestError, setSuggestError] = React.useState<string | null>(null)

  const fileInputRef = React.useRef<HTMLInputElement | null>(null)

  const currentModelInfo = React.useMemo(
    () => providers.find((p) => p.id === selectedModel) || providers[0],
    [providers, selectedModel]
  )

  const supportedRatios =
    currentModelInfo?.supported_aspect_ratios || aspectRatios

  const supportedImageFormats =
    (currentModelInfo?.supported_formats as ExportImageFormat[] | undefined) || [
      "original",
      "png",
      "jpg",
      "webp",
    ]

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
      if (res.theme) {
        setTheme(res.theme)
        if (!primaryTagManualRef.current) {
          setPrimaryTag(formatPicassyKeyword(res.theme))
        }
      }
      if (res.base_prompt) setBasePrompt(res.base_prompt)
      if (res.aspect_ratio && supportedRatios.includes(res.aspect_ratio)) {
        setAspectRatio(res.aspect_ratio)
      }
      if (res.reference_strength) {
        setReferenceStrength(res.reference_strength)
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
      setSuggestError("Enter a theme above first so AI can tailor the variation axes.")
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
      primary_tag: primaryTag.trim() || theme.trim(),
      category: category.trim(),
      filename_style: filenameStyle,
      preferred_cdp_slot: preferredCdpSlot,
      base_prompt: basePrompt.trim(),
      reference_mode: referenceMode,
      reference_strength: referenceStrength,
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

  const parsedAngles = splitLines(axesText.camera_angles)
  const parsedLighting = splitLines(axesText.lighting)
  const parsedComps = splitLines(axesText.compositions)
  const parsedAtmos = splitLines(axesText.atmospheres)
  const parsedCustom = splitLines(axesText.custom_axis)

  const activePresetLabel =
    selectedPresetId === "ai_custom"
      ? "AI custom"
      : presets.find((p) => p.id === selectedPresetId)?.label || "Preset"

  const kwSlug = slugifyKeywordPreview(primaryTag || theme)
  const cleanTitleKw = formatPicassyKeyword(primaryTag || theme) || "Beautiful Image"
  const extPreview = exportImageFormat === "original" ? "orig" : exportImageFormat
  const sampleFile1 = filenameStyle === "studio_seq" ? `001_${kwSlug}` : `${kwSlug}-1`
  const sampleFile2 = filenameStyle === "studio_seq" ? `002_${kwSlug}` : `${kwSlug}-2`

  return (
    <div className="flex flex-col gap-5">
      {/* Screen Header */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#2E2E2E] pb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-[#F5F5F5]">
            Create image set
          </h1>
          <p className="mt-0.5 max-w-2xl text-xs sm:text-sm text-[#A3A3A3]">
            Set your Picassy keyword and visual source on the left, then configure size, Chrome slot, and export options on the right.
          </p>
        </div>

        <StudioBadge
          tone={currentModelInfo?.ready ? "emerald" : "neutral"}
          label={currentModelInfo?.status_label || "Provider standby"}
        />
      </div>

      {/* 2-Column Neutral Workbench */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
        {/* LEFT COLUMN (7/12) */}
        <div className="lg:col-span-7 flex flex-col gap-5">
          <StudioPanel noPadding>
            <div className="divide-y divide-[#2E2E2E]">
              {/* Section 1: Theme & Taxonomy */}
              <div className="p-4 sm:p-5 flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="studio-theme-input"
                      className="text-xs font-semibold text-[#F5F5F5]"
                    >
                      Theme or subject *
                    </label>
                    <span className="font-mono-tech text-[11px] text-[#737373]">
                      {filenameStyle === "picassy_slug"
                        ? `${kwSlug}-1.${extPreview}`
                        : `001_${kwSlug}.${extPreview}`}
                    </span>
                  </div>
                  <input
                    id="studio-theme-input"
                    type="text"
                    value={theme}
                    onChange={(e) => {
                      const nextVal = e.target.value
                      setTheme(nextVal)
                      if (!primaryTagManualRef.current) {
                        setPrimaryTag(formatPicassyKeyword(nextVal))
                      }
                    }}
                    placeholder="Enter theme or keyword (e.g., Charcoal Portrait Sketch or Sympathy Messages)"
                    className="h-10 w-full rounded-md border border-[#383838] bg-[#262626] px-3.5 text-sm font-medium text-[#F5F5F5] placeholder:text-[#737373] outline-none transition-colors duration-150 focus:border-[#A3A3A3]"
                  />

                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <span className="text-[11px] text-[#737373] mr-0.5">Samples:</span>
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
                        className="rounded border border-[#2E2E2E] bg-[#171717] px-2.5 py-1 text-[11px] text-[#A3A3A3] transition-colors duration-150 hover:border-[#404040] hover:text-[#F5F5F5] cursor-pointer"
                      >
                        {sample.theme}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Primary Keyword + Category + Filename Rule */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                  <div className="sm:col-span-5 flex flex-col gap-1">
                    <label
                      htmlFor="studio-primary-tag"
                      className="text-xs font-medium text-[#A3A3A3]"
                    >
                      Tag chính (Primary keyword) *
                    </label>
                    <input
                      id="studio-primary-tag"
                      type="text"
                      value={primaryTag}
                      onChange={(e) => {
                        primaryTagManualRef.current = e.target.value.trim().length > 0
                        setPrimaryTag(e.target.value)
                      }}
                      placeholder="Title Case keyword"
                      className="h-9 rounded-md border border-[#2E2E2E] bg-[#262626] px-3 text-xs sm:text-sm text-[#F5F5F5] placeholder:text-[#737373] outline-none focus:border-[#A3A3A3]"
                    />
                  </div>

                  <div className="sm:col-span-4 flex flex-col gap-1">
                    <label className="text-xs font-medium text-[#A3A3A3]">
                      Category (1 per set)
                    </label>
                    <Select
                      value={
                        categoryOptions.includes(category) ? category : categoryOptions[0]
                      }
                      onValueChange={(v) => v && setCategory(v)}
                    >
                      <SelectTrigger className="h-9 text-xs sm:text-sm">
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

                  <div className="sm:col-span-3 flex flex-col gap-1">
                    <label className="text-xs font-medium text-[#A3A3A3]">
                      Filename rule
                    </label>
                    <Select
                      value={filenameStyle}
                      onValueChange={(v) => v && setFilenameStyle(v as FilenameStyle)}
                    >
                      <SelectTrigger className="h-9 text-xs sm:text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="picassy_slug">slug-1, 2…</SelectItem>
                        <SelectItem value="studio_seq">001_slug</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Shared Visual Direction */}
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="studio-base-prompt"
                    className="text-xs font-medium text-[#A3A3A3]"
                  >
                    Shared visual direction (optional)
                  </label>
                  <textarea
                    id="studio-base-prompt"
                    rows={2}
                    value={basePrompt}
                    onChange={(e) => setBasePrompt(e.target.value)}
                    placeholder="Focal objects, textures, or medium details shared across every shot…"
                    className="w-full rounded-md border border-[#2E2E2E] bg-[#262626] p-3 text-xs sm:text-sm text-[#F5F5F5] placeholder:text-[#737373] outline-none focus:border-[#A3A3A3]"
                  />
                </div>
              </div>

              {/* Section 2: Inspiration Source & References */}
              <div className="p-4 sm:p-5 flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#F5F5F5]">
                      Source mode
                    </span>
                    <span className="text-xs text-[#737373]">
                      {referenceMode === "prompt_only"
                        ? "Text prompt only"
                        : `${selectedRefIds.length} reference image(s) selected`}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {[
                      {
                        id: "prompt_only" as ReferenceMode,
                        label: "Pure prompt",
                        sub: "Text brief & variation axes only",
                        icon: <Sparkle size={15} />,
                      },
                      {
                        id: "local_upload" as ReferenceMode,
                        label: "Reference upload",
                        sub: "Pair your own PNG, JPG, or WebP files",
                        icon: <UploadSimple size={15} />,
                      },
                      {
                        id: "pinterest" as ReferenceMode,
                        label: "Pinterest search",
                        sub: "Fetch candidates from keyword or URL",
                        icon: <Compass size={15} />,
                      },
                    ].map((mode) => {
                      const active = referenceMode === mode.id
                      return (
                        <button
                          key={mode.id}
                          type="button"
                          onClick={() => setReferenceMode(mode.id)}
                          className={cn(
                            "flex items-start gap-2.5 rounded-md border p-3 text-left transition-colors duration-150 cursor-pointer",
                            active
                              ? "border-[#D4D4D4] bg-[#262626] text-[#F5F5F5]"
                              : "border-[#2E2E2E] bg-[#171717] text-[#A3A3A3] hover:border-[#404040] hover:text-[#F5F5F5]"
                          )}
                        >
                          <span
                            className={cn(
                              "mt-0.5 shrink-0",
                              active ? "text-[#F5F5F5]" : "text-[#737373]"
                            )}
                          >
                            {mode.icon}
                          </span>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-[#F5F5F5]">
                              {mode.label}
                            </p>
                            <p className="mt-0.5 text-[11px] leading-snug text-[#A3A3A3]">
                              {mode.sub}
                            </p>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {referenceMode !== "prompt_only" && (
                  <div className="flex flex-col gap-4 pt-1">
                    {/* 3-Mode Reference Variation Strength */}
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label className="text-xs font-medium text-[#F5F5F5]">
                          Độ bám ảnh mẫu (Reference variation mode)
                        </label>
                        <span className="font-mono-tech text-[11px] text-[#737373]">
                          75–115 words target
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        {REFERENCE_STRENGTH_OPTIONS.map((opt) => {
                          const active = referenceStrength === opt.id
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => setReferenceStrength(opt.id)}
                              className={cn(
                                "flex flex-col items-start gap-1 rounded-md border p-2.5 text-left transition-colors duration-150 cursor-pointer",
                                active
                                  ? "border-[#D4D4D4] bg-[#262626] text-[#F5F5F5]"
                                  : "border-[#2E2E2E] bg-[#171717] text-[#A3A3A3] hover:border-[#404040]"
                              )}
                            >
                              <div className="flex w-full items-center justify-between gap-1.5">
                                <span className="text-xs font-semibold text-[#F5F5F5]">
                                  {opt.label}
                                </span>
                                <span
                                  className={cn(
                                    "rounded px-1.5 py-0.5 font-mono-tech text-[10px]",
                                    active
                                      ? "bg-[#FAFAFA] text-[#121212] font-semibold"
                                      : "bg-[#262626] text-[#737373]"
                                  )}
                                >
                                  {opt.badge}
                                </span>
                              </div>
                              <p className="text-[11px] leading-snug text-[#A3A3A3]">
                                {opt.description}
                              </p>
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {referenceMode === "local_upload" ? (
                      <div
                        onDragOver={(e) => {
                          e.preventDefault()
                          setDragActive(true)
                        }}
                        onDragLeave={() => setDragActive(false)}
                        onDrop={handleDrop}
                        className={cn(
                          "flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed px-4 py-3.5 transition-colors duration-150",
                          dragActive
                            ? "border-[#FAFAFA] bg-[#262626]"
                            : "border-[#404040] bg-[#171717]"
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
                        <div className="flex items-center gap-3">
                          <span className="flex size-9 items-center justify-center rounded-md border border-[#2E2E2E] bg-[#262626] text-[#F5F5F5]">
                            <UploadSimple size={18} />
                          </span>
                          <div>
                            <p className="text-xs font-medium text-[#F5F5F5]">
                              Drop reference images here or browse files
                            </p>
                            <p className="text-[11px] text-[#737373]">
                              PNG, JPG, WebP — optimized automatically before upload
                            </p>
                          </div>
                        </div>
                        <StudioButton
                          variant="secondary"
                          loading={uploading}
                          onClick={() => fileInputRef.current?.click()}
                          icon={<UploadSimple size={14} />}
                        >
                          {uploading ? "Uploading…" : "Choose files"}
                        </StudioButton>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2 rounded-md border border-[#2E2E2E] bg-[#171717] p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-medium text-[#F5F5F5]">
                            Discover Pinterest candidates
                          </span>
                          <span className="font-mono-tech text-[10px] text-[#737373]">
                            {settings?.pinterest_access_token_configured
                              ? "API v5 token active"
                              : "Candidate preview mode"}
                          </span>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <input
                            type="text"
                            value={pinterestQuery}
                            onChange={(e) => setPinterestQuery(e.target.value)}
                            placeholder={
                              theme
                                ? `Keyword, Pin URL, or Board URL (defaults to "${theme}")`
                                : "Keyword, Pin URL (pinterest.com/pin/…), or Board URL"
                            }
                            className="h-9 flex-1 rounded-md border border-[#2E2E2E] bg-[#262626] px-3 text-xs text-[#F5F5F5] placeholder:text-[#737373] outline-none focus:border-[#A3A3A3]"
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
                            className="h-9 w-18 rounded-md border border-[#2E2E2E] bg-[#262626] px-2.5 text-center font-mono-tech text-xs text-[#F5F5F5]"
                          />
                          <StudioButton
                            variant="secondary"
                            loading={discovering}
                            onClick={handlePinterestDiscover}
                            icon={<Compass size={14} />}
                          >
                            {discovering ? "Fetching…" : "Fetch pins"}
                          </StudioButton>
                        </div>
                      </div>
                    )}

                    {/* Reference Grid */}
                    {filteredRefs.length > 0 && (
                      <div className="flex flex-col gap-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#A3A3A3]">
                          <span className="tabular-nums">
                            Selected <strong className="text-[#F5F5F5]">{selectedRefIds.length}</strong> of{" "}
                            <strong className="text-[#F5F5F5]">{filteredRefs.length}</strong> imported
                          </span>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedRefIds(filteredRefs.map((r) => r.id))
                              }
                              className="rounded border border-[#383838] bg-[#262626] px-2.5 py-1 text-[11px] text-[#F5F5F5] hover:border-[#525252] cursor-pointer"
                            >
                              Select all
                            </button>
                            {selectedRefIds.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setSelectedRefIds([])}
                                className="rounded border border-[#2E2E2E] bg-[#171717] px-2.5 py-1 text-[11px] text-[#A3A3A3] hover:text-[#F5F5F5] cursor-pointer"
                              >
                                Unselect
                              </button>
                            )}
                            {selectedRefIds.length > 0 && (
                              <button
                                type="button"
                                disabled={deletingRefBusy}
                                onClick={async () => {
                                  const idsToRemove = [...selectedRefIds]
                                  setDeletingRefBusy(true)
                                  try {
                                    setSelectedRefIds([])
                                    if (onBulkDeleteReferences) {
                                      await onBulkDeleteReferences({
                                        reference_ids: idsToRemove,
                                      })
                                    } else {
                                      for (const rid of idsToRemove) {
                                        await onDeleteReference(rid)
                                      }
                                    }
                                  } finally {
                                    setDeletingRefBusy(false)
                                  }
                                }}
                                className="inline-flex items-center gap-1 rounded border border-[#EF4444]/35 bg-[#262626] px-2.5 py-1 text-[11px] font-medium text-[#FCA5A5] hover:bg-[#EF4444]/15 cursor-pointer"
                              >
                                <Trash size={12} />
                                Delete selected ({selectedRefIds.length})
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={deletingRefBusy}
                              onClick={async () => {
                                setDeletingRefBusy(true)
                                try {
                                  setSelectedRefIds([])
                                  if (onBulkDeleteReferences) {
                                    await onBulkDeleteReferences({
                                      source_type:
                                        referenceMode === "pinterest"
                                          ? "pinterest"
                                          : "local_upload",
                                    })
                                  } else {
                                    for (const r of filteredRefs) {
                                      await onDeleteReference(r.id)
                                    }
                                  }
                                } finally {
                                  setDeletingRefBusy(false)
                                }
                              }}
                              className="inline-flex items-center gap-1 rounded border border-[#2E2E2E] bg-[#171717] px-2.5 py-1 text-[11px] text-[#A3A3A3] hover:border-[#EF4444]/35 hover:text-[#FCA5A5] cursor-pointer"
                              title="Delete all imported reference images in this tab"
                            >
                              <Trash size={12} />
                              Delete all ({filteredRefs.length})
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5">
                          {filteredRefs.map((ref) => {
                            const isSelected = selectedRefIds.includes(ref.id)
                            const orderIdx = selectedRefIds.indexOf(ref.id)
                            return (
                              <div
                                key={ref.id}
                                className={cn(
                                  "group relative overflow-hidden rounded-md border bg-[#121212] transition-colors duration-150",
                                  isSelected
                                    ? "border-[#FAFAFA] ring-1 ring-[#FAFAFA]"
                                    : "border-[#2E2E2E] opacity-85 hover:border-[#525252] hover:opacity-100"
                                )}
                              >
                                <button
                                  type="button"
                                  onClick={() => toggleRefSelection(ref.id)}
                                  className="block aspect-square w-full overflow-hidden bg-[#121212] cursor-pointer"
                                >
                                  <img
                                    src={getReferenceImageUrl(ref.id)}
                                    alt={ref.title}
                                    className="h-full w-full object-cover"
                                  />
                                </button>
                                <button
                                  type="button"
                                  disabled={deletingRefBusy}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setSelectedRefIds((prev) =>
                                      prev.filter((x) => x !== ref.id)
                                    )
                                    onDeleteReference(ref.id)
                                  }}
                                  aria-label={`Delete reference ${ref.id}`}
                                  title={`Delete reference #${ref.id}`}
                                  className="absolute top-1.5 right-1.5 z-10 flex size-6 shrink-0 items-center justify-center rounded border border-[#404040] bg-[#121212]/90 text-[#F5F5F5] transition-colors duration-150 hover:border-[#EF4444] hover:bg-[#EF4444] hover:text-white cursor-pointer"
                                >
                                  <Trash size={12} weight="bold" />
                                </button>
                                <div className="flex items-center justify-between border-t border-[#2E2E2E] bg-[#171717] px-2 py-1 font-mono-tech text-[10px] text-[#A3A3A3]">
                                  <span className="truncate">
                                    #{ref.id} · {ref.width}×{ref.height}
                                  </span>
                                </div>
                                {isSelected && (
                                  <span className="pointer-events-none absolute top-1.5 left-1.5 flex h-5 items-center gap-1 rounded bg-[#FAFAFA] px-1.5 font-mono-tech text-[10px] font-bold text-[#121212]">
                                    <CheckCircle size={11} weight="bold" />#{orderIdx + 1}
                                  </span>
                                )}
                              </div>
                            )
                          })}
                        </div>

                        <div className="flex items-center justify-between gap-3 rounded-md border border-[#2E2E2E] bg-[#171717] px-3.5 py-2.5">
                          <div>
                            <p className="text-xs font-medium text-[#F5F5F5]">
                              Cycle references across shots
                            </p>
                            <p className="text-[11px] text-[#737373]">
                              When target count ({targetCount}) exceeds selected references ({selectedRefIds.length}), rotate references with fresh axes.
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
                      <div className="rounded-md border border-[#EF4444]/35 bg-[#EF4444]/10 p-3 text-xs text-[#FCA5A5]">
                        Model <strong>{currentModelInfo?.label}</strong> does not accept reference images. Choose a reference-capable model or switch to Pure prompt.
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Section 3: Style Presets & Collapsible Variation Axes */}
              <div className="p-4 sm:p-5 flex flex-col gap-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2">
                    <Sliders size={15} className="text-[#A3A3A3]" />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-[#F5F5F5]">
                        Style preset &amp; variation axes
                      </span>
                      <span className="rounded border border-[#2E2E2E] bg-[#262626] px-2 py-0.5 text-[11px] text-[#A3A3A3]">
                        {activePresetLabel}
                      </span>
                      {aiSuggestSource && (
                        <span className="rounded border border-[#404040] bg-[#262626] px-2 py-0.5 text-[11px] text-[#F5F5F5]">
                          {aiSuggestSource}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setShowImportDialog(true)}
                      title="Copy sample prompt and import JSON axes"
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#383838] bg-[#262626] px-2.5 text-xs font-medium text-[#F5F5F5] hover:border-[#525252] cursor-pointer"
                    >
                      <FileCode size={13} className="text-[#A3A3A3]" />
                      Sample &amp; JSON
                    </button>
                    <button
                      type="button"
                      disabled={suggestingAxes}
                      onClick={handleSuggestAxes}
                      className={cn(
                        "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors duration-150 cursor-pointer",
                        selectedPresetId === "ai_custom"
                          ? "border-[#FAFAFA] bg-[#FAFAFA] text-[#121212] font-semibold"
                          : "border-[#383838] bg-[#262626] text-[#F5F5F5] hover:border-[#525252]"
                      )}
                    >
                      <MagicWand
                        size={13}
                        className={suggestingAxes ? "animate-spin" : ""}
                      />
                      {suggestingAxes ? "Analyzing…" : "AI suggest"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAxesConfig((v) => !v)}
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-[#2E2E2E] bg-[#171717] px-2.5 text-xs font-medium text-[#A3A3A3] hover:border-[#404040] hover:text-[#F5F5F5] cursor-pointer"
                    >
                      <span>{showAxesConfig ? "Hide axes" : "Edit axes"}</span>
                      <CaretDown
                        size={12}
                        className={cn(
                          "transition-transform duration-150",
                          showAxesConfig && "rotate-180"
                        )}
                      />
                    </button>
                  </div>
                </div>

                {suggestError && (
                  <div className="rounded-md border border-[#EF4444]/35 bg-[#EF4444]/10 px-3 py-2 text-xs text-[#FCA5A5]">
                    {suggestError}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {presets.map((p) => {
                    const isSelected = selectedPresetId === p.id
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleApplyPreset(p.id)}
                        className={cn(
                          "flex flex-col items-start rounded-md border p-2.5 text-left transition-colors duration-150 cursor-pointer",
                          isSelected
                            ? "border-[#D4D4D4] bg-[#262626] text-[#F5F5F5]"
                            : "border-[#2E2E2E] bg-[#171717] text-[#A3A3A3] hover:border-[#404040] hover:text-[#F5F5F5]"
                        )}
                      >
                        <span className="text-xs font-semibold">{p.label}</span>
                        <span className="mt-0.5 line-clamp-1 text-[10px] text-[#737373]">
                          {p.description}
                        </span>
                      </button>
                    )
                  })}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#2E2E2E] bg-[#171717] px-3 py-2 text-xs">
                  <div className="min-w-0 flex-1 truncate text-[#A3A3A3]">
                    <span className="font-medium text-[#F5F5F5]">Style lock: </span>
                    {fixedElements.style || "Adaptive high-resolution visual style"}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowShotPreview((v) => !v)}
                    className="shrink-0 text-[11px] font-medium text-[#F5F5F5] hover:underline cursor-pointer"
                  >
                    {showShotPreview ? "Hide preview" : "Preview 4 shots"}
                  </button>
                </div>

                {showShotPreview && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {[0, 1, 2, 3].map((idx) => {
                      const angle =
                        parsedAngles[idx % Math.max(1, parsedAngles.length)] ||
                        "Hero angle"
                      const comp =
                        parsedComps[(idx * 2 + 1) % Math.max(1, parsedComps.length)] ||
                        "Rule of thirds"
                      const light =
                        parsedLighting[
                          (idx * 3 + 2) % Math.max(1, parsedLighting.length)
                        ] || "Natural light"
                      const atmos =
                        parsedAtmos[(idx * 5 + 3) % Math.max(1, parsedAtmos.length)] ||
                        "Authentic ground"
                      const customVal =
                        parsedCustom[(idx * 7) % Math.max(1, parsedCustom.length)] || ""
                      const pairedRefId =
                        referenceMode !== "prompt_only" && selectedRefIds.length > 0
                          ? cycleReferences || idx < selectedRefIds.length
                            ? selectedRefIds[idx % selectedRefIds.length]
                            : null
                          : null

                      return (
                        <div
                          key={idx}
                          className="rounded-md border border-[#2E2E2E] bg-[#171717] p-2.5 space-y-1.5"
                        >
                          <div className="flex items-center justify-between font-mono-tech text-[11px]">
                            <span className="font-semibold text-[#F5F5F5]">
                              Shot #{String(idx + 1).padStart(2, "0")}
                            </span>
                            <span className="text-[#A3A3A3]">
                              {pairedRefId ? `Ref #${pairedRefId}` : "Prompt"} ·{" "}
                              {aspectRatio}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-1 text-[11px] text-[#A3A3A3]">
                            {(enabledAxes.camera_angles ?? true) && (
                              <span className="truncate" title={angle}>
                                • {angle}
                              </span>
                            )}
                            {(enabledAxes.compositions ?? true) && (
                              <span className="truncate" title={comp}>
                                • {comp}
                              </span>
                            )}
                            {(enabledAxes.lighting ?? true) && (
                              <span className="truncate" title={light}>
                                • {light}
                              </span>
                            )}
                            {(enabledAxes.atmospheres ?? true) && (
                              <span className="truncate" title={atmos}>
                                • {atmos}
                              </span>
                            )}
                            {(enabledAxes.custom_axis ?? false) && customVal && (
                              <span
                                className="col-span-2 truncate text-[#D4D4D4]"
                                title={customVal}
                              >
                                • {customAxisLabel}: {customVal}
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {showAxesConfig && (
                  <div className="flex flex-col gap-4 border-t border-[#2E2E2E] pt-4">
                    <div>
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#F5F5F5]">
                          <LockKey size={13} className="text-[#A3A3A3]" />
                          Locked continuity across set
                        </span>
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
                          className="text-xs text-[#A3A3A3] hover:text-[#F5F5F5] cursor-pointer"
                        >
                          Clear overrides
                        </button>
                      </div>
                      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                        {(
                          [
                            ["subject", "Subject / framing lock", "Front-facing or focal lock"],
                            ["style", "Visual style / medium", "Medium, lens, rendering style"],
                            ["color_palette", "Color palette", "Shared tones & contrast"],
                            ["brand_mood", "Mood & tone", "Editorial atmosphere"],
                          ] as const
                        ).map(([fKey, fLabel, fPlaceholder]) => {
                          const isOn = enabledFixed[fKey] ?? true
                          return (
                            <div
                              key={fKey}
                              className={cn(
                                "flex flex-col gap-1 transition-opacity",
                                !isOn && "opacity-45"
                              )}
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-[#A3A3A3]">{fLabel}</span>
                                <Switch
                                  checked={isOn}
                                  onCheckedChange={(v) =>
                                    setEnabledFixed((ef) => ({ ...ef, [fKey]: v }))
                                  }
                                />
                              </div>
                              <input
                                type="text"
                                disabled={!isOn}
                                value={fixedElements[fKey] || ""}
                                onChange={(e) =>
                                  setFixedElements((f) => ({
                                    ...f,
                                    [fKey]: e.target.value,
                                  }))
                                }
                                placeholder={fPlaceholder}
                                className="h-9 rounded-md border border-[#2E2E2E] bg-[#262626] px-3 text-xs text-[#F5F5F5]"
                              />
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#F5F5F5]">
                          <ArrowsClockwise size={13} className="text-[#A3A3A3]" />
                          Rotated variation axes (1 option per line)
                        </span>
                        <span className="text-[11px] text-[#737373]">
                          Disable Camera angles for flat-lay, wallpaper, or front-facing art
                        </span>
                      </div>

                      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                        <div
                          className={cn(
                            "flex flex-col gap-1.5 rounded-md border border-[#2E2E2E] bg-[#171717] p-2.5",
                            !(enabledAxes.camera_angles ?? true) && "opacity-50"
                          )}
                        >
                          <div className="flex items-center justify-between text-xs">
                            <span className="inline-flex items-center gap-1.5 font-medium text-[#F5F5F5]">
                              <Camera size={13} className="text-[#A3A3A3]" /> Camera angles{" "}
                              <span className="font-mono-tech text-[10px] text-[#737373]">
                                ({parsedAngles.length})
                              </span>
                            </span>
                            <Switch
                              checked={enabledAxes.camera_angles ?? true}
                              onCheckedChange={(v) =>
                                setEnabledAxes((ea) => ({ ...ea, camera_angles: v }))
                              }
                            />
                          </div>
                          <textarea
                            rows={3}
                            disabled={!(enabledAxes.camera_angles ?? true)}
                            value={axesText.camera_angles}
                            onChange={(e) =>
                              setAxesText((a) => ({
                                ...a,
                                camera_angles: e.target.value,
                              }))
                            }
                            className="rounded border border-[#2E2E2E] bg-[#121212] p-2 font-mono-tech text-[11px] text-[#F5F5F5]"
                          />
                        </div>

                        <div
                          className={cn(
                            "flex flex-col gap-1.5 rounded-md border border-[#2E2E2E] bg-[#171717] p-2.5",
                            !(enabledAxes.compositions ?? true) && "opacity-50"
                          )}
                        >
                          <div className="flex items-center justify-between text-xs">
                            <span className="inline-flex items-center gap-1.5 font-medium text-[#F5F5F5]">
                              <GridFour size={13} className="text-[#A3A3A3]" /> Compositions{" "}
                              <span className="font-mono-tech text-[10px] text-[#737373]">
                                ({parsedComps.length})
                              </span>
                            </span>
                            <Switch
                              checked={enabledAxes.compositions ?? true}
                              onCheckedChange={(v) =>
                                setEnabledAxes((ea) => ({ ...ea, compositions: v }))
                              }
                            />
                          </div>
                          <textarea
                            rows={3}
                            disabled={!(enabledAxes.compositions ?? true)}
                            value={axesText.compositions}
                            onChange={(e) =>
                              setAxesText((a) => ({
                                ...a,
                                compositions: e.target.value,
                              }))
                            }
                            className="rounded border border-[#2E2E2E] bg-[#121212] p-2 font-mono-tech text-[11px] text-[#F5F5F5]"
                          />
                        </div>

                        <div
                          className={cn(
                            "flex flex-col gap-1.5 rounded-md border border-[#2E2E2E] bg-[#171717] p-2.5",
                            !(enabledAxes.lighting ?? true) && "opacity-50"
                          )}
                        >
                          <div className="flex items-center justify-between text-xs">
                            <span className="inline-flex items-center gap-1.5 font-medium text-[#F5F5F5]">
                              <SunDim size={13} className="text-[#A3A3A3]" /> Lighting{" "}
                              <span className="font-mono-tech text-[10px] text-[#737373]">
                                ({parsedLighting.length})
                              </span>
                            </span>
                            <Switch
                              checked={enabledAxes.lighting ?? true}
                              onCheckedChange={(v) =>
                                setEnabledAxes((ea) => ({ ...ea, lighting: v }))
                              }
                            />
                          </div>
                          <textarea
                            rows={3}
                            disabled={!(enabledAxes.lighting ?? true)}
                            value={axesText.lighting}
                            onChange={(e) =>
                              setAxesText((a) => ({ ...a, lighting: e.target.value }))
                            }
                            className="rounded border border-[#2E2E2E] bg-[#121212] p-2 font-mono-tech text-[11px] text-[#F5F5F5]"
                          />
                        </div>

                        <div
                          className={cn(
                            "flex flex-col gap-1.5 rounded-md border border-[#2E2E2E] bg-[#171717] p-2.5",
                            !(enabledAxes.atmospheres ?? true) && "opacity-50"
                          )}
                        >
                          <div className="flex items-center justify-between text-xs">
                            <span className="inline-flex items-center gap-1.5 font-medium text-[#F5F5F5]">
                              <Wind size={13} className="text-[#A3A3A3]" /> Grounds &amp; settings{" "}
                              <span className="font-mono-tech text-[10px] text-[#737373]">
                                ({parsedAtmos.length})
                              </span>
                            </span>
                            <Switch
                              checked={enabledAxes.atmospheres ?? true}
                              onCheckedChange={(v) =>
                                setEnabledAxes((ea) => ({ ...ea, atmospheres: v }))
                              }
                            />
                          </div>
                          <textarea
                            rows={3}
                            disabled={!(enabledAxes.atmospheres ?? true)}
                            value={axesText.atmospheres}
                            onChange={(e) =>
                              setAxesText((a) => ({
                                ...a,
                                atmospheres: e.target.value,
                              }))
                            }
                            className="rounded border border-[#2E2E2E] bg-[#121212] p-2 font-mono-tech text-[11px] text-[#F5F5F5]"
                          />
                        </div>

                        <div
                          className={cn(
                            "sm:col-span-2 flex flex-col gap-1.5 rounded-md border border-[#2E2E2E] bg-[#171717] p-2.5",
                            !(enabledAxes.custom_axis ?? false) && "opacity-55"
                          )}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                              <Sparkle size={13} className="text-[#A3A3A3] shrink-0" />
                              <input
                                type="text"
                                value={customAxisLabel}
                                onChange={(e) => setCustomAxisLabel(e.target.value)}
                                placeholder="5th axis name (e.g. Brushwork, Pose, Nail Shape)"
                                className="h-7 flex-1 rounded border border-[#2E2E2E] bg-[#262626] px-2 text-xs font-medium text-[#F5F5F5] outline-none"
                              />
                              <span className="font-mono-tech text-[10px] text-[#737373]">
                                ({parsedCustom.length})
                              </span>
                            </div>
                            <Switch
                              checked={enabledAxes.custom_axis ?? false}
                              onCheckedChange={(v) =>
                                setEnabledAxes((ea) => ({ ...ea, custom_axis: v }))
                              }
                            />
                          </div>
                          <textarea
                            rows={2}
                            disabled={!(enabledAxes.custom_axis ?? false)}
                            value={axesText.custom_axis}
                            onChange={(e) =>
                              setAxesText((a) => ({
                                ...a,
                                custom_axis: e.target.value,
                              }))
                            }
                            placeholder="Optional 5th axis variations (1 per line)…"
                            className="rounded border border-[#2E2E2E] bg-[#121212] p-2 font-mono-tech text-[11px] text-[#F5F5F5]"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between border-t border-[#2E2E2E] pt-3">
                      <span className="text-xs text-[#A3A3A3]">
                        Write visual prompts in English while generating metadata in{" "}
                        {metadataLanguage}
                      </span>
                      <Switch
                        checked={optimizePromptEnglish}
                        onCheckedChange={setOptimizePromptEnglish}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </StudioPanel>
        </div>

        {/* RIGHT STICKY COLUMN (5/12) */}
        <div className="lg:col-span-5 lg:sticky lg:top-16 flex flex-col gap-5">
          <StudioPanel noPadding>
            <div className="divide-y divide-[#2E2E2E]">
              {/* Geometry & Set Size */}
              <div className="p-4 sm:p-5 flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-[#F5F5F5]">
                    Aspect ratio
                  </span>
                  <div className="grid grid-cols-5 gap-1.5">
                    {supportedRatios.map((r) => {
                      const meta = RATIO_META[r] || {
                        label: r,
                        res: "",
                        wClass: "w-4",
                        hClass: "h-4",
                      }
                      const active = aspectRatio === r
                      return (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setAspectRatio(r)}
                          className={cn(
                            "flex flex-col items-center justify-center gap-1.5 rounded-md border py-2 px-1.5 transition-colors duration-150 cursor-pointer",
                            active
                              ? "border-[#FAFAFA] bg-[#262626] text-[#F5F5F5]"
                              : "border-[#2E2E2E] bg-[#171717] text-[#A3A3A3] hover:border-[#404040] hover:text-[#F5F5F5]"
                          )}
                        >
                          <div className="flex h-6 items-center justify-center">
                            <span
                              className={cn(
                                "rounded-[2px] border-[1.5px]",
                                meta.wClass,
                                meta.hClass,
                                active
                                  ? "border-[#FAFAFA] bg-[#FAFAFA]/15"
                                  : "border-[#737373] bg-transparent"
                              )}
                            />
                          </div>
                          <div className="text-center leading-tight">
                            <p className="font-mono-tech text-[11px] font-semibold">
                              {r}
                            </p>
                            <p className="text-[10px] text-[#737373]">{meta.label}</p>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Batch Mode & Count */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                  <div className="sm:col-span-5 flex flex-col gap-1">
                    <label className="text-xs font-medium text-[#A3A3A3]">
                      Batch mode
                    </label>
                    <div className="grid grid-cols-2 rounded-md border border-[#2E2E2E] bg-[#171717] p-0.5 h-9">
                      <button
                        type="button"
                        onClick={() => setRunMode("fixed")}
                        className={cn(
                          "rounded text-xs font-medium transition-colors duration-150 cursor-pointer",
                          runMode === "fixed"
                            ? "bg-[#FAFAFA] text-[#121212] font-semibold"
                            : "text-[#737373] hover:text-[#F5F5F5]"
                        )}
                      >
                        Fixed
                      </button>
                      <button
                        type="button"
                        onClick={() => setRunMode("continuous")}
                        className={cn(
                          "rounded text-xs font-medium transition-colors duration-150 cursor-pointer",
                          runMode === "continuous"
                            ? "bg-[#FAFAFA] text-[#121212] font-semibold"
                            : "text-[#737373] hover:text-[#F5F5F5]"
                        )}
                      >
                        Waves
                      </button>
                    </div>
                  </div>

                  {runMode === "fixed" ? (
                    <div className="sm:col-span-7 flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-[#A3A3A3]">
                          Set size
                        </label>
                        <div className="flex items-center gap-1">
                          {[6, 20, 50, 100].map((quickN) => (
                            <button
                              key={quickN}
                              type="button"
                              onClick={() => setTargetCount(quickN)}
                              className={cn(
                                "rounded px-1.5 py-0.5 font-mono-tech text-[10px] cursor-pointer",
                                targetCount === quickN
                                  ? "bg-[#FAFAFA] text-[#121212] font-semibold"
                                  : "bg-[#262626] text-[#A3A3A3] hover:text-[#F5F5F5]"
                              )}
                            >
                              {quickN}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setTargetCount((c) => Math.max(1, c - 1))}
                          className="flex size-9 items-center justify-center rounded-md border border-[#2E2E2E] bg-[#262626] text-[#F5F5F5] hover:border-[#404040] cursor-pointer"
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
                          className="h-9 flex-1 rounded-md border border-[#2E2E2E] bg-[#262626] text-center font-mono-tech text-sm font-semibold text-[#F5F5F5]"
                        />
                        <button
                          type="button"
                          onClick={() => setTargetCount((c) => Math.min(1000, c + 1))}
                          className="flex size-9 items-center justify-center rounded-md border border-[#2E2E2E] bg-[#262626] text-[#F5F5F5] hover:border-[#404040] cursor-pointer"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="sm:col-span-7 flex flex-col gap-1">
                      <label className="text-xs font-medium text-[#A3A3A3]">
                        Per wave / session cap
                      </label>
                      <div className="grid grid-cols-2 gap-1.5">
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
                          title="Images per wave"
                          className="h-9 rounded-md border border-[#2E2E2E] bg-[#262626] px-2.5 text-center font-mono-tech text-xs text-[#F5F5F5]"
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
                          title="Session cap"
                          className="h-9 rounded-md border border-[#2E2E2E] bg-[#262626] px-2.5 text-center font-mono-tech text-xs text-[#F5F5F5]"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Engine, Chrome Slot & Format */}
              <div className="p-4 sm:p-5 flex flex-col gap-3.5">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                  <div className="sm:col-span-7 flex flex-col gap-1">
                    <label className="text-xs font-medium text-[#A3A3A3]">
                      Generation model
                    </label>
                    <Select
                      value={selectedModel}
                      onValueChange={(v) => v && setSelectedModel(v)}
                    >
                      <SelectTrigger className="h-9 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {providers.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            <span className="inline-flex items-center gap-2">
                              <BrandIcon
                                name={p.engine.replace("_api", "")}
                                size={14}
                              />
                              <span>{p.label}</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="sm:col-span-5 flex flex-col gap-1">
                    <label className="text-xs font-medium text-[#A3A3A3]">
                      Metadata language
                    </label>
                    <Select
                      value={metadataLanguage}
                      onValueChange={(v) => v && setMetadataLanguage(v)}
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

                {selectedModel.startsWith("chrome-cdp/") && (
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-medium text-[#A3A3A3]">
                      Chrome CDP slot
                    </label>
                    <Select
                      value={String(preferredCdpSlot)}
                      onValueChange={(v) => setPreferredCdpSlot(Number(v) || 0)}
                    >
                      <SelectTrigger className="h-8 w-56 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">Auto (next free slot)</SelectItem>
                        {(cdpSlots.length > 0
                          ? cdpSlots
                          : [
                              {
                                slot_id: 1,
                                port: 9222,
                                label: "Slot 1",
                                enabled: true,
                                connected: false,
                                open_engines: [] as string[],
                                active_job_id: null,
                                active_generation_id: null,
                              },
                            ]
                        ).map((s) => (
                          <SelectItem key={s.slot_id} value={String(s.slot_id)}>
                            {`Slot #${s.slot_id} (:${s.port}) — ${
                              s.enabled
                                ? s.connected
                                  ? "Online"
                                  : "Standby"
                                : s.connected
                                  ? "Paused"
                                  : "Off"
                            }`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-[#A3A3A3]">
                      Image format
                    </span>
                    <span className="font-mono-tech text-[11px] text-[#A3A3A3]">
                      .{extPreview}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {EXPORT_IMAGE_FORMAT_OPTIONS.filter((fmt) =>
                      supportedImageFormats.includes(fmt.id)
                    ).map((fmt) => {
                      const active = exportImageFormat === fmt.id
                      return (
                        <button
                          key={fmt.id}
                          type="button"
                          onClick={() => setExportImageFormat(fmt.id)}
                          title={fmt.description}
                          className={cn(
                            "rounded-md border py-1.5 px-2 text-center text-xs font-medium transition-colors duration-150 cursor-pointer",
                            active
                              ? "border-[#FAFAFA] bg-[#FAFAFA] text-[#121212] font-semibold"
                              : "border-[#2E2E2E] bg-[#171717] text-[#A3A3A3] hover:border-[#404040] hover:text-[#F5F5F5]"
                          )}
                        >
                          {fmt.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* CSV Mode + Folder + Live Contract */}
              <div className="p-4 sm:p-5 flex flex-col gap-3.5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-[#F5F5F5]">
                      Picassy export mode
                    </p>
                    <p className="text-[11px] text-[#737373]">
                      {metadataExportMode === "csv"
                        ? "Writes 8-column pin-import.csv alongside images"
                        : "Images only — skips metadata generation"}
                    </p>
                  </div>
                  <div className="flex items-center rounded-md border border-[#2E2E2E] bg-[#171717] p-0.5 shrink-0">
                    {(
                      [
                        ["csv", "CSV + images"],
                        ["none", "Images only"],
                      ] as const
                    ).map(([mKey, mLabel]) => {
                      const active = metadataExportMode === mKey
                      return (
                        <button
                          key={mKey}
                          type="button"
                          onClick={() => setMetadataExportMode(mKey)}
                          className={cn(
                            "rounded px-2.5 py-1 text-xs font-medium transition-colors duration-150 cursor-pointer",
                            active
                              ? "bg-[#FAFAFA] text-[#121212] font-semibold"
                              : "text-[#A3A3A3] hover:text-[#F5F5F5]"
                          )}
                        >
                          {mLabel}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {metadataExportMode !== "none" && (
                  <div className="rounded-md border border-[#2E2E2E] bg-[#171717] p-3 flex flex-col gap-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-[#F5F5F5]">
                          AI metadata router ({settings?.metadata_provider || "auto"})
                        </p>
                        <p className="text-[11px] text-[#737373]">
                          Sentence-case description &amp; alt text, Title-Case Title
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setShowCaptionEditor((v) => !v)}
                          className="text-[11px] font-medium text-[#F5F5F5] hover:underline cursor-pointer"
                        >
                          {showCaptionEditor ? "Hide prompt" : "SEO prompt"}
                        </button>
                        <Switch
                          checked={useAiCaptionPrompt}
                          onCheckedChange={setUseAiCaptionPrompt}
                        />
                      </div>
                    </div>

                    {showCaptionEditor && (
                      <div className="flex flex-col gap-2 border-t border-[#2E2E2E] pt-2.5">
                        <div className="flex flex-wrap items-center gap-1">
                          {captionStylePresets.map((cp) => (
                            <button
                              key={cp.id}
                              type="button"
                              onClick={() => setCaptionPrompt(cp.prompt)}
                              className="rounded border border-[#2E2E2E] bg-[#262626] px-2 py-0.5 text-[10px] text-[#A3A3A3] hover:text-[#F5F5F5] cursor-pointer"
                            >
                              {cp.label}
                            </button>
                          ))}
                        </div>
                        <textarea
                          rows={2}
                          value={captionPrompt}
                          onChange={(e) => setCaptionPrompt(e.target.value)}
                          className="w-full rounded border border-[#2E2E2E] bg-[#121212] p-2 text-xs text-[#F5F5F5] outline-none focus:border-[#A3A3A3]"
                        />
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-[#A3A3A3]">
                    Export root folder
                  </label>
                  <div className="flex items-center gap-1.5">
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
                      placeholder="./exports/<YYYY-MM-DD_HHMMSS_slug>/"
                      className="h-9 flex-1 rounded-md border border-[#2E2E2E] bg-[#262626] px-3 font-mono-tech text-xs text-[#F5F5F5] placeholder:text-[#737373] outline-none focus:border-[#A3A3A3]"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const chosen = await onPickExportFolder()
                        if (chosen) setExportRootDir(chosen)
                      }}
                      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-[#383838] bg-[#262626] px-3 text-xs font-medium text-[#F5F5F5] hover:border-[#525252] cursor-pointer"
                      title="Select export root folder in Finder"
                    >
                      <FolderOpen size={14} />
                      Browse…
                    </button>
                  </div>
                </div>

                <div className="rounded-md border border-[#2E2E2E] bg-[#121212] px-3 py-2.5 font-mono-tech text-[11px] text-[#A3A3A3] space-y-0.5">
                  <div className="flex items-center justify-between text-[#F5F5F5]">
                    <span className="truncate">
                      exports/…_{kwSlug.slice(0, 18)}/
                    </span>
                    <span className="text-[10px] text-[#A3A3A3]">{category}</span>
                  </div>
                  <p className="text-[10px] text-[#737373] truncate">
                    Tag: &quot;{cleanTitleKw}&quot; · {sampleFile1}.{extPreview},{" "}
                    {sampleFile2}.{extPreview}
                    {metadataExportMode === "csv" ? " + pin-import.csv" : ""}
                  </p>
                </div>
              </div>

              {/* Primary White Button & Secondary Button */}
              <div className="p-4 sm:p-5 flex flex-col gap-2.5 bg-[#191919]">
                <StudioButton
                  variant="primary"
                  disabled={!theme.trim() || submitting || Boolean(referenceUnsupported)}
                  loading={submitting}
                  onClick={() => handleSubmit(true)}
                  icon={<Play size={14} weight="fill" />}
                  className="h-10 w-full text-xs sm:text-sm"
                >
                  Plan &amp; start run (
                  {runMode === "fixed" ? `${targetCount} shots` : `${batchSize}/wave`})
                </StudioButton>

                <StudioButton
                  variant="secondary"
                  disabled={!theme.trim() || submitting || Boolean(referenceUnsupported)}
                  loading={submitting}
                  onClick={() => handleSubmit(false)}
                  icon={<ListChecks size={14} />}
                  className="h-9 w-full"
                >
                  Review variation plan first
                </StudioButton>
              </div>
            </div>
          </StudioPanel>

          {recentJobs.length > 0 && (
            <StudioPanel title="Recent sets">
              <div className="flex flex-col divide-y divide-[#2E2E2E] -my-2">
                {recentJobs.slice(0, 4).map((job) => (
                  <div
                    key={job.id}
                    className="flex items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-[#F5F5F5]">
                        <span className="mr-1 font-mono-tech text-[#737373]">
                          #{job.id}
                        </span>
                        {job.theme}
                      </p>
                      <p className="font-mono-tech text-[10px] text-[#737373]">
                        {job.counts.completed}/{job.counts.total} saved ·{" "}
                        {job.aspect_ratio} ·{" "}
                        {(job.metadata_export_mode || "csv").toUpperCase()}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => onSelectJob(job, "plan")}
                        className="rounded border border-[#2E2E2E] bg-[#262626] px-2 py-1 text-[11px] text-[#A3A3A3] hover:text-[#F5F5F5] cursor-pointer"
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
                        className="rounded bg-[#FAFAFA] px-2 py-1 text-[11px] font-semibold text-[#121212] hover:bg-[#E5E5E5] cursor-pointer"
                      >
                        {job.counts.completed > 0 ? "Gallery" : "Run"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteJob(job.id, false)}
                        title={`Delete set #${job.id}`}
                        className="flex size-6 items-center justify-center rounded text-[#737373] hover:bg-[#EF4444]/15 hover:text-[#FCA5A5] cursor-pointer"
                      >
                        <Trash size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </StudioPanel>
          )}
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
