import * as React from "react"
import { StudioLayout } from "@/components/layout/StudioLayout"
import { CreateScreen } from "@/components/studio/CreateScreen"
import { PlanScreen } from "@/components/studio/PlanScreen"
import { RunScreen } from "@/components/studio/RunScreen"
import { GalleryScreen } from "@/components/studio/GalleryScreen"
import { SettingsPanel } from "@/components/settings/SettingsPanel"
import {
  addGenerationTurn,
  bulkDeleteGenerations,
  bulkDeleteReferences,
  cancelJob,
  createJob,
  deleteGeneration,
  deleteJob,
  deleteReference,
  discoverPinterestReferences,
  fetchActivityLogs,
  fetchJob,
  fetchJobs,
  fetchReferences,
  fetchSystemStatus,
  launchCdpBrowser,
  openExportFolder,
  pauseJob,
  pickExportFolder,
  reconcileJobExportFolder,
  regenerateAllJobMetadata,
  removeJobWatermarks,
  replanJob,
  resetWorkspace,
  resumeJob,
  retryFailedTurns,
  retryGeneration,
  retryGenerationMetadata,
  skipGeneration,
  startJob,
  updateGeneration,
  updateJob,
  updateStudioSettings,
  uploadReferenceFiles,
  type ActivityLog,
  type CreateJobPayload,
  type ImageSetJob,
  type MetadataExportMode,
  type ReferenceItem,
  type StudioSettings,
  type StudioTab,
  type SystemStatusResponse,
  type TurnVariationAxes,
} from "@/services/studioApi"

const ACTIVE_JOB_STORAGE_KEY = "studio_active_job_id"

const DEFAULT_CAPTION_PROMPT_FALLBACK =
  "Write a catchy, aesthetic Pinterest Pin Title, an engaging social hook Caption, a 2-3 sentence SEO-friendly Description that inspires saves and clicks, and 6-10 relevant trending Hashtags tailored to this image for uploading to Pinterest and visual platforms."

