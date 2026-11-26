import * as React from "react"
import {
  FolderOpen,
  DownloadSimple,
  Table,
  Copy,
  Check,
  ArrowsClockwise,
  Trash,
  WarningCircle,
  Sparkle,
  MagnifyingGlass,
  FloppyDisk,
  PencilSimple,
  Star,
} from "@phosphor-icons/react"
import {
  StudioPanel,
  StudioButton,
  StudioBadge,
  StudioPagination,
} from "@/components/shared/StudioPrimitives"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  formatPicassyKeyword,
  formatPicassySentenceCase,
  getGenerationImageUrl,
  getJobCsvUrl,
  getJobZipUrl,
  getReferenceImageUrl,
  type CreateJobPayload,
  type GenerationItem,
  type ImageSetJob,
  type MetadataExportMode,
  type StudioTab,
} from "@/services/studioApi"
import { cn } from "@/lib/utils"

export interface GalleryScreenProps {
  jobs: ImageSetJob[]
  activeJob: ImageSetJob | null
  picassyCategories?: string[]
  onSelectJob: (job: ImageSetJob) => void
  onNavigateTab: (tab: StudioTab) => void
  onUpdateJob: (jobId: number, updates: Partial<CreateJobPayload>) => Promise<void>
  onRegenerateAllMetadata: (jobId: number, useBrowserTurn: boolean) => Promise<void>
  onRemoveWatermarks?: (jobId: number) => Promise<void>
  onUpdateMetadata: (
    genId: number,
    updates: {
      is_peak?: boolean
      title?: string
      caption?: string
      description?: string
      alt_text?: string
      hashtags?: string
      prompt_final?: string
    }
  ) => Promise<void>
  onDeleteGeneration: (genId: number) => Promise<void>
  onRetryMetadata: (genId: number, useBrowserTurn: boolean) => Promise<void>
  onRetrySingleTurn: (genId: number, mutateAxes: boolean) => Promise<void>
  onOpenFolder: (jobId: number) => Promise<void>
  onChangeJobFolder: (jobId: number) => Promise<void>
  onDeleteJob: (jobId: number, deleteFiles: boolean) => Promise<void>
}

