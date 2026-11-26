import * as React from "react"
import {
  Sparkle,
  ListChecks,
  Play,
  Images,
  Sliders,
  Plus,
  FolderOpen,
  DownloadSimple,
  Browsers,
  Aperture,
  X,
  List,
  Trash,
  MagnifyingGlass,
  ArrowSquareOut,
} from "@phosphor-icons/react"
import { StudioBadge, StudioButton } from "@/components/shared/StudioPrimitives"
import {
  getJobZipUrl,
  type CdpSlotStatus,
  type ImageSetJob,
  type MetadataExportMode,
  type StudioTab,
  type SystemStatusResponse,
} from "@/services/studioApi"
import { cn } from "@/lib/utils"

export interface StudioLayoutProps {
  activeTab: StudioTab
  onSelectTab: (tab: StudioTab) => void
  status: SystemStatusResponse | null
  jobs: ImageSetJob[]
  activeJob: ImageSetJob | null
  onSelectJob: (job: ImageSetJob, targetTab?: StudioTab) => void
  onDeleteJob: (jobId: number, deleteFiles: boolean) => Promise<void>
  onSwitchJobExportMode: (jobId: number, mode: MetadataExportMode) => Promise<void>
  onOpenFolder: (jobId: number) => Promise<void>
  onChangeJobFolder: (jobId: number) => Promise<void>
  notice: {
    tone: "emerald" | "amber" | "rose" | "sky" | "neutral"
    message: string
  } | null
  onDismissNotice: () => void
  onLaunchCdp: (engine?: string, forceRestart?: boolean, slotId?: number) => Promise<void>
  children: React.ReactNode
}