export function App() {
  const [activeTab, setActiveTab] = React.useState<StudioTab>("create")
  const [status, setStatus] = React.useState<SystemStatusResponse | null>(null)
  const [jobs, setJobs] = React.useState<ImageSetJob[]>([])
  const [activeJobId, setActiveJobId] = React.useState<number | null>(() => {
    const saved = localStorage.getItem(ACTIVE_JOB_STORAGE_KEY)
    return saved ? Number(saved) : null
  })
  const [references, setReferences] = React.useState<ReferenceItem[]>([])
  const [logs, setLogs] = React.useState<ActivityLog[]>([])
  const [notice, setNotice] = React.useState<{
    tone: "emerald" | "amber" | "rose" | "sky" | "neutral"
    message: string
  } | null>(null)

  const activeJobIdRef = React.useRef<number | null>(activeJobId)
  React.useEffect(() => {
    activeJobIdRef.current = activeJobId
  }, [activeJobId])

  const activeJob = React.useMemo(() => {
    if (activeJobId) {
      const found = jobs.find((j) => j.id === activeJobId)
      if (found) return found
    }
    return jobs[0] || null
  }, [jobs, activeJobId])

  const runningJobIds = React.useMemo(
    () => jobs.filter((j) => j.status === "running").map((j) => j.id),
    [jobs]
  )
  const runningJobsKey = runningJobIds.join(",")
  const runningJobId = runningJobIds[0] ?? null

  const syncJobInListOnly = (updated: ImageSetJob) => {
    setJobs((prev) => {
      const exists = prev.some((j) => j.id === updated.id)
      if (!exists) return [updated, ...prev]
      return prev.map((j) => (j.id === updated.id ? updated : j))
    })
  }

  const selectJobAndRemember = React.useCallback(
    async (job: ImageSetJob, targetTab?: StudioTab) => {
      setActiveJobId(job.id)
      localStorage.setItem(ACTIVE_JOB_STORAGE_KEY, String(job.id))
      if (targetTab) {
        setActiveTab(targetTab)
      }
      // Hydrate full generations + logs when switching to a summary job loaded with include_generations=false
      try {
        const [fullJob, jobLogs] = await Promise.all([
          job.generations.length === 0 && job.counts.total > 0
            ? fetchJob(job.id)
            : Promise.resolve(job),
          fetchActivityLogs(job.id),
        ])
        syncJobInListOnly(fullJob)
        setLogs(jobLogs)
      } catch {
        // ignore transient errors
      }
    },
    []
  )

  const refreshAll = React.useCallback(async () => {
    try {
      const [sys, jobSummaryList, refList] = await Promise.all([
        fetchSystemStatus(),
        fetchJobs(false),
        fetchReferences(),
      ])
      setStatus(sys)
      setReferences(refList)

      const targetId = activeJobIdRef.current || jobSummaryList[0]?.id
      let hydratedTarget: ImageSetJob | null = null
      if (targetId) {
        try {
          hydratedTarget = await fetchJob(targetId)
        } catch {
          hydratedTarget = null
        }
      }

      setJobs((prev) =>
        jobSummaryList.map((summaryJob) => {
          if (hydratedTarget && summaryJob.id === hydratedTarget.id) {
            return hydratedTarget
          }
          const existing = prev.find((p) => p.id === summaryJob.id)
          if (existing && existing.generations.length > 0 && existing.updated_at === summaryJob.updated_at) {
            return existing
          }
          return summaryJob
        })
      )

      if (targetId) {
        const jobLogs = await fetchActivityLogs(targetId)
        setLogs(jobLogs)
      }
    } catch {
      // Keep UI responsive if server is restarting
    }
  }, [])

  React.useEffect(() => {
    refreshAll()
  }, [refreshAll])

  // Lightweight polling during active runs (all running jobs up to 4 slots + system slot status)
  React.useEffect(() => {
    const runningIdsKey = runningJobIds.join(",")
    if (runningIdsKey) {
      const targetIds = runningIdsKey
        .split(",")
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n) && n > 0)
      const interval = setInterval(async () => {
        try {
          const activeId = activeJobIdRef.current || targetIds[0]
          const [nextStatus, activeLogs, ...freshJobs] = await Promise.all([
            fetchSystemStatus().catch(() => null),
            activeId ? fetchActivityLogs(activeId).catch(() => null) : Promise.resolve(null),
            ...targetIds.map((id) => fetchJob(id).catch(() => null)),
          ])
          if (nextStatus) {
            setStatus(nextStatus)
          }
          for (const fj of freshJobs) {
            if (fj) syncJobInListOnly(fj)
          }
          if (activeLogs) {
            setLogs(activeLogs)
          }
        } catch {
          // ignore
        }
      }, 1800)
      return () => clearInterval(interval)
    }

    const idleInterval = setInterval(refreshAll, 10000)
    return () => clearInterval(idleInterval)
  }, [runningJobIds, refreshAll])

  const updateJobInState = (updated: ImageSetJob) => {
    syncJobInListOnly(updated)
    setActiveJobId(updated.id)
    localStorage.setItem(ACTIVE_JOB_STORAGE_KEY, String(updated.id))
  }

  const handleUploadReferences = async (files: File[]) => {
    try {
      const uploaded = await uploadReferenceFiles(files)
      const allRefs = await fetchReferences()
      setReferences(allRefs)
      setNotice({
        tone: "emerald",
        message: `Uploaded ${uploaded.length} reference image(s).`,
      })
      return uploaded
    } catch (err) {
      setNotice({
        tone: "rose",
        message: err instanceof Error ? err.message : "Failed to upload reference images.",
      })
      return []
    }
  }

  const handleDiscoverPinterest = async (queryOrUrl: string, limit: number) => {
    try {
      const res = await discoverPinterestReferences(queryOrUrl, limit)
      const allRefs = await fetchReferences()
      setReferences(allRefs)
      setNotice({
        tone: res.count > 0 ? "emerald" : "amber",
        message:
          res.count > 0
            ? `Found ${res.count} Pinterest candidate image(s) for ${res.input_info.label}.`
            : `No Pinterest candidates found for ${res.input_info.label}. Try another keyword or upload local references.`,
      })
      return res.references
    } catch (err) {
      setNotice({
        tone: "rose",
        message: err instanceof Error ? err.message : "Pinterest discovery failed.",
      })
      return []
    }
  }

  const handleDeleteReference = async (refId: number) => {
    try {
      await deleteReference(refId)
      setReferences((prev) => prev.filter((r) => r.id !== refId))
      if (activeJobIdRef.current) {
        const refreshed = await fetchJob(activeJobIdRef.current).catch(() => null)
        if (refreshed) syncJobInListOnly(refreshed)
      }
      setNotice({
        tone: "emerald",
        message: `Deleted reference #${refId}.`,
      })
    } catch (err) {
      setNotice({
        tone: "rose",
        message: err instanceof Error ? err.message : "Failed to delete reference.",
      })
    }
  }

  const handleBulkDeleteReferences = async (options: {
    reference_ids?: number[]
    source_type?: "local_upload" | "pinterest"
    delete_all?: boolean
  }) => {
    try {
      const res = await bulkDeleteReferences(options)
      const freshRefs = await fetchReferences()
      setReferences(freshRefs)
      if (activeJobIdRef.current) {
        const refreshed = await fetchJob(activeJobIdRef.current).catch(() => null)
        if (refreshed) syncJobInListOnly(refreshed)
      }
      setNotice({
        tone: "emerald",
        message: `Deleted ${res.deleted_count} reference image(s) cleanly.`,
      })
    } catch (err) {
      setNotice({
        tone: "rose",
        message:
          err instanceof Error ? err.message : "Failed to bulk-delete references.",
      })
    }
  }

  const handleCreateJob = async (payload: CreateJobPayload) => {
    try {
      const created = await createJob(payload)
      updateJobInState(created)
      if (payload.auto_start) {
        setActiveTab("run")
        setNotice({
          tone: "sky",
          message: `Created set "${created.theme}" and started sequential generation.`,
        })
      } else {
        setActiveTab("plan")
        setNotice({
          tone: "emerald",
          message: `Planned ${created.generations.length} variations for "${created.theme}". Review or edit before starting.`,
        })
      }
    } catch (err) {
      setNotice({
        tone: "rose",
        message: err instanceof Error ? err.message : "Could not create image set.",
      })
    }
  }

  const handleUpdateJob = async (
    jobId: number,
    updates: Partial<CreateJobPayload>
  ) => {
    try {
      const updated = await updateJob(jobId, updates)
      updateJobInState(updated)
      const modeMsg = updates.metadata_export_mode
        ? `Export mode switched to ${updates.metadata_export_mode.toUpperCase()} and synced on disk.`
        : updates.export_image_format
          ? `Image export format set to ${updates.export_image_format.toUpperCase()} for generated outputs.`
          : `Updated set #${jobId} settings.`
      setNotice({
        tone: "emerald",
        message: modeMsg,
      })
    } catch (err) {
      setNotice({
        tone: "rose",
        message: err instanceof Error ? err.message : "Failed to update set.",
      })
    }
  }

  const handleSwitchJobExportMode = async (
    jobId: number,
    mode: MetadataExportMode
  ) => {
    await handleUpdateJob(jobId, { metadata_export_mode: mode })
  }

  const handleRegenerateAllMetadata = async (
    jobId: number,
    useBrowserTurn: boolean
  ) => {
    try {
      const updated = await regenerateAllJobMetadata(jobId, useBrowserTurn)
      updateJobInState(updated)
      setNotice({
        tone: "emerald",
        message: useBrowserTurn
          ? "Generated fresh Pinterest Captions & Descriptions via AI Browser (:9222) and synced files."
          : "Generated fresh Pinterest SEO Captions & Descriptions for all images in set.",
      })
    } catch (err) {
      setNotice({
        tone: "rose",
        message:
          err instanceof Error
            ? err.message
            : "Could not regenerate captions.",
      })
    }
  }

  const handleRemoveWatermarks = async (jobId: number) => {
    try {
      const res = await removeJobWatermarks(jobId)
      updateJobInState(res.job)
      setNotice({
        tone: res.cleaned_count > 0 ? "emerald" : "sky",
        message:
          res.cleaned_count > 0
            ? `Removed Gemini watermarks on ${res.cleaned_count} image(s) (${res.skipped_count} skipped as already clean).`
            : `All ${res.skipped_count} image(s) already clean — no Gemini watermark detected.`,
      })
    } catch (err) {
      setNotice({
        tone: "rose",
        message:
          err instanceof Error ? err.message : "Failed to remove watermarks.",
      })
    }
  }

  const handleReplanJob = async (jobId: number) => {
    try {
      const updated = await replanJob(jobId)
      updateJobInState(updated)
      setNotice({
        tone: "emerald",
        message: "Regenerated unlocked variations with fresh axes.",
      })
    } catch (err) {
      setNotice({
        tone: "rose",
        message: err instanceof Error ? err.message : "Failed to replan set.",
      })
    }
  }

  const handleAddTurn = async (jobId: number) => {
    try {
      const updated = await addGenerationTurn(jobId, {})
      updateJobInState(updated)
      setNotice({
        tone: "emerald",
        message: "Added new variation shot to plan.",
      })
    } catch (err) {
      setNotice({
        tone: "rose",
        message: err instanceof Error ? err.message : "Failed to add shot.",
      })
    }
  }

  const handleUpdateGeneration = async (
    genId: number,
    updates: {
      prompt_final?: string
      reference_id?: number | null
      clear_reference?: boolean
      is_locked?: boolean
      is_peak?: boolean
      title?: string
      caption?: string
      description?: string
      alt_text?: string
      hashtags?: string
      variation_axes?: TurnVariationAxes
    }
  ) => {
    try {
      const res = await updateGeneration(genId, updates)
      updateJobInState(res.job)
    } catch (err) {
      setNotice({
        tone: "rose",
        message: err instanceof Error ? err.message : "Failed to save changes.",
      })
    }
  }

  const handleDeleteGeneration = async (genId: number) => {
    try {
      const updated = await deleteGeneration(genId)
      updateJobInState(updated)
      setNotice({
        tone: "emerald",
        message: "Deleted image, renamed remaining files (-1..N) & updated pin-import.csv.",
      })
    } catch (err) {
      setNotice({
        tone: "rose",
        message: err instanceof Error ? err.message : "Could not delete shot.",
      })
    }
  }

  const handleBulkDeleteGenerations = async (jobId: number, genIds: number[]) => {
    try {
      const res = await bulkDeleteGenerations(jobId, genIds)
      updateJobInState(res.job)
      setNotice({
        tone: "emerald",
        message: `Deleted ${res.deleted_count} image(s), re-sequenced folder files & synced pin-import.csv.`,
      })
    } catch (err) {
      setNotice({
        tone: "rose",
        message:
          err instanceof Error ? err.message : "Could not bulk-delete images.",
      })
    }
  }

  const handleReconcileJobFolder = async (jobId: number) => {
    try {
      const res = await reconcileJobExportFolder(jobId)
      if (res.job) {
        updateJobInState(res.job)
      }
      setNotice({
        tone: "emerald",
        message:
          res.removed_missing > 0 || res.reindexed > 0
            ? `Synced folder & pin-import.csv (removed ${res.removed_missing} deleted file(s), renamed ${res.reindexed} file(s)).`
            : "Folder images and pin-import.csv are 100% in sync.",
      })
    } catch (err) {
      setNotice({
        tone: "rose",
        message:
          err instanceof Error ? err.message : "Failed to sync folder & CSV.",
      })
    }
  }

  const handleStartJob = async (jobId: number) => {
    try {
      const updated = await startJob(jobId)
      updateJobInState(updated)
      setActiveTab("run")
      setNotice({
        tone: "sky",
        message: `Started sequential generation for "${updated.theme}".`,
      })
    } catch (err) {
      setNotice({
        tone: "rose",
        message: err instanceof Error ? err.message : "Could not start job.",
      })
    }
  }

  const handlePauseJob = async (jobId: number) => {
    try {
      const updated = await pauseJob(jobId)
      updateJobInState(updated)
      setNotice({
        tone: "amber",
        message: "Paused sequential run. Completed images are safely saved.",
      })
    } catch (err) {
      setNotice({
        tone: "rose",
        message: err instanceof Error ? err.message : "Failed to pause run.",
      })
    }
  }

  const handleResumeJob = async (jobId: number) => {
    try {
      const updated = await resumeJob(jobId)
      updateJobInState(updated)
      setNotice({
        tone: "sky",
        message: "Resumed sequential generation.",
      })
    } catch (err) {
      setNotice({
        tone: "rose",
        message: err instanceof Error ? err.message : "Failed to resume run.",
      })
    }
  }

  const handleCancelJob = async (jobId: number) => {
    try {
      const updated = await cancelJob(jobId)
      updateJobInState(updated)
      setNotice({
        tone: "amber",
        message: "Cancelled remaining planned turns. Completed images are preserved.",
      })
    } catch (err) {
      setNotice({
        tone: "rose",
        message: err instanceof Error ? err.message : "Failed to cancel run.",
      })
    }
  }

  const handleRetryFailed = async (jobId: number) => {
    try {
      const updated = await retryFailedTurns(jobId)
      updateJobInState(updated)
      setNotice({
        tone: "sky",
        message: "Queued failed/cancelled turns for retry.",
      })
    } catch (err) {
      setNotice({
        tone: "rose",
        message: err instanceof Error ? err.message : "Failed to queue retry.",
      })
    }
  }

  const handleRetrySingleTurn = async (genId: number, mutateAxes: boolean) => {
    try {
      const res = await retryGeneration(genId, mutateAxes)
      updateJobInState(res.job)
      setActiveTab("run")
      setNotice({
        tone: "sky",
        message: mutateAxes
          ? "Rotated variation axes and queued turn for regeneration."
          : "Queued turn for retry.",
      })
    } catch (err) {
      setNotice({
        tone: "rose",
        message: err instanceof Error ? err.message : "Failed to retry turn.",
      })
    }
  }

  const handleSkipTurn = async (genId: number) => {
    try {
      const res = await skipGeneration(genId)
      updateJobInState(res.job)
      setNotice({
        tone: "amber",
        message: "Deferred current shot to end of set — pipeline moved immediately to next shot.",
      })
    } catch (err) {
      setNotice({
        tone: "rose",
        message: err instanceof Error ? err.message : "Could not defer shot.",
      })
    }
  }

  const handleRetryMetadata = async (genId: number, useBrowserTurn: boolean) => {
    try {
      const res = await retryGenerationMetadata(genId, useBrowserTurn)
      updateJobInState(res.job)
      setNotice({
        tone: "emerald",
        message: useBrowserTurn
          ? "Generated Pin Caption & Description via AI Browser prompt and synced files."
          : "Updated Pin Caption & Description and synced files.",
      })
    } catch (err) {
      setNotice({
        tone: "rose",
        message: err instanceof Error ? err.message : "Failed to regenerate metadata.",
      })
    }
  }

  const handleOpenFolder = async (jobId: number) => {
    try {
      const res = await openExportFolder(jobId)
      setNotice({
        tone: "emerald",
        message: `Opened export folder: ${res.export_dir}`,
      })
    } catch (err) {
      setNotice({
        tone: "rose",
        message: err instanceof Error ? err.message : "Could not open folder.",
      })
    }
  }

  const handlePickExportFolder = async (jobId?: number): Promise<string | null> => {
    try {
      const res = await pickExportFolder(jobId, true)
      if (res.cancelled || !res.path) return null
      if (res.settings) {
        setStatus((prev) => (prev ? { ...prev, settings: res.settings! } : prev))
      }
      if (res.job) {
        updateJobInState(res.job)
      }
      setNotice({
        tone: "emerald",
        message: jobId
          ? `Moved set #${jobId} export location to: ${res.job?.export_dir || res.path}`
          : `Selected export root folder: ${res.path}`,
      })
      return res.path
    } catch (err) {
      setNotice({
        tone: "rose",
        message: err instanceof Error ? err.message : "Could not pick folder.",
      })
      return null
    }
  }

  const handleSaveExportRoot = async (dir: string) => {
    try {
      const saved = await updateStudioSettings({ export_root_dir: dir })
      setStatus((prev) => (prev ? { ...prev, settings: saved } : prev))
      setNotice({
        tone: "emerald",
        message: `Default export folder updated to: ${saved.export_root_dir}`,
      })
    } catch (err) {
      setNotice({
        tone: "rose",
        message: err instanceof Error ? err.message : "Invalid export folder path.",
      })
    }
  }

  const handleDeleteJob = async (jobId: number, deleteFiles: boolean) => {
    try {
      await deleteJob(jobId, deleteFiles)
      const remaining = await fetchJobs()
      setJobs(remaining)
      const nextId = remaining[0]?.id || null
      setActiveJobId(nextId)
      if (nextId) {
        localStorage.setItem(ACTIVE_JOB_STORAGE_KEY, String(nextId))
      } else {
        localStorage.removeItem(ACTIVE_JOB_STORAGE_KEY)
      }
      setNotice({
        tone: "emerald",
        message: `Removed set #${jobId} from workspace history.`,
      })
    } catch (err) {
      setNotice({
        tone: "rose",
        message: err instanceof Error ? err.message : "Failed to delete set.",
      })
    }
  }

  const handleLaunchCdp = async (
    engine = "gemini",
    forceRestart = false,
    slotId = 1
  ) => {
    try {
      const res = await launchCdpBrowser(engine, forceRestart, slotId)
      await refreshAll()
      setNotice({
        tone: res.launched ? "emerald" : "rose",
        message: res.message,
      })
    } catch (err) {
      setNotice({
        tone: "rose",
        message: err instanceof Error ? err.message : "Failed to launch AI browser.",
      })
    }
  }

  const handleSaveSettings = async (updates: Partial<StudioSettings>) => {
    try {
      const saved = await updateStudioSettings(updates)
      setStatus((prev) => (prev ? { ...prev, settings: saved } : prev))
      await refreshAll()
      setNotice({
        tone: "emerald",
        message: "Saved Studio settings.",
      })
    } catch (err) {
      setNotice({
        tone: "rose",
        message: err instanceof Error ? err.message : "Failed to save Studio settings.",
      })
    }
  }

  const handleResetWorkspace = async (opts: {
    clear_references: boolean
    delete_exports: boolean
  }) => {
    try {
      await resetWorkspace(opts)
      localStorage.removeItem(ACTIVE_JOB_STORAGE_KEY)
      setActiveJobId(null)
      await refreshAll()
      setActiveTab("create")
      setNotice({
        tone: "emerald",
        message: "Workspace history reset cleanly.",
      })
    } catch (err) {
      setNotice({
        tone: "rose",
        message: err instanceof Error ? err.message : "Failed to reset workspace.",
      })
    }
  }

  // Refresh active job when switching to Plan, Run, or Gallery
  const handleSelectTab = async (tab: StudioTab) => {
    setActiveTab(tab)
    if (activeJobId && ["plan", "run", "gallery"].includes(tab)) {
      try {
        const fresh = await fetchJob(activeJobId)
        updateJobInState(fresh)
      } catch {
        // ignore
      }
    }
  }

  return (
    <StudioLayout
      activeTab={activeTab}
      onSelectTab={handleSelectTab}
      status={status}
      jobs={jobs}
      activeJob={activeJob}
      onSelectJob={(job, tab) => selectJobAndRemember(job, tab)}
      onDeleteJob={handleDeleteJob}
      onSwitchJobExportMode={handleSwitchJobExportMode}
      onOpenFolder={handleOpenFolder}
      onChangeJobFolder={async (jid) => {
        await handlePickExportFolder(jid)
      }}
      notice={notice}
      onDismissNotice={() => setNotice(null)}
      onLaunchCdp={handleLaunchCdp}
    >
      {activeTab === "create" && (
        <CreateScreen
          providers={status?.providers || []}
          presets={status?.presets || []}
          captionStylePresets={status?.caption_style_presets || []}
          defaultCaptionPrompt={
            status?.default_caption_prompt || DEFAULT_CAPTION_PROMPT_FALLBACK
          }
          aspectRatios={status?.aspect_ratios || ["1:1", "4:5", "9:16", "16:9", "3:2"]}
          metadataLanguages={
            status?.metadata_languages || ["English", "Vietnamese"]
          }
          picassyCategories={status?.picassy_categories || []}
          cdpSlots={status?.cdp_slots || []}
          settings={status?.settings || null}
          references={references}
          recentJobs={jobs}
          onUploadReferences={handleUploadReferences}
          onDiscoverPinterest={handleDiscoverPinterest}
          onDeleteReference={handleDeleteReference}
          onBulkDeleteReferences={handleBulkDeleteReferences}
          onCreateJob={handleCreateJob}
          onSelectJob={(job, tab) => selectJobAndRemember(job, tab)}
          onDeleteJob={handleDeleteJob}
          onPickExportFolder={() => handlePickExportFolder()}
          onSaveExportRoot={handleSaveExportRoot}
        />
      )}

      {activeTab === "plan" && (
        <PlanScreen
          job={activeJob}
          presets={status?.presets || []}
          picassyCategories={status?.picassy_categories || []}
          cdpSlots={status?.cdp_slots || []}
          allReferences={references}
          onNavigateTab={handleSelectTab}
          onUpdateJob={handleUpdateJob}
          onDeleteJob={handleDeleteJob}
          onReplanJob={handleReplanJob}
          onAddTurn={handleAddTurn}
          onUpdateGeneration={handleUpdateGeneration}
          onDeleteGeneration={handleDeleteGeneration}
          onStartJob={handleStartJob}
        />
      )}

      {activeTab === "run" && (
        <RunScreen
          job={activeJob}
          providers={status?.providers || []}
          cdpSlots={status?.cdp_slots || []}
          logs={logs}
          onNavigateTab={handleSelectTab}
          onStartJob={handleStartJob}
          onPauseJob={handlePauseJob}
          onResumeJob={handleResumeJob}
          onCancelJob={handleCancelJob}
          onRetryFailed={handleRetryFailed}
          onRetrySingleTurn={handleRetrySingleTurn}
          onSkipTurn={handleSkipTurn}
          onEnableSlot={(slotId) =>
            handleLaunchCdp(
              "gemini",
              false,
              slotId || activeJob?.preferred_cdp_slot || 1
            )
          }
          onRestartBrowser={(slotId) =>
            handleLaunchCdp(
              "gemini",
              true,
              slotId || activeJob?.active_cdp_slot || activeJob?.preferred_cdp_slot || 1
            )
          }
          onRetryMetadata={handleRetryMetadata}
          onDeleteGeneration={handleDeleteGeneration}
          onOpenFolder={handleOpenFolder}
        />
      )}

      {activeTab === "gallery" && (
        <GalleryScreen
          jobs={jobs}
          activeJob={activeJob}
          picassyCategories={status?.picassy_categories || []}
          onSelectJob={(j) => selectJobAndRemember(j)}
          onNavigateTab={handleSelectTab}
          onUpdateJob={handleUpdateJob}
          onRegenerateAllMetadata={handleRegenerateAllMetadata}
          onRemoveWatermarks={handleRemoveWatermarks}
          onUpdateMetadata={(genId, updates) =>
            handleUpdateGeneration(genId, updates)
          }
          onDeleteGeneration={handleDeleteGeneration}
          onBulkDeleteGenerations={handleBulkDeleteGenerations}
          onReconcileFolder={handleReconcileJobFolder}
          onRetryMetadata={handleRetryMetadata}
          onRetrySingleTurn={handleRetrySingleTurn}
          onOpenFolder={handleOpenFolder}
          onChangeJobFolder={async (jid) => {
            await handlePickExportFolder(jid)
          }}
          onDeleteJob={handleDeleteJob}
        />
      )}

      {activeTab === "settings" && (
        <SettingsPanel
          settings={status?.settings || null}
          providers={status?.providers || []}
          cdp={status?.cdp || null}
          cdpSlots={status?.cdp_slots || []}
          picassyCategories={status?.picassy_categories || []}
          aspectRatios={status?.aspect_ratios || ["1:1", "4:5", "9:16", "16:9", "3:2"]}
          metadataLanguages={
            status?.metadata_languages || ["English", "Vietnamese"]
          }
          onSaveSettings={handleSaveSettings}
          onPickExportFolder={() => handlePickExportFolder()}
          onLaunchCdp={handleLaunchCdp}
          onResetWorkspace={handleResetWorkspace}
        />
      )}
    </StudioLayout>
  )
}

export default App
