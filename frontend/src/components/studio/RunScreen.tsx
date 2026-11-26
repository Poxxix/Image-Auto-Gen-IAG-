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
  Images,
  Camera,
  SunDim,
  GridFour,
  Wind,
  Trash,
  ArrowsOutSimple,
  ArrowsInSimple,
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
  onEnableSlot?: (slotId: number) => Promise<void>
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
  onEnableSlot,
  onRestartBrowser,
  onRetryMetadata,
  onDeleteGeneration,
  onOpenFolder,
}: RunScreenProps) {
  const [pageIndex, setPageIndex] = React.useState(1)
  const [expandLogs, setExpandLogs] = React.useState(false)
  const pageSize = 24

  React.useEffect(() => {
    setPageIndex(1)
  }, [job?.id])

  if (!job) {
    return (
      <StudioPanel title="No image set selected">
        <div className="flex flex-col items-start gap-3 py-4">
          <p className="text-sm text-[#A3A3A3]">
            Select or create an image set first to monitor sequential rendering.
          </p>
          <StudioButton variant="primary" onClick={() => onNavigateTab("create")}>
            Create new set
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
    <div className="flex flex-col gap-5">
      {/* Header & Controls */}
      <div className="flex flex-col justify-between gap-4 border-b border-[#2E2E2E] pb-4 lg:flex-row lg:items-end">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-[#F5F5F5]">
              {job.theme}
            </h1>
            <StudioBadge
              tone={job.status === "failed" ? "rose" : "neutral"}
              label={job.status.replace(/_/g, " ")}
              pulse={isRunning}
            />
          </div>
          <p className="mt-1 font-mono-tech text-xs text-[#A3A3A3]">
            {job.current_step || "Ready to generate sequentially."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {job.status === "planned" && (
            <StudioButton
              variant="primary"
              onClick={() => onStartJob(job.id)}
              icon={<Play size={14} weight="fill" />}
            >
              Start run
            </StudioButton>
          )}

          {isRunning && (
            <StudioButton
              variant="secondary"
              onClick={() => onPauseJob(job.id)}
              icon={<Pause size={14} weight="fill" />}
            >
              Pause
            </StudioButton>
          )}

          {isPaused && (
            <StudioButton
              variant="primary"
              onClick={() => onResumeJob(job.id)}
              icon={<Play size={14} weight="fill" />}
            >
              Resume
            </StudioButton>
          )}

          {(isRunning || isPaused || counts.planned > 0) && (
            <StudioButton
              variant="danger"
              onClick={() => onCancelJob(job.id)}
              icon={<StopCircle size={14} />}
            >
              Cancel remaining
            </StudioButton>
          )}

          {(counts.failed > 0 || counts.cancelled > 0) && (
            <StudioButton
              variant="secondary"
              onClick={() => onRetryFailed(job.id)}
              icon={<ArrowsClockwise size={14} />}
            >
              Retry failed ({counts.failed + counts.cancelled})
            </StudioButton>
          )}

          {(onEnableSlot || onRestartBrowser) &&
            (isRunning || isPaused) &&
            (() => {
              const activeSlotId =
                job.active_cdp_slot || job.preferred_cdp_slot || 1
              const slotObj = cdpSlots.find((s) => s.slot_id === activeSlotId)
              const targetPort = slotObj?.port || 9221 + activeSlotId
              const needsEnableOrConnect =
                isRunning &&
                !job.active_cdp_slot &&
                slotObj &&
                (!slotObj.enabled || !slotObj.connected)
              return (
                <>
                  {onEnableSlot && needsEnableOrConnect && (
                    <StudioButton
                      variant="primary"
                      onClick={() => onEnableSlot(activeSlotId)}
                      title={`Enable and connect Chrome slot #${activeSlotId} (:${targetPort})`}
                    >
                      Enable slot #{activeSlotId} (:{targetPort})
                    </StudioButton>
                  )}
                  {onRestartBrowser && (
                    <StudioButton
                      variant="secondary"
                      onClick={() => onRestartBrowser(activeSlotId)}
                      title={`Force restart Chrome slot #${activeSlotId} (:${targetPort})`}
                    >
                      Restart slot #{activeSlotId} (:{targetPort})
                    </StudioButton>
                  )}
                </>
              )
            })()}

          <StudioButton
            variant="secondary"
            onClick={() => onOpenFolder(job.id)}
            icon={<FolderOpen size={14} />}
          >
            Open folder
          </StudioButton>

          {doneOrMeta > 0 && (
            <StudioButton
              variant="primary"
              onClick={() => onNavigateTab("gallery")}
              icon={<Images size={14} />}
            >
              Open gallery ({doneOrMeta})
            </StudioButton>
          )}
        </div>
      </div>

      {/* Progress & Console Strip */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <StudioPanel
            title={`${doneOrMeta} of ${counts.total} shots saved`}
            headerRight={
              <span className="font-mono-tech text-xs text-[#F5F5F5]">
                {progressPct}%
              </span>
            }
          >
            <div className="flex flex-col gap-4">
              <div className="h-2 w-full overflow-hidden rounded-full bg-[#262626]">
                <div
                  className="h-full rounded-full bg-[#FAFAFA] transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>

              <div className="grid grid-cols-3 divide-x divide-y sm:divide-y-0 divide-[#2E2E2E] rounded-md border border-[#2E2E2E] bg-[#171717] sm:grid-cols-6">
                {[
                  { label: "Planned", val: counts.planned, tone: "text-[#A3A3A3]" },
                  { label: "Rendering", val: counts.generating, tone: "text-[#F5F5F5]" },
                  { label: "Saved", val: counts.completed, tone: "text-[#F5F5F5]" },
                  {
                    label: "Meta pending",
                    val: counts.metadata_pending,
                    tone: "text-[#D4D4D4]",
                  },
                  {
                    label: "Failed",
                    val: counts.failed,
                    tone: counts.failed > 0 ? "text-[#FCA5A5]" : "text-[#737373]",
                  },
                  { label: "Cancelled", val: counts.cancelled, tone: "text-[#737373]" },
                ].map((s) => (
                  <div key={s.label} className="px-2.5 py-2 text-left">
                    <span className="block text-[10px] text-[#737373] truncate">
                      {s.label}
                    </span>
                    <span
                      className={cn(
                        "mt-0.5 block font-mono-tech text-base font-semibold tabular-nums",
                        s.tone
                      )}
                    >
                      {s.val}
                    </span>
                  </div>
                ))}
              </div>

              {activeTurn && (isRunning || job.status === "planned") && (
                <div className="rounded-md border border-[#404040] bg-[#222222] p-3.5 flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#F5F5F5]">
                      {activeTurn.status === "generating"
                        ? `Rendering shot #${String(activeTurn.index_num).padStart(2, "0")}`
                        : activeTurn.status === "metadata_pending"
                          ? `Writing metadata for shot #${String(activeTurn.index_num).padStart(2, "0")}`
                          : `Next up: shot #${String(activeTurn.index_num).padStart(2, "0")}`}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono-tech text-[11px] text-[#A3A3A3]">
                        {job.active_cdp_slot
                          ? `Slot #${job.active_cdp_slot} (:${9221 + job.active_cdp_slot})`
                          : job.model}
                      </span>
                      {onSkipTurn &&
                        (activeTurn.status === "generating" ||
                          (isRunning &&
                            activeTurn.status === "metadata_pending")) && (
                          <button
                            type="button"
                            onClick={() => onSkipTurn(activeTurn.id)}
                            className="rounded border border-[#525252] bg-[#2E2E2E] px-2.5 py-0.5 text-[11px] font-medium text-[#F5F5F5] hover:bg-[#383838] cursor-pointer"
                            title="Defer this shot to the end of the queue and advance immediately"
                          >
                            Defer to end
                          </button>
                        )}
                    </div>
                  </div>
                  <p className="text-xs text-[#D4D4D4] line-clamp-2">
                    {activeTurn.prompt_final}
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-[11px] text-[#A3A3A3]">
                    {activeTurn.variation_axes?.camera_angle && (
                      <span className="inline-flex items-center gap-1 truncate">
                        <Camera size={11} className="text-[#737373] shrink-0" />
                        <span className="truncate">
                          {activeTurn.variation_axes.camera_angle}
                        </span>
                      </span>
                    )}
                    {activeTurn.variation_axes?.composition && (
                      <span className="inline-flex items-center gap-1 truncate">
                        <GridFour size={11} className="text-[#737373] shrink-0" />
                        <span className="truncate">
                          {activeTurn.variation_axes.composition}
                        </span>
                      </span>
                    )}
                    {activeTurn.variation_axes?.lighting && (
                      <span className="inline-flex items-center gap-1 truncate">
                        <SunDim size={11} className="text-[#737373] shrink-0" />
                        <span className="truncate">
                          {activeTurn.variation_axes.lighting}
                        </span>
                      </span>
                    )}
                    {activeTurn.variation_axes?.atmosphere && (
                      <span className="inline-flex items-center gap-1 truncate">
                        <Wind size={11} className="text-[#737373] shrink-0" />
                        <span className="truncate">
                          {activeTurn.variation_axes.atmosphere}
                        </span>
                      </span>
                    )}
                  </div>
                </div>
              )}

              {job.error && (
                <div className="rounded-md border border-[#EF4444]/35 bg-[#EF4444]/10 p-3 text-xs text-[#FCA5A5]">
                  {job.error}
                </div>
              )}
            </div>
          </StudioPanel>
        </div>

        {/* Console Log */}
        <div className="lg:col-span-5">
          <StudioPanel
            title="Activity console"
            headerRight={
              <div className="flex items-center gap-2">
                {doneOrMeta > 0 && (
                  <a
                    href={getJobZipUrl(job.id)}
                    download
                    className="inline-flex items-center gap-1 rounded bg-[#FAFAFA] px-2.5 py-1 text-[11px] font-semibold text-[#121212] hover:bg-[#E5E5E5]"
                  >
                    <DownloadSimple size={12} weight="bold" />
                    .ZIP
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setExpandLogs((v) => !v)}
                  className="inline-flex items-center gap-1 rounded border border-[#2E2E2E] bg-[#262626] px-2 py-1 text-[11px] text-[#A3A3A3] hover:text-[#F5F5F5] cursor-pointer"
                >
                  {expandLogs ? (
                    <>
                      <ArrowsInSimple size={12} /> Compact
                    </>
                  ) : (
                    <>
                      <ArrowsOutSimple size={12} /> Expand
                    </>
                  )}
                </button>
              </div>
            }
          >
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#2E2E2E] bg-[#171717] px-3 py-2 font-mono-tech text-[11px] text-[#A3A3A3]">
                <span>
                  {job.active_cdp_slot
                    ? `Slot #${job.active_cdp_slot} (:${9221 + job.active_cdp_slot})`
                    : job.preferred_cdp_slot
                      ? `Pinned S${job.preferred_cdp_slot}`
                      : "Auto slot"}
                </span>
                <span>
                  {(job.export_image_format || "original").toUpperCase()} ·{" "}
                  {(job.metadata_export_mode || "csv").toUpperCase()}
                </span>
                <span className="text-[#737373]">
                  {modelInfo?.cost_estimate || "Session"}
                </span>
              </div>

              <div
                className={cn(
                  "flex flex-col gap-1.5 overflow-y-auto rounded-md border border-[#2E2E2E] bg-[#121212] p-2.5 font-mono-tech text-[11px]",
                  expandLogs ? "max-h-[380px]" : "max-h-[164px]"
                )}
              >
                {logs.length === 0 ? (
                  <p className="text-[#737373]">
                    No events recorded for this set yet.
                  </p>
                ) : (
                  logs.map((log) => (
                    <div
                      key={log.id}
                      className="border-b border-[#2E2E2E]/60 pb-1.5 last:border-b-0 last:pb-0"
                    >
                      <div className="flex items-center justify-between text-[10px] text-[#737373]">
                        <span>{log.stage}</span>
                        <span>
                          {log.created_at.split("T")[1]?.slice(0, 8) ||
                            log.created_at}
                        </span>
                      </div>
                      <p
                        className={cn(
                          "mt-0.5 text-[11px] leading-snug",
                          log.level === "ERROR"
                            ? "text-[#FCA5A5]"
                            : log.level === "WARN"
                              ? "text-[#D4D4D4]"
                              : "text-[#F5F5F5]"
                        )}
                      >
                        {log.message}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </StudioPanel>
        </div>
      </div>

      {/* Contact-Sheet Grid */}
      <StudioPagination
        totalItems={job.generations.length}
        pageSize={pageSize}
        pageIndex={pageIndex}
        onPageChange={setPageIndex}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {job.generations
          .slice((pageIndex - 1) * pageSize, pageIndex * pageSize)
          .map((gen) => {
            const hasImage = Boolean(gen.image_file)
            return (
              <div
                key={gen.id}
                className={cn(
                  "flex flex-col justify-between overflow-hidden rounded-lg border bg-[#1C1C1C] p-4 transition-colors duration-150",
                  gen.status === "generating"
                    ? "border-[#D4D4D4]"
                    : gen.status === "failed"
                      ? "border-[#EF4444]/50"
                      : "border-[#2E2E2E]"
                )}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono-tech text-xs font-semibold text-[#F5F5F5]">
                        #{String(gen.index_num).padStart(2, "0")}
                      </span>
                      <StudioBadge
                        tone={gen.status === "failed" ? "rose" : "neutral"}
                        label={gen.status.replace("_", " ")}
                        pulse={gen.status === "generating"}
                      />
                    </div>

                    {gen.reference && (
                      <div className="flex items-center gap-1.5 rounded border border-[#2E2E2E] bg-[#171717] px-2 py-0.5 text-[10px] text-[#A3A3A3]">
                        <img
                          src={getReferenceImageUrl(gen.reference.id)}
                          alt=""
                          className="size-3.5 rounded-xs object-cover"
                        />
                        <span className="font-mono-tech">
                          Ref #{gen.reference.id}
                        </span>
                      </div>
                    )}
                  </div>

                  <div
                    className={cn(
                      "mt-3 relative w-full max-h-[320px] overflow-hidden rounded-md border border-[#2E2E2E] bg-[#121212]",
                      aspectClass
                    )}
                  >
                    {hasImage ? (
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
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-[#737373]">
                        <Sparkle
                          size={20}
                          className={
                            gen.status === "generating"
                              ? "text-[#F5F5F5] animate-spin"
                              : "text-[#737373]"
                          }
                        />
                        <span>
                          {gen.status === "generating"
                            ? "Rendering image…"
                            : gen.status === "failed"
                              ? gen.error || "Generation failed"
                              : "Queued"}
                        </span>
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
                        className="shrink-0 rounded bg-[#FAFAFA] px-2 py-0.5 font-semibold text-[#121212] hover:bg-[#E5E5E5] cursor-pointer"
                      >
                        Mutate &amp; redo
                      </button>
                    </div>
                  )}

                  <div className="mt-2.5 space-y-1">
                    {gen.title ? (
                      <p className="text-xs sm:text-sm font-medium text-[#F5F5F5] line-clamp-1">
                        {gen.title}
                      </p>
                    ) : (
                      <p className="text-xs text-[#737373]">
                        {gen.status === "metadata_pending"
                          ? "Writing SEO metadata…"
                          : (job.metadata_export_mode || "csv") === "none"
                            ? "Images-only mode"
                            : "Metadata writes once image finishes"}
                      </p>
                    )}
                    <p className="text-xs text-[#A3A3A3] line-clamp-2">
                      {gen.description || gen.prompt_final}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#2E2E2E] pt-2.5">
                  <span className="font-mono-tech text-[10px] text-[#737373] truncate">
                    {gen.image_file || gen.variation_axes?.camera_angle || "Planned"}
                  </span>

                  <div className="flex items-center gap-1">
                    {onSkipTurn &&
                      (gen.status === "generating" ||
                        (isRunning && gen.status === "metadata_pending")) && (
                        <button
                          type="button"
                          onClick={() => onSkipTurn(gen.id)}
                          className="rounded border border-[#404040] bg-[#262626] px-2 py-1 text-[11px] font-medium text-[#F5F5F5] cursor-pointer"
                          title="Defer shot to end of set"
                        >
                          Defer
                        </button>
                      )}

                    {(gen.status === "metadata_pending" || hasImage) &&
                      (job.metadata_export_mode || "csv") !== "none" && (
                        <button
                          type="button"
                          onClick={() => onRetryMetadata(gen.id, true)}
                          className="rounded border border-[#383838] bg-[#262626] px-2 py-1 text-[11px] text-[#F5F5F5] hover:border-[#525252] cursor-pointer"
                          title="Rewrite caption via AI browser"
                        >
                          AI caption
                        </button>
                      )}

                    <button
                      type="button"
                      onClick={() => onRetrySingleTurn(gen.id, false)}
                      className="rounded border border-[#383838] bg-[#262626] px-2 py-1 text-[11px] text-[#F5F5F5] hover:border-[#525252] cursor-pointer"
                    >
                      Retry
                    </button>

                    {hasImage && (
                      <a
                        href={getGenerationImageUrl(
                          gen.id,
                          gen.updated_at,
                          true
                        )}
                        download
                        className="flex size-7 items-center justify-center rounded border border-[#383838] bg-[#262626] text-[#F5F5F5] hover:border-[#525252]"
                        title="Download image"
                      >
                        <DownloadSimple size={13} />
                      </a>
                    )}

                    <button
                      type="button"
                      onClick={() => onDeleteGeneration(gen.id)}
                      className="flex size-7 items-center justify-center rounded border border-[#2E2E2E] bg-[#262626] text-[#737373] hover:border-[#EF4444]/35 hover:bg-[#EF4444]/15 hover:text-[#FCA5A5] cursor-pointer"
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
  )
}
