import * as React from "react"
import {
  Play,
  Pause,
  StopCircle,
  ArrowsClockwise,
  FolderOpen,
  DownloadSimple,
  WarningCircle,
  Sparkle,
  ArrowRight,
  Camera,
  SunDim,
  GridFour,
  Wind,
  Trash,
} from "@phosphor-icons/react"
import {
  StudioPanel,
  StudioButton,
  StudioBadge,
  StudioPagination,
} from "@/components/shared/StudioPrimitives"
import {
  getGenerationImageUrl,
  getJobZipUrl,
  getReferenceImageUrl,
  type ActivityLog,
  type CdpSlotStatus,
  type ImageSetJob,
  type ProviderModel,
  type StudioTab,
} from "@/services/studioApi"
import { cn } from "@/lib/utils"

export interface RunScreenProps {
  job: ImageSetJob | null
  providers: ProviderModel[]
  cdpSlots?: CdpSlotStatus[]
  logs: ActivityLog[]
  onNavigateTab: (tab: StudioTab) => void
  onStartJob: (jobId: number) => Promise<void>
  onPauseJob: (jobId: number) => Promise<void>
  onResumeJob: (jobId: number) => Promise<void>
  onCancelJob: (jobId: number) => Promise<void>
  onRetryFailed: (jobId: number) => Promise<void>
  onRetrySingleTurn: (genId: number, mutateAxes: boolean) => Promise<void>
  onSkipTurn?: (genId: number) => Promise<void>
  onRestartBrowser?: (slotId?: number) => Promise<void>
  onRetryMetadata: (genId: number, useBrowserTurn: boolean) => Promise<void>
  onDeleteGeneration: (genId: number) => Promise<void>
  onOpenFolder: (jobId: number) => Promise<void>
}

