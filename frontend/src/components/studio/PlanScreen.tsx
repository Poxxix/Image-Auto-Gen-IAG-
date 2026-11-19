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
  getReferenceImageUrl,
  suggestVariationAxes,
  type CreateJobPayload,
  type EnabledAxes,
  type EnabledFixed,
  type FixedElements,
  type GenerationItem,
  type ImageSetJob,
  type MetadataExportMode,
  type ReferenceItem,
  type StudioPreset,
  type StudioTab,
  type SuggestAxesResponse,
  type TurnVariationAxes,
} from "@/services/studioApi"
import { cn } from "@/lib/utils"

export interface PlanScreenProps {
  job: ImageSetJob | null
  presets?: StudioPreset[]
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

export function PlanScreen({
  job,
  presets = [],
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

  // Editable Job Brief, Locked Continuity & Variation Axes Drawer
  const [showJobEditor, setShowJobEditor] = React.useState(false)
  const [showImportDialog, setShowImportDialog] = React.useState(false)
  const [pageIndex, setPageIndex] = React.useState(1)
  const pageSize = 24
  const [themeDraft, setThemeDraft] = React.useState("")
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
  const [customAxisLabelDraft, setCustomAxisLabelDraft] = React.useState("Custom Variation Axis")
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
    setCustomAxisLabelDraft(job.variation_axes?.custom_axis_label || "Custom Variation Axis")
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
      <StudioPanel eyebrow="02 · VARIATION PLANNER" title="No Active Image Set">
        <div className="flex flex-col items-start gap-4 py-6">
          <p className="text-sm text-[#9ca3af]">
            Create a new image set in the Create view or select an existing set from the left sidebar.
          </p>
          <StudioButton
            variant="primary"
            onClick={() => onNavigateTab("create")}
          >
            Go to Create View
          </StudioButton>
        </div>
      </StudioPanel>
    )
  }

  // Detect any exact duplicate prompts across planned turns
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
    : ["Three-quarter hero angle", "Top-down overhead flatlay", "Macro detail close-up", "Wide establishing frame"]
  const poolComps = job.variation_axes?.compositions?.length
    ? job.variation_axes.compositions
    : ["Rule-of-thirds placement", "Centered hero balance", "Layered foreground depth", "Dynamic diagonal flow"]
  const poolLights = job.variation_axes?.lighting?.length
    ? job.variation_axes.lighting
    : ["Soft diffused natural light", "Warm golden-hour sunlight", "High-contrast studio key light", "Atmospheric rim lighting"]
  const poolAtmos = job.variation_axes?.atmospheres?.length
    ? job.variation_axes.atmospheres
    : ["Authentic subject environment", "Clean minimalist backdrop", "Warm atmospheric setting", "Natural daylight context"]
  const poolCustom = job.variation_axes?.custom_axis?.length
    ? job.variation_axes.custom_axis
    : []
  const jobEnabledAxes = {
    camera_angles: job.variation_axes?.enabled_axes?.camera_angles ?? true,
    compositions: job.variation_axes?.enabled_axes?.compositions ?? true,
    lighting: job.variation_axes?.enabled_axes?.lighting ?? true,
    atmospheres: job.variation_axes?.enabled_axes?.atmospheres ?? true,
    custom_axis:
      job.variation_axes?.enabled_axes?.custom_axis ??
      Boolean(poolCustom.length),
  }
  const customAxisLabel =
    job.variation_axes?.custom_axis_label || "Custom Detail"

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

