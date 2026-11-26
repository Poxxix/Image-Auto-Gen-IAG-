import * as React from "react"
import {
  Play,
  ArrowsClockwise,
  Plus,
  LockKey,
  LockKeyOpen,
  Trash,
  WarningCircle,
  CheckCircle,
  Sparkle,
  Shuffle,
  SquaresFour,
  Rows,
  PencilSimple,
  FloppyDisk,
  Camera,
  GridFour,
  SunDim,
  Wind,
  MagicWand,
  MagnifyingGlass,
  Copy,
  Check,
  Sliders,
  X,
  FileCode,
} from "@phosphor-icons/react"
import {
  StudioPanel,
  StudioButton,
  StudioBadge,
  StudioPagination,
} from "@/components/shared/StudioPrimitives"
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
  REFERENCE_ADAPTIVE_PRESET_ID,
  REFERENCE_SAFE_AXES_DEFAULTS,
  REFERENCE_STRENGTH_OPTIONS,
  getReferenceImageUrl,
  suggestVariationAxes,
  type CdpSlotStatus,
  type CreateJobPayload,
  type EnabledAxes,
  type EnabledFixed,
  type ExportImageFormat,
  type FilenameStyle,
  type FixedElements,
  type GenerationItem,
  type ImageSetJob,
  type MetadataExportMode,
  type ReferenceItem,
  type ReferenceStrengthMode,
  type StudioPreset,
  type StudioTab,
  type SuggestAxesResponse,
  type TurnVariationAxes,
} from "@/services/studioApi"
import { cn } from "@/lib/utils"

const DEFAULT_PLAN_CATEGORIES = [
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

export interface PlanScreenProps {
  job: ImageSetJob | null
  presets?: StudioPreset[]
  picassyCategories?: string[]
  cdpSlots?: CdpSlotStatus[]
  allReferences: ReferenceItem[]
  onNavigateTab: (tab: StudioTab) => void
  onUpdateJob: (jobId: number, updates: Partial<CreateJobPayload>) => Promise<void>
  onDeleteJob: (jobId: number, deleteFiles: boolean) => Promise<void>
  onReplanJob: (jobId: number) => Promise<void>
  onAddTurn: (jobId: number) => Promise<void>
  onUpdateGeneration: (
    genId: number,
    updates: {
      prompt_final?: string
      reference_id?: number | null
      clear_reference?: boolean
      is_locked?: boolean
      variation_axes?: TurnVariationAxes
    }
  ) => Promise<void>
  onDeleteGeneration: (genId: number) => Promise<void>
  onStartJob: (jobId: number) => Promise<void>
}

type ShotFilter = "all" | "unlocked" | "locked" | "referenced" | "duplicates"

const splitLines = (txt: string) =>
  txt
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)

function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

