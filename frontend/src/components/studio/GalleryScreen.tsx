import * as React from "react"
import {
  FolderOpen,
  DownloadSimple,
  FileCode,
  FileText,
  Copy,
  Check,
  ArrowsClockwise,
  Trash,
  WarningCircle,
  Sparkle,
  MagnifyingGlass,
  FloppyDisk,
  PencilSimple,
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
  getGenerationCaptionFileUrl,
  getGenerationImageUrl,
  getGenerationSidecarUrl,
  getJobCaptionsBundleUrl,
  getJobManifestUrl,
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
  onSelectJob: (job: ImageSetJob) => void
  onNavigateTab: (tab: StudioTab) => void
  onUpdateJob: (jobId: number, updates: Partial<CreateJobPayload>) => Promise<void>
  onRegenerateAllMetadata: (jobId: number, useBrowserTurn: boolean) => Promise<void>
  onRemoveWatermarks?: (jobId: number) => Promise<void>
  onUpdateMetadata: (
    genId: number,
    updates: {
      title?: string
      caption?: string
      description?: string
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

export function GalleryScreen({
  jobs,
  activeJob,
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
  const [modalTab, setModalTab] = React.useState<"details" | "caption" | "json">("details")
  const [filterStatus, setFilterStatus] = React.useState<
    "all" | "completed" | "metadata_pending" | "duplicates"
  >("all")
  const [searchQuery, setSearchQuery] = React.useState("")
  const [titleDrafts, setTitleDrafts] = React.useState<Record<number, string>>({})
  const [captionDrafts, setCaptionDrafts] = React.useState<Record<number, string>>({})
  const [descDrafts, setDescDrafts] = React.useState<Record<number, string>>({})
  const [tagsDrafts, setTagsDrafts] = React.useState<Record<number, string>>({})
  const [promptDrafts, setPromptDrafts] = React.useState<Record<number, string>>({})

  const [savingId, setSavingId] = React.useState<number | null>(null)
  const [savedId, setSavedId] = React.useState<number | null>(null)
  const [copiedId, setCopiedId] = React.useState<number | null>(null)
  const [regeneratingAll, setRegeneratingAll] = React.useState(false)
  const [removingWatermarks, setRemovingWatermarks] = React.useState(false)

  // Set & Caption Prompt Editor
  const [showCaptionConfig, setShowCaptionConfig] = React.useState(false)
  const [themeDraft, setThemeDraft] = React.useState("")
  const [captionPromptDraft, setCaptionPromptDraft] = React.useState("")
  const [savingJobConfig, setSavingJobConfig] = React.useState(false)
  const [pageIndex, setPageIndex] = React.useState(1)
  const pageSize = 24

  const currentJob = activeJob || jobs[0] || null

  React.useEffect(() => {
    setPageIndex(1)
  }, [currentJob?.id, filterStatus, searchQuery])

  React.useEffect(() => {
    if (!currentJob) return
    const tMap: Record<number, string> = {}
    const cMap: Record<number, string> = {}
    const dMap: Record<number, string> = {}
    const hMap: Record<number, string> = {}
    const pMap: Record<number, string> = {}
    for (const g of currentJob.generations) {
      tMap[g.id] = g.title || ""
      cMap[g.id] = g.caption || g.title || ""
      dMap[g.id] = g.description || ""
      hMap[g.id] = g.hashtags || ""
      pMap[g.id] = g.prompt_final || ""
    }
    setTitleDrafts(tMap)
    setCaptionDrafts(cMap)
    setDescDrafts(dMap)
    setTagsDrafts(hMap)
    setPromptDrafts(pMap)
    setThemeDraft(currentJob.theme || "")
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
            Generated image sets, Pinterest captions, sidecar JSON files, and ZIP archives appear here once created.
          </p>
          <StudioButton variant="primary" onClick={() => onNavigateTab("create")}>
            Create First Image Set
          </StudioButton>
        </div>
      </StudioPanel>
    )
  }

  const exportMode: MetadataExportMode = currentJob.metadata_export_mode || "json"

  const handleSaveMeta = async (gen: GenerationItem, force = false) => {
    const newTitle = (titleDrafts[gen.id] ?? gen.title).trim()
    const newCaption = (captionDrafts[gen.id] ?? (gen.caption || gen.title)).trim()
    const newDesc = (descDrafts[gen.id] ?? gen.description).trim()
    const newTags = (tagsDrafts[gen.id] ?? (gen.hashtags || "")).trim()
    if (
      !force &&
      newTitle === (gen.title || "") &&
      newCaption === (gen.caption || gen.title || "") &&
      newDesc === (gen.description || "") &&
      newTags === (gen.hashtags || "")
    ) {
      return
    }
    setSavingId(gen.id)
    try {
      await onUpdateMetadata(gen.id, {
        title: newTitle,
        caption: newCaption,
        description: newDesc,
        hashtags: newTags,
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
    const c = (captionDrafts[gen.id] ?? (gen.caption || gen.title)).trim()
    const d = (descDrafts[gen.id] ?? gen.description).trim()
    const h = (tagsDrafts[gen.id] ?? (gen.hashtags || "")).trim()
    const lines = [t]
    if (c && c !== t) lines.push(c)
    if (d) {
      lines.push("")
      lines.push(d)
    }
    if (h && !d.includes(h)) {
      lines.push("")
      lines.push(h)
    }
    return lines.filter((x, i, a) => !(x === "" && a[i - 1] === "")).join("\n")
  }

  const filteredGenerations = currentJob.generations.filter((g) => {
    if (filterStatus === "completed" && g.status !== "completed") return false
    if (filterStatus === "metadata_pending" && g.status !== "metadata_pending")
      return false
    if (filterStatus === "duplicates" && !g.duplicate_warning) return false
    const q = searchQuery.trim().toLowerCase()
    if (!q) return true
    return (
      (g.title || "").toLowerCase().includes(q) ||
      (g.caption || "").toLowerCase().includes(q) ||
      (g.description || "").toLowerCase().includes(q) ||
      (g.hashtags || "").toLowerCase().includes(q) ||
      (g.prompt_final || "").toLowerCase().includes(q) ||
      (g.image_file || "").toLowerCase().includes(q)
    )
  })

  const buildSidecarJsonPreview = (gen: GenerationItem) =>
    JSON.stringify(
      {
        index: gen.index_num,
        title: titleDrafts[gen.id] ?? gen.title,
        caption: captionDrafts[gen.id] ?? (gen.caption || gen.title),
        description: descDrafts[gen.id] ?? gen.description,
        hashtags: tagsDrafts[gen.id] ?? (gen.hashtags || ""),
        prompt_final: promptDrafts[gen.id] ?? gen.prompt_final,
        reference: gen.reference
          ? {
            id: gen.reference.id,
            source_type: gen.reference.source_type,
            source_ref: gen.reference.source_ref,
            filename: gen.reference.filename,
            usage_rights: gen.reference.usage_rights,
          }
          : null,
        model: gen.model || currentJob.model,
        status: gen.status,
        image_file: gen.image_file,
      },
      null,
      2
    )

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
            <button
              type="button"
              onClick={() => setShowCaptionConfig((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-3 py-1 text-xs text-[#d1d5db] ring-1 ring-white/[0.1] hover:bg-white/[0.1] hover:text-white cursor-pointer"
            >
              <PencilSimple size={13} />
              {showCaptionConfig ? "Close Prompt Editor" : "Edit Set & Caption Prompt"}
            </button>
          </div>
          <p className="mt-1.5 font-mono-tech text-xs text-[#9ca3af] break-all">
            Export Path: {currentJob.export_dir}
          </p>
        </div>

        {/* Export Actions */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* 3-Way Export Mode Switch: Xuất JSON | Xuất Caption | Không */}
          <div className="flex items-center rounded-full bg-white/[0.04] p-1 ring-1 ring-white/[0.1]">
            {(
              [
                ["json", "Xuất JSON (.json)"],
                ["caption", "Xuất Caption (.txt)"],
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

          {exportMode === "caption" && (
            <a
              href={getJobCaptionsBundleUrl(currentJob.id)}
              download={`captions_${currentJob.slug}.txt`}
              className="inline-flex h-10 items-center gap-1.5 rounded-full bg-amber-400/15 px-4 text-xs font-medium text-amber-200 ring-1 ring-amber-400/30 hover:bg-amber-400/25"
            >
              <FileText size={15} weight="light" />
              captions.txt
            </a>
          )}

          {exportMode === "json" && (
            <a
              href={getJobManifestUrl(currentJob.id)}
              download="manifest.json"
              className="inline-flex h-10 items-center gap-1.5 rounded-full bg-white/[0.05] px-4 text-xs font-medium text-[#e5e7eb] ring-1 ring-white/[0.09] hover:bg-white/[0.1]"
            >
              <FileCode size={15} weight="light" />
              manifest.json
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
          eyebrow="POST-IMAGE PINTEREST CAPTION & DESCRIPTION PROMPT"
          title="Configure Set Theme & Batch Caption Generator"
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
              <div className="sm:col-span-2 flex flex-col gap-1.5">
                <label className="text-xs font-medium text-amber-200/90">
                  Prompt tạo Caption & Description (Chuẩn Pinterest / Trang ảnh)
                </label>
                <input
                  type="text"
                  value={captionPromptDraft}
                  onChange={(e) => setCaptionPromptDraft(e.target.value)}
                  placeholder="Instructions for Pin Title, Caption, SEO Description, and Hashtags..."
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
          const captionVal = captionDrafts[gen.id] ?? (gen.caption || gen.title)
          const descVal = descDrafts[gen.id] ?? gen.description
          const tagsVal = tagsDrafts[gen.id] ?? (gen.hashtags || "")
          const isDirty =
            titleVal !== (gen.title || "") ||
            captionVal !== (gen.caption || gen.title || "") ||
            descVal !== (gen.description || "") ||
            tagsVal !== (gen.hashtags || "")

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
                      title="Delete this image & its sidecar/caption file"
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

                {/* Inline Editable Pin Title, Caption, Description & Hashtags */}
                {exportMode !== "none" ? (
                  <div className="mt-4 flex flex-col gap-2.5">
                    <div>
                      <div className="flex items-center justify-between">
                        <label className="font-mono-tech text-[10px] uppercase tracking-wider text-[#9ca3af]">
                          Pin Title (
                          {exportMode === "caption"
                            ? gen.caption_file || `${String(gen.index_num).padStart(3, "0")}.txt`
                            : gen.sidecar_file || "Sidecar JSON"}
                          )
                        </label>
                        {savingId === gen.id ? (
                          <span className="font-mono-tech text-[10px] text-sky-300">
                            Syncing…
                          </span>
                        ) : savedId === gen.id ? (
                          <span className="font-mono-tech text-[10px] text-emerald-300">
                            ✓ Saved & synced
                          </span>
                        ) : isDirty ? (
                          <button
                            type="button"
                            onClick={() => handleSaveMeta(gen, true)}
                            className="inline-flex items-center gap-1 font-mono-tech text-[10px] text-emerald-300 hover:underline cursor-pointer"
                          >
                            <FloppyDisk size={11} />
                            Save now
                          </button>
                        ) : null}
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
                        placeholder="Catchy Pinterest Pin title..."
                        className="mt-1 h-9 w-full rounded-xl bg-white/[0.03] px-3 text-xs font-medium text-white ring-1 ring-white/[0.08] outline-none focus:ring-2 focus:ring-white/30"
                      />
                    </div>

                    <div>
                      <label className="font-mono-tech text-[10px] uppercase tracking-wider text-amber-200/80">
                        Social Caption / Hook
                      </label>
                      <input
                        type="text"
                        value={captionVal}
                        onChange={(e) =>
                          setCaptionDrafts((prev) => ({
                            ...prev,
                            [gen.id]: e.target.value,
                          }))
                        }
                        onBlur={() => handleSaveMeta(gen)}
                        placeholder="Short engaging social caption hook..."
                        className="mt-1 h-8 w-full rounded-xl bg-white/[0.025] px-3 text-xs text-amber-100 ring-1 ring-white/[0.07] outline-none focus:ring-2 focus:ring-amber-400/30"
                      />
                    </div>

                    <div>
                      <label className="font-mono-tech text-[10px] uppercase tracking-wider text-[#9ca3af]">
                        Pinterest SEO Description & Hashtags
                      </label>
                      <textarea
                        rows={3}
                        value={descVal}
                        onChange={(e) =>
                          setDescDrafts((prev) => ({
                            ...prev,
                            [gen.id]: e.target.value,
                          }))
                        }
                        onBlur={() => handleSaveMeta(gen)}
                        placeholder="Enter SEO description & hashtags..."
                        className="mt-1 w-full rounded-xl bg-white/[0.03] p-3 text-xs text-[#d1d5db] ring-1 ring-white/[0.08] outline-none focus:ring-2 focus:ring-white/30"
                      />
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-[11px] text-[#646b78]">
                    Image-only export mode active. Switch to "Xuất Caption" or "Xuất JSON" above to edit & export Pin captions.
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
                    title="Copy Title + Caption + Description + Hashtags for Pinterest upload"
                  >
                    {copiedId === gen.id ? (
                      <>
                        <Check size={12} weight="bold" className="text-emerald-300" />
                        Copied Pin
                      </>
                    ) : (
                      <>
                        <Copy size={12} weight="light" />
                        Copy Pin
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
                    {exportMode === "caption" && (
                      <a
                        href={getGenerationCaptionFileUrl(gen.id)}
                        download={
                          gen.caption_file ||
                          `${String(gen.index_num).padStart(3, "0")}_${currentJob.slug}.txt`
                        }
                        className="rounded-full bg-amber-400/15 px-2.5 py-1 font-mono-tech text-[10px] text-amber-200 hover:bg-amber-400/25"
                        title="Download .TXT Pin Caption file"
                      >
                        .TXT
                      </a>
                    )}
                    {exportMode === "json" && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedGen(gen)
                          setModalTab("json")
                        }}
                        className="rounded-full bg-white/[0.05] px-2.5 py-1 font-mono-tech text-[10px] text-[#d1d5db] hover:bg-white/[0.12] cursor-pointer"
                        title="Inspect sidecar JSON"
                      >
                        .JSON
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

                  {/* Modal Tab Switcher: Details vs Pin Caption vs Sidecar JSON */}
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
                      Details & Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setModalTab("caption")}
                      className={cn(
                        "rounded-full px-3 py-1 text-xs font-medium cursor-pointer",
                        modalTab === "caption"
                          ? "bg-amber-400 text-[#050505]"
                          : "text-[#9ca3af] hover:text-white"
                      )}
                    >
                      Pin Caption (.txt)
                    </button>
                    <button
                      type="button"
                      onClick={() => setModalTab("json")}
                      className={cn(
                        "rounded-full px-3 py-1 font-mono-tech text-xs font-medium cursor-pointer",
                        modalTab === "json"
                          ? "bg-[#f4f5f7] text-[#050505]"
                          : "text-[#9ca3af] hover:text-white"
                      )}
                    >
                      .json
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
                          href={getGenerationCaptionFileUrl(selectedGen.id)}
                          download
                          className="rounded-full bg-amber-400/20 px-3.5 py-2 text-xs text-amber-200 hover:bg-amber-400/30"
                        >
                          Download .TXT
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
                ) : modalTab === "caption" ? (
                  <div className="flex flex-col justify-between gap-3">
                    <pre className="max-h-[370px] whitespace-pre-wrap overflow-auto rounded-2xl bg-[#050505] p-4 font-mono-tech text-xs leading-relaxed text-amber-200 ring-1 ring-white/[0.08]">
                      {buildPinCopyBlock(selectedGen)}
                    </pre>
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() =>
                          handleCopyText(
                            selectedGen.id + 20000,
                            buildPinCopyBlock(selectedGen)
                          )
                        }
                        className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-4 py-2 text-xs text-white hover:bg-white/[0.12] cursor-pointer"
                      >
                        <Copy size={13} weight="light" />
                        {copiedId === selectedGen.id + 20000
                          ? "Copied Pin Caption"
                          : "Copy Pin Caption"}
                      </button>
                      <a
                        href={getGenerationCaptionFileUrl(selectedGen.id)}
                        download
                        className="rounded-full bg-amber-400 px-4 py-2 text-xs font-semibold text-[#050505] hover:bg-amber-300"
                      >
                        Download .TXT Caption
                      </a>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col justify-between gap-3">
                    <pre className="max-h-[370px] overflow-auto rounded-2xl bg-[#050505] p-4 font-mono-tech text-[11px] leading-relaxed text-emerald-300 ring-1 ring-white/[0.08]">
                      {buildSidecarJsonPreview(selectedGen)}
                    </pre>
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() =>
                          handleCopyText(
                            selectedGen.id + 10000,
                            buildSidecarJsonPreview(selectedGen)
                          )
                        }
                        className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-4 py-2 text-xs text-white hover:bg-white/[0.12] cursor-pointer"
                      >
                        <Copy size={13} weight="light" />
                        {copiedId === selectedGen.id + 10000
                          ? "Copied Sidecar JSON"
                          : "Copy Sidecar JSON"}
                      </button>
                      <a
                        href={getGenerationSidecarUrl(selectedGen.id)}
                        download={selectedGen.sidecar_file}
                        className="rounded-full bg-[#f4f5f7] px-4 py-2 text-xs font-semibold text-[#050505] hover:bg-white"
                      >
                        Save {selectedGen.sidecar_file || "sidecar.json"}
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