  const handleSaveAxes = async (gen: GenerationItem, overrideAxes?: TurnVariationAxes) => {
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
    const currentVal = (editingAxes[gen.id]?.[axisKey] ?? gen.variation_axes?.[axisKey]) || ""
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
        nextAxes.custom_axis = pickDifferent(poolCustom, gen.variation_axes?.custom_axis)
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

  const currentExportMode: MetadataExportMode = job.metadata_export_mode || "json"

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-5 border-b border-white/[0.06] pb-6 lg:flex-row lg:items-end">
        <div>
          <p className="font-mono-tech text-[11px] uppercase tracking-[0.22em] text-[#9ca3af]">
            02 · STORYBOARD & VARIATION MATRIX · SET #{job.id}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-2xl sm:text-4xl font-semibold tracking-tight text-[#f4f5f7]">
              {job.theme}
            </h1>
            <button
              type="button"
              onClick={() => setShowJobEditor((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 transition-all cursor-pointer",
                showJobEditor
                  ? "bg-[#f4f5f7] text-[#050505] ring-white"
                  : "bg-white/[0.05] text-[#d1d5db] ring-white/[0.1] hover:bg-white/[0.1] hover:text-white"
              )}
            >
              <Sliders size={13} />
              {showJobEditor ? "Close Set & Axes Studio" : "Edit Continuity & Axes Pool"}
            </button>
            <button
              type="button"
              disabled={suggestingAxes}
              onClick={() => handleSuggestAxesForJob(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/15 px-3 py-1 text-xs font-semibold text-amber-200 ring-1 ring-amber-400/35 hover:bg-amber-400/25 cursor-pointer"
            >
              <MagicWand
                size={13}
                weight="fill"
                className={suggestingAxes ? "animate-spin" : ""}
              />
              {suggestingAxes ? "AI Analyzing…" : "AI Suggest Axes"}
            </button>
          </div>
          <p className="mt-1.5 max-w-2xl text-xs sm:text-sm text-[#9ca3af]">
            Inspect or tweak each shot’s 4 variation axes, reference image, and final prompt. Lock any shot you want to keep before clicking <strong>Replan Unlocked</strong>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StudioButton
            variant="secondary"
            loading={replanning}
            onClick={handleReplanClick}
            icon={<ArrowsClockwise size={15} weight="light" />}
          >
            Replan Unlocked ({unlockedCount})
          </StudioButton>
          <StudioButton
            variant="secondary"
            loading={adding}
            onClick={handleAddTurnClick}
            icon={<Plus size={15} weight="light" />}
          >
            Add Shot
          </StudioButton>
          <StudioButton
            variant="primary"
            loading={starting}
            disabled={job.counts.planned === 0 && job.run_mode !== "continuous"}
            onClick={handleStartClick}
            icon={<Play size={15} weight="fill" />}
          >
            Start Run ({job.counts.planned} planned)
          </StudioButton>
          <button
            type="button"
            onClick={() => onDeleteJob(job.id, false)}
            title="Delete this image set"
            className="flex size-10 items-center justify-center rounded-full bg-white/[0.04] text-[#9ca3af] ring-1 ring-white/[0.08] hover:bg-rose-500/15 hover:text-rose-300 cursor-pointer"
          >
            <Trash size={15} />
          </button>
        </div>
      </div>

      {/* Expandable Set Brief, Locked Continuity & Variation Axes Studio Drawer */}
      {showJobEditor && (
        <StudioPanel
          eyebrow="SET BRIEF, LOCKED CONTINUITY & VARIATION AXES POOL"
          title={`Customize Set #${job.id} Continuity & Axes`}
        >
          <div className="flex flex-col gap-5">
            {suggestError && (
              <div className="rounded-xl bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300 ring-1 ring-rose-500/25">
                {suggestError}
              </div>
            )}
            {/* Row 1: Theme & Base Direction */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[#9ca3af]">
                  Set Theme / Subject
                </label>
                <input
                  type="text"
                  value={themeDraft}
                  onChange={(e) => setThemeDraft(e.target.value)}
                  className="h-10 rounded-xl bg-white/[0.04] px-3.5 text-sm text-white ring-1 ring-white/[0.1] outline-none focus:ring-2 focus:ring-white/30"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[#9ca3af]">
                  Base Visual Direction
                </label>
                <input
                  type="text"
                  value={basePromptDraft}
                  onChange={(e) => setBasePromptDraft(e.target.value)}
                  placeholder="Optional shared visual direction across all shots..."
                  className="h-10 rounded-xl bg-white/[0.04] px-3.5 text-sm text-white ring-1 ring-white/[0.1] outline-none focus:ring-2 focus:ring-white/30"
                />
              </div>
            </div>

            {/* Row 2: Preset Strip + AI Suggest Button */}
            {presets.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono-tech text-[11px] uppercase tracking-wider text-[#d1d5db]">
                    Style Presets & AI Topic Adaptation
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    {aiSuggestLabel && (
                      <span className="rounded-full bg-amber-400/15 px-2.5 py-0.5 font-mono-tech text-[10px] text-amber-300 ring-1 ring-amber-400/30">
                        AI Tailored · {aiSuggestLabel}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowImportDialog(true)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/15 px-3 py-1 text-[11px] font-semibold text-sky-200 ring-1 ring-sky-400/35 hover:bg-sky-500/25 cursor-pointer"
                    >
                      <FileCode size={12} weight="fill" />
                      Sample Prompt &amp; Import
                    </button>
                    <button
                      type="button"
                      disabled={suggestingAxes}
                      onClick={() => handleSuggestAxesForJob(false)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-amber-400 px-3 py-1 text-[11px] font-semibold text-[#050505] hover:bg-amber-300 cursor-pointer"
                    >
                      <MagicWand
                        size={12}
                        weight="fill"
                        className={suggestingAxes ? "animate-spin" : ""}
                      />
                      {suggestingAxes ? "Generating Custom Axes…" : "AI Auto-Generate Axes for Theme"}
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                  {presets.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleApplyPresetDraft(p.id)}
                      className={cn(
                        "rounded-xl px-3 py-2 text-left text-xs font-medium ring-1 transition-all cursor-pointer",
                        presetDraft === p.id
                          ? "bg-[#f4f5f7] text-[#050505] font-semibold ring-white"
                          : "bg-white/[0.03] text-[#9ca3af] ring-white/[0.07] hover:bg-white/[0.07] hover:text-white"
                      )}
                    >
                      <span className="block truncate">{p.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Row 3: Locked Continuity 4 Inputs (With ON/OFF Toggles) */}
            <div>
              <p className="mb-2 flex items-center gap-1.5 font-mono-tech text-[11px] uppercase tracking-wider text-[#d1d5db]">
                <LockKey size={13} />
                Locked Continuity Elements (Toggle Individual Locks ON/OFF)
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className={cn("flex flex-col gap-1 transition-opacity", !(enabledFixedDraft.subject ?? true) && "opacity-45")}>
                  <div className="flex items-center justify-between text-[10px] font-mono-tech uppercase text-[#9ca3af]">
                    <span>Subject / Framing Lock</span>
                    <Switch
                      checked={enabledFixedDraft.subject ?? true}
                      onCheckedChange={(v) => setEnabledFixedDraft((ef) => ({ ...ef, subject: v }))}
                    />
                  </div>
                  <input
                    type="text"
                    disabled={!(enabledFixedDraft.subject ?? true)}
                    value={fixedDraft.subject || ""}
                    onChange={(e) =>
                      setFixedDraft((f) => ({ ...f, subject: e.target.value }))
                    }
                    placeholder="Subject / Focal Motif"
                    className="h-9 rounded-xl bg-white/[0.03] px-3 text-xs text-white ring-1 ring-white/[0.08]"
                  />
                </div>
                <div className={cn("flex flex-col gap-1 transition-opacity", !(enabledFixedDraft.style ?? true) && "opacity-45")}>
                  <div className="flex items-center justify-between text-[10px] font-mono-tech uppercase text-[#9ca3af]">
                    <span>Visual Style / Medium</span>
                    <Switch
                      checked={enabledFixedDraft.style ?? true}
                      onCheckedChange={(v) => setEnabledFixedDraft((ef) => ({ ...ef, style: v }))}
                    />
                  </div>
                  <input
                    type="text"
                    disabled={!(enabledFixedDraft.style ?? true)}
                    value={fixedDraft.style || ""}
                    onChange={(e) =>
                      setFixedDraft((f) => ({ ...f, style: e.target.value }))
                    }
                    placeholder="Visual Style / Medium / Lens"
                    className="h-9 rounded-xl bg-white/[0.03] px-3 text-xs text-white ring-1 ring-white/[0.08]"
                  />
                </div>
                <div className={cn("flex flex-col gap-1 transition-opacity", !(enabledFixedDraft.color_palette ?? true) && "opacity-45")}>
                  <div className="flex items-center justify-between text-[10px] font-mono-tech uppercase text-[#9ca3af]">
                    <span>Color Palette</span>
                    <Switch
                      checked={enabledFixedDraft.color_palette ?? true}
                      onCheckedChange={(v) => setEnabledFixedDraft((ef) => ({ ...ef, color_palette: v }))}
                    />
                  </div>
                  <input
                    type="text"
                    disabled={!(enabledFixedDraft.color_palette ?? true)}
                    value={fixedDraft.color_palette || ""}
                    onChange={(e) =>
                      setFixedDraft((f) => ({ ...f, color_palette: e.target.value }))
                    }
                    placeholder="Color Palette"
                    className="h-9 rounded-xl bg-white/[0.03] px-3 text-xs text-white ring-1 ring-white/[0.08]"
                  />
                </div>
                <div className={cn("flex flex-col gap-1 transition-opacity", !(enabledFixedDraft.brand_mood ?? true) && "opacity-45")}>
                  <div className="flex items-center justify-between text-[10px] font-mono-tech uppercase text-[#9ca3af]">
                    <span>Brand Mood / Tone</span>
                    <Switch
                      checked={enabledFixedDraft.brand_mood ?? true}
                      onCheckedChange={(v) => setEnabledFixedDraft((ef) => ({ ...ef, brand_mood: v }))}
                    />
                  </div>
                  <input
                    type="text"
                    disabled={!(enabledFixedDraft.brand_mood ?? true)}
                    value={fixedDraft.brand_mood || ""}
                    onChange={(e) =>
                      setFixedDraft((f) => ({ ...f, brand_mood: e.target.value }))
                    }
                    placeholder="Brand Mood / Tone"
                    className="h-9 rounded-xl bg-white/[0.03] px-3 text-xs text-white ring-1 ring-white/[0.08]"
                  />
                </div>
              </div>
            </div>

            {/* Row 4: Toggleable Variation Axes Pools + Custom 5th Axis */}
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 font-mono-tech text-[11px] uppercase tracking-wider text-[#d1d5db]">
                  <ArrowsClockwise size={13} />
                  Modular Variation Axes Pool (Toggle Axes ON/OFF for Wallpaper, Painting, Front View)
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className={cn("flex flex-col gap-1 transition-opacity", !(enabledAxesDraft.camera_angles ?? true) && "opacity-50")}>
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1 text-[11px] text-[#9ca3af]">
                      <Camera size={12} /> Camera Angles
                    </span>
                    <Switch
                      checked={enabledAxesDraft.camera_angles ?? true}
                      onCheckedChange={(v) => setEnabledAxesDraft((ea) => ({ ...ea, camera_angles: v }))}
                    />
                  </div>
                  <textarea
                    rows={4}
                    disabled={!(enabledAxesDraft.camera_angles ?? true)}
                    value={axesPoolDraft.camera_angles}
                    onChange={(e) =>
                      setAxesPoolDraft((a) => ({ ...a, camera_angles: e.target.value }))
                    }
                    className="rounded-xl bg-white/[0.03] p-2.5 font-mono-tech text-[11px] text-white ring-1 ring-white/[0.08]"
                  />
                </div>
                <div className={cn("flex flex-col gap-1 transition-opacity", !(enabledAxesDraft.compositions ?? true) && "opacity-50")}>
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1 text-[11px] text-[#9ca3af]">
                      <GridFour size={12} /> Compositions
                    </span>
                    <Switch
                      checked={enabledAxesDraft.compositions ?? true}
                      onCheckedChange={(v) => setEnabledAxesDraft((ea) => ({ ...ea, compositions: v }))}
                    />
                  </div>
                  <textarea
                    rows={4}
                    disabled={!(enabledAxesDraft.compositions ?? true)}
                    value={axesPoolDraft.compositions}
                    onChange={(e) =>
                      setAxesPoolDraft((a) => ({ ...a, compositions: e.target.value }))
                    }
                    className="rounded-xl bg-white/[0.03] p-2.5 font-mono-tech text-[11px] text-white ring-1 ring-white/[0.08]"
                  />
                </div>
                <div className={cn("flex flex-col gap-1 transition-opacity", !(enabledAxesDraft.lighting ?? true) && "opacity-50")}>
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1 text-[11px] text-[#9ca3af]">
                      <SunDim size={12} /> Lighting Setups
                    </span>
                    <Switch
                      checked={enabledAxesDraft.lighting ?? true}
                      onCheckedChange={(v) => setEnabledAxesDraft((ea) => ({ ...ea, lighting: v }))}
                    />
                  </div>
                  <textarea
                    rows={4}
                    disabled={!(enabledAxesDraft.lighting ?? true)}
                    value={axesPoolDraft.lighting}
                    onChange={(e) =>
                      setAxesPoolDraft((a) => ({ ...a, lighting: e.target.value }))
                    }
                    className="rounded-xl bg-white/[0.03] p-2.5 font-mono-tech text-[11px] text-white ring-1 ring-white/[0.08]"
                  />
                </div>
                <div className={cn("flex flex-col gap-1 transition-opacity", !(enabledAxesDraft.atmospheres ?? true) && "opacity-50")}>
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1 text-[11px] text-[#9ca3af]">
                      <Wind size={12} /> Atmospheres
                    </span>
                    <Switch
                      checked={enabledAxesDraft.atmospheres ?? true}
                      onCheckedChange={(v) => setEnabledAxesDraft((ea) => ({ ...ea, atmospheres: v }))}
                    />
                  </div>
                  <textarea
                    rows={4}
                    disabled={!(enabledAxesDraft.atmospheres ?? true)}
                    value={axesPoolDraft.atmospheres}
                    onChange={(e) =>
                      setAxesPoolDraft((a) => ({ ...a, atmospheres: e.target.value }))
                    }
                    className="rounded-xl bg-white/[0.03] p-2.5 font-mono-tech text-[11px] text-white ring-1 ring-white/[0.08]"
                  />
                </div>

                {/* Custom 5th Domain Axis */}
                <div className={cn("sm:col-span-2 lg:col-span-4 flex flex-col gap-2 rounded-2xl bg-white/[0.025] p-3 ring-1 ring-amber-400/20 transition-opacity", !(enabledAxesDraft.custom_axis ?? false) && "opacity-60")}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                      <Sparkle size={13} className="text-amber-300 shrink-0" />
                      <input
                        type="text"
                        value={customAxisLabelDraft}
                        onChange={(e) => setCustomAxisLabelDraft(e.target.value)}
                        placeholder="5th Axis Name (e.g. Brushwork & Medium, Pose & Expression, Pattern Flow)"
                        className="h-7 flex-1 rounded-lg bg-black/40 px-2.5 text-xs font-medium text-amber-200 ring-1 ring-white/[0.08] outline-none"
                      />
                    </div>
                    <Switch
                      checked={enabledAxesDraft.custom_axis ?? false}
                      onCheckedChange={(v) => setEnabledAxesDraft((ea) => ({ ...ea, custom_axis: v }))}
                    />
                  </div>
                  <textarea
                    rows={2}
                    disabled={!(enabledAxesDraft.custom_axis ?? false)}
                    value={axesPoolDraft.custom_axis}
                    onChange={(e) =>
                      setAxesPoolDraft((a) => ({ ...a, custom_axis: e.target.value }))
                    }
                    placeholder="Optional 5th axis options (1 per line)..."
                    className="rounded-xl bg-white/[0.03] p-2.5 font-mono-tech text-[11px] text-white ring-1 ring-white/[0.08]"
                  />
                </div>
              </div>
            </div>

            {/* Row 5: Post-Image Export Mode & Caption Prompt */}
            <div className="grid grid-cols-1 gap-4 border-t border-white/[0.06] pt-4 sm:grid-cols-2 items-center">
              <div>
                <p className="text-xs font-medium text-white">
                  Post-Image Export Mode
                </p>
                <div className="mt-1.5 inline-flex items-center rounded-full bg-black/40 p-1 ring-1 ring-white/[0.1]">
                  {(
                    [
                      ["json", "Sidecar JSON (.json)"],
                      ["caption", "Pin Caption (.txt)"],
                      ["none", "Images Only"],
                    ] as const
                  ).map(([mKey, mLabel]) => (
                    <button
                      key={mKey}
                      type="button"
                      onClick={() =>
                        onUpdateJob(job.id, { metadata_export_mode: mKey })
                      }
                      className={cn(
                        "rounded-full px-3 py-1 text-xs font-medium transition-all cursor-pointer",
                        currentExportMode === mKey
                          ? "bg-amber-400 text-[#050505] font-semibold"
                          : "text-[#9ca3af] hover:text-white"
                      )}
                    >
                      {mLabel}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.07]">
                <div>
                  <p className="text-xs font-medium text-white">
                    AI Browser Post-Image Caption Turn
                  </p>
                  <p className="text-[11px] text-[#9ca3af]">
                    Generate Pin Title, Caption & SEO Description right after each image (:9222)
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
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-amber-200/90">
                  Post-Image Caption & Description Prompt
                </label>
                <textarea
                  rows={2}
                  value={captionPromptDraft}
                  onChange={(e) => setCaptionPromptDraft(e.target.value)}
                  className="w-full rounded-xl bg-white/[0.04] p-3 text-xs text-white ring-1 ring-white/[0.1] outline-none focus:ring-2 focus:ring-amber-400/40"
                />
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-white/[0.06] pt-3">
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
                icon={<FloppyDisk size={15} />}
              >
                Save Continuity Only
              </StudioButton>
              <StudioButton
                variant="primary"
                loading={savingJob}
                onClick={() => handleSaveJobDetails(true)}
                icon={<ArrowsClockwise size={15} />}
              >
                Save & Replan Unlocked Shots
              </StudioButton>
            </div>
          </div>
        </StudioPanel>
      )}

      {/* Compact 3-Card Summary & Continuity Bar */}
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
        <div className="rounded-2xl bg-white/[0.025] p-3.5 ring-1 ring-white/[0.07]">
          <div className="flex items-center justify-between">
            <p className="font-mono-tech text-[10px] uppercase tracking-wider text-[#9ca3af]">
              Set Strategy & Format
            </p>
            <span className="rounded-md bg-white/[0.06] px-2 py-0.5 font-mono-tech text-[10px] text-white">
              {job.aspect_ratio}
            </span>
          </div>
          <p className="mt-1 text-sm font-medium text-white">
            {job.run_mode === "fixed"
              ? `Fixed Set · ${job.generations.length} Shots`
              : `Continuous Wave · ${job.batch_size}/wave (Cap ${job.session_cap})`}
          </p>
          <p className="mt-0.5 font-mono-tech text-[11px] text-amber-300/90">
            {job.metadata_language} · Export:{" "}
            {currentExportMode === "caption"
              ? "Pin Caption (.txt)"
              : currentExportMode === "none"
                ? "Image Only"
                : "Sidecar (.json)"}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowJobEditor(true)}
          className="group rounded-2xl bg-white/[0.025] p-3.5 text-left ring-1 ring-white/[0.07] hover:bg-white/[0.05] hover:ring-amber-400/30 transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <p className="font-mono-tech text-[10px] uppercase tracking-wider text-amber-300/90">
              Locked Brand Continuity
            </p>
            <span className="inline-flex items-center gap-1 font-mono-tech text-[10px] text-[#9ca3af] group-hover:text-white">
              <PencilSimple size={11} /> Edit
            </span>
          </div>
          <p className="mt-1 text-xs font-medium text-[#e5e7eb] line-clamp-1">
            {job.fixed_elements?.style || "Adaptive high-resolution visual style"}
          </p>
          <p className="mt-0.5 text-[11px] text-[#9ca3af] line-clamp-1">
            Palette: {job.fixed_elements?.color_palette || "Harmonious theme tones"}
          </p>
        </button>

        <div className="rounded-2xl bg-white/[0.025] p-3.5 ring-1 ring-white/[0.07] flex items-center justify-between">
          <div>
            <p className="font-mono-tech text-[10px] uppercase tracking-wider text-[#9ca3af]">
              Diversity & Collision Check
            </p>
            {duplicatePromptIndices.length === 0 ? (
              <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-emerald-300">
                <CheckCircle size={15} weight="fill" />
                {job.generations.length}/{job.generations.length} unique prompts
              </p>
            ) : (
              <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-amber-300">
                <WarningCircle size={15} weight="fill" />
                {duplicatePromptIndices.length} duplicate group(s)
              </p>
            )}
            <p className="mt-0.5 text-[11px] text-[#9ca3af]">
              {lockedCount} locked · {unlockedCount} unlocked · {referencedCount} paired ref
            </p>
          </div>
          <StudioBadge
            tone={duplicatePromptIndices.length === 0 ? "emerald" : "amber"}
            label={duplicatePromptIndices.length === 0 ? "Unique" : "Review"}
          />
        </div>
      </div>

      {/* Filter, Search & View Mode Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/[0.02] p-2.5 ring-1 ring-white/[0.07]">
        {/* Left: Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ["all", `All (${job.generations.length})`],
              ["unlocked", `Unlocked (${unlockedCount})`],
              ["locked", `Locked (${lockedCount})`],
              ...(referencedCount > 0
                ? ([["referenced", `Paired Ref (${referencedCount})`]] as const)
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
                "rounded-full px-3 py-1 text-xs font-medium transition-all cursor-pointer",
                shotFilter === fKey
                  ? "bg-[#f4f5f7] text-[#050505] font-semibold"
                  : "bg-white/[0.03] text-[#9ca3af] hover:bg-white/[0.07] hover:text-white"
              )}
            >
              {fLabel}
            </button>
          ))}
        </div>

        {/* Right: Search Input + View Toggle */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <MagnifyingGlass
              size={13}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#646b78]"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search angle, lighting, prompt…"
              className="h-8 w-48 sm:w-60 rounded-full bg-white/[0.04] pl-8 pr-7 text-xs text-white placeholder:text-[#646b78] ring-1 ring-white/[0.08] outline-none focus:ring-white/25"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#646b78] hover:text-white cursor-pointer"
              >
                <X size={12} />
              </button>
            )}
          </div>

          <div className="flex items-center rounded-full bg-white/[0.04] p-0.5 ring-1 ring-white/[0.08]">
            <button
              type="button"
              onClick={() => setViewMode("cards")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer",
                viewMode === "cards"
                  ? "bg-[#f4f5f7] text-[#050505] font-semibold"
                  : "text-[#9ca3af] hover:text-white"
              )}
            >
              <Rows size={13} />
              Storyboard
            </button>
            <button
              type="button"
              onClick={() => setViewMode("table")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer",
                viewMode === "table"
                  ? "bg-[#f4f5f7] text-[#050505] font-semibold"
                  : "text-[#9ca3af] hover:text-white"
              )}
            >
              <SquaresFour size={13} />
              Matrix Grid
            </button>
          </div>
        </div>
      </div>

      {/* Planned Turns View */}
      {filteredGenerations.length === 0 ? (
        <div className="rounded-2xl bg-white/[0.02] p-8 text-center ring-1 ring-white/[0.06]">
          <p className="text-sm text-[#9ca3af]">
            No shots match the current filter.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <StudioPagination
            totalItems={filteredGenerations.length}
            pageSize={pageSize}
            pageIndex={pageIndex}
            onPageChange={setPageIndex}
          />
          <div
            className={cn(
              viewMode === "table"
                ? "grid grid-cols-1 gap-4 md:grid-cols-2"
                : "flex flex-col gap-4"
            )}
          >
            {filteredGenerations
              .slice((pageIndex - 1) * pageSize, pageIndex * pageSize)
              .map((gen) => {
            const promptVal = editingPrompts[gen.id] ?? gen.prompt_final
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
                      label: "Camera Angle",
                      icon: <Camera size={12} className="text-amber-300/90" />,
                    },
                  ]
                : []),
              ...(jobEnabledAxes.compositions || axesVal.composition
                ? [
                    {
                      key: "composition" as const,
                      label: "Composition",
                      icon: <GridFour size={12} className="text-sky-300/90" />,
                    },
                  ]
                : []),
              ...(jobEnabledAxes.lighting || axesVal.lighting
                ? [
                    {
                      key: "lighting" as const,
                      label: "Lighting",
                      icon: <SunDim size={12} className="text-amber-200/90" />,
                    },
                  ]
                : []),
              ...(jobEnabledAxes.atmospheres || axesVal.atmosphere
                ? [
                    {
                      key: "atmosphere" as const,
                      label: "Atmosphere",
                      icon: <Wind size={12} className="text-emerald-300/90" />,
                    },
                  ]
                : []),
              ...(jobEnabledAxes.custom_axis || axesVal.custom_axis
                ? [
                    {
                      key: "custom_axis" as const,
                      label: customAxisLabel,
                      icon: <Sparkle size={12} className="text-amber-300" />,
                    },
                  ]
                : []),
            ]

            return (
              <div
                key={gen.id}
                className={cn(
                  "rounded-3xl bg-[#0b0d12]/95 p-4 sm:p-5 ring-1 transition-all",
                  gen.is_locked
                    ? "ring-amber-400/40 bg-amber-500/[0.02]"
                    : isDuplicatePrompt
                      ? "ring-rose-400/45"
                      : "ring-white/[0.08] hover:ring-white/[0.14]"
                )}
              >
                <div
                  className={cn(
                    "flex flex-col gap-4",
                    !isCompactGrid && "lg:flex-row lg:items-start"
                  )}
                >
                  {/* Shot Header / Left Column */}
                  <div
                    className={cn(
                      "flex flex-col gap-3 shrink-0",
                      !isCompactGrid ? "lg:w-60" : "w-full"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="flex h-7 items-center rounded-full bg-white/[0.07] px-2.5 font-mono-tech text-xs font-semibold text-white ring-1 ring-white/[0.12]">
                          #{String(gen.index_num).padStart(3, "0")}
                        </span>
                        <StudioBadge
                          tone={
                            gen.status === "completed"
                              ? "emerald"
                              : gen.status === "failed"
                                ? "rose"
                                : "sky"
                          }
                          label={gen.status}
                        />
                        {gen.is_locked && (
                          <span className="font-mono-tech text-[10px] text-amber-300">
                            Locked
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleShuffleAxes(gen)}
                          disabled={shufflingId === gen.id}
                          title="Randomize all 4 variation axes from the set pool"
                          className="inline-flex h-7 items-center gap-1 rounded-full bg-white/[0.04] px-2.5 text-[11px] text-[#d1d5db] ring-1 ring-white/[0.08] hover:bg-white/[0.1] hover:text-white cursor-pointer"
                        >
                          <Shuffle
                            size={12}
                            weight="light"
                            className={shufflingId === gen.id ? "animate-spin" : ""}
                          />
                          Shuffle
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            onUpdateGeneration(gen.id, { is_locked: !gen.is_locked })
                          }
                          title={
                            gen.is_locked
                              ? "Locked — preserved during Replan"
                              : "Unlocked — click to lock this shot"
                          }
                          className={cn(
                            "flex size-7 items-center justify-center rounded-full ring-1 transition-colors cursor-pointer",
                            gen.is_locked
                              ? "bg-amber-400/20 text-amber-300 ring-amber-400/40"
                              : "bg-white/[0.04] text-[#9ca3af] ring-white/[0.08] hover:text-white"
                          )}
                        >
                          {gen.is_locked ? (
                            <LockKey size={13} weight="fill" />
                          ) : (
                            <LockKeyOpen size={13} weight="light" />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => onDeleteGeneration(gen.id)}
                          aria-label={`Remove turn ${gen.index_num}`}
                          title="Delete this shot"
                          className="flex size-7 items-center justify-center rounded-full bg-white/[0.04] text-[#646b78] ring-1 ring-white/[0.07] hover:bg-rose-500/15 hover:text-rose-300 cursor-pointer"
                        >
                          <Trash size={13} weight="light" />
                        </button>
                      </div>
                    </div>

                    {/* Reference Image Pairing Box */}
                    <div className="flex items-center gap-2.5 rounded-2xl bg-white/[0.025] p-2 ring-1 ring-white/[0.06]">
                      {gen.reference ? (
                        <img
                          src={getReferenceImageUrl(gen.reference.id)}
                          alt={gen.reference.title}
                          className="size-9 shrink-0 rounded-xl object-cover ring-1 ring-white/[0.14]"
                        />
                      ) : (
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.03] text-[#646b78] ring-1 ring-white/[0.06]">
                          <Sparkle size={14} weight="light" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <span className="block font-mono-tech text-[9px] uppercase tracking-wider text-[#646b78]">
                          Reference Pairing
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
                          <SelectTrigger className="mt-0.5 h-7 w-full rounded-lg bg-white/[0.04] px-2.5 text-[11px] text-white ring-1 ring-white/[0.08]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Pure Prompt (None)</SelectItem>
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

                  {/* Right / Bottom Area: 4 Interactive Axis Cards + Final Prompt */}
                  <div className="flex flex-1 min-w-0 flex-col gap-3">
                    {/* 4 Variation Axes Grid */}
                    <div
                      className={cn(
                        "grid grid-cols-1 gap-2 sm:grid-cols-2",
                        !isCompactGrid && "xl:grid-cols-4"
                      )}
                    >
                      {axisMeta.map(({ key: axisKey, label: axisLabel, icon }) => (
                        <div
                          key={axisKey}
                          className="group/axis flex flex-col justify-between rounded-xl bg-white/[0.025] px-3 py-2 ring-1 ring-white/[0.06] focus-within:ring-white/[0.22]"
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="inline-flex items-center gap-1.5 font-mono-tech text-[10px] uppercase tracking-wider text-[#9ca3af]">
                              {icon}
                              {axisLabel}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCycleSingleAxis(gen, axisKey)}
                              title={`Cycle next ${axisLabel} option from pool`}
                              className="opacity-60 group-hover/axis:opacity-100 rounded p-0.5 text-[#9ca3af] hover:bg-white/[0.08] hover:text-white cursor-pointer"
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
                            className="mt-1 w-full bg-transparent text-xs text-[#f4f5f7] placeholder:text-[#646b78] outline-none"
                          />
                        </div>
                      ))}
                    </div>

                    {/* Final Prompt Textarea */}
                    <div className="flex flex-col gap-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono-tech text-[10px] uppercase tracking-wider text-[#646b78]">
                          prompt_final · Auto-saves on blur
                        </span>
                        <div className="flex items-center gap-2">
                          {savingGenId === gen.id && (
                            <span className="font-mono-tech text-[10px] text-sky-300">
                              Saving…
                            </span>
                          )}
                          {savedGenId === gen.id && (
                            <span className="font-mono-tech text-[10px] text-emerald-300">
                              ✓ Saved
                            </span>
                          )}
                          {isPromptDirty && (
                            <button
                              type="button"
                              onClick={() => handleSavePrompt(gen, true)}
                              className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-0.5 font-mono-tech text-[10px] text-emerald-300 hover:bg-emerald-500/30 cursor-pointer"
                            >
                              <FloppyDisk size={11} />
                              Save Prompt
                            </button>
                          )}
                          {isDuplicatePrompt && (
                            <span className="text-[11px] text-rose-300">
                              Duplicate — click Shuffle
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => handleCopyPrompt(gen.id, promptVal)}
                            className="inline-flex items-center gap-1 rounded-full bg-white/[0.04] px-2 py-0.5 font-mono-tech text-[10px] text-[#9ca3af] hover:bg-white/[0.1] hover:text-white cursor-pointer"
                          >
                            {copiedGenId === gen.id ? (
                              <>
                                <Check size={10} className="text-emerald-300" />
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
                        className="w-full rounded-2xl bg-white/[0.025] p-3 text-xs leading-relaxed text-[#e5e7eb] ring-1 ring-white/[0.07] outline-none focus:bg-white/[0.04] focus:text-white focus:ring-2 focus:ring-white/25"
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