export function StudioLayout({
  activeTab,
  onSelectTab,
  status,
  jobs,
  activeJob,
  onSelectJob,
  onDeleteJob,
  onSwitchJobExportMode,
  onOpenFolder,
  onChangeJobFolder,
  notice,
  onDismissNotice,
  onLaunchCdp,
  children,
}: StudioLayoutProps) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = React.useState(false)
  const [launchingCdp, setLaunchingCdp] = React.useState(false)
  const [setSearch, setSetSearch] = React.useState("")

  const cdpSlots: CdpSlotStatus[] = status?.cdp_slots || []
  const enabledSlots = cdpSlots.filter((s) => s.enabled)
  const onlineSlots = enabledSlots.filter((s) => s.connected)
  const isCdpConnected =
    onlineSlots.length > 0 || Boolean(status?.cdp?.online || status?.cdp?.connected)
  const plannedCount = activeJob?.counts?.planned || 0
  const runningCount = jobs.filter((j) => j.status === "running").length
  const completedCount = activeJob?.counts?.completed || 0

  const pipelineItems: Array<{
    id: StudioTab
    step: string
    label: string
    badge?: string | number
    icon: React.ReactNode
  }> = [
    {
      id: "create",
      step: "1",
      label: "Create",
      icon: <Sparkle size={15} />,
    },
    {
      id: "plan",
      step: "2",
      label: "Plan",
      badge: plannedCount > 0 ? plannedCount : undefined,
      icon: <ListChecks size={15} />,
    },
    {
      id: "run",
      step: "3",
      label: "Run",
      badge: runningCount > 0 ? "Live" : undefined,
      icon: <Play size={15} />,
    },
    {
      id: "gallery",
      step: "4",
      label: "Gallery",
      badge: completedCount > 0 ? completedCount : undefined,
      icon: <Images size={15} />,
    },
  ]

  const filteredJobs = React.useMemo(() => {
    const q = setSearch.trim().toLowerCase()
    if (!q) return jobs
    return jobs.filter(
      (j) =>
        j.theme.toLowerCase().includes(q) ||
        String(j.id).includes(q) ||
        (j.slug || "").toLowerCase().includes(q)
    )
  }, [jobs, setSearch])

  const handleLaunchClick = async (engine = "gemini", slotId = 1) => {
    setLaunchingCdp(true)
    try {
      await onLaunchCdp(engine, false, slotId)
    } finally {
      setLaunchingCdp(false)
    }
  }

  const formatShortFolder = (fullPath?: string) => {
    if (!fullPath) return "./exports"
    const parts = fullPath.replace(/\\/g, "/").split("/").filter(Boolean)
    if (parts.length <= 2) return fullPath
    return `…/${parts.slice(-2).join("/")}`
  }

  const slotList =
    cdpSlots.length > 0
      ? cdpSlots
      : [
          {
            slot_id: 1,
            port: 9222,
            label: "Slot 1",
            enabled: true,
            connected: isCdpConnected,
            open_engines: [] as string[],
            active_job_id: null,
            active_generation_id: null,
          },
        ]

  return (
    <div className="flex min-h-screen w-full bg-[#121212] text-[#F5F5F5]">
      {/* Left Sidebar (244px, pure neutral) */}
      <aside className="hidden lg:flex lg:sticky lg:top-0 lg:h-screen w-[244px] shrink-0 flex-col justify-between border-r border-[#2E2E2E] bg-[#171717] p-3.5 select-none">
        <div className="flex flex-1 min-h-0 flex-col gap-4">
          {/* Header + New Set Button */}
          <div className="flex items-center justify-between gap-2 px-1">
            <button
              type="button"
              onClick={() => onSelectTab("create")}
              className="flex items-center gap-2.5 text-left cursor-pointer"
            >
              <span className="flex size-7 items-center justify-center rounded-md bg-[#FAFAFA] text-[#121212]">
                <Aperture size={16} weight="bold" />
              </span>
              <span className="text-sm font-semibold tracking-tight text-[#F5F5F5]">
                Theme Studio
              </span>
            </button>

            <button
              type="button"
              onClick={() => onSelectTab("create")}
              title="Create new image set"
              className="inline-flex h-7 items-center gap-1 rounded-md bg-[#FAFAFA] px-2.5 text-[11px] font-semibold text-[#121212] transition-colors duration-150 hover:bg-[#E5E5E5] cursor-pointer"
            >
              <Plus size={12} weight="bold" />
              New
            </button>
          </div>

          {/* 4-Step Pipeline */}
          <nav aria-label="Workflow" className="flex flex-col gap-0.5">
            {pipelineItems.map((item) => {
              const active = activeTab === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectTab(item.id)}
                  className={cn(
                    "group relative flex items-center justify-between rounded-md px-2.5 py-2 text-xs font-medium transition-colors duration-150 cursor-pointer",
                    active
                      ? "bg-[#262626] text-[#F5F5F5]"
                      : "text-[#A3A3A3] hover:bg-[#1F1F1F] hover:text-[#F5F5F5]"
                  )}
                >
                  {active && (
                    <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-[#FAFAFA]" />
                  )}
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "w-3.5 text-left font-mono-tech text-[11px]",
                        active ? "font-semibold text-[#F5F5F5]" : "text-[#737373]"
                      )}
                    >
                      {item.step}
                    </span>
                    <span
                      className={cn(
                        active ? "text-[#F5F5F5]" : "text-[#737373] group-hover:text-[#A3A3A3]"
                      )}
                    >
                      {item.icon}
                    </span>
                    <span>{item.label}</span>
                  </span>

                  {item.badge !== undefined && (
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 font-mono-tech text-[10px] font-medium",
                        active
                          ? "bg-[#FAFAFA] text-[#121212] font-semibold"
                          : "bg-[#262626] text-[#A3A3A3]"
                      )}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              )
            })}
          </nav>

          {/* Image Sets List */}
          <div className="flex flex-1 min-h-0 flex-col gap-2 border-t border-[#2E2E2E] pt-3">
            <div className="flex items-center justify-between px-1.5">
              <span className="text-xs font-medium text-[#A3A3A3]">
                Sets ({jobs.length})
              </span>
              {jobs.length > 0 && (
                <span className="font-mono-tech text-[10px] text-[#737373]">
                  {jobs.reduce((acc, j) => acc + j.counts.completed, 0)} saved
                </span>
              )}
            </div>

            {jobs.length > 3 && (
              <div className="relative">
                <MagnifyingGlass
                  size={12}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#737373]"
                />
                <input
                  type="text"
                  value={setSearch}
                  onChange={(e) => setSetSearch(e.target.value)}
                  placeholder="Filter sets…"
                  className="h-7 w-full rounded-md border border-[#2E2E2E] bg-[#1C1C1C] pl-7 pr-6 text-xs text-[#F5F5F5] placeholder:text-[#737373] outline-none focus:border-[#525252]"
                />
                {setSearch && (
                  <button
                    type="button"
                    onClick={() => setSetSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[#737373] hover:text-[#F5F5F5] cursor-pointer"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            )}

            <div className="flex flex-1 min-h-0 flex-col gap-1 overflow-y-auto pr-0.5">
              {filteredJobs.length === 0 ? (
                <p className="px-1.5 py-2 text-xs text-[#737373]">
                  {jobs.length === 0
                    ? "No sets yet."
                    : "No sets match filter."}
                </p>
              ) : (
                filteredJobs.map((job) => {
                  const isSelected = activeJob?.id === job.id
                  const done = job.counts.completed + job.counts.metadata_pending
                  const pct = Math.round(
                    (done / Math.max(1, job.counts.total)) * 100
                  )
                  const expMode = job.metadata_export_mode || "csv"
                  return (
                    <div
                      key={job.id}
                      className={cn(
                        "group relative flex flex-col gap-1.5 rounded-md border p-2 text-left transition-colors duration-150",
                        isSelected
                          ? "border-[#404040] bg-[#242424] text-[#F5F5F5]"
                          : "border-transparent bg-transparent text-[#A3A3A3] hover:border-[#2E2E2E] hover:bg-[#1C1C1C]"
                      )}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            const nextTab: StudioTab =
                              job.status === "running"
                                ? "run"
                                : activeTab === "plan" ||
                                    activeTab === "run" ||
                                    activeTab === "gallery"
                                  ? activeTab
                                  : done > 0
                                    ? "gallery"
                                    : "plan"
                            onSelectJob(job, nextTab)
                          }}
                          className="truncate text-xs font-medium text-left flex-1 cursor-pointer"
                        >
                          <span className="mr-1 font-mono-tech text-[10px] text-[#737373]">
                            #{job.id}
                          </span>
                          {job.theme}
                        </button>
                        <span className="shrink-0 font-mono-tech text-[10px] text-[#A3A3A3]">
                          {done}/{job.counts.total}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            onDeleteJob(job.id, false)
                          }}
                          title={`Delete set #${job.id}`}
                          className="opacity-0 group-hover:opacity-100 rounded p-0.5 text-[#737373] hover:bg-[#EF4444]/15 hover:text-[#FCA5A5] transition-opacity cursor-pointer"
                        >
                          <Trash size={12} />
                        </button>
                      </div>

                      <div className="h-[2px] w-full overflow-hidden rounded-full bg-[#2E2E2E]">
                        <div
                          className="h-full rounded-full bg-[#D4D4D4] transition-all duration-150"
                          style={{
                            width: `${Math.max(pct, job.counts.planned > 0 ? 6 : 0)}%`,
                          }}
                        />
                      </div>

                      <div className="flex items-center justify-between gap-1">
                        <span className="font-mono-tech text-[10px] text-[#737373] truncate">
                          {job.active_cdp_slot ? `S${job.active_cdp_slot} ` : ""}
                          {job.aspect_ratio} {expMode === "none" ? "Img" : "CSV"}
                        </span>
                        <div className="flex items-center gap-0.5">
                          {(
                            [
                              ["plan", "Plan"],
                              ["run", "Run"],
                              ["gallery", "Gallery"],
                            ] as const
                          ).map(([t, label]) => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => onSelectJob(job, t)}
                              className={cn(
                                "rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors duration-150 cursor-pointer",
                                isSelected && activeTab === t
                                  ? "bg-[#FAFAFA] text-[#121212]"
                                  : "text-[#737373] hover:bg-[#2E2E2E] hover:text-[#F5F5F5]"
                              )}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>

        {/* Bottom Dock: Chrome Slots + Settings */}
        <div className="mt-3 flex flex-col gap-2 border-t border-[#2E2E2E] pt-3">
          <div className="rounded-md border border-[#2E2E2E] bg-[#1C1C1C] p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#F5F5F5]">
                Chrome ({onlineSlots.length}/{enabledSlots.length || 1})
              </span>
              <span className="text-[10px] text-[#A3A3A3]">
                {isCdpConnected ? "Online" : "Standby"}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-1">
              {slotList.map((slot) => (
                <button
                  key={slot.slot_id}
                  type="button"
                  disabled={launchingCdp}
                  onClick={() => handleLaunchClick("gemini", slot.slot_id)}
                  title={`${slot.label} (:${slot.port})${
                    slot.active_job_id
                      ? ` — rendering set #${slot.active_job_id}`
                      : !slot.enabled
                        ? " — off (click to launch & enable)"
                        : " — click to launch or focus"
                  }`}
                  className={cn(
                    "flex items-center justify-between rounded border px-2 py-1 font-mono-tech text-[10px] transition-colors duration-150 cursor-pointer",
                    slot.enabled && slot.connected
                      ? "border-[#525252] bg-[#2A2A2A] text-[#F5F5F5] hover:border-[#737373]"
                      : slot.enabled
                        ? "border-[#2E2E2E] bg-[#222222] text-[#A3A3A3] hover:border-[#404040] hover:text-[#F5F5F5]"
                        : "border-[#262626] bg-[#171717] text-[#737373] hover:border-[#404040] hover:text-[#A3A3A3]"
                  )}
                >
                  <span className="truncate">
                    S{slot.slot_id} :{slot.port}
                  </span>
                  <span
                    className={cn(
                      "size-1.5 rounded-full shrink-0",
                      slot.active_job_id
                        ? "bg-[#FAFAFA] animate-pulse"
                        : slot.enabled && slot.connected
                          ? "bg-[#FAFAFA]"
                          : slot.connected
                            ? "bg-[#A3A3A3]"
                            : "bg-[#404040]"
                    )}
                  />
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => onSelectTab("settings")}
            className={cn(
              "relative flex items-center justify-between rounded-md px-2.5 py-2 text-xs font-medium transition-colors duration-150 cursor-pointer",
              activeTab === "settings"
                ? "bg-[#262626] text-[#F5F5F5]"
                : "text-[#A3A3A3] hover:bg-[#1F1F1F] hover:text-[#F5F5F5]"
            )}
          >
            {activeTab === "settings" && (
              <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-[#FAFAFA]" />
            )}
            <span className="flex items-center gap-2">
              <Sliders
                size={15}
                className={activeTab === "settings" ? "text-[#F5F5F5]" : "text-[#737373]"}
              />
              <span>Settings</span>
            </span>
          </button>
        </div>
      </aside>

      {/* Right Main Area */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Minimal 46px Top Context Bar */}
        <header className="sticky top-0 z-30 border-b border-[#2E2E2E] bg-[#171717] px-4 py-2 sm:px-7">
          <div className="mx-auto flex min-h-[30px] max-w-[1360px] flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(true)}
                aria-label="Open menu"
                className="flex lg:hidden size-8 items-center justify-center rounded-md border border-[#2E2E2E] bg-[#262626] text-[#F5F5F5] cursor-pointer"
              >
                <List size={17} />
              </button>

              {activeJob ? (
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <span className="rounded border border-[#383838] bg-[#262626] px-1.5 py-0.5 font-mono-tech text-[11px] text-[#D4D4D4]">
                    #{activeJob.id}
                  </span>
                  <h2 className="truncate max-w-[200px] sm:max-w-[360px] text-sm font-semibold text-[#F5F5F5]">
                    {activeJob.theme}
                  </h2>
                  <StudioBadge
                    tone={activeJob.status === "failed" ? "rose" : "neutral"}
                    label={activeJob.status.replace(/_/g, " ")}
                    pulse={activeJob.status === "running"}
                  />
                  <button
                    type="button"
                    onClick={() => onOpenFolder(activeJob.id)}
                    title={`Open in Finder: ${activeJob.export_dir}`}
                    className="hidden md:inline-flex items-center gap-1 rounded-md border border-[#2E2E2E] bg-[#1C1C1C] px-2 py-0.5 font-mono-tech text-[11px] text-[#A3A3A3] hover:border-[#404040] hover:text-[#F5F5F5] cursor-pointer"
                  >
                    <FolderOpen size={12} />
                    <span>{formatShortFolder(activeJob.export_dir)}</span>
                    <ArrowSquareOut size={10} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-[#F5F5F5]">
                    New set
                  </span>
                  <span className="hidden sm:inline-block font-mono-tech text-[11px] text-[#737373]">
                    {formatShortFolder(status?.settings?.export_root_dir)}
                  </span>
                </div>
              )}
            </div>

            {activeJob && (
              <div className="flex items-center gap-1.5">
                <div
                  className="flex items-center rounded-md border border-[#2E2E2E] bg-[#1C1C1C] p-0.5"
                  title="Export mode: Picassy pin-import.csv or Images only"
                >
                  {(
                    [
                      ["csv", "CSV"],
                      ["none", "Images only"],
                    ] as const
                  ).map(([modeKey, modeLabel]) => {
                    const currentMode = activeJob.metadata_export_mode || "csv"
                    const isModeActive = currentMode === modeKey
                    return (
                      <button
                        key={modeKey}
                        type="button"
                        onClick={() => onSwitchJobExportMode(activeJob.id, modeKey)}
                        className={cn(
                          "rounded px-2.5 py-1 text-[11px] font-medium transition-colors duration-150 cursor-pointer",
                          isModeActive
                            ? "bg-[#FAFAFA] text-[#121212] font-semibold"
                            : "text-[#A3A3A3] hover:text-[#F5F5F5]"
                        )}
                      >
                        {modeLabel}
                      </button>
                    )
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => onChangeJobFolder(activeJob.id)}
                  title="Change export folder"
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-[#383838] bg-[#262626] px-2.5 text-xs text-[#F5F5F5] hover:border-[#525252] cursor-pointer"
                >
                  <FolderOpen size={13} />
                  <span className="hidden sm:inline">Folder…</span>
                </button>

                {activeJob.counts.completed > 0 && (
                  <a
                    href={getJobZipUrl(activeJob.id)}
                    download
                    title="Download ZIP archive"
                    className="inline-flex h-7 items-center gap-1 rounded-md bg-[#FAFAFA] px-2.5 text-xs font-semibold text-[#121212] hover:bg-[#E5E5E5]"
                  >
                    <DownloadSimple size={13} weight="bold" />
                    <span>.ZIP</span>
                  </a>
                )}
              </div>
            )}
          </div>
        </header>

        {/* Mobile Drawer */}
        {mobileSidebarOpen && (
          <div className="fixed inset-0 z-50 flex bg-black/75 lg:hidden">
            <div className="flex w-72 flex-col justify-between border-r border-[#2E2E2E] bg-[#171717] p-4">
              <div className="flex flex-1 min-h-0 flex-col gap-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-[#F5F5F5]">
                    Theme Studio
                  </span>
                  <button
                    type="button"
                    onClick={() => setMobileSidebarOpen(false)}
                    className="rounded-md p-1 text-[#A3A3A3] hover:text-[#F5F5F5]"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="flex flex-col gap-1">
                  {pipelineItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        onSelectTab(item.id)
                        setMobileSidebarOpen(false)
                      }}
                      className={cn(
                        "flex items-center justify-between rounded-md px-3 py-2 text-xs font-medium",
                        activeTab === item.id
                          ? "bg-[#262626] text-[#F5F5F5]"
                          : "text-[#A3A3A3]"
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span className="font-mono-tech text-[11px] opacity-70">
                          {item.step}
                        </span>
                        {item.icon}
                        <span>{item.label}</span>
                      </span>
                      {item.badge !== undefined && (
                        <span className="rounded bg-[#262626] px-1.5 py-0.5 font-mono-tech text-[10px]">
                          {item.badge}
                        </span>
                      )}
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={() => {
                      onSelectTab("settings")
                      setMobileSidebarOpen(false)
                    }}
                    className={cn(
                      "mt-1 flex items-center gap-2 border-t border-[#2E2E2E] px-3 pt-3 pb-2 text-xs font-medium",
                      activeTab === "settings" ? "text-[#F5F5F5]" : "text-[#A3A3A3]"
                    )}
                  >
                    <Sliders size={15} />
                    <span>Settings</span>
                  </button>
                </div>

                <div className="flex flex-1 min-h-0 flex-col gap-1 border-t border-[#2E2E2E] pt-3 overflow-y-auto">
                  <span className="px-1 text-xs font-medium text-[#A3A3A3]">
                    Sets ({jobs.length})
                  </span>
                  {jobs.map((job) => (
                    <button
                      key={job.id}
                      type="button"
                      onClick={() => {
                        onSelectJob(job, "plan")
                        setMobileSidebarOpen(false)
                      }}
                      className={cn(
                        "flex items-center justify-between rounded-md px-2.5 py-2 text-left text-xs",
                        activeJob?.id === job.id
                          ? "bg-[#262626] text-[#F5F5F5]"
                          : "text-[#A3A3A3]"
                      )}
                    >
                      <span className="truncate">
                        <span className="mr-1 font-mono-tech text-[#737373]">
                          #{job.id}
                        </span>
                        {job.theme}
                      </span>
                      <span className="font-mono-tech text-[10px] text-[#A3A3A3]">
                        {job.counts.completed}/{job.counts.total}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-t border-[#2E2E2E] pt-3">
                <StudioButton
                  variant="secondary"
                  loading={launchingCdp}
                  onClick={() => handleLaunchClick("gemini", 1)}
                  icon={<Browsers size={14} />}
                  className="w-full justify-center h-8 text-xs"
                >
                  {isCdpConnected
                    ? `Browser online (${onlineSlots.length})`
                    : "Launch browser (:9222)"}
                </StudioButton>
              </div>
            </div>
          </div>
        )}

        {/* Main Workspace */}
        <main className="mx-auto w-full max-w-[1360px] flex-1 px-4 py-5 sm:px-7 sm:py-6">
          {notice && (
            <div className="mb-5 flex items-center justify-between gap-4 rounded-lg border border-[#2E2E2E] bg-[#1C1C1C] px-4 py-2.5">
              <div className="flex items-center gap-3 text-xs sm:text-sm text-[#F5F5F5]">
                <StudioBadge tone={notice.tone} label="Info" />
                <span>{notice.message}</span>
              </div>
              <button
                type="button"
                onClick={onDismissNotice}
                className="rounded-md px-2.5 py-1 text-xs text-[#A3A3A3] hover:bg-[#262626] hover:text-[#F5F5F5] cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {children}
        </main>
      </div>
    </div>
  )
}
