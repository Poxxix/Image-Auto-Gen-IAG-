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
  X,
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
  onBulkDeleteGenerations?: (jobId: number, genIds: number[]) => Promise<void>
  onReconcileFolder?: (jobId: number) => Promise<void>
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
  onBulkDeleteGenerations,
  onReconcileFolder,
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
  const [reconcilingFolder, setReconcilingFolder] = React.useState(false)
  const [selectedGenIds, setSelectedGenIds] = React.useState<number[]>([])
  const [bulkDeleting, setBulkDeleting] = React.useState(false)

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
    setSelectedGenIds([])
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
      <StudioPanel title="No image sets yet">
        <div className="flex flex-col items-start gap-3 py-4">
          <p className="text-sm text-[#A3A3A3]">
            Generated image sets, Picassy SEO fields, bulk-import CSV files (pin-import.csv), and ZIP archives appear here once created.
          </p>
          <StudioButton variant="primary" onClick={() => onNavigateTab("create")}>
            Create first set
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
    <div className="flex flex-col gap-5">
      {/* Top Publishing & Export Toolbar */}
      <div className="flex flex-col justify-between gap-4 border-b border-[#2E2E2E] pb-4 lg:flex-row lg:items-end">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-[#F5F5F5]">
              {currentJob.theme}
            </h1>
            <StudioBadge tone="neutral" label={`Tag: ${jobPrimaryTag}`} />
            <StudioBadge tone="neutral" label={jobCategory} />
            <button
              type="button"
              onClick={() => setShowCaptionConfig((v) => !v)}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors duration-150 cursor-pointer",
                showCaptionConfig
                  ? "border-[#FAFAFA] bg-[#FAFAFA] text-[#121212] font-semibold"
                  : "border-[#383838] bg-[#262626] text-[#F5F5F5] hover:border-[#525252]"
              )}
            >
              <PencilSimple size={13} />
              {showCaptionConfig ? "Close SEO settings" : "Edit SEO settings"}
            </button>
          </div>
          <p className="mt-1 font-mono-tech text-xs text-[#737373] break-all">
            {currentJob.export_dir}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-md border border-[#2E2E2E] bg-[#1C1C1C] p-0.5">
            {(
              [
                ["csv", "Xuất CSV"],
                ["none", "Chỉ ảnh"],
              ] as const
            ).map(([mKey, mLabel]) => (
              <button
                key={mKey}
                type="button"
                onClick={() =>
                  onUpdateJob(currentJob.id, { metadata_export_mode: mKey })
                }
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium transition-colors duration-150 cursor-pointer",
                  exportMode === mKey
                    ? "bg-[#FAFAFA] text-[#121212] font-semibold"
                    : "text-[#A3A3A3] hover:text-[#F5F5F5]"
                )}
              >
                {mLabel}
              </button>
            ))}
          </div>

          <StudioButton
            variant="secondary"
            onClick={() => onOpenFolder(currentJob.id)}
            icon={<FolderOpen size={14} />}
          >
            Open in Finder
          </StudioButton>

          {onReconcileFolder && (
            <StudioButton
              variant="secondary"
              loading={reconcilingFolder}
              onClick={async () => {
                setReconcilingFolder(true)
                try {
                  await onReconcileFolder(currentJob.id)
                } finally {
                  setReconcilingFolder(false)
                }
              }}
              icon={<ArrowsClockwise size={14} />}
              title="Scan folder for files deleted in Finder, re-sequence -1..N, and rewrite pin-import.csv"
            >
              Sync folder &amp; CSV
            </StudioButton>
          )}

          {onRemoveWatermarks &&
            currentJob.generations.some((g) => Boolean(g.image_file)) && (
              <StudioButton
                variant="secondary"
                loading={removingWatermarks}
                onClick={handleRemoveWatermarksClick}
                icon={<Sparkle size={14} />}
              >
                Clean watermarks
              </StudioButton>
            )}

          {currentJob.generations.some((g) => Boolean(g.image_file)) && (
            <a
              href={getJobCsvUrl(currentJob.id)}
              download={`${currentJob.slug || "set"}-pin-import.csv`}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#383838] bg-[#262626] px-3 text-xs font-medium text-[#F5F5F5] transition-colors duration-150 hover:border-[#525252] hover:bg-[#303030]"
              title="Download 8-column Picassy bulk-import CSV (pin-import.csv)"
            >
              <Table size={14} />
              pin-import.csv
            </a>
          )}

          <a
            href={getJobZipUrl(currentJob.id)}
            download
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#FAFAFA] px-3.5 text-xs font-semibold text-[#121212] transition-colors duration-150 hover:bg-[#E5E5E5]"
          >
            <DownloadSimple size={14} weight="bold" />
            Download .ZIP
          </a>

          <button
            type="button"
            onClick={() => onDeleteJob(currentJob.id, false)}
            aria-label="Delete set from history"
            className="flex size-9 items-center justify-center rounded-md border border-[#2E2E2E] bg-[#1C1C1C] text-[#A3A3A3] hover:border-[#EF4444]/35 hover:bg-[#EF4444]/15 hover:text-[#FCA5A5] cursor-pointer"
            title="Remove set record (keeps exported files on disk)"
          >
            <Trash size={14} />
          </button>
        </div>
      </div>

      {/* Collapsible SEO Settings */}
      {showCaptionConfig && (
        <StudioPanel
          title="Picassy tag, category & batch caption instructions"
          headerRight={
            <button
              type="button"
              onClick={() => onChangeJobFolder(currentJob.id)}
              className="inline-flex items-center gap-1 text-xs text-[#F5F5F5] hover:underline cursor-pointer"
            >
              <FolderOpen size={13} /> Change export folder…
            </button>
          }
        >
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[#A3A3A3]">
                  Set name
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
                  Tag chính (Primary keyword)
                </label>
                <input
                  type="text"
                  value={primaryTagDraft}
                  onChange={(e) => setPrimaryTagDraft(e.target.value)}
                  className="h-9 rounded-md border border-[#2E2E2E] bg-[#262626] px-3 text-sm text-[#F5F5F5] outline-none focus:border-[#A3A3A3]"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[#A3A3A3]">
                  Category (1 per set)
                </label>
                <select
                  value={categoryDraft}
                  onChange={(e) => setCategoryDraft(e.target.value)}
                  className="h-9 rounded-md border border-[#2E2E2E] bg-[#262626] px-3 text-xs text-[#F5F5F5] outline-none focus:border-[#A3A3A3]"
                >
                  {categoryOptions.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-3 flex flex-col gap-1">
                <label className="text-xs font-medium text-[#A3A3A3]">
                  Metadata prompt instructions
                </label>
                <input
                  type="text"
                  value={captionPromptDraft}
                  onChange={(e) => setCaptionPromptDraft(e.target.value)}
                  placeholder="Instructions for Title (<=60), Sentence-case Description (<=160), and Alt text (100–125)…"
                  className="h-9 rounded-md border border-[#2E2E2E] bg-[#262626] px-3 text-xs text-[#F5F5F5] outline-none focus:border-[#A3A3A3]"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#2E2E2E] pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <StudioButton
                  variant="secondary"
                  loading={regeneratingAll}
                  onClick={() => handleRegenerateAll(false)}
                  icon={<ArrowsClockwise size={14} />}
                >
                  Regenerate all captions (instant)
                </StudioButton>
                <StudioButton
                  variant="secondary"
                  loading={regeneratingAll}
                  onClick={() => handleRegenerateAll(true)}
                  icon={<Sparkle size={14} />}
                >
                  Rewrite all via AI browser
                </StudioButton>
              </div>

              <div className="flex items-center gap-2">
                <StudioButton
                  variant="secondary"
                  onClick={() => setShowCaptionConfig(false)}
                >
                  Cancel
                </StudioButton>
                <StudioButton
                  variant="primary"
                  loading={savingJobConfig}
                  onClick={handleSaveJobPrompt}
                  icon={<FloppyDisk size={14} />}
                >
                  Save SEO settings
                </StudioButton>
              </div>
            </div>
          </div>
        </StudioPanel>
      )}

      {/* Filter Pills & Search */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-[#2E2E2E] bg-[#1C1C1C] p-2.5">
        <div className="flex flex-wrap items-center gap-1">
          {(
            [
              ["all", `All (${currentJob.counts.total})`],
              ["completed", `Completed (${currentJob.counts.completed})`],
              ["peak", `★ Peak (${peakCount})`],
              [
                "metadata_pending",
                `Metadata pending (${currentJob.counts.metadata_pending})`,
              ],
              ["duplicates", `Duplicates (${currentJob.counts.duplicates})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilterStatus(key)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150 cursor-pointer",
                filterStatus === key
                  ? "bg-[#FAFAFA] text-[#121212] font-semibold"
                  : "text-[#A3A3A3] hover:bg-[#262626] hover:text-[#F5F5F5]"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative flex w-full sm:w-64 items-center">
          <MagnifyingGlass
            size={13}
            className="pointer-events-none absolute left-2.5 text-[#737373]"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter by title, description, file…"
            className="h-8 w-full rounded-md border border-[#2E2E2E] bg-[#262626] pl-8 pr-7 text-xs text-[#F5F5F5] placeholder:text-[#737373] outline-none focus:border-[#A3A3A3]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 text-[#737373] hover:text-[#F5F5F5] cursor-pointer"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Multi-Set Switcher */}
      {jobs.length > 1 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {jobs.map((j) => {
            const active = j.id === currentJob.id
            return (
              <button
                key={j.id}
                type="button"
                onClick={() => onSelectJob(j)}
                className={cn(
                  "shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors duration-150 cursor-pointer",
                  active
                    ? "border-[#FAFAFA] bg-[#FAFAFA] text-[#121212] font-semibold"
                    : "border-[#2E2E2E] bg-[#1C1C1C] text-[#A3A3A3] hover:text-[#F5F5F5]"
                )}
              >
                <span className="mr-1 font-mono-tech opacity-75">#{j.id}</span>
                {j.theme} ({j.counts.completed}/{j.counts.total})
              </button>
            )
          })}
        </div>
      )}

      {/* Bulk Delete Bar */}
      {selectedGenIds.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#EF4444]/35 bg-[#1C1C1C] px-4 py-2.5 text-xs">
          <span className="text-[#F5F5F5]">
            Selected <strong>{selectedGenIds.length}</strong> image(s) — deleting removes files on disk, re-numbers remaining files (-1..N), and updates pin-import.csv.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedGenIds([])}
              className="rounded border border-[#383838] bg-[#262626] px-2.5 py-1 text-xs text-[#F5F5F5] cursor-pointer"
            >
              Unselect
            </button>
            <button
              type="button"
              disabled={bulkDeleting}
              onClick={async () => {
                const ids = [...selectedGenIds]
                setBulkDeleting(true)
                try {
                  setSelectedGenIds([])
                  if (onBulkDeleteGenerations) {
                    await onBulkDeleteGenerations(currentJob.id, ids)
                  } else {
                    for (const gid of ids) {
                      await onDeleteGeneration(gid)
                    }
                  }
                } finally {
                  setBulkDeleting(false)
                }
              }}
              className="inline-flex items-center gap-1.5 rounded bg-[#EF4444] px-3 py-1 font-semibold text-white hover:bg-[#DC2626] cursor-pointer"
            >
              <Trash size={13} weight="bold" />
              {bulkDeleting
                ? "Deleting…"
                : `Delete selected (${selectedGenIds.length})`}
            </button>
          </div>
        </div>
      )}

      {/* Contact-Sheet Grid */}
      <StudioPagination
        totalItems={filteredGenerations.length}
        pageSize={pageSize}
        pageIndex={pageIndex}
        onPageChange={setPageIndex}
        itemLabel="frames"
      />

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
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
                className={cn(
                  "flex flex-col justify-between overflow-hidden rounded-lg border bg-[#1C1C1C] p-4 transition-colors duration-150",
                  gen.is_peak
                    ? "border-[#A3A3A3]"
                    : "border-[#2E2E2E] hover:border-[#404040]"
                )}
              >
                <div>
                  {/* Frame Header */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <input
                        type="checkbox"
                        checked={selectedGenIds.includes(gen.id)}
                        onChange={() =>
                          setSelectedGenIds((prev) =>
                            prev.includes(gen.id)
                              ? prev.filter((x) => x !== gen.id)
                              : [...prev, gen.id]
                          )
                        }
                        aria-label={`Select image ${gen.index_num}`}
                        className="size-3.5 shrink-0 accent-[#FAFAFA] cursor-pointer"
                      />
                      <span className="font-mono-tech text-xs font-semibold text-[#F5F5F5]">
                        #{String(gen.index_num).padStart(2, "0")}
                      </span>
                      <span className="font-mono-tech text-[11px] text-[#737373] truncate">
                        {gen.image_file || "Pending"}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleTogglePeak(gen)}
                        title={`Peak of Picassy: ${
                          gen.is_peak
                            ? "TRUE in CSV (click to unset)"
                            : "FALSE in CSV (click to mark TRUE)"
                        }`}
                        className={cn(
                          "inline-flex h-6.5 items-center gap-1 rounded border px-2 text-[11px] font-semibold transition-colors duration-150 cursor-pointer",
                          gen.is_peak
                            ? "border-[#FAFAFA] bg-[#FAFAFA] text-[#121212]"
                            : "border-[#2E2E2E] bg-[#262626] text-[#A3A3A3] hover:border-[#525252] hover:text-[#F5F5F5]"
                        )}
                      >
                        <Star size={11} weight={gen.is_peak ? "fill" : "regular"} />
                        Peak
                      </button>

                      <button
                        type="button"
                        onClick={() => onDeleteGeneration(gen.id)}
                        title="Delete image, re-sequence folder & update pin-import.csv"
                        className="flex size-6.5 items-center justify-center rounded border border-[#2E2E2E] bg-[#262626] text-[#737373] hover:border-[#EF4444]/35 hover:bg-[#EF4444]/15 hover:text-[#FCA5A5] cursor-pointer"
                      >
                        <Trash size={12} />
                      </button>
                    </div>
                  </div>

                  {/* Neutral #121212 Image Frame */}
                  <div className="mt-2.5 relative aspect-[4/3] w-full overflow-hidden rounded-md border border-[#2E2E2E] bg-[#121212]">
                    {hasImage ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedGen(gen)
                          setModalTab("details")
                        }}
                        className="block h-full w-full cursor-pointer"
                      >
                        <img
                          src={getGenerationImageUrl(
                            gen.id,
                            gen.md5 || gen.image_file
                          )}
                          alt={gen.title || gen.prompt_final}
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover"
                        />
                      </button>
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-[#737373]">
                        <Sparkle size={18} />
                        <span>No image file yet ({gen.status})</span>
                      </div>
                    )}
                  </div>

                  {gen.duplicate_warning && (
                    <div className="mt-2.5 flex items-center justify-between gap-2 rounded-md border border-[#404040] bg-[#262626] px-2.5 py-1.5 text-[11px] text-[#F5F5F5]">
                      <span className="inline-flex items-center gap-1.5 truncate">
                        <WarningCircle size={13} weight="fill" />
                        {gen.duplicate_warning}
                      </span>
                      <button
                        type="button"
                        onClick={() => onRetrySingleTurn(gen.id, true)}
                        className="shrink-0 rounded bg-[#FAFAFA] px-2 py-0.5 font-semibold text-[#121212] cursor-pointer"
                      >
                        Mutate &amp; redo
                      </button>
                    </div>
                  )}

                  {/* Inline SEO Editors */}
                  {exportMode !== "none" ? (
                    <div className="mt-3 flex flex-col gap-2">
                      <div>
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <label className="font-medium text-[#A3A3A3]">
                            Title
                          </label>
                          <div className="flex items-center gap-2">
                            {savingId === gen.id ? (
                              <span className="font-mono-tech text-[#A3A3A3]">
                                Saving…
                              </span>
                            ) : savedId === gen.id ? (
                              <span className="font-mono-tech text-[#F5F5F5]">
                                Saved
                              </span>
                            ) : isDirty ? (
                              <button
                                type="button"
                                onClick={() => handleSaveMeta(gen, true)}
                                className="inline-flex items-center gap-1 font-medium text-[#F5F5F5] hover:underline cursor-pointer"
                              >
                                <FloppyDisk size={11} />
                                Save
                              </button>
                            ) : null}
                            <span
                              className={cn(
                                "font-mono-tech tabular-nums",
                                titleOk ? "text-[#A3A3A3]" : "text-[#FCA5A5]"
                              )}
                              title={
                                titleOk
                                  ? "Starts with keyword and within 60 chars"
                                  : `Start with "${jobPrimaryTag}" and keep <= 60 chars`
                              }
                            >
                              {titleVal.length}/60
                            </span>
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
                          placeholder={`Starts with "${jobPrimaryTag}" (<=60 chars)…`}
                          className="mt-1 h-8 w-full rounded-md border border-[#2E2E2E] bg-[#262626] px-2.5 text-xs font-medium text-[#F5F5F5] outline-none focus:border-[#A3A3A3]"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <label className="font-medium text-[#A3A3A3]">
                            Description
                          </label>
                          <span
                            className={cn(
                              "font-mono-tech tabular-nums",
                              descOk ? "text-[#A3A3A3]" : "text-[#FCA5A5]"
                            )}
                          >
                            {descVal.length}/160
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
                          placeholder={`Sentence containing "${jobPrimaryTag.toLowerCase()}" (<=160 chars, no #)…`}
                          className="mt-1 w-full rounded-md border border-[#2E2E2E] bg-[#262626] p-2 text-xs text-[#F5F5F5] outline-none focus:border-[#A3A3A3]"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <label className="font-medium text-[#A3A3A3]">
                            Alt text
                          </label>
                          <span
                            className={cn(
                              "font-mono-tech tabular-nums",
                              altOk ? "text-[#A3A3A3]" : "text-[#FCA5A5]"
                            )}
                          >
                            {altVal.length}/100–125
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
                          placeholder="Visual description for screen readers (100–125 chars)…"
                          className="mt-1 w-full rounded-md border border-[#2E2E2E] bg-[#262626] p-2 text-xs text-[#F5F5F5] outline-none focus:border-[#A3A3A3]"
                        />
                      </div>
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-[#737373]">
                      Images-only mode active. Switch to &ldquo;Xuất CSV&rdquo; above to edit and export pin-import.csv.
                    </p>
                  )}
                </div>

                {/* Card Footer */}
                <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-[#2E2E2E] pt-2.5">
                  <div className="flex flex-wrap items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleCopyText(gen.id, buildPinCopyBlock(gen))}
                      className="inline-flex items-center gap-1 rounded border border-[#383838] bg-[#262626] px-2 py-1 text-[11px] font-medium text-[#F5F5F5] hover:border-[#525252] cursor-pointer"
                      title="Copy Picassy Tag, Category, Title, Description, Alt text"
                    >
                      {copiedId === gen.id ? (
                        <>
                          <Check size={11} weight="bold" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy size={11} />
                          Copy SEO
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => onRetryMetadata(gen.id, true)}
                      className="inline-flex items-center gap-1 rounded border border-[#2E2E2E] bg-[#262626] px-2 py-1 text-[11px] text-[#A3A3A3] hover:text-[#F5F5F5] cursor-pointer"
                      title="Rewrite caption via AI browser"
                    >
                      <Sparkle size={11} />
                      AI rewrite
                    </button>

                    <button
                      type="button"
                      onClick={() => onRetryMetadata(gen.id, false)}
                      className="flex size-6.5 items-center justify-center rounded border border-[#2E2E2E] bg-[#262626] text-[#A3A3A3] hover:text-[#F5F5F5] cursor-pointer"
                      title="Instant grammatical SEO synthesis"
                    >
                      <ArrowsClockwise size={11} />
                    </button>
                  </div>

                  {hasImage && (
                    <div className="flex items-center gap-1">
                      {exportMode === "csv" && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedGen(gen)
                            setModalTab("csv")
                          }}
                          className="rounded border border-[#2E2E2E] bg-[#171717] px-2 py-1 font-mono-tech text-[10px] text-[#A3A3A3] hover:text-[#F5F5F5] cursor-pointer"
                          title="Preview exact CSV row in pin-import.csv"
                        >
                          CSV row
                        </button>
                      )}
                      <a
                        href={getGenerationImageUrl(
                          gen.id,
                          gen.updated_at,
                          true
                        )}
                        download={gen.image_file}
                        className="inline-flex items-center gap-1 rounded bg-[#FAFAFA] px-2.5 py-1 text-[11px] font-semibold text-[#121212] hover:bg-[#E5E5E5]"
                      >
                        <DownloadSimple size={11} weight="bold" />
                        Save
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
        itemLabel="frames"
      />

      {/* Inspector Modal */}
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
                      #{String(selectedGen.index_num).padStart(2, "0")} —{" "}
                      {selectedGen.title || selectedGen.image_file}
                    </DialogTitle>
                    <DialogDescription className="font-mono-tech text-xs">
                      {selectedGen.width}×{selectedGen.height} ·{" "}
                      {selectedGen.model} · {selectedGen.image_file}
                    </DialogDescription>
                  </div>

                  <div className="flex items-center rounded-md border border-[#2E2E2E] bg-[#171717] p-0.5">
                    <button
                      type="button"
                      onClick={() => setModalTab("details")}
                      className={cn(
                        "rounded px-2.5 py-1 text-xs font-medium cursor-pointer",
                        modalTab === "details"
                          ? "bg-[#FAFAFA] text-[#121212] font-semibold"
                          : "text-[#A3A3A3] hover:text-[#F5F5F5]"
                      )}
                    >
                      Details &amp; edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setModalTab("csv")}
                      className={cn(
                        "rounded px-2.5 py-1 text-xs font-medium cursor-pointer",
                        modalTab === "csv"
                          ? "bg-[#FAFAFA] text-[#121212] font-semibold"
                          : "text-[#A3A3A3] hover:text-[#F5F5F5]"
                      )}
                    >
                      CSV row
                    </button>
                  </div>
                </div>
              </DialogHeader>

              <div className="mt-4 grid grid-cols-1 gap-5 md:grid-cols-2">
                <div className="flex items-center justify-center overflow-hidden rounded-lg border border-[#2E2E2E] bg-[#121212] p-2">
                  <img
                    src={getGenerationImageUrl(
                      selectedGen.id,
                      selectedGen.md5 || selectedGen.image_file
                    )}
                    alt={selectedGen.title}
                    className="max-h-[440px] w-full object-contain"
                  />
                </div>

                {modalTab === "details" ? (
                  <div className="flex flex-col justify-between gap-4 text-xs">
                    <div className="space-y-3">
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-[#F5F5F5]">
                            Visual generation prompt
                          </span>
                          <button
                            type="button"
                            onClick={async () => {
                              const draftP = (
                                promptDrafts[selectedGen.id] ??
                                selectedGen.prompt_final
                              ).trim()
                              if (draftP) {
                                await onUpdateMetadata(selectedGen.id, {
                                  prompt_final: draftP,
                                })
                              }
                            }}
                            className="font-medium text-[#F5F5F5] hover:underline cursor-pointer"
                          >
                            Save prompt
                          </button>
                        </div>
                        <textarea
                          rows={4}
                          value={
                            promptDrafts[selectedGen.id] ??
                            selectedGen.prompt_final
                          }
                          onChange={(e) =>
                            setPromptDrafts((prev) => ({
                              ...prev,
                              [selectedGen.id]: e.target.value,
                            }))
                          }
                          className="mt-1 w-full rounded-md border border-[#2E2E2E] bg-[#121212] p-2.5 text-xs leading-relaxed text-[#F5F5F5] outline-none focus:border-[#A3A3A3]"
                        />
                        <div className="mt-2 flex items-center gap-2">
                          <StudioButton
                            variant="secondary"
                            onClick={async () => {
                              const draftP = (
                                promptDrafts[selectedGen.id] ??
                                selectedGen.prompt_final
                              ).trim()
                              if (
                                draftP &&
                                draftP !== selectedGen.prompt_final
                              ) {
                                await onUpdateMetadata(selectedGen.id, {
                                  prompt_final: draftP,
                                })
                              }
                              await onRetrySingleTurn(selectedGen.id, false)
                              setSelectedGen(null)
                            }}
                          >
                            Save prompt &amp; regenerate image
                          </StudioButton>
                        </div>
                      </div>

                      {selectedGen.reference && (
                        <div className="flex items-center gap-3 rounded-md border border-[#2E2E2E] bg-[#171717] p-2.5">
                          <img
                            src={getReferenceImageUrl(selectedGen.reference.id)}
                            alt={selectedGen.reference.title}
                            className="size-11 rounded border border-[#2E2E2E] bg-[#121212] object-cover"
                          />
                          <div>
                            <p className="font-medium text-[#F5F5F5]">
                              Reference #{selectedGen.reference.id} (
                              {selectedGen.reference.source_type})
                            </p>
                            <p className="text-[11px] text-[#737373]">
                              Rights: {selectedGen.reference.usage_rights}
                            </p>
                          </div>
                        </div>
                      )}

                      <div className="flex items-center justify-between rounded-md border border-[#2E2E2E] bg-[#171717] p-3">
                        <div>
                          <p className="text-xs font-semibold text-[#F5F5F5]">
                            Peak of Picassy
                          </p>
                          <p className="text-[11px] text-[#A3A3A3]">
                            Writes{" "}
                            <code className="font-mono-tech text-[#F5F5F5]">
                              {selectedGen.is_peak ? "TRUE" : "FALSE"}
                            </code>{" "}
                            in column 7 of pin-import.csv
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleTogglePeak(selectedGen)}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono-tech text-xs font-semibold transition-colors duration-150 cursor-pointer",
                            selectedGen.is_peak
                              ? "border-[#FAFAFA] bg-[#FAFAFA] text-[#121212]"
                              : "border-[#383838] bg-[#262626] text-[#F5F5F5]"
                          )}
                        >
                          <Star
                            size={13}
                            weight={selectedGen.is_peak ? "fill" : "regular"}
                          />
                          {selectedGen.is_peak ? "TRUE" : "FALSE"}
                        </button>
                      </div>

                      <div className="rounded-md border border-[#2E2E2E] bg-[#121212] p-2.5 font-mono-tech text-[11px] text-[#737373] space-y-0.5">
                        <p>MD5: {selectedGen.md5}</p>
                        <p>dHash: {selectedGen.dhash}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#2E2E2E] pt-3">
                      <StudioButton
                        variant="danger"
                        onClick={async () => {
                          await onDeleteGeneration(selectedGen.id)
                          setSelectedGen(null)
                        }}
                        icon={<Trash size={13} />}
                      >
                        Delete image
                      </StudioButton>

                      <div className="flex items-center gap-2">
                        <a
                          href={getJobCsvUrl(currentJob.id)}
                          download={`${currentJob.slug || "set"}-pin-import.csv`}
                          className="inline-flex h-9 items-center rounded-md border border-[#383838] bg-[#262626] px-3 text-xs font-medium text-[#F5F5F5]"
                        >
                          pin-import.csv
                        </a>
                        <a
                          href={getGenerationImageUrl(
                            selectedGen.id,
                            selectedGen.updated_at,
                            true
                          )}
                          download={selectedGen.image_file}
                          className="inline-flex h-9 items-center rounded-md bg-[#FAFAFA] px-3.5 text-xs font-semibold text-[#121212] hover:bg-[#E5E5E5]"
                        >
                          Download image
                        </a>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col justify-between gap-3">
                    <pre className="max-h-[370px] whitespace-pre-wrap break-all overflow-auto rounded-md border border-[#2E2E2E] bg-[#121212] p-3.5 font-mono-tech text-[11px] leading-relaxed text-[#E5E5E5]">
                      {buildCsvRowPreview(selectedGen, true)}
                    </pre>
                    <div className="flex items-center justify-between">
                      <StudioButton
                        variant="secondary"
                        onClick={() =>
                          handleCopyText(
                            selectedGen.id + 20000,
                            buildCsvRowPreview(selectedGen, false)
                          )
                        }
                        icon={<Copy size={13} />}
                      >
                        {copiedId === selectedGen.id + 20000
                          ? "Copied CSV row"
                          : "Copy CSV row"}
                      </StudioButton>
                      <a
                        href={getJobCsvUrl(currentJob.id)}
                        download={`${currentJob.slug || "set"}-pin-import.csv`}
                        className="inline-flex h-9 items-center rounded-md bg-[#FAFAFA] px-3.5 text-xs font-semibold text-[#121212] hover:bg-[#E5E5E5]"
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