const DEFAULT_GALLERY_CATEGORIES = [
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

export function GalleryScreen({
  jobs,
  activeJob,
  picassyCategories = DEFAULT_GALLERY_CATEGORIES,
  onSelectJob,
  onNavigateTab,
  onUpdateJob,
  onRegenerateAllMetadata,
  onRemoveWatermarks,
  onUpdateMetadata,
  onDeleteGeneration,
  onRetryMetadata,
  onRetrySingleTurn,
  onOpenFolder,
  onChangeJobFolder,
  onDeleteJob,
}: GalleryScreenProps) {
  const [selectedGen, setSelectedGen] = React.useState<GenerationItem | null>(null)
  const [modalTab, setModalTab] = React.useState<"details" | "csv">("details")
  const [filterStatus, setFilterStatus] = React.useState<
    "all" | "completed" | "peak" | "metadata_pending" | "duplicates"
  >("all")
  const [searchQuery, setSearchQuery] = React.useState("")
  const [titleDrafts, setTitleDrafts] = React.useState<Record<number, string>>({})
  const [descDrafts, setDescDrafts] = React.useState<Record<number, string>>({})
  const [altDrafts, setAltDrafts] = React.useState<Record<number, string>>({})
  const [promptDrafts, setPromptDrafts] = React.useState<Record<number, string>>({})

  const [savingId, setSavingId] = React.useState<number | null>(null)
  const [savedId, setSavedId] = React.useState<number | null>(null)
  const [copiedId, setCopiedId] = React.useState<number | null>(null)
  const [regeneratingAll, setRegeneratingAll] = React.useState(false)
  const [removingWatermarks, setRemovingWatermarks] = React.useState(false)

  // Set & Picassy Config Editor
  const [showCaptionConfig, setShowCaptionConfig] = React.useState(false)
  const [themeDraft, setThemeDraft] = React.useState("")
  const [primaryTagDraft, setPrimaryTagDraft] = React.useState("")
  const [categoryDraft, setCategoryDraft] = React.useState("")
  const [captionPromptDraft, setCaptionPromptDraft] = React.useState("")
  const [savingJobConfig, setSavingJobConfig] = React.useState(false)
  const [pageIndex, setPageIndex] = React.useState(1)
  const pageSize = 24

  const currentJob = activeJob || jobs[0] || null
  const categoryOptions =
    picassyCategories.length > 0 ? picassyCategories : DEFAULT_GALLERY_CATEGORIES

  React.useEffect(() => {
    setPageIndex(1)
  }, [currentJob?.id, filterStatus, searchQuery])

  React.useEffect(() => {
    if (!currentJob) return
    const tMap: Record<number, string> = {}
    const dMap: Record<number, string> = {}
    const aMap: Record<number, string> = {}
    const pMap: Record<number, string> = {}
    for (const g of currentJob.generations) {
      tMap[g.id] = g.title || ""
      dMap[g.id] = g.description || ""
      aMap[g.id] = g.alt_text || ""
      pMap[g.id] = g.prompt_final || ""
    }
    setTitleDrafts(tMap)
    setDescDrafts(dMap)
    setAltDrafts(aMap)
    setPromptDrafts(pMap)
    setThemeDraft(currentJob.theme || "")
    setPrimaryTagDraft(currentJob.primary_tag || currentJob.theme || "")
    setCategoryDraft(currentJob.category || categoryOptions[0] || "Art")
    setCaptionPromptDraft(currentJob.caption_prompt || "")
    if (selectedGen) {
      const refreshed = currentJob.generations.find((x) => x.id === selectedGen.id)
      if (refreshed) setSelectedGen(refreshed)
      else setSelectedGen(null)
    }
  }, [currentJob])

  if (!currentJob) {
    return (
      <StudioPanel eyebrow="04 · SET GALLERY & EXPORTS" title="No Image Sets Yet">
        <div className="flex flex-col items-start gap-4 py-6">
          <p className="text-sm text-[#9ca3af]">
            Generated image sets, Picassy captions, bulk-import CSV files (`pin-import.csv`), and ZIP archives appear here once created.
          </p>
          <StudioButton variant="primary" onClick={() => onNavigateTab("create")}>
            Create First Image Set
          </StudioButton>
        </div>
      </StudioPanel>
    )
  }

  const exportMode: MetadataExportMode = currentJob.metadata_export_mode || "csv"
  const rawJobTag = (currentJob.primary_tag || currentJob.theme || "").trim()
  const jobPrimaryTag = formatPicassyKeyword(rawJobTag) || rawJobTag
  const jobCategory = (currentJob.category || "Art").trim()
  const peakCount = currentJob.generations.filter((g) => Boolean(g.is_peak)).length

  const handleTogglePeak = async (gen: GenerationItem) => {
    setSavingId(gen.id)
    try {
      await onUpdateMetadata(gen.id, { is_peak: !gen.is_peak })
    } finally {
      setSavingId(null)
    }
  }

  const handleSaveMeta = async (gen: GenerationItem, force = false) => {
    const newTitle = (titleDrafts[gen.id] ?? gen.title).trim()
    const newDesc = (descDrafts[gen.id] ?? gen.description).trim()
    const newAlt = (altDrafts[gen.id] ?? (gen.alt_text || "")).trim()
    if (
      !force &&
      newTitle === (gen.title || "") &&
      newDesc === (gen.description || "") &&
      newAlt === (gen.alt_text || "")
    ) {
      return
    }
    setSavingId(gen.id)
    try {
      await onUpdateMetadata(gen.id, {
        title: newTitle,
        caption: newTitle,
        description: newDesc,
        alt_text: newAlt,
      })
      setSavedId(gen.id)
      setTimeout(() => setSavedId(null), 2000)
    } finally {
      setSavingId(null)
    }
  }

  const handleSaveJobPrompt = async () => {
    if (!themeDraft.trim()) return
    setSavingJobConfig(true)
    try {
      await onUpdateJob(currentJob.id, {
        theme: themeDraft.trim(),
        primary_tag: primaryTagDraft.trim() || themeDraft.trim(),
        category: categoryDraft.trim(),
        caption_prompt: captionPromptDraft.trim(),
      })
      setShowCaptionConfig(false)
    } finally {
      setSavingJobConfig(false)
    }
  }

  const handleRegenerateAll = async (useBrowser: boolean) => {
    setRegeneratingAll(true)
    try {
      await onRegenerateAllMetadata(currentJob.id, useBrowser)
    } finally {
      setRegeneratingAll(false)
    }
  }

  const handleRemoveWatermarksClick = async () => {
    if (!onRemoveWatermarks) return
    setRemovingWatermarks(true)
    try {
      await onRemoveWatermarks(currentJob.id)
    } finally {
      setRemovingWatermarks(false)
    }
  }

  const handleCopyText = (id: number, text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1800)
  }

  const buildPinCopyBlock = (gen: GenerationItem) => {
    const t = (titleDrafts[gen.id] ?? gen.title).trim()
    const d = (descDrafts[gen.id] ?? gen.description).trim()
    const a = (altDrafts[gen.id] ?? (gen.alt_text || "")).trim()
    return [
      `Tag chinh: ${jobPrimaryTag}`,
      `Category: ${jobCategory}`,
      `Title: ${t}`,
      `Description: ${d}`,
      `Alt text: ${a}`,
    ].join("\n")
  }

  const filteredGenerations = currentJob.generations.filter((g) => {
    if (filterStatus === "completed" && g.status !== "completed") return false
    if (filterStatus === "peak" && !g.is_peak) return false
    if (filterStatus === "metadata_pending" && g.status !== "metadata_pending")
      return false
    if (filterStatus === "duplicates" && !g.duplicate_warning) return false
    const q = searchQuery.trim().toLowerCase()
    if (!q) return true
    return (
      (g.title || "").toLowerCase().includes(q) ||
      (g.description || "").toLowerCase().includes(q) ||
      (g.alt_text || "").toLowerCase().includes(q) ||
      jobPrimaryTag.toLowerCase().includes(q) ||
      jobCategory.toLowerCase().includes(q) ||
      (g.prompt_final || "").toLowerCase().includes(q) ||
      (g.image_file || "").toLowerCase().includes(q)
    )
  })

  const escapeCsvCell = (val: string) => {
    const clean = val.replace(/\s+/g, " ").trim()
    if (clean.includes(",") || clean.includes('"') || clean.includes("\n")) {
      return `"${clean.replace(/"/g, '""')}"`
    }
    return clean
  }

  const buildCsvRowPreview = (gen: GenerationItem, withHeader = true) => {
    const rawDesc = descDrafts[gen.id] ?? gen.description ?? ""
    const rawAlt = altDrafts[gen.id] ?? gen.alt_text ?? ""
    const row = [
      gen.image_file || "",
      titleDrafts[gen.id] ?? gen.title ?? "",
      formatPicassySentenceCase(rawDesc),
      formatPicassySentenceCase(rawAlt),
      jobCategory,
      jobPrimaryTag,
      gen.is_peak ? "TRUE" : "FALSE",
      promptDrafts[gen.id] ?? gen.prompt_final ?? "",
    ]
      .map(escapeCsvCell)
      .join(",")
    return withHeader
      ? `File name,title,description,alt_text,categories,tags,Peak of Picassy,prompt\n${row}`
      : row
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex flex-col justify-between gap-6 border-b border-white/[0.06] pb-7 lg:flex-row lg:items-end">
        <div>
          <p className="font-mono-tech text-[11px] uppercase tracking-[0.22em] text-[#9ca3af]">
            04 · PINTEREST CAPTION STUDIO & EXPORT ARCHIVE · SET #{currentJob.id}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-[#f4f5f7]">
              {currentJob.theme}
            </h1>
            <StudioBadge tone="sky" label={`Tag: ${jobPrimaryTag}`} />
            <StudioBadge tone="emerald" label={`Cat: ${jobCategory}`} />
            <button
              type="button"
              onClick={() => setShowCaptionConfig((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-3 py-1 text-xs text-[#d1d5db] ring-1 ring-white/[0.1] hover:bg-white/[0.1] hover:text-white cursor-pointer"
            >
              <PencilSimple size={13} />
              {showCaptionConfig ? "Close Picassy Editor" : "Edit Tag, Category & Prompt"}
            </button>
          </div>
          <p className="mt-1.5 font-mono-tech text-xs text-[#9ca3af] break-all">
            Export Path: {currentJob.export_dir}
          </p>
        </div>

        {/* Export Actions */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* 2-Way Export Mode Switch: Xuất CSV | Không (Chỉ ảnh) */}
          <div className="flex items-center rounded-full bg-white/[0.04] p-1 ring-1 ring-white/[0.1]">
            {(
              [
                ["csv", "Xuất CSV (pin-import.csv)"],
                ["none", "Không (Chỉ ảnh)"],
              ] as const
            ).map(([mKey, mLabel]) => (
              <button
                key={mKey}
                type="button"
                onClick={() =>
                  onUpdateJob(currentJob.id, { metadata_export_mode: mKey })
                }
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium transition-all cursor-pointer",
                  exportMode === mKey
                    ? "bg-amber-400 text-[#050505] font-semibold"
                    : "text-[#9ca3af] hover:text-white"
                )}
              >
                {mLabel}
              </button>
            ))}
          </div>

          <StudioButton
            variant="secondary"
            onClick={() => onChangeJobFolder(currentJob.id)}
          >
            <span className="inline-flex items-center gap-1.5">
              <FolderOpen size={15} weight="light" />
              Change Folder…
            </span>
          </StudioButton>

          <StudioButton
            variant="secondary"
            onClick={() => onOpenFolder(currentJob.id)}
          >
            <span className="inline-flex items-center gap-1.5">
              <FolderOpen size={15} weight="light" />
              Open in Finder
            </span>
          </StudioButton>

          {onRemoveWatermarks &&
            currentJob.generations.some((g) => Boolean(g.image_file)) && (
              <StudioButton
                variant="secondary"
                loading={removingWatermarks}
                onClick={handleRemoveWatermarksClick}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Sparkle size={15} weight="light" />
                  Clean Watermarks
                </span>
              </StudioButton>
            )}

          {currentJob.generations.some((g) => Boolean(g.image_file)) && (
            <a
              href={getJobCsvUrl(currentJob.id)}
              download={`${currentJob.slug || "set"}-pin-import.csv`}
              className="inline-flex h-10 items-center gap-1.5 rounded-full bg-amber-400/15 px-4 text-xs font-semibold text-amber-200 ring-1 ring-amber-400/35 hover:bg-amber-400/25"
              title="Download 8-column Picassy bulk-import CSV (pin-import.csv)"
            >
              <Table size={15} weight="duotone" />
              pin-import.csv
            </a>
          )}

          <a
            href={getJobZipUrl(currentJob.id)}
            download
            className="inline-flex h-10 items-center gap-2 rounded-full bg-[#f4f5f7] px-5 text-xs font-semibold text-[#050505] shadow-[0_6px_22px_rgba(255,255,255,0.14)] hover:bg-white"
          >
            <DownloadSimple size={15} weight="bold" />
            Download Set (.ZIP)
          </a>

          <button
            type="button"
            onClick={() => onDeleteJob(currentJob.id, false)}
            aria-label="Delete set from history"
            className="flex size-10 items-center justify-center rounded-full bg-white/[0.04] text-[#9ca3af] ring-1 ring-white/[0.08] hover:bg-rose-500/15 hover:text-rose-300 cursor-pointer"
            title="Remove set record (keeps exported files on disk)"
          >
            <Trash size={15} weight="light" />
          </button>
        </div>
      </div>

      {/* Expandable Set Name & Post-Image Caption Prompt Panel */}
      {showCaptionConfig && (
        <StudioPanel
          eyebrow="PICASSY SEO DATA & BATCH CAPTION PROMPT"
          title="Configure Primary Tag, Category & Metadata Prompt"
        >
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[#9ca3af]">
                  Set Theme / Name
                </label>
                <input
                  type="text"
                  value={themeDraft}
                  onChange={(e) => setThemeDraft(e.target.value)}
                  className="h-10 rounded-xl bg-white/[0.04] px-3.5 text-sm text-white ring-1 ring-white/[0.1]"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-amber-200/90">
                  Tag chính (Primary Keyword)
                </label>
                <input
                  type="text"
                  value={primaryTagDraft}
                  onChange={(e) => setPrimaryTagDraft(e.target.value)}
                  className="h-10 rounded-xl bg-white/[0.04] px-3.5 text-sm text-white ring-1 ring-white/[0.1]"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-emerald-200/90">
                  Category (1 per Job)
                </label>
                <select
                  value={categoryDraft}
                  onChange={(e) => setCategoryDraft(e.target.value)}
                  className="h-10 rounded-xl bg-[#0e1117] px-3 text-xs text-white ring-1 ring-white/[0.1]"
                >
                  {categoryOptions.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-3 flex flex-col gap-1.5">
                <label className="text-xs font-medium text-amber-200/90">
                  Custom Picassy Metadata Instructions
                </label>
                <input
                  type="text"
                  value={captionPromptDraft}
                  onChange={(e) => setCaptionPromptDraft(e.target.value)}
                  placeholder="Instructions for Title (<=60), Description (<=160), and Alt Text (100-125)..."
                  className="h-10 rounded-xl bg-white/[0.04] px-3.5 text-xs text-white ring-1 ring-white/[0.1]"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <StudioButton
                  variant="secondary"
                  loading={regeneratingAll}
                  onClick={() => handleRegenerateAll(false)}
                  icon={<ArrowsClockwise size={14} />}
                >
                  Regenerate All Captions (Instant Pin SEO)
                </StudioButton>
                <StudioButton
                  variant="secondary"
                  loading={regeneratingAll}
                  onClick={() => handleRegenerateAll(true)}
                  icon={<Sparkle size={14} />}
                >
                  Run AI Browser Prompt for All Images (:9222)
                </StudioButton>
              </div>

              <div className="flex items-center gap-2">
                <StudioButton
                  variant="secondary"
                  onClick={() => setShowCaptionConfig(false)}
                >
                  Close
                </StudioButton>
                <StudioButton
                  variant="primary"
                  loading={savingJobConfig}
                  onClick={handleSaveJobPrompt}
                  icon={<FloppyDisk size={14} />}
                >
                  Save Prompt & Theme
                </StudioButton>
              </div>
            </div>
          </div>
        </StudioPanel>
      )}

      {/* Set Selector & Filter Bar */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ["all", `All (${currentJob.counts.total})`],
              ["completed", `Completed (${currentJob.counts.completed})`],
              ["peak", `Peak ★ (${peakCount})`],
              [
                "metadata_pending",
                `Meta Pending (${currentJob.counts.metadata_pending})`,
              ],
              ["duplicates", `Near-Duplicates (${currentJob.counts.duplicates})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilterStatus(key)}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-xs font-medium ring-1 transition-colors cursor-pointer",
                filterStatus === key
                  ? "bg-[#f4f5f7] text-[#050505] ring-white"
                  : "bg-white/[0.03] text-[#9ca3af] ring-white/[0.07] hover:text-white"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative flex w-full sm:w-72 items-center">
          <MagnifyingGlass
            size={15}
            weight="light"
            className="pointer-events-none absolute left-3.5 text-[#9ca3af]"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter by title, caption, hashtags..."
            className="h-9 w-full rounded-full bg-white/[0.04] pl-9 pr-4 text-xs text-white placeholder:text-[#646b78] ring-1 ring-white/[0.08] outline-none focus:ring-2 focus:ring-white/30"
          />
        </div>
      </div>

      {/* Multi-Set Switcher Strip when >1 sets exist */}
      {jobs.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {jobs.map((j) => {
            const active = j.id === currentJob.id
            return (
              <button
                key={j.id}
                type="button"
                onClick={() => onSelectJob(j)}
                className={cn(
                  "shrink-0 rounded-2xl px-4 py-2 text-xs font-medium ring-1 transition-all cursor-pointer",
                  active
                    ? "bg-white/[0.1] text-white ring-white/[0.25]"
                    : "bg-white/[0.025] text-[#9ca3af] ring-white/[0.06] hover:text-white"
                )}
              >
                Set #{j.id} · {j.theme} ({j.counts.completed}/{j.counts.total})
              </button>
            )
          })}
        </div>
      )}

      {/* Gallery Grid (Paginated for 100–1000 images) */}
      <StudioPagination
        totalItems={filteredGenerations.length}
        pageSize={pageSize}
        pageIndex={pageIndex}
        onPageChange={setPageIndex}
        itemLabel="items"
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        {filteredGenerations
          .slice((pageIndex - 1) * pageSize, pageIndex * pageSize)
          .map((gen) => {
          const hasImage = Boolean(gen.image_file)
          const titleVal = titleDrafts[gen.id] ?? gen.title
          const descVal = descDrafts[gen.id] ?? gen.description
          const altVal = altDrafts[gen.id] ?? (gen.alt_text || "")
          const kwLower = jobPrimaryTag.toLowerCase()
          const titleOk =
            titleVal.length > 0 &&
            titleVal.length <= 60 &&
            (!kwLower || titleVal.toLowerCase().startsWith(kwLower))
          const descOk =
            descVal.length > 0 &&
            descVal.length <= 160 &&
            !descVal.includes("#") &&
            (!kwLower || descVal.toLowerCase().includes(kwLower))
          const altOk =
            altVal.length >= 100 &&
            altVal.length <= 125 &&
            (!kwLower || altVal.toLowerCase().includes(kwLower))
          const isDirty =
            titleVal !== (gen.title || "") ||
            descVal !== (gen.description || "") ||
            altVal !== (gen.alt_text || "")

          return (
            <div
              key={gen.id}
              className="flex flex-col justify-between overflow-hidden rounded-3xl bg-[#0b0d11]/90 p-5 ring-1 ring-white/[0.08] transition-all hover:ring-white/[0.16]"
            >
              <div>
                {/* Top Header */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono-tech text-xs font-semibold text-white">
                      #{String(gen.index_num).padStart(3, "0")}
                    </span>
                    <span className="font-mono-tech text-[11px] text-[#9ca3af] truncate">
                      {gen.image_file || "Not generated yet"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleTogglePeak(gen)}
                      title={`Peak of Picassy: ${gen.is_peak ? "TRUE (click to unset)" : "FALSE (click to mark TRUE in CSV)"}`}
                      className={cn(
                        "inline-flex h-7 items-center gap-1 rounded-full px-2.5 font-mono-tech text-[10px] font-semibold ring-1 transition-all cursor-pointer",
                        gen.is_peak
                          ? "bg-amber-400 text-[#050505] ring-amber-300 shadow-[0_2px_10px_rgba(251,191,36,0.28)]"
                          : "bg-white/[0.04] text-[#9ca3af] ring-white/[0.08] hover:bg-white/[0.1] hover:text-amber-200"
                      )}
                    >
                      <Star size={12} weight={gen.is_peak ? "fill" : "regular"} />
                      Peak
                    </button>
                    <StudioBadge
                      tone={
                        gen.status === "completed"
                          ? "emerald"
                          : gen.status === "metadata_pending"
                            ? "amber"
                            : gen.status === "failed"
                              ? "rose"
                              : "neutral"
                      }
                      label={gen.status.replace("_", " ")}
                    />
                    <button
                      type="button"
                      onClick={() => onDeleteGeneration(gen.id)}
                      title="Delete this image and resequence pin-import.csv"
                      className="flex size-7 items-center justify-center rounded-full bg-white/[0.04] text-[#646b78] hover:bg-rose-500/20 hover:text-rose-300 cursor-pointer"
                    >
                      <Trash size={13} />
                    </button>
                  </div>
                </div>

                {/* Image Preview */}
                <div className="mt-3 relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-black/50 ring-1 ring-white/[0.07]">
                  {hasImage ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedGen(gen)
                        setModalTab("details")
                      }}
                      className="group block h-full w-full cursor-pointer"
                    >
                      <img
                        src={getGenerationImageUrl(gen.id, gen.md5 || gen.image_file)}
                        alt={gen.title || gen.prompt_final}
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                      />
                    </button>
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-[#646b78]">
                      <Sparkle size={20} weight="light" />
                      <span>No image file yet ({gen.status})</span>
                    </div>
                  )}
                </div>

                {/* Near-Duplicate Warning if present */}
                {gen.duplicate_warning && (
                  <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-amber-500/12 px-3 py-2 text-[11px] text-amber-200 ring-1 ring-amber-400/30">
                    <span className="inline-flex items-center gap-1.5">
                      <WarningCircle size={14} weight="fill" />
                      {gen.duplicate_warning}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRetrySingleTurn(gen.id, true)}
                      className="rounded-full bg-amber-400/20 px-2.5 py-0.5 font-medium text-amber-100 hover:bg-amber-400/30 cursor-pointer"
                    >
                      Mutate & Redo
                    </button>
                  </div>
                )}

                {/* Inline Editable Picassy SEO Fields: Title (<=60), Description (<=160), Alt Text (100-125) */}
                {exportMode !== "none" ? (
                  <div className="mt-4 flex flex-col gap-2.5">
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <label className="font-mono-tech text-[10px] uppercase tracking-wider text-[#9ca3af]">
                          Title ({titleVal.length}/60)
                        </label>
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "font-mono-tech text-[10px]",
                              titleOk ? "text-emerald-300" : "text-amber-300"
                            )}
                          >
                            {titleOk ? "✓ Prefix+Len" : "Check Prefix/60"}
                          </span>
                          {savingId === gen.id ? (
                            <span className="font-mono-tech text-[10px] text-sky-300">
                              Syncing…
                            </span>
                          ) : savedId === gen.id ? (
                            <span className="font-mono-tech text-[10px] text-emerald-300">
                              ✓ Saved
                            </span>
                          ) : isDirty ? (
                            <button
                              type="button"
                              onClick={() => handleSaveMeta(gen, true)}
                              className="inline-flex items-center gap-1 font-mono-tech text-[10px] text-emerald-300 hover:underline cursor-pointer"
                            >
                              <FloppyDisk size={11} />
                              Save
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <input
                        type="text"
                        value={titleVal}
                        onChange={(e) =>
                          setTitleDrafts((prev) => ({
                            ...prev,
                            [gen.id]: e.target.value,
                          }))
                        }
                        onBlur={() => handleSaveMeta(gen)}
                        placeholder={`Starts with "${jobPrimaryTag}" (<=60 chars)...`}
                        className="mt-1 h-9 w-full rounded-xl bg-white/[0.03] px-3 text-xs font-medium text-white ring-1 ring-white/[0.08] outline-none focus:ring-2 focus:ring-white/30"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <label className="font-mono-tech text-[10px] uppercase tracking-wider text-[#9ca3af]">
                          Description ({descVal.length}/160)
                        </label>
                        <span
                          className={cn(
                            "font-mono-tech text-[10px]",
                            descOk ? "text-emerald-300" : "text-amber-300"
                          )}
                        >
                          {descOk ? "✓ Clean Prose" : "Check Keyword/160"}
                        </span>
                      </div>
                      <textarea
                        rows={2}
                        value={descVal}
                        onChange={(e) =>
                          setDescDrafts((prev) => ({
                            ...prev,
                            [gen.id]: e.target.value,
                          }))
                        }
                        onBlur={() => handleSaveMeta(gen)}
                        placeholder={`Complete sentence containing "${jobPrimaryTag}" (<=160 chars, no #)...`}
                        className="mt-1 w-full rounded-xl bg-white/[0.03] p-2.5 text-xs text-[#d1d5db] ring-1 ring-white/[0.08] outline-none focus:ring-2 focus:ring-white/30"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <label className="font-mono-tech text-[10px] uppercase tracking-wider text-sky-200/90">
                          Alt Text ({altVal.length}/100–125)
                        </label>
                        <span
                          className={cn(
                            "font-mono-tech text-[10px]",
                            altOk ? "text-emerald-300" : "text-rose-300"
                          )}
                        >
                          {altOk ? "✓ 100–125" : `${altVal.length} chars (need 100–125)`}
                        </span>
                      </div>
                      <textarea
                        rows={2}
                        value={altVal}
                        onChange={(e) =>
                          setAltDrafts((prev) => ({
                            ...prev,
                            [gen.id]: e.target.value,
                          }))
                        }
                        onBlur={() => handleSaveMeta(gen)}
                        placeholder="Truthful screen-reader visual description (100-125 chars)..."
                        className="mt-1 w-full rounded-xl bg-white/[0.025] p-2.5 text-xs text-sky-100 ring-1 ring-white/[0.07] outline-none focus:ring-2 focus:ring-sky-400/30"
                      />
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-[11px] text-[#646b78]">
                    Image-only export mode active. Switch to &quot;Xuất CSV&quot; above to edit &amp; export <code className="text-[#9ca3af]">pin-import.csv</code>.
                  </p>
                )}
              </div>

              {/* Card Bottom Bar: Copy Pin Caption, AI Re-write, & Downloads */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleCopyText(gen.id, buildPinCopyBlock(gen))}
                    className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2.5 py-1 text-[11px] font-medium text-amber-200 ring-1 ring-amber-400/25 hover:bg-amber-400/25 cursor-pointer"
                    title="Copy Picassy Tag, Category, Title, Description, Alt text"
                  >
                    {copiedId === gen.id ? (
                      <>
                        <Check size={12} weight="bold" className="text-emerald-300" />
                        Copied SEO
                      </>
                    ) : (
                      <>
                        <Copy size={12} weight="light" />
                        Copy SEO
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => onRetryMetadata(gen.id, true)}
                    className="inline-flex items-center gap-1 rounded-full bg-white/[0.04] px-2.5 py-1 text-[11px] text-[#d1d5db] hover:bg-white/[0.1] hover:text-white cursor-pointer"
                    title="Send post-image prompt to AI Browser (:9222) to write a fresh Pin Caption & Description"
                  >
                    <Sparkle size={12} weight="light" className="text-amber-300" />
                    AI Prompt
                  </button>

                  <button
                    type="button"
                    onClick={() => onRetryMetadata(gen.id, false)}
                    className="inline-flex items-center gap-1 rounded-full bg-white/[0.04] px-2 py-1 text-[11px] text-[#9ca3af] hover:text-white cursor-pointer"
                    title="Instant Pin SEO Caption & Description synthesis"
                  >
                    <ArrowsClockwise size={12} weight="light" />
                  </button>
                </div>

                {hasImage && (
                  <div className="flex items-center gap-1.5">
                    {exportMode === "csv" && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedGen(gen)
                          setModalTab("csv")
                        }}
                        className="rounded-full bg-white/[0.05] px-2.5 py-1 font-mono-tech text-[10px] text-[#d1d5db] hover:bg-white/[0.12] cursor-pointer"
                        title="Preview exact CSV row in pin-import.csv"
                      >
                        .CSV Row
                      </button>
                    )}
                    <a
                      href={getGenerationImageUrl(gen.id, gen.updated_at, true)}
                      download={gen.image_file}
                      className="inline-flex items-center gap-1 rounded-full bg-[#f4f5f7] px-3 py-1 text-[11px] font-medium text-[#050505] hover:bg-white"
                    >
                      <DownloadSimple size={12} weight="bold" />
                      Image
                    </a>
                  </div>
                )}
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
        itemLabel="items"
      />

      {/* Full Image, Prompt Editor, Pin Caption & Sidecar JSON Inspector Modal */}
      <Dialog
        open={Boolean(selectedGen)}
        onOpenChange={(open) => !open && setSelectedGen(null)}
      >
        <DialogContent className="max-w-3xl">
          {selectedGen && (
            <>
              <DialogHeader>
                <div className="flex flex-wrap items-center justify-between gap-2 pr-6">
                  <div>
                    <DialogTitle>
                      #{String(selectedGen.index_num).padStart(3, "0")} ·{" "}
                      {selectedGen.title || selectedGen.image_file}
                    </DialogTitle>
                    <DialogDescription>
                      {selectedGen.width}×{selectedGen.height} · {selectedGen.model} ·{" "}
                      {selectedGen.image_file}
                    </DialogDescription>
                  </div>

                  {/* Modal Tab Switcher: Details vs CSV Row */}
                  <div className="flex items-center rounded-full bg-white/[0.04] p-1 ring-1 ring-white/[0.08]">
                    <button
                      type="button"
                      onClick={() => setModalTab("details")}
                      className={cn(
                        "rounded-full px-3 py-1 text-xs font-medium cursor-pointer",
                        modalTab === "details"
                          ? "bg-[#f4f5f7] text-[#050505]"
                          : "text-[#9ca3af] hover:text-white"
                      )}
                    >
                      Details &amp; Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setModalTab("csv")}
                      className={cn(
                        "rounded-full px-3 py-1 font-mono-tech text-xs font-medium cursor-pointer",
                        modalTab === "csv"
                          ? "bg-amber-400 text-[#050505]"
                          : "text-[#9ca3af] hover:text-white"
                      )}
                    >
                      CSV Row (.csv)
                    </button>
                  </div>
                </div>
              </DialogHeader>

              <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="overflow-hidden rounded-2xl bg-black/60 ring-1 ring-white/[0.1] flex items-center justify-center">
                  <img
                    src={getGenerationImageUrl(selectedGen.id, selectedGen.md5 || selectedGen.image_file)}
                    alt={selectedGen.title}
                    className="max-h-[440px] w-full object-contain"
                  />
                </div>

                {modalTab === "details" ? (
                  <div className="flex flex-col justify-between gap-4 text-xs">
                    <div className="space-y-3">
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="font-mono-tech text-[10px] uppercase tracking-wider text-[#9ca3af]">
                            Editable Visual Prompt (prompt_final)
                          </span>
                          <button
                            type="button"
                            onClick={async () => {
                              const draftP = (
                                promptDrafts[selectedGen.id] ?? selectedGen.prompt_final
                              ).trim()
                              if (draftP) {
                                await onUpdateMetadata(selectedGen.id, {
                                  prompt_final: draftP,
                                })
                              }
                            }}
                            className="font-mono-tech text-[10px] text-emerald-300 hover:underline cursor-pointer"
                          >
                            Save Prompt
                          </button>
                        </div>
                        <textarea
                          rows={4}
                          value={
                            promptDrafts[selectedGen.id] ?? selectedGen.prompt_final
                          }
                          onChange={(e) =>
                            setPromptDrafts((prev) => ({
                              ...prev,
                              [selectedGen.id]: e.target.value,
                            }))
                          }
                          className="mt-1 w-full rounded-xl bg-white/[0.03] p-3 text-xs leading-relaxed text-[#e5e7eb] ring-1 ring-white/[0.08]"
                        />
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={async () => {
                              const draftP = (
                                promptDrafts[selectedGen.id] ?? selectedGen.prompt_final
                              ).trim()
                              if (draftP && draftP !== selectedGen.prompt_final) {
                                await onUpdateMetadata(selectedGen.id, {
                                  prompt_final: draftP,
                                })
                              }
                              await onRetrySingleTurn(selectedGen.id, false)
                              setSelectedGen(null)
                            }}
                            className="rounded-full bg-white/[0.07] px-3 py-1 text-[11px] text-white hover:bg-white/[0.14] cursor-pointer"
                          >
                            Save Prompt & Regenerate Image
                          </button>
                        </div>
                      </div>

                      {selectedGen.reference && (
                        <div className="flex items-center gap-3 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.07]">
                          <img
                            src={getReferenceImageUrl(selectedGen.reference.id)}
                            alt={selectedGen.reference.title}
                            className="size-12 rounded-lg object-cover"
                          />
                          <div>
                            <p className="font-medium text-white">
                              Reference #{selectedGen.reference.id} (
                              {selectedGen.reference.source_type})
                            </p>
                            <p className="text-[11px] text-[#9ca3af]">
                              Rights: {selectedGen.reference.usage_rights}
                            </p>
                          </div>
                        </div>
                      )}

                      <div className="flex items-center justify-between rounded-xl bg-white/[0.025] p-3 ring-1 ring-white/[0.07]">
                        <div>
                          <p className="text-xs font-semibold text-white">
                            Peak of Picassy (Featured CSV Flag)
                          </p>
                          <p className="text-[11px] text-[#9ca3af]">
                            Exports <code className="text-amber-300">{selectedGen.is_peak ? "TRUE" : "FALSE"}</code> in column 7 of <code className="text-[#d1d5db]">pin-import.csv</code>
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleTogglePeak(selectedGen)}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 font-mono-tech text-xs font-semibold ring-1 transition-all cursor-pointer",
                            selectedGen.is_peak
                              ? "bg-amber-400 text-[#050505] ring-amber-300"
                              : "bg-white/[0.05] text-[#d1d5db] ring-white/[0.1] hover:bg-white/[0.1]"
                          )}
                        >
                          <Star size={13} weight={selectedGen.is_peak ? "fill" : "regular"} />
                          {selectedGen.is_peak ? "TRUE" : "FALSE"}
                        </button>
                      </div>

                      <div className="rounded-xl bg-white/[0.02] p-3 ring-1 ring-white/[0.06] font-mono-tech text-[11px] text-[#9ca3af] space-y-1">
                        <p>MD5: {selectedGen.md5}</p>
                        <p>dHash: {selectedGen.dhash}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                      <button
                        type="button"
                        onClick={async () => {
                          await onDeleteGeneration(selectedGen.id)
                          setSelectedGen(null)
                        }}
                        className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-3.5 py-2 text-xs text-rose-200 hover:bg-rose-500/25 cursor-pointer"
                      >
                        <Trash size={13} />
                        Delete Image
                      </button>

                      <div className="flex items-center gap-2">
                        <a
                          href={getJobCsvUrl(currentJob.id)}
                          download={`${currentJob.slug || "set"}-pin-import.csv`}
                          className="rounded-full bg-amber-400/20 px-3.5 py-2 text-xs text-amber-200 hover:bg-amber-400/30"
                        >
                          Download Set .CSV
                        </a>
                        <a
                          href={getGenerationImageUrl(
                            selectedGen.id,
                            selectedGen.updated_at,
                            true
                          )}
                          download={selectedGen.image_file}
                          className="rounded-full bg-[#f4f5f7] px-4 py-2 text-xs font-semibold text-[#050505] hover:bg-white"
                        >
                          Download Image
                        </a>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col justify-between gap-3">
                    <pre className="max-h-[370px] whitespace-pre-wrap break-all overflow-auto rounded-2xl bg-[#050505] p-4 font-mono-tech text-[11px] leading-relaxed text-amber-200 ring-1 ring-white/[0.08]">
                      {buildCsvRowPreview(selectedGen, true)}
                    </pre>
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() =>
                          handleCopyText(
                            selectedGen.id + 20000,
                            buildCsvRowPreview(selectedGen, false)
                          )
                        }
                        className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-4 py-2 text-xs text-white hover:bg-white/[0.12] cursor-pointer"
                      >
                        <Copy size={13} weight="light" />
                        {copiedId === selectedGen.id + 20000
                          ? "Copied CSV Row"
                          : "Copy CSV Row"}
                      </button>
                      <a
                        href={getJobCsvUrl(currentJob.id)}
                        download={`${currentJob.slug || "set"}-pin-import.csv`}
                        className="rounded-full bg-amber-400 px-4 py-2 text-xs font-semibold text-[#050505] hover:bg-amber-300"
                      >
                        Download pin-import.csv
                      </a>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