export function PlanScreen({
  job,
  presets = [],
  picassyCategories = DEFAULT_PLAN_CATEGORIES,
  cdpSlots = [],
  allReferences,
  onNavigateTab,
  onUpdateJob,
  onDeleteJob,
  onReplanJob,
  onAddTurn,
  onUpdateGeneration,
  onDeleteGeneration,
  onStartJob,
}: PlanScreenProps) {
  const categoryOptions =
    picassyCategories.length > 0 ? picassyCategories : DEFAULT_PLAN_CATEGORIES
  const [editingPrompts, setEditingPrompts] = React.useState<Record<number, string>>({})
  const [editingAxes, setEditingAxes] = React.useState<Record<number, TurnVariationAxes>>({})
  const [savingGenId, setSavingGenId] = React.useState<number | null>(null)
  const [savedGenId, setSavedGenId] = React.useState<number | null>(null)
  const [copiedGenId, setCopiedGenId] = React.useState<number | null>(null)
  const [viewMode, setViewMode] = React.useState<"cards" | "table">("cards")
  const [shotFilter, setShotFilter] = React.useState<ShotFilter>("all")
  const [searchQuery, setSearchQuery] = React.useState("")
  const [replanning, setReplanning] = React.useState(false)
  const [starting, setStarting] = React.useState(false)
  const [adding, setAdding] = React.useState(false)
  const [shufflingId, setShufflingId] = React.useState<number | null>(null)

  const [showJobEditor, setShowJobEditor] = React.useState(false)
  const [showImportDialog, setShowImportDialog] = React.useState(false)
  const [pageIndex, setPageIndex] = React.useState(1)
  const pageSize = 24
  const [themeDraft, setThemeDraft] = React.useState("")
  const [primaryTagDraft, setPrimaryTagDraft] = React.useState("")
  const [categoryDraft, setCategoryDraft] = React.useState("Art")
  const [filenameStyleDraft, setFilenameStyleDraft] =
    React.useState<FilenameStyle>("picassy_slug")
  const [referenceStrengthDraft, setReferenceStrengthDraft] =
    React.useState<ReferenceStrengthMode>("balanced")
  const [preferredSlotDraft, setPreferredSlotDraft] = React.useState<number>(0)
  const [basePromptDraft, setBasePromptDraft] = React.useState("")
  const [captionPromptDraft, setCaptionPromptDraft] = React.useState("")
  const [presetDraft, setPresetDraft] = React.useState("")
  const [fixedDraft, setFixedDraft] = React.useState<FixedElements>({
    subject: "",
    style: "",
    color_palette: "",
    brand_mood: "",
  })
  const [enabledFixedDraft, setEnabledFixedDraft] = React.useState<EnabledFixed>({
    subject: true,
    style: true,
    color_palette: true,
    brand_mood: true,
  })
  const [axesPoolDraft, setAxesPoolDraft] = React.useState({
    camera_angles: "",
    compositions: "",
    lighting: "",
    atmospheres: "",
    custom_axis: "",
  })
  const [customAxisLabelDraft, setCustomAxisLabelDraft] = React.useState(
    "Custom Variation Axis"
  )
  const [enabledAxesDraft, setEnabledAxesDraft] = React.useState<EnabledAxes>({
    camera_angles: true,
    compositions: true,
    lighting: true,
    atmospheres: true,
    custom_axis: false,
  })
  const [savingJob, setSavingJob] = React.useState(false)
  const [suggestingAxes, setSuggestingAxes] = React.useState(false)
  const [aiSuggestLabel, setAiSuggestLabel] = React.useState<string | null>(null)
  const [suggestError, setSuggestError] = React.useState<string | null>(null)

  React.useEffect(() => {
    setPageIndex(1)
  }, [job?.id, shotFilter, searchQuery])

  React.useEffect(() => {
    if (!job) return
    const nextPrompts: Record<number, string> = {}
    const nextAxes: Record<number, TurnVariationAxes> = {}
    for (const g of job.generations) {
      nextPrompts[g.id] = g.prompt_final
      nextAxes[g.id] = { ...(g.variation_axes || {}) }
    }
    setEditingPrompts(nextPrompts)
    setEditingAxes(nextAxes)
    setThemeDraft(job.theme || "")
    setPrimaryTagDraft(job.primary_tag || job.theme || "")
    setCategoryDraft(job.category || categoryOptions[0] || "Art")
    setFilenameStyleDraft((job.filename_style as FilenameStyle) || "picassy_slug")
    setReferenceStrengthDraft(
      (job.reference_strength as ReferenceStrengthMode) || "balanced"
    )
    setPreferredSlotDraft(Number(job.preferred_cdp_slot || 0))
    setBasePromptDraft(job.base_prompt || "")
    setCaptionPromptDraft(job.caption_prompt || "")
    setPresetDraft(job.preset_id || "auto_universal")
    setFixedDraft({
      subject: job.fixed_elements?.subject || "",
      style: job.fixed_elements?.style || "",
      color_palette: job.fixed_elements?.color_palette || "",
      brand_mood: job.fixed_elements?.brand_mood || "",
    })
    setEnabledFixedDraft({
      subject: job.fixed_elements?.enabled_fixed?.subject ?? true,
      style: job.fixed_elements?.enabled_fixed?.style ?? true,
      color_palette: job.fixed_elements?.enabled_fixed?.color_palette ?? true,
      brand_mood: job.fixed_elements?.enabled_fixed?.brand_mood ?? true,
    })
    setAxesPoolDraft({
      camera_angles: (job.variation_axes?.camera_angles || []).join("\n"),
      compositions: (job.variation_axes?.compositions || []).join("\n"),
      lighting: (job.variation_axes?.lighting || []).join("\n"),
      atmospheres: (job.variation_axes?.atmospheres || []).join("\n"),
      custom_axis: (job.variation_axes?.custom_axis || []).join("\n"),
    })
    setCustomAxisLabelDraft(
      job.variation_axes?.custom_axis_label || "Custom Variation Axis"
    )
    setEnabledAxesDraft({
      camera_angles: job.variation_axes?.enabled_axes?.camera_angles ?? true,
      compositions: job.variation_axes?.enabled_axes?.compositions ?? true,
      lighting: job.variation_axes?.enabled_axes?.lighting ?? true,
      atmospheres: job.variation_axes?.enabled_axes?.atmospheres ?? true,
      custom_axis:
        job.variation_axes?.enabled_axes?.custom_axis ??
        Boolean(job.variation_axes?.custom_axis?.length),
    })
  }, [job])

  if (!job) {
    return (
      <StudioPanel title="No image set selected">
        <div className="flex flex-col items-start gap-3 py-4">
          <p className="text-sm text-[#A3A3A3]">
            Create a new image set in step 1 or select an existing set from the sidebar.
          </p>
          <StudioButton variant="primary" onClick={() => onNavigateTab("create")}>
            Create new set
          </StudioButton>
        </div>
      </StudioPanel>
    )
  }

  const promptFrequency: Record<string, number[]> = {}
  for (const g of job.generations) {
    const key = (editingPrompts[g.id] ?? g.prompt_final).trim().toLowerCase()
    if (!promptFrequency[key]) promptFrequency[key] = []
    promptFrequency[key].push(g.index_num)
  }
  const duplicatePromptIndices = Object.values(promptFrequency).filter(
    (arr) => arr.length > 1
  )

  const poolAngles = job.variation_axes?.camera_angles?.length
    ? job.variation_axes.camera_angles
    : [
        "Three-quarter hero angle",
        "Top-down overhead flatlay",
        "Macro detail close-up",
        "Wide establishing frame",
      ]
  const poolComps = job.variation_axes?.compositions?.length
    ? job.variation_axes.compositions
    : [
        "Rule-of-thirds placement",
        "Centered hero balance",
        "Layered foreground depth",
        "Dynamic diagonal flow",
      ]
  const poolLights = job.variation_axes?.lighting?.length
    ? job.variation_axes.lighting
    : [
        "Soft diffused natural light",
        "Warm golden-hour sunlight",
        "High-contrast studio key light",
        "Atmospheric rim lighting",
      ]
  const poolAtmos = job.variation_axes?.atmospheres?.length
    ? job.variation_axes.atmospheres
    : [
        "Authentic subject environment",
        "Clean minimalist backdrop",
        "Warm atmospheric setting",
        "Natural daylight context",
      ]
  const poolCustom = job.variation_axes?.custom_axis?.length
    ? job.variation_axes.custom_axis
    : []
  const jobEnabledAxes = {
    camera_angles: job.variation_axes?.enabled_axes?.camera_angles ?? true,
    compositions: job.variation_axes?.enabled_axes?.compositions ?? true,
    lighting: job.variation_axes?.enabled_axes?.lighting ?? true,
    atmospheres: job.variation_axes?.enabled_axes?.atmospheres ?? true,
    custom_axis:
      job.variation_axes?.enabled_axes?.custom_axis ?? Boolean(poolCustom.length),
  }
  const customAxisLabel = job.variation_axes?.custom_axis_label || "Custom detail"

  const handleSavePrompt = async (gen: GenerationItem, force = false) => {
    const draft = (editingPrompts[gen.id] ?? gen.prompt_final).trim()
    if (!draft) return
    if (!force && draft === gen.prompt_final) return
    setSavingGenId(gen.id)
    try {
      await onUpdateGeneration(gen.id, { prompt_final: draft })
      setSavedGenId(gen.id)
      setTimeout(() => setSavedGenId(null), 1800)
    } finally {
      setSavingGenId(null)
    }
  }

  const handleSaveAxes = async (
    gen: GenerationItem,
    overrideAxes?: TurnVariationAxes
  ) => {
    const draftAxes = overrideAxes || editingAxes[gen.id] || gen.variation_axes || {}
    const origAxes = gen.variation_axes || {}
    const changed =
      (draftAxes.camera_angle || "") !== (origAxes.camera_angle || "") ||
      (draftAxes.composition || "") !== (origAxes.composition || "") ||
      (draftAxes.lighting || "") !== (origAxes.lighting || "") ||
      (draftAxes.atmosphere || "") !== (origAxes.atmosphere || "") ||
      (draftAxes.custom_axis || "") !== (origAxes.custom_axis || "")
    if (!changed) return
    setSavingGenId(gen.id)
    try {
      await onUpdateGeneration(gen.id, { variation_axes: draftAxes })
      setSavedGenId(gen.id)
      setTimeout(() => setSavedGenId(null), 1800)
    } finally {
      setSavingGenId(null)
    }
  }

  type EditableAxisKey =
    | "camera_angle"
    | "composition"
    | "lighting"
    | "atmosphere"
    | "custom_axis"

  const handleCycleSingleAxis = async (
    gen: GenerationItem,
    axisKey: EditableAxisKey
  ) => {
    const poolMap: Record<EditableAxisKey, string[]> = {
      camera_angle: poolAngles,
      composition: poolComps,
      lighting: poolLights,
      atmosphere: poolAtmos,
      custom_axis: poolCustom,
    }
    const list = poolMap[axisKey]
    if (!list.length) return
    const currentVal =
      (editingAxes[gen.id]?.[axisKey] ?? gen.variation_axes?.[axisKey]) || ""
    const curIdx = list.findIndex((item) => item === currentVal)
    const nextVal = list[(curIdx + 1) % list.length]
    const updatedAxes: TurnVariationAxes = {
      ...(editingAxes[gen.id] || gen.variation_axes || {}),
      [axisKey]: nextVal,
      ...(axisKey === "custom_axis" ? { custom_axis_label: customAxisLabel } : {}),
    }
    setEditingAxes((prev) => ({
      ...prev,
      [gen.id]: updatedAxes,
    }))
    await handleSaveAxes(gen, updatedAxes)
  }

  const handleToggleRefPresetDraft = (enablePreset: boolean) => {
    if (!enablePreset) {
      setPresetDraft(REFERENCE_ADAPTIVE_PRESET_ID)
      setAiSuggestLabel(null)
      setFixedDraft({
        subject: "",
        style: "",
        color_palette: "",
        brand_mood: "",
      })
      setEnabledFixedDraft({
        subject: false,
        style: false,
        color_palette: false,
        brand_mood: false,
      })
      setAxesPoolDraft({
        camera_angles: REFERENCE_SAFE_AXES_DEFAULTS.camera_angles.join("\n"),
        compositions: REFERENCE_SAFE_AXES_DEFAULTS.compositions.join("\n"),
        lighting: REFERENCE_SAFE_AXES_DEFAULTS.lighting.join("\n"),
        atmospheres: REFERENCE_SAFE_AXES_DEFAULTS.atmospheres.join("\n"),
        custom_axis: REFERENCE_SAFE_AXES_DEFAULTS.custom_axis.join("\n"),
      })
      setCustomAxisLabelDraft(REFERENCE_SAFE_AXES_DEFAULTS.custom_axis_label)
      setEnabledAxesDraft({
        camera_angles: false,
        compositions: true,
        lighting: true,
        atmospheres: false,
        custom_axis: true,
      })
    } else {
      handleApplyPresetDraft(presets[0]?.id || "auto_universal")
    }
  }

  const handleApplyPresetDraft = (presetId: string) => {
    setPresetDraft(presetId)
    setAiSuggestLabel(null)
    const found = presets.find((p) => p.id === presetId)
    if (found) {
      setFixedDraft({
        subject: fixedDraft.subject || found.fixed_elements.subject || "",
        style: found.fixed_elements.style || "",
        color_palette: found.fixed_elements.color_palette || "",
        brand_mood: found.fixed_elements.brand_mood || "",
      })
      if (found.fixed_elements.enabled_fixed) {
        setEnabledFixedDraft({
          subject: found.fixed_elements.enabled_fixed.subject ?? true,
          style: found.fixed_elements.enabled_fixed.style ?? true,
          color_palette: found.fixed_elements.enabled_fixed.color_palette ?? true,
          brand_mood: found.fixed_elements.enabled_fixed.brand_mood ?? true,
        })
      }
      setAxesPoolDraft({
        camera_angles: (found.variation_axes.camera_angles || []).join("\n"),
        compositions: (found.variation_axes.compositions || []).join("\n"),
        lighting: (found.variation_axes.lighting || []).join("\n"),
        atmospheres: (found.variation_axes.atmospheres || []).join("\n"),
        custom_axis: (found.variation_axes.custom_axis || []).join("\n"),
      })
      setCustomAxisLabelDraft(
        found.variation_axes.custom_axis_label || "Custom Variation Axis"
      )
      setEnabledAxesDraft({
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

  const applyAxesResponseToDraft = (
    res: SuggestAxesResponse,
    applyMetaFields = false
  ) => {
    setPresetDraft("ai_custom")
    setAiSuggestLabel(res.source_label)
    if (applyMetaFields) {
      if (res.theme) setThemeDraft(res.theme)
      if (res.base_prompt) setBasePromptDraft(res.base_prompt)
      if (res.reference_strength) setReferenceStrengthDraft(res.reference_strength)
    }
    setFixedDraft({
      subject: res.fixed_elements?.subject || themeDraft.trim() || job.theme,
      style: res.fixed_elements?.style || "",
      color_palette: res.fixed_elements?.color_palette || "",
      brand_mood: res.fixed_elements?.brand_mood || "",
    })
    if (res.fixed_elements?.enabled_fixed) {
      setEnabledFixedDraft({
        subject: res.fixed_elements.enabled_fixed.subject ?? true,
        style: res.fixed_elements.enabled_fixed.style ?? true,
        color_palette: res.fixed_elements.enabled_fixed.color_palette ?? true,
        brand_mood: res.fixed_elements.enabled_fixed.brand_mood ?? true,
      })
    }
    setAxesPoolDraft({
      camera_angles: (res.variation_axes?.camera_angles || []).join("\n"),
      compositions: (res.variation_axes?.compositions || []).join("\n"),
      lighting: (res.variation_axes?.lighting || []).join("\n"),
      atmospheres: (res.variation_axes?.atmospheres || []).join("\n"),
      custom_axis: (res.variation_axes?.custom_axis || []).join("\n"),
    })
    if (res.variation_axes?.custom_axis_label) {
      setCustomAxisLabelDraft(res.variation_axes.custom_axis_label)
    }
    const ea = res.variation_axes?.enabled_axes
    setEnabledAxesDraft({
      camera_angles: ea?.camera_angles ?? true,
      compositions: ea?.compositions ?? true,
      lighting: ea?.lighting ?? true,
      atmospheres: ea?.atmospheres ?? true,
      custom_axis: ea?.custom_axis ?? Boolean(res.variation_axes?.custom_axis?.length),
    })
  }

  const handleSuggestAxesForJob = async (autoOpenDrawer = true) => {
    const targetTheme = themeDraft.trim() || job.theme
    if (!targetTheme) return
    setSuggestingAxes(true)
    setSuggestError(null)
    if (autoOpenDrawer) setShowJobEditor(true)
    try {
      const res = await suggestVariationAxes({
        theme: targetTheme,
        base_prompt: basePromptDraft.trim() || job.base_prompt,
        model: job.model,
        reference_ids: job.reference_ids || [],
        use_browser_turn: true,
      })
      applyAxesResponseToDraft(res, false)
    } catch (err) {
      setSuggestError(
        err instanceof Error ? err.message : "Failed to generate variation axes."
      )
    } finally {
      setSuggestingAxes(false)
    }
  }

  const handleSaveJobDetails = async (andReplan = false) => {
    if (!themeDraft.trim()) return
    setSavingJob(true)
    try {
      await onUpdateJob(job.id, {
        theme: themeDraft.trim(),
        primary_tag: primaryTagDraft.trim() || themeDraft.trim(),
        category: categoryDraft.trim(),
        filename_style: filenameStyleDraft,
        reference_strength: referenceStrengthDraft,
        preferred_cdp_slot: preferredSlotDraft,
        base_prompt: basePromptDraft.trim(),
        caption_prompt: captionPromptDraft.trim(),
        preset_id: presetDraft,
        fixed_elements: {
          ...fixedDraft,
          enabled_fixed: enabledFixedDraft,
        },
        variation_axes: {
          camera_angles: splitLines(axesPoolDraft.camera_angles),
          compositions: splitLines(axesPoolDraft.compositions),
          lighting: splitLines(axesPoolDraft.lighting),
          atmospheres: splitLines(axesPoolDraft.atmospheres),
          custom_axis: splitLines(axesPoolDraft.custom_axis),
          custom_axis_label: customAxisLabelDraft.trim() || "Custom Variation Axis",
          enabled_axes: enabledAxesDraft,
        },
      })
      if (andReplan) {
        await onReplanJob(job.id)
      }
      setShowJobEditor(false)
    } finally {
      setSavingJob(false)
    }
  }

  const handleShuffleAxes = async (gen: GenerationItem) => {
    const pickDifferent = (arr: string[], current?: string) => {
      const candidates = arr.filter((x) => x !== current)
      const source = candidates.length > 0 ? candidates : arr
      return source[Math.floor(Math.random() * source.length)]
    }

    setShufflingId(gen.id)
    try {
      const nextAxes: TurnVariationAxes = {
        camera_angle: jobEnabledAxes.camera_angles
          ? pickDifferent(poolAngles, gen.variation_axes?.camera_angle)
          : "",
        composition: jobEnabledAxes.compositions
          ? pickDifferent(poolComps, gen.variation_axes?.composition)
          : "",
        lighting: jobEnabledAxes.lighting
          ? pickDifferent(poolLights, gen.variation_axes?.lighting)
          : "",
        atmosphere: jobEnabledAxes.atmospheres
          ? pickDifferent(poolAtmos, gen.variation_axes?.atmosphere)
          : "",
      }
      if (jobEnabledAxes.custom_axis && poolCustom.length) {
        nextAxes.custom_axis = pickDifferent(
          poolCustom,
          gen.variation_axes?.custom_axis
        )
        nextAxes.custom_axis_label = customAxisLabel
      }
      await onUpdateGeneration(gen.id, { variation_axes: nextAxes })
    } finally {
      setShufflingId(null)
    }
  }

  const handleReplanClick = async () => {
    setReplanning(true)
    try {
      await onReplanJob(job.id)
    } finally {
      setReplanning(false)
    }
  }

  const handleAddTurnClick = async () => {
    setAdding(true)
    try {
      await onAddTurn(job.id)
    } finally {
      setAdding(false)
    }
  }

  const handleStartClick = async () => {
    setStarting(true)
    try {
      await onStartJob(job.id)
    } finally {
      setStarting(false)
    }
  }

  const handleCopyPrompt = (genId: number, text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedGenId(genId)
    setTimeout(() => setCopiedGenId(null), 1500)
  }

  const lockedCount = job.generations.filter((g) => g.is_locked).length
  const unlockedCount = job.generations.length - lockedCount
  const referencedCount = job.generations.filter((g) => Boolean(g.reference_id)).length
  const duplicateSet = new Set(duplicatePromptIndices.flat())

  const filteredGenerations = job.generations.filter((gen) => {
    if (shotFilter === "locked" && !gen.is_locked) return false
    if (shotFilter === "unlocked" && gen.is_locked) return false
    if (shotFilter === "referenced" && !gen.reference_id) return false
    if (shotFilter === "duplicates" && !duplicateSet.has(gen.index_num)) return false

    const q = searchQuery.trim().toLowerCase()
    if (!q) return true
    const promptVal = (editingPrompts[gen.id] ?? gen.prompt_final).toLowerCase()
    const axesVal = editingAxes[gen.id] || gen.variation_axes || {}
    return (
      promptVal.includes(q) ||
      String(gen.index_num).includes(q) ||
      (axesVal.camera_angle || "").toLowerCase().includes(q) ||
      (axesVal.composition || "").toLowerCase().includes(q) ||
      (axesVal.lighting || "").toLowerCase().includes(q) ||
      (axesVal.atmosphere || "").toLowerCase().includes(q)
    )
  })

  const currentExportMode: MetadataExportMode = job.metadata_export_mode || "csv"

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-[#2E2E2E] pb-4 lg:flex-row lg:items-end">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-[#F5F5F5]">
              {job.theme}
            </h1>
            <button
              type="button"
              onClick={() => setShowJobEditor((v) => !v)}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors duration-150 cursor-pointer",
                showJobEditor
                  ? "border-[#FAFAFA] bg-[#FAFAFA] text-[#121212] font-semibold"
                  : "border-[#383838] bg-[#262626] text-[#F5F5F5] hover:border-[#525252]"
              )}
            >
              <Sliders size={13} />
              {showJobEditor ? "Close brief editor" : "Edit brief & axes"}
            </button>
            <button
              type="button"
              onClick={() => setShowImportDialog(true)}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[#2E2E2E] bg-[#1C1C1C] px-2.5 text-xs font-medium text-[#A3A3A3] hover:border-[#404040] hover:text-[#F5F5F5] cursor-pointer"
            >
              <FileCode size={13} />
              Sample &amp; JSON
            </button>
            <button
              type="button"
              disabled={suggestingAxes}
              onClick={() => handleSuggestAxesForJob(true)}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[#383838] bg-[#262626] px-2.5 text-xs font-medium text-[#F5F5F5] hover:border-[#525252] cursor-pointer"
            >
              <MagicWand
                size={13}
                className={suggestingAxes ? "animate-spin" : ""}
              />
              {suggestingAxes ? "Analyzing…" : "AI suggest"}
            </button>
          </div>
          <p className="mt-1 text-xs text-[#A3A3A3]">
            Tag: <strong className="font-medium text-[#F5F5F5]">{job.primary_tag || job.theme}</strong>{" "}
            · Category: <strong className="font-medium text-[#F5F5F5]">{job.category || "Art"}</strong>{" "}
            · {job.aspect_ratio} · {(job.export_image_format || "original").toUpperCase()} ·{" "}
            {currentExportMode === "none" ? "Images only" : "pin-import.csv"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <StudioButton
            variant="secondary"
            loading={replanning}
            onClick={handleReplanClick}
            icon={<ArrowsClockwise size={14} />}
          >
            Replan unlocked ({unlockedCount})
          </StudioButton>
          <StudioButton
            variant="secondary"
            loading={adding}
            onClick={handleAddTurnClick}
            icon={<Plus size={14} />}
          >
            Add shot
          </StudioButton>
          <StudioButton
            variant="primary"
            loading={starting}
            disabled={job.counts.planned === 0 && job.run_mode !== "continuous"}
            onClick={handleStartClick}
            icon={<Play size={14} weight="fill" />}
          >
            Start generation ({job.counts.planned})
          </StudioButton>
          <button
            type="button"
            onClick={() => onDeleteJob(job.id, false)}
            title="Delete this image set"
            className="flex size-9 items-center justify-center rounded-md border border-[#2E2E2E] bg-[#1C1C1C] text-[#A3A3A3] hover:border-[#EF4444]/35 hover:bg-[#EF4444]/15 hover:text-[#FCA5A5] cursor-pointer"
          >
            <Trash size={14} />
          </button>
        </div>
      </div>

      {/* Collapsible Brief & Axes Editor */}
      {showJobEditor && (
        <StudioPanel
          title={`Edit brief & variation pool (#${job.id})`}
          headerRight={
            <button
              type="button"
              onClick={() => setShowJobEditor(false)}
              className="text-xs text-[#A3A3A3] hover:text-[#F5F5F5] cursor-pointer"
            >
              Close
            </button>
          }
        >
          <div className="flex flex-col gap-5">
            {suggestError && (
              <div className="rounded-md border border-[#EF4444]/35 bg-[#EF4444]/10 px-3 py-2 text-xs text-[#FCA5A5]">
                {suggestError}
              </div>
            )}

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[#A3A3A3]">
                  Theme or subject
                </label>
                <input
                  type="text"
                  value={themeDraft}
                  onChange={(e) => setThemeDraft(e.target.value)}
                  className="h-9 rounded-md border border-[#2E2E2E] bg-[#262626] px-3 text-sm text-[#F5F5F5] outline-none focus:border-[#A3A3A3]"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[#A3A3A3]">
                  Shared visual direction
                </label>
                <input
                  type="text"
                  value={basePromptDraft}
                  onChange={(e) => setBasePromptDraft(e.target.value)}
                  placeholder="Optional shared visual direction across all shots…"
                  className="h-9 rounded-md border border-[#2E2E2E] bg-[#262626] px-3 text-sm text-[#F5F5F5] outline-none focus:border-[#A3A3A3]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[#A3A3A3]">
                  Tag chính (Primary keyword)
                </label>
                <input
                  type="text"
                  value={primaryTagDraft}
                  onChange={(e) => setPrimaryTagDraft(e.target.value)}
                  className="h-9 rounded-md border border-[#2E2E2E] bg-[#262626] px-3 text-xs text-[#F5F5F5] outline-none focus:border-[#A3A3A3]"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[#A3A3A3]">
                  Category
                </label>
                <select
                  value={categoryDraft}
                  onChange={(e) => setCategoryDraft(e.target.value)}
                  className="h-9 rounded-md border border-[#2E2E2E] bg-[#262626] px-2.5 text-xs text-[#F5F5F5] outline-none focus:border-[#A3A3A3]"
                >
                  {categoryOptions.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[#A3A3A3]">
                  Filename rule
                </label>
                <select
                  value={filenameStyleDraft}
                  onChange={(e) =>
                    setFilenameStyleDraft(e.target.value as FilenameStyle)
                  }
                  className="h-9 rounded-md border border-[#2E2E2E] bg-[#262626] px-2.5 text-xs text-[#F5F5F5] outline-none focus:border-[#A3A3A3]"
                >
                  <option value="picassy_slug">Picassy (slug-1, 2…)</option>
                  <option value="studio_seq">Legacy (001_slug)</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[#A3A3A3]">
                  Chrome CDP slot
                </label>
                <select
                  value={String(preferredSlotDraft)}
                  onChange={(e) =>
                    setPreferredSlotDraft(Number(e.target.value) || 0)
                  }
                  className="h-9 rounded-md border border-[#2E2E2E] bg-[#262626] px-2.5 text-xs text-[#F5F5F5] outline-none focus:border-[#A3A3A3]"
                >
                  <option value="0">Auto (next free slot)</option>
                  {(cdpSlots.length > 0
                    ? cdpSlots
                    : [
                        { slot_id: 1, port: 9222 },
                        { slot_id: 2, port: 9223 },
                        { slot_id: 3, port: 9224 },
                        { slot_id: 4, port: 9225 },
                      ]
                  ).map((s) => (
                    <option key={s.slot_id} value={String(s.slot_id)}>
                      Slot #{s.slot_id} (:{s.port})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {job.reference_mode !== "prompt_only" && (
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium text-[#F5F5F5]">
                  Độ bám ảnh mẫu (Reference variation mode)
                </span>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {REFERENCE_STRENGTH_OPTIONS.map((opt) => {
                    const active = referenceStrengthDraft === opt.id
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setReferenceStrengthDraft(opt.id)}
                        className={cn(
                          "flex flex-col items-start gap-0.5 rounded-md border p-2.5 text-left transition-colors duration-150 cursor-pointer",
                          active
                            ? "border-[#FAFAFA] bg-[#262626] text-[#F5F5F5]"
                            : "border-[#2E2E2E] bg-[#171717] text-[#A3A3A3] hover:border-[#404040]"
                        )}
                      >
                        <span className="text-xs font-semibold text-[#F5F5F5]">
                          {opt.label}
                        </span>
                        <span className="text-[11px] text-[#A3A3A3]">
                          {opt.description}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {presets.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="text-xs font-medium text-[#F5F5F5]">
                      Style presets
                    </span>
                    {job.reference_mode !== "prompt_only" && (
                      <label className="inline-flex items-center gap-2 rounded border border-[#2E2E2E] bg-[#171717] px-2 py-0.5 text-[11px] text-[#A3A3A3] cursor-pointer">
                        <span>
                          {presetDraft === REFERENCE_ADAPTIVE_PRESET_ID
                            ? "Preset off (Adaptive per ref)"
                            : "Preset on"}
                        </span>
                        <Switch
                          checked={presetDraft !== REFERENCE_ADAPTIVE_PRESET_ID}
                          onCheckedChange={handleToggleRefPresetDraft}
                        />
                      </label>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {aiSuggestLabel && (
                      <span className="rounded border border-[#404040] bg-[#262626] px-2 py-0.5 text-[11px] text-[#F5F5F5]">
                        {aiSuggestLabel}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowImportDialog(true)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-[#383838] bg-[#262626] px-2.5 py-1 text-xs text-[#F5F5F5] cursor-pointer"
                    >
                      <FileCode size={12} />
                      Sample &amp; JSON
                    </button>
                    <button
                      type="button"
                      disabled={suggestingAxes}
                      onClick={() => handleSuggestAxesForJob(false)}
                      className="inline-flex items-center gap-1.5 rounded-md bg-[#FAFAFA] px-2.5 py-1 text-xs font-semibold text-[#121212] hover:bg-[#E5E5E5] cursor-pointer"
                    >
                      <MagicWand
                        size={12}
                        className={suggestingAxes ? "animate-spin" : ""}
                      />
                      {suggestingAxes ? "Generating…" : "AI auto-generate"}
                    </button>
                  </div>
                </div>
                <div
                  className={cn(
                    "grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6 transition-opacity duration-150",
                    job.reference_mode !== "prompt_only" &&
                      presetDraft === REFERENCE_ADAPTIVE_PRESET_ID &&
                      "opacity-50 hover:opacity-90"
                  )}
                >
                  {presets.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleApplyPresetDraft(p.id)}
                      className={cn(
                        "rounded-md border px-2.5 py-1.5 text-left text-xs font-medium transition-colors duration-150 cursor-pointer",
                        presetDraft === p.id
                          ? "border-[#FAFAFA] bg-[#FAFAFA] text-[#121212] font-semibold"
                          : "border-[#2E2E2E] bg-[#171717] text-[#A3A3A3] hover:text-[#F5F5F5]"
                      )}
                    >
                      <span className="block truncate">{p.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[#F5F5F5]">
                <LockKey size={13} className="text-[#A3A3A3]" />
                Locked continuity elements
              </p>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                {(
                  [
                    ["subject", "Subject / framing", "Subject or focal lock"],
                    ["style", "Visual style / medium", "Medium, lens, rendering"],
                    ["color_palette", "Color palette", "Shared color tones"],
                    ["brand_mood", "Mood & tone", "Editorial mood"],
                  ] as const
                ).map(([fKey, fLabel, fPlaceholder]) => {
                  const isOn = enabledFixedDraft[fKey] ?? true
                  return (
                    <div
                      key={fKey}
                      className={cn(
                        "flex flex-col gap-1 transition-opacity",
                        !isOn && "opacity-45"
                      )}
                    >
                      <div className="flex items-center justify-between text-xs text-[#A3A3A3]">
                        <span>{fLabel}</span>
                        <Switch
                          checked={isOn}
                          onCheckedChange={(v) =>
                            setEnabledFixedDraft((ef) => ({ ...ef, [fKey]: v }))
                          }
                        />
                      </div>
                      <input
                        type="text"
                        disabled={!isOn}
                        value={fixedDraft[fKey] || ""}
                        onChange={(e) =>
                          setFixedDraft((f) => ({ ...f, [fKey]: e.target.value }))
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
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[#F5F5F5]">
                <ArrowsClockwise size={13} className="text-[#A3A3A3]" />
                Variation axes pool (toggle individual axes on or off)
              </p>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                {(
                  [
                    ["camera_angles", "Camera angles", <Camera key="c" size={12} />],
                    ["compositions", "Compositions", <GridFour key="g" size={12} />],
                    ["lighting", "Lighting", <SunDim key="s" size={12} />],
                    ["atmospheres", "Grounds & settings", <Wind key="w" size={12} />],
                  ] as const
                ).map(([aKey, aLabel, aIcon]) => {
                  const isOn = enabledAxesDraft[aKey] ?? true
                  return (
                    <div
                      key={aKey}
                      className={cn(
                        "flex flex-col gap-1 transition-opacity",
                        !isOn && "opacity-50"
                      )}
                    >
                      <div className="flex items-center justify-between text-xs text-[#A3A3A3]">
                        <span className="inline-flex items-center gap-1 text-[#F5F5F5]">
                          {aIcon} {aLabel}
                        </span>
                        <Switch
                          checked={isOn}
                          onCheckedChange={(v) =>
                            setEnabledAxesDraft((ea) => ({ ...ea, [aKey]: v }))
                          }
                        />
                      </div>
                      <textarea
                        rows={4}
                        disabled={!isOn}
                        value={axesPoolDraft[aKey]}
                        onChange={(e) =>
                          setAxesPoolDraft((a) => ({
                            ...a,
                            [aKey]: e.target.value,
                          }))
                        }
                        className="rounded-md border border-[#2E2E2E] bg-[#121212] p-2.5 font-mono-tech text-[11px] text-[#F5F5F5]"
                      />
                    </div>
                  )
                })}

                <div
                  className={cn(
                    "sm:col-span-2 lg:col-span-4 flex flex-col gap-1.5 rounded-md border border-[#2E2E2E] bg-[#171717] p-3",
                    !(enabledAxesDraft.custom_axis ?? false) && "opacity-55"
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                      <Sparkle size={13} className="text-[#A3A3A3] shrink-0" />
                      <input
                        type="text"
                        value={customAxisLabelDraft}
                        onChange={(e) => setCustomAxisLabelDraft(e.target.value)}
                        placeholder="5th axis name (e.g. Brushwork, Pose, Nail Shape)"
                        className="h-7 flex-1 rounded border border-[#2E2E2E] bg-[#262626] px-2.5 text-xs font-medium text-[#F5F5F5] outline-none"
                      />
                    </div>
                    <Switch
                      checked={enabledAxesDraft.custom_axis ?? false}
                      onCheckedChange={(v) =>
                        setEnabledAxesDraft((ea) => ({ ...ea, custom_axis: v }))
                      }
                    />
                  </div>
                  <textarea
                    rows={2}
                    disabled={!(enabledAxesDraft.custom_axis ?? false)}
                    value={axesPoolDraft.custom_axis}
                    onChange={(e) =>
                      setAxesPoolDraft((a) => ({
                        ...a,
                        custom_axis: e.target.value,
                      }))
                    }
                    placeholder="Optional 5th axis options (1 per line)…"
                    className="rounded-md border border-[#2E2E2E] bg-[#121212] p-2 font-mono-tech text-[11px] text-[#F5F5F5]"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 border-t border-[#2E2E2E] pt-4 lg:grid-cols-3 items-center">
              <div>
                <p className="text-xs font-medium text-[#F5F5F5]">Image format</p>
                <div className="mt-1.5 inline-flex flex-wrap items-center rounded-md border border-[#2E2E2E] bg-[#171717] p-0.5">
                  {EXPORT_IMAGE_FORMAT_OPTIONS.map((fmt) => {
                    const currentFmt: ExportImageFormat =
                      job.export_image_format || "original"
                    return (
                      <button
                        key={fmt.id}
                        type="button"
                        onClick={() =>
                          onUpdateJob(job.id, { export_image_format: fmt.id })
                        }
                        className={cn(
                          "rounded px-2.5 py-1 text-xs font-medium transition-colors duration-150 cursor-pointer",
                          currentFmt === fmt.id
                            ? "bg-[#FAFAFA] text-[#121212] font-semibold"
                            : "text-[#A3A3A3] hover:text-[#F5F5F5]"
                        )}
                      >
                        {fmt.shortLabel}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-[#F5F5F5]">
                  Post-image export mode
                </p>
                <div className="mt-1.5 inline-flex items-center rounded-md border border-[#2E2E2E] bg-[#171717] p-0.5">
                  {(
                    [
                      ["csv", "Picassy CSV"],
                      ["none", "Images only"],
                    ] as const
                  ).map(([mKey, mLabel]) => (
                    <button
                      key={mKey}
                      type="button"
                      onClick={() =>
                        onUpdateJob(job.id, { metadata_export_mode: mKey })
                      }
                      className={cn(
                        "rounded px-2.5 py-1 text-xs font-medium transition-colors duration-150 cursor-pointer",
                        currentExportMode === mKey
                          ? "bg-[#FAFAFA] text-[#121212] font-semibold"
                          : "text-[#A3A3A3] hover:text-[#F5F5F5]"
                      )}
                    >
                      {mLabel}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between rounded-md border border-[#2E2E2E] bg-[#171717] p-3">
                <div>
                  <p className="text-xs font-medium text-[#F5F5F5]">
                    AI metadata generation
                  </p>
                  <p className="text-[11px] text-[#737373]">
                    Generate SEO Title, Description &amp; Alt text after each shot
                  </p>
                </div>
                <Switch
                  checked={job.use_ai_caption_prompt ?? true}
                  onCheckedChange={(checked) =>
                    onUpdateJob(job.id, { use_ai_caption_prompt: checked })
                  }
                />
              </div>
            </div>

            {currentExportMode !== "none" && (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[#A3A3A3]">
                  SEO metadata prompt
                </label>
                <textarea
                  rows={2}
                  value={captionPromptDraft}
                  onChange={(e) => setCaptionPromptDraft(e.target.value)}
                  className="w-full rounded-md border border-[#2E2E2E] bg-[#121212] p-2.5 text-xs text-[#F5F5F5] outline-none focus:border-[#A3A3A3]"
                />
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#2E2E2E] pt-3">
              <StudioButton
                variant="secondary"
                onClick={() => setShowJobEditor(false)}
              >
                Cancel
              </StudioButton>
              <StudioButton
                variant="secondary"
                loading={savingJob}
                onClick={() => handleSaveJobDetails(false)}
                icon={<FloppyDisk size={14} />}
              >
                Save continuity only
              </StudioButton>
              <StudioButton
                variant="primary"
                loading={savingJob}
                onClick={() => handleSaveJobDetails(true)}
                icon={<ArrowsClockwise size={14} />}
              >
                Save &amp; replan unlocked
              </StudioButton>
            </div>
          </div>
        </StudioPanel>
      )}

      {/* Flat Summary Strip */}
      <div className="grid grid-cols-1 divide-y divide-[#2E2E2E] rounded-lg border border-[#2E2E2E] bg-[#1C1C1C] md:grid-cols-3 md:divide-y-0 md:divide-x">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between text-xs text-[#737373]">
            <span>Batch strategy</span>
            <span className="font-mono-tech text-[#A3A3A3]">
              {job.metadata_language}
            </span>
          </div>
          <p className="mt-0.5 text-xs sm:text-sm font-semibold text-[#F5F5F5]">
            {job.run_mode === "fixed"
              ? `Fixed set (${job.generations.length} shots)`
              : `Continuous waves (${job.batch_size}/wave, cap ${job.session_cap})`}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowJobEditor(true)}
          className="px-4 py-3 text-left hover:bg-[#242424] transition-colors duration-150 cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs text-[#737373]">
            <span>Style continuity</span>
            <span className="inline-flex items-center gap-1 text-[#F5F5F5]">
              <PencilSimple size={11} /> Edit
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs sm:text-sm font-medium text-[#F5F5F5]">
            {job.preset_id === REFERENCE_ADAPTIVE_PRESET_ID
              ? "Adaptive per reference (paper stays paper, skin stays skin)"
              : job.fixed_elements?.style || "Adaptive high-resolution visual style"}
          </p>
        </button>

        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <div>
            <span className="text-xs text-[#737373]">Prompt uniqueness</span>
            {duplicatePromptIndices.length === 0 ? (
              <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#F5F5F5]">
                <CheckCircle size={14} weight="fill" />
                {job.generations.length}/{job.generations.length} unique ({lockedCount} locked)
              </p>
            ) : (
              <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#FCA5A5]">
                <WarningCircle size={14} weight="fill" />
                {duplicatePromptIndices.length} duplicate group(s)
              </p>
            )}
          </div>
          <StudioBadge
            tone={duplicatePromptIndices.length === 0 ? "neutral" : "rose"}
            label={duplicatePromptIndices.length === 0 ? "Unique" : "Review"}
          />
        </div>
      </div>

      {/* Filter, Search & View Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-[#2E2E2E] bg-[#1C1C1C] p-2.5">
        <div className="flex flex-wrap items-center gap-1">
          {(
            [
              ["all", `All (${job.generations.length})`],
              ["unlocked", `Unlocked (${unlockedCount})`],
              ["locked", `Locked (${lockedCount})`],
              ...(referencedCount > 0
                ? ([["referenced", `Paired ref (${referencedCount})`]] as const)
                : []),
              ...(duplicateSet.size > 0
                ? ([["duplicates", `Duplicates (${duplicateSet.size})`]] as const)
                : []),
            ] as const
          ).map(([fKey, fLabel]) => (
            <button
              key={fKey}
              type="button"
              onClick={() => setShotFilter(fKey as ShotFilter)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150 cursor-pointer",
                shotFilter === fKey
                  ? "bg-[#FAFAFA] text-[#121212] font-semibold"
                  : "text-[#A3A3A3] hover:bg-[#262626] hover:text-[#F5F5F5]"
              )}
            >
              {fLabel}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <MagnifyingGlass
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#737373]"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search angle, lighting, prompt…"
              className="h-8 w-48 sm:w-60 rounded-md border border-[#2E2E2E] bg-[#262626] pl-8 pr-7 text-xs text-[#F5F5F5] placeholder:text-[#737373] outline-none focus:border-[#A3A3A3]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#737373] hover:text-[#F5F5F5] cursor-pointer"
              >
                <X size={12} />
              </button>
            )}
          </div>

          <div className="flex items-center rounded-md border border-[#2E2E2E] bg-[#171717] p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("cards")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors duration-150 cursor-pointer",
                viewMode === "cards"
                  ? "bg-[#FAFAFA] text-[#121212] font-semibold"
                  : "text-[#A3A3A3] hover:text-[#F5F5F5]"
              )}
            >
              <Rows size={13} />
              Cards
            </button>
            <button
              type="button"
              onClick={() => setViewMode("table")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors duration-150 cursor-pointer",
                viewMode === "table"
                  ? "bg-[#FAFAFA] text-[#121212] font-semibold"
                  : "text-[#A3A3A3] hover:text-[#F5F5F5]"
              )}
            >
              <SquaresFour size={13} />
              Table
            </button>
          </div>
        </div>
      </div>

      {/* Planned Shots */}
      {filteredGenerations.length === 0 ? (
        <div className="rounded-lg border border-[#2E2E2E] bg-[#1C1C1C] p-8 text-center">
          <p className="text-sm text-[#A3A3A3]">
            No shots match the current filter.
          </p>
        </div>
      ) : (
        <div className="space-y-3.5">
          <StudioPagination
            totalItems={filteredGenerations.length}
            pageSize={pageSize}
            pageIndex={pageIndex}
            onPageChange={setPageIndex}
          />
          <div
            className={cn(
              viewMode === "table"
                ? "grid grid-cols-1 gap-3.5 md:grid-cols-2"
                : "flex flex-col gap-3.5"
            )}
          >
            {filteredGenerations
              .slice((pageIndex - 1) * pageSize, pageIndex * pageSize)
              .map((gen) => {
                const promptVal = editingPrompts[gen.id] ?? gen.prompt_final
                const wordCount = countWords(promptVal)
                const wordTone =
                  wordCount > 145 ? "text-[#FCA5A5]" : "text-[#A3A3A3]"
                const axesVal = editingAxes[gen.id] || gen.variation_axes || {}
                const isPromptDirty = promptVal.trim() !== gen.prompt_final
                const isDuplicatePrompt =
                  (promptFrequency[promptVal.trim().toLowerCase()] || []).length > 1
                const isCompactGrid = viewMode === "table"

                const axisMeta = [
                  ...(jobEnabledAxes.camera_angles || axesVal.camera_angle
                    ? [
                        {
                          key: "camera_angle" as const,
                          label: "Camera angle",
                          icon: <Camera size={12} className="text-[#737373]" />,
                        },
                      ]
                    : []),
                  ...(jobEnabledAxes.compositions || axesVal.composition
                    ? [
                        {
                          key: "composition" as const,
                          label: "Composition",
                          icon: <GridFour size={12} className="text-[#737373]" />,
                        },
                      ]
                    : []),
                  ...(jobEnabledAxes.lighting || axesVal.lighting
                    ? [
                        {
                          key: "lighting" as const,
                          label: "Lighting",
                          icon: <SunDim size={12} className="text-[#737373]" />,
                        },
                      ]
                    : []),
                  ...(jobEnabledAxes.atmospheres || axesVal.atmosphere
                    ? [
                        {
                          key: "atmosphere" as const,
                          label: "Setting",
                          icon: <Wind size={12} className="text-[#737373]" />,
                        },
                      ]
                    : []),
                  ...(jobEnabledAxes.custom_axis || axesVal.custom_axis
                    ? [
                        {
                          key: "custom_axis" as const,
                          label: customAxisLabel,
                          icon: <Sparkle size={12} className="text-[#737373]" />,
                        },
                      ]
                    : []),
                ]

                return (
                  <div
                    key={gen.id}
                    className={cn(
                      "rounded-lg border bg-[#1C1C1C] p-4 transition-colors duration-150",
                      gen.is_locked
                        ? "border-[#737373] bg-[#222222]"
                        : isDuplicatePrompt
                          ? "border-[#EF4444]/50"
                          : "border-[#2E2E2E] hover:border-[#404040]"
                    )}
                  >
                    <div
                      className={cn(
                        "flex flex-col gap-4",
                        !isCompactGrid && "lg:flex-row lg:items-start"
                      )}
                    >
                      <div
                        className={cn(
                          "flex flex-col gap-2.5 shrink-0",
                          !isCompactGrid ? "lg:w-56" : "w-full"
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="rounded border border-[#383838] bg-[#262626] px-2 py-0.5 font-mono-tech text-xs font-semibold text-[#F5F5F5]">
                              #{String(gen.index_num).padStart(2, "0")}
                            </span>
                            <StudioBadge
                              tone={gen.status === "failed" ? "rose" : "neutral"}
                              label={gen.status}
                            />
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleShuffleAxes(gen)}
                              disabled={shufflingId === gen.id}
                              title="Shuffle variation axes from set pool"
                              className="inline-flex h-7 items-center gap-1 rounded border border-[#383838] bg-[#262626] px-2 text-[11px] text-[#F5F5F5] hover:border-[#525252] cursor-pointer"
                            >
                              <Shuffle
                                size={12}
                                className={shufflingId === gen.id ? "animate-spin" : ""}
                              />
                              Shuffle
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                onUpdateGeneration(gen.id, {
                                  is_locked: !gen.is_locked,
                                })
                              }
                              title={
                                gen.is_locked
                                  ? "Locked — preserved during Replan"
                                  : "Unlocked — click to lock"
                              }
                              className={cn(
                                "flex size-7 items-center justify-center rounded border transition-colors duration-150 cursor-pointer",
                                gen.is_locked
                                  ? "border-[#FAFAFA] bg-[#FAFAFA] text-[#121212]"
                                  : "border-[#2E2E2E] bg-[#262626] text-[#A3A3A3] hover:text-[#F5F5F5]"
                              )}
                            >
                              {gen.is_locked ? (
                                <LockKey size={13} weight="fill" />
                              ) : (
                                <LockKeyOpen size={13} />
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={() => onDeleteGeneration(gen.id)}
                              aria-label={`Remove shot ${gen.index_num}`}
                              title="Delete this shot"
                              className="flex size-7 items-center justify-center rounded border border-[#2E2E2E] bg-[#262626] text-[#737373] hover:border-[#EF4444]/35 hover:bg-[#EF4444]/15 hover:text-[#FCA5A5] cursor-pointer"
                            >
                              <Trash size={13} />
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 rounded-md border border-[#2E2E2E] bg-[#171717] p-2">
                          {gen.reference ? (
                            <img
                              src={getReferenceImageUrl(gen.reference.id)}
                              alt={gen.reference.title}
                              className="size-9 shrink-0 rounded border border-[#2E2E2E] bg-[#121212] object-cover"
                            />
                          ) : (
                            <div className="flex size-9 shrink-0 items-center justify-center rounded border border-[#2E2E2E] bg-[#121212] text-[#737373]">
                              <Sparkle size={14} />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <span className="block text-[10px] text-[#737373]">
                              Paired reference
                            </span>
                            <Select
                              value={gen.reference_id ? String(gen.reference_id) : "none"}
                              onValueChange={(val) => {
                                if (val === "none") {
                                  onUpdateGeneration(gen.id, { clear_reference: true })
                                } else {
                                  onUpdateGeneration(gen.id, {
                                    reference_id: Number(val),
                                  })
                                }
                              }}
                            >
                              <SelectTrigger className="mt-0.5 min-h-[28px] h-7 w-full px-2 py-0.5 text-[11px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">Pure prompt (none)</SelectItem>
                                {allReferences.map((r) => (
                                  <SelectItem key={r.id} value={String(r.id)}>
                                    #{r.id} · {r.title.slice(0, 22)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-1 min-w-0 flex-col gap-2.5">
                        <div
                          className={cn(
                            "grid grid-cols-1 gap-2 sm:grid-cols-2",
                            !isCompactGrid && "xl:grid-cols-4"
                          )}
                        >
                          {axisMeta.map(({ key: axisKey, label: axisLabel, icon }) => (
                            <div
                              key={axisKey}
                              className="group/axis flex flex-col justify-between rounded-md border border-[#2E2E2E] bg-[#171717] px-2.5 py-1.5 focus-within:border-[#A3A3A3]"
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#A3A3A3]">
                                  {icon}
                                  {axisLabel}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleCycleSingleAxis(gen, axisKey)}
                                  title={`Cycle next ${axisLabel} option`}
                                  className="opacity-65 group-hover/axis:opacity-100 rounded p-0.5 text-[#A3A3A3] hover:bg-[#262626] hover:text-[#F5F5F5] cursor-pointer"
                                >
                                  <ArrowsClockwise size={11} />
                                </button>
                              </div>
                              <input
                                type="text"
                                value={axesVal[axisKey] || ""}
                                onChange={(e) => {
                                  const val = e.target.value
                                  setEditingAxes((prev) => ({
                                    ...prev,
                                    [gen.id]: {
                                      ...(prev[gen.id] || gen.variation_axes || {}),
                                      [axisKey]: val,
                                    },
                                  }))
                                }}
                                onBlur={() => handleSaveAxes(gen)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.currentTarget.blur()
                                  }
                                }}
                                placeholder={`Custom ${axisLabel.toLowerCase()}…`}
                                className="mt-0.5 w-full bg-transparent text-xs text-[#F5F5F5] placeholder:text-[#737373] outline-none"
                              />
                            </div>
                          ))}
                        </div>

                        <div className="flex flex-col gap-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-[11px] text-[#737373]">
                              <span>Final prompt</span>
                              <span
                                className={cn("font-mono-tech", wordTone)}
                                title="Optimal prompt length: 65–125 words"
                              >
                                {wordCount} words
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              {savingGenId === gen.id && (
                                <span className="font-mono-tech text-[11px] text-[#A3A3A3]">
                                  Saving…
                                </span>
                              )}
                              {savedGenId === gen.id && (
                                <span className="font-mono-tech text-[11px] text-[#F5F5F5]">
                                  Saved
                                </span>
                              )}
                              {isPromptDirty && (
                                <button
                                  type="button"
                                  onClick={() => handleSavePrompt(gen, true)}
                                  className="inline-flex items-center gap-1 rounded bg-[#FAFAFA] px-2 py-0.5 text-[11px] font-semibold text-[#121212] hover:bg-[#E5E5E5] cursor-pointer"
                                >
                                  <FloppyDisk size={11} />
                                  Save prompt
                                </button>
                              )}
                              {isDuplicatePrompt && (
                                <span className="text-[11px] text-[#FCA5A5]">
                                  Duplicate — shuffle axes
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => handleCopyPrompt(gen.id, promptVal)}
                                className="inline-flex items-center gap-1 rounded border border-[#2E2E2E] bg-[#262626] px-2 py-0.5 text-[11px] text-[#A3A3A3] hover:text-[#F5F5F5] cursor-pointer"
                              >
                                {copiedGenId === gen.id ? (
                                  <>
                                    <Check size={10} />
                                    Copied
                                  </>
                                ) : (
                                  <>
                                    <Copy size={10} />
                                    Copy
                                  </>
                                )}
                              </button>
                            </div>
                          </div>

                          <textarea
                            rows={isCompactGrid ? 3 : 2}
                            value={promptVal}
                            onChange={(e) =>
                              setEditingPrompts((prev) => ({
                                ...prev,
                                [gen.id]: e.target.value,
                              }))
                            }
                            onBlur={() => handleSavePrompt(gen)}
                            className="w-full rounded-md border border-[#2E2E2E] bg-[#121212] p-2.5 text-xs leading-relaxed text-[#F5F5F5] outline-none focus:border-[#A3A3A3]"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
          </div>

          <StudioPagination
            totalItems={filteredGenerations.length}
            pageSize={pageSize}
            pageIndex={pageIndex}
            onPageChange={setPageIndex}
          />
        </div>
      )}

      <ExternalAiImportDialog
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        theme={themeDraft || job.theme}
        basePrompt={basePromptDraft || job.base_prompt}
        targetCount={job.counts?.total || job.target_count}
        metadataLanguage={job.metadata_language || "English"}
        onApplyImported={(data, opts) => {
          applyAxesResponseToDraft(data, opts.applyMetaFields)
          setShowJobEditor(true)
        }}
      />
    </div>
  )
}