export function RunScreen({
  job,
  providers,
  cdpSlots = [],
  logs,
  onNavigateTab,
  onStartJob,
  onPauseJob,
  onResumeJob,
  onCancelJob,
  onRetryFailed,
  onRetrySingleTurn,
  onSkipTurn,
  onRestartBrowser,
  onRetryMetadata,
  onDeleteGeneration,
  onOpenFolder,
}: RunScreenProps) {
  const [pageIndex, setPageIndex] = React.useState(1)
  const pageSize = 24

  React.useEffect(() => {
    setPageIndex(1)
  }, [job?.id])

  if (!job) {
    return (
      <StudioPanel eyebrow="03 · SEQUENTIAL RUNNER" title="No Active Image Set">
        <div className="flex flex-col items-start gap-4 py-6">
          <p className="text-sm text-[#9ca3af]">
            Select or create an image set first to monitor sequential generation.
          </p>
          <StudioButton variant="primary" onClick={() => onNavigateTab("create")}>
            Create New Image Set
          </StudioButton>
        </div>
      </StudioPanel>
    )
  }

  const counts = job.counts
  const total = Math.max(1, counts.total)
  const doneOrMeta = counts.completed + counts.metadata_pending
  const progressPct = Math.min(100, Math.round((doneOrMeta / total) * 100))
  const isRunning = job.status === "running"
  const isPaused = job.status === "paused"

  const modelInfo = providers.find((p) => p.id === job.model)
  const activeTurn =
    job.generations.find((g) => g.status === "generating") ||
    (isRunning
      ? job.generations.find((g) => g.status === "metadata_pending")
      : undefined) ||
    job.generations.find((g) => g.status === "planned") ||
    null

  const aspectClass =
    job.aspect_ratio === "9:16"
      ? "aspect-[9/16]"
      : job.aspect_ratio === "4:5"
        ? "aspect-[4/5]"
        : job.aspect_ratio === "16:9" || job.aspect_ratio === "3:2"
          ? "aspect-video"
          : "aspect-square"

  return (
    <div className="flex flex-col gap-8">
      {/* Header & Primary Controls */}
      <div className="flex flex-col justify-between gap-6 border-b border-white/[0.06] pb-7 lg:flex-row lg:items-end">
        <div>
          <div className="flex items-center gap-3">
            <p className="font-mono-tech text-[11px] uppercase tracking-[0.22em] text-[#9ca3af]">
              03 · SEQUENTIAL RENDER QUEUE · SET #{job.id}
            </p>
            <StudioBadge
              tone={
                isRunning
                  ? "sky"
                  : job.status === "completed"
                    ? "emerald"
                    : job.status === "paused"
                      ? "amber"
                      : job.status === "failed"
                        ? "rose"
                        : "neutral"
              }
              label={job.status.replace(/_/g, " ")}
              pulse={isRunning}
            />
          </div>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-semibold tracking-tight text-[#f4f5f7]">
            {job.theme}
          </h1>
          <p className="mt-1.5 font-mono-tech text-xs text-[#9ca3af]">
            {job.current_step || "Ready to generate sequentially."}
          </p>
        </div>

        {/* Control Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          {job.status === "planned" && (
            <StudioButton
              variant="primary"
              onClick={() => onStartJob(job.id)}
              icon={<Play size={15} weight="fill" />}
            >
              Start Run
            </StudioButton>
          )}

          {isRunning && (
            <StudioButton
              variant="secondary"
              onClick={() => onPauseJob(job.id)}
              icon={<Pause size={15} weight="fill" />}
            >
              Pause Run
            </StudioButton>
          )}

          {isPaused && (
            <StudioButton
              variant="primary"
              onClick={() => onResumeJob(job.id)}
              icon={<Play size={15} weight="fill" />}
            >
              Resume Run
            </StudioButton>
          )}

          {(isRunning || isPaused || counts.planned > 0) && (
            <StudioButton
              variant="danger"
              onClick={() => onCancelJob(job.id)}
            >
              <span className="inline-flex items-center gap-1.5">
                <StopCircle size={15} weight="light" />
                Cancel Remaining
              </span>
            </StudioButton>
          )}

          {(counts.failed > 0 || counts.cancelled > 0) && (
            <StudioButton
              variant="secondary"
              onClick={() => onRetryFailed(job.id)}
              icon={<ArrowsClockwise size={15} weight="light" />}
            >
              Retry Failed ({counts.failed + counts.cancelled})
            </StudioButton>
          )}

          {onRestartBrowser && (isRunning || isPaused) && (() => {
            const activeSlotId = job.active_cdp_slot || job.preferred_cdp_slot || 1
            const slotObj = cdpSlots.find((s) => s.slot_id === activeSlotId)
            const targetPort = slotObj?.port || 9221 + activeSlotId
            return (
              <StudioButton
                variant="secondary"
                onClick={() => onRestartBrowser(activeSlotId)}
                title={`Force restart Chrome Slot #${activeSlotId} (:${targetPort}) if browser tab is hung`}
              >
                Restart Slot #{activeSlotId} (:{targetPort})
              </StudioButton>
            )
          })()}

          <StudioButton
            variant="secondary"
            onClick={() => onOpenFolder(job.id)}
          >
            <span className="inline-flex items-center gap-1.5">
              <FolderOpen size={15} weight="light" />
              Open Folder
            </span>
          </StudioButton>

          {doneOrMeta > 0 && (
            <StudioButton
              variant="primary"
              onClick={() => onNavigateTab("gallery")}
              icon={<ArrowRight size={15} weight="light" />}
            >
              Open in Gallery ({doneOrMeta})
            </StudioButton>
          )}
        </div>
      </div>

      {/* Progress & Telemetry Strip */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8 flex flex-col gap-6">
          <StudioPanel
            eyebrow={
              job.run_mode === "continuous"
                ? `CONTINUOUS WAVE MODE · CAP ${job.session_cap}`
                : "SEQUENTIAL RENDER PROGRESS"
            }
            title={`${doneOrMeta} of ${counts.total} Shots Saved to Disk`}
          >
            <div className="flex flex-col gap-4">
              {/* Progress Bar */}
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full bg-emerald-400 transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>

              {/* Status Counters */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
                {[
                  { label: "Planned", val: counts.planned, tone: "text-[#9ca3af]" },
                  { label: "Generating", val: counts.generating, tone: "text-sky-300" },
                  { label: "Completed", val: counts.completed, tone: "text-emerald-300" },
                  {
                    label: "Meta Pending",
                    val: counts.metadata_pending,
                    tone: "text-amber-300",
                  },
                  { label: "Failed", val: counts.failed, tone: "text-rose-300" },
                  { label: "Cancelled", val: counts.cancelled, tone: "text-[#646b78]" },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="rounded-2xl bg-white/[0.025] p-3 ring-1 ring-white/[0.06]"
                  >
                    <span className="block font-mono-tech text-[10px] uppercase tracking-wider text-[#646b78]">
                      {s.label}
                    </span>
                    <span className={cn("mt-1 block font-display text-xl font-semibold", s.tone)}>
                      {s.val}
                    </span>
                  </div>
                ))}
              </div>

              {/* Active Shot Spotlight */}
              {activeTurn && (isRunning || job.status === "planned") && (
                <div className="rounded-2xl bg-sky-500/[0.06] p-4 ring-1 ring-sky-400/25 flex flex-col gap-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono-tech text-xs font-semibold text-sky-200">
                      {activeTurn.status === "generating"
                        ? `ACTIVE SHOT #${String(activeTurn.index_num).padStart(3, "0")} · RENDERING NOW`
                        : activeTurn.status === "metadata_pending"
                          ? `ACTIVE SHOT #${String(activeTurn.index_num).padStart(3, "0")} · WRITING CAPTION`
                          : `NEXT IN QUEUE · SHOT #${String(activeTurn.index_num).padStart(3, "0")}`}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono-tech text-[11px] text-[#9ca3af]">
                        {job.model}
                      </span>
                      {onSkipTurn &&
                        (activeTurn.status === "generating" ||
                          (isRunning && activeTurn.status === "metadata_pending")) && (
                          <button
                            type="button"
                            onClick={() => onSkipTurn(activeTurn.id)}
                            className="rounded-full bg-amber-400/20 px-3 py-1 text-[11px] font-medium text-amber-200 ring-1 ring-amber-400/35 hover:bg-amber-400/30 cursor-pointer"
                            title="Temporarily defer this shot to retry at end of set and jump immediately to the next shot"
                          >
                            Defer → Retry Later
                          </button>
                        )}
                    </div>
                  </div>
                  <p className="text-xs text-[#e5e7eb] line-clamp-2">
                    {activeTurn.prompt_final}
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-[10px] text-[#9ca3af] pt-1">
                    <span className="inline-flex items-center gap-1 truncate">
                      <Camera size={11} className="text-sky-300 shrink-0" />
                      <span className="truncate">{activeTurn.variation_axes?.camera_angle}</span>
                    </span>
                    <span className="inline-flex items-center gap-1 truncate">
                      <GridFour size={11} className="text-sky-300 shrink-0" />
                      <span className="truncate">{activeTurn.variation_axes?.composition}</span>
                    </span>
                    <span className="inline-flex items-center gap-1 truncate">
                      <SunDim size={11} className="text-sky-300 shrink-0" />
                      <span className="truncate">{activeTurn.variation_axes?.lighting}</span>
                    </span>
                    <span className="inline-flex items-center gap-1 truncate">
                      <Wind size={11} className="text-sky-300 shrink-0" />
                      <span className="truncate">{activeTurn.variation_axes?.atmosphere}</span>
                    </span>
                  </div>
                </div>
              )}

              {job.error && (
                <div className="rounded-2xl bg-amber-500/10 p-3.5 text-xs text-amber-200 ring-1 ring-amber-400/30">
                  {job.error}
                </div>
              )}
            </div>
          </StudioPanel>

          {/* Darkroom Contact Sheet Grid (Paginated for 100–1000 image sets) */}
          <StudioPagination
            totalItems={job.generations.length}
            pageSize={pageSize}
            pageIndex={pageIndex}
            onPageChange={setPageIndex}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {job.generations
              .slice((pageIndex - 1) * pageSize, pageIndex * pageSize)
              .map((gen) => {
              const hasImage = Boolean(gen.image_file)
              return (
                <div
                  key={gen.id}
                  className={cn(
                    "flex flex-col justify-between overflow-hidden rounded-3xl bg-[#0b0d11]/90 p-4 ring-1 transition-all",
                    gen.status === "generating"
                      ? "ring-sky-400/50 shadow-[0_0_30px_rgba(56,189,248,0.08)]"
                      : gen.duplicate_warning
                        ? "ring-amber-400/40"
                        : gen.status === "failed"
                          ? "ring-rose-400/35"
                          : "ring-white/[0.08]"
                  )}
                >
                  <div>
                    {/* Card Top Bar */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono-tech text-xs font-semibold text-white">
                          #{String(gen.index_num).padStart(3, "0")}
                        </span>
                        <StudioBadge
                          tone={
                            gen.status === "completed"
                              ? "emerald"
                              : gen.status === "generating"
                                ? "sky"
                                : gen.status === "metadata_pending"
                                  ? "amber"
                                  : gen.status === "failed"
                                    ? "rose"
                                    : "neutral"
                          }
                          label={gen.status.replace("_", " ")}
                          pulse={gen.status === "generating"}
                        />
                      </div>

                      {gen.reference && (
                        <div className="flex items-center gap-1.5 rounded-full bg-white/[0.04] px-2.5 py-0.5 text-[10px] text-[#9ca3af] ring-1 ring-white/[0.08]">
                          <img
                            src={getReferenceImageUrl(gen.reference.id)}
                            alt=""
                            className="size-3.5 rounded-full object-cover"
                          />
                          <span>Ref #{gen.reference.id}</span>
                        </div>
                      )}
                    </div>

                    {/* Aspect-Aware Visual Preview Frame */}
                    <div
                      className={cn(
                        "mt-3 relative w-full max-h-[340px] overflow-hidden rounded-2xl bg-black/50 ring-1 ring-white/[0.06]",
                        aspectClass
                      )}
                    >
                      {hasImage ? (
                        <img
                          src={getGenerationImageUrl(gen.id, gen.md5 || gen.image_file)}
                          alt={gen.title || gen.prompt_final}
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-[#646b78]">
                          <Sparkle
                            size={22}
                            weight="light"
                            className={
                              gen.status === "generating"
                                ? "text-sky-300 animate-spin"
                                : "text-[#646b78]"
                            }
                          />
                          <span>
                            {gen.status === "generating"
                              ? "Rendering image…"
                              : gen.status === "failed"
                                ? gen.error || "Generation failed"
                                : "Waiting in sequential queue"}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Duplicate / Perceptual Hash Warning Banner */}
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

                    {/* Title, Caption, Description & Prompt */}
                    <div className="mt-3 space-y-1">
                      {gen.title ? (
                        <p className="text-sm font-medium text-[#f4f5f7] line-clamp-1">
                          {gen.title}
                        </p>
                      ) : (
                        <p className="text-xs italic text-[#646b78]">
                          {gen.status === "metadata_pending"
                            ? "Metadata pending — image safely saved"
                            : (job.metadata_export_mode || "json") === "none"
                              ? "Image-only mode (no caption prompt)"
                              : "Pin Title & Caption generated after image completes"}
                        </p>
                      )}
                      {gen.caption && gen.caption !== gen.title && (
                        <p className="text-[11px] font-medium text-amber-300/90 line-clamp-1">
                          {gen.caption}
                        </p>
                      )}
                      <p className="text-xs text-[#9ca3af] line-clamp-2">
                        {gen.description || gen.prompt_final}
                      </p>
                    </div>
                  </div>

                  {/* Card Footer Actions */}
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-3">
                    <span className="font-mono-tech text-[10px] text-[#646b78] truncate">
                      {gen.image_file || gen.variation_axes?.camera_angle || "Planned"}
                    </span>

                    <div className="flex items-center gap-1.5">
                      {onSkipTurn &&
                        (gen.status === "generating" ||
                          (isRunning && gen.status === "metadata_pending")) && (
                          <button
                            type="button"
                            onClick={() => onSkipTurn(gen.id)}
                            className="rounded-full bg-amber-500/20 px-2.5 py-1 text-[11px] font-medium text-amber-200 ring-1 ring-amber-400/30 hover:bg-amber-500/30 cursor-pointer"
                            title="Temporarily defer this shot to retry at end of set and jump to next shot"
                          >
                            Defer
                          </button>
                        )}
                      {(gen.status === "metadata_pending" || hasImage) &&
                        (job.metadata_export_mode || "json") !== "none" && (
                          <button
                            type="button"
                            onClick={() => onRetryMetadata(gen.id, true)}
                            className="rounded-full bg-amber-500/20 px-2.5 py-1 text-[11px] text-amber-200 ring-1 ring-amber-400/30 hover:bg-amber-500/30 cursor-pointer"
                            title="Send post-image prompt to AI Browser to write Pin Caption & Description"
                          >
                            AI Caption
                          </button>
                        )}

                      <button
                        type="button"
                        onClick={() => onRetrySingleTurn(gen.id, false)}
                        className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[11px] text-[#d1d5db] hover:bg-white/[0.1] cursor-pointer"
                      >
                        Retry Shot
                      </button>

                      {hasImage && (
                        <a
                          href={getGenerationImageUrl(gen.id, gen.updated_at, true)}
                          download
                          className="flex size-7 items-center justify-center rounded-full bg-white/[0.06] text-white hover:bg-white/[0.14]"
                          title="Download image"
                        >
                          <DownloadSimple size={13} weight="light" />
                        </a>
                      )}

                      <button
                        type="button"
                        onClick={() => onDeleteGeneration(gen.id)}
                        className="flex size-7 items-center justify-center rounded-full bg-white/[0.04] text-[#646b78] hover:bg-rose-500/20 hover:text-rose-300 cursor-pointer"
                        title="Delete shot"
                      >
                        <Trash size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <StudioPagination
            totalItems={job.generations.length}
            pageSize={pageSize}
            pageIndex={pageIndex}
            onPageChange={setPageIndex}
          />
        </div>

        {/* Right 4 Columns: Provider Info, Export Info & Live Activity Feed */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          <StudioPanel eyebrow="PROVIDER & QUOTA" title="Execution Policy">
            <div className="flex flex-col gap-3 text-xs text-[#9ca3af]">
              <div className="flex items-center justify-between py-1 border-b border-white/[0.05]">
                <span>Active model</span>
                <span className="font-mono-tech text-white">{job.model}</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-white/[0.05]">
                <span>Assigned Chrome Slot</span>
                <span className="font-mono-tech text-sky-300">
                  {job.active_cdp_slot
                    ? `Running Slot #${job.active_cdp_slot} (:${9221 + job.active_cdp_slot})`
                    : job.preferred_cdp_slot
                      ? `Pinned Slot #${job.preferred_cdp_slot} (:${9221 + job.preferred_cdp_slot})`
                      : "Auto (1 Job = 1 Slot)"}
                </span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-white/[0.05]">
                <span>Category / Filename</span>
                <span className="font-mono-tech text-[#e5e7eb]">
                  {(job.category || "Auto") + " · " + (job.filename_style === "studio_seq" ? "001_slug" : "slug-1")}
                </span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-white/[0.05]">
                <span>Concurrency</span>
                <span className="font-mono-tech text-emerald-300">1 (Sequential)</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-white/[0.05]">
                <span>Post-image export</span>
                <span className="font-mono-tech text-amber-300 uppercase">
                  {job.metadata_export_mode || "json"}
                </span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-white/[0.05]">
                <span>Image format</span>
                <span className="font-mono-tech text-emerald-300 uppercase">
                  {job.export_image_format || "original"}
                </span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-white/[0.05]">
                <span>Estimated cost</span>
                <span className="font-mono-tech text-[#e5e7eb]">
                  {modelInfo?.cost_estimate || "Session-based"}
                </span>
              </div>
              <p className="text-[11px] text-[#646b78]">
                {modelInfo?.rate_limit_note}
              </p>

              {doneOrMeta > 0 && (
                <a
                  href={getJobZipUrl(job.id)}
                  download
                  className="mt-2 inline-flex items-center justify-center gap-2 rounded-full bg-[#f4f5f7] px-4 py-2.5 text-xs font-medium text-[#050505] hover:bg-white"
                >
                  <DownloadSimple size={15} weight="bold" />
                  Download Complete Set (.ZIP)
                </a>
              )}
            </div>
          </StudioPanel>

          <StudioPanel eyebrow="LIVE TELEMETRY" title="Run Event Stream">
            <div className="flex max-h-[460px] flex-col gap-2 overflow-y-auto pr-1 font-mono-tech text-[11px]">
              {logs.length === 0 ? (
                <p className="text-[#646b78]">No events recorded for this set yet.</p>
              ) : (
                logs.map((log) => (
                  <div
                    key={log.id}
                    className="rounded-xl bg-white/[0.02] p-2.5 ring-1 ring-white/[0.05]"
                  >
                    <div className="flex items-center justify-between text-[10px] text-[#646b78]">
                      <span>{log.stage}</span>
                      <span>{log.created_at.split("T")[1] || log.created_at}</span>
                    </div>
                    <p
                      className={cn(
                        "mt-1 text-xs",
                        log.level === "ERROR"
                          ? "text-rose-300"
                          : log.level === "WARN"
                            ? "text-amber-300"
                            : "text-[#d1d5db]"
                      )}
                    >
                      {log.message}
                    </p>
                  </div>
                ))
              )}
            </div>
          </StudioPanel>
        </div>
      </div>
    </div>
  )
}
