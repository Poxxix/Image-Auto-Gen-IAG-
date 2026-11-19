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
import { BrandIcon } from "@/components/shared/BrandIcon"
import {
  getJobZipUrl,
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
  onLaunchCdp: (engine?: string) => Promise<void>
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

  const isCdpConnected = Boolean(status?.cdp?.online || status?.cdp?.connected)
  const plannedCount = activeJob?.counts?.planned || 0
  const runningCount = jobs.filter((j) => j.status === "running").length
  const completedCount = activeJob?.counts?.completed || 0

  const navItems: Array<{
    id: StudioTab
    step: string
    label: string
    shortLabel: string
    badge?: string | number
    badgeTone?: "amber" | "emerald" | "sky"
    icon: React.ReactNode
  }> = [
    {
      id: "create",
      step: "01",
      label: "Create Brief",
      shortLabel: "Create",
      icon: <Sparkle size={15} weight="duotone" />,
    },
    {
      id: "plan",
      step: "02",
      label: "Variation Plan",
      shortLabel: "Plan",
      badge: plannedCount > 0 ? plannedCount : undefined,
      badgeTone: "amber",
      icon: <ListChecks size={15} weight="duotone" />,
    },
    {
      id: "run",
      step: "03",
      label: "Render Queue",
      shortLabel: "Run",
      badge: runningCount > 0 ? "LIVE" : undefined,
      badgeTone: "sky",
      icon: <Play size={15} weight="duotone" />,
    },
    {
      id: "gallery",
      step: "04",
      label: "Set Gallery",
      shortLabel: "Gallery",
      badge: completedCount > 0 ? completedCount : undefined,
      badgeTone: "emerald",
      icon: <Images size={15} weight="duotone" />,
    },
    {
      id: "settings",
      step: "05",
      label: "Studio Settings",
      shortLabel: "Settings",
      icon: <Sliders size={15} weight="duotone" />,
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

  const handleLaunchClick = async (engine = "gemini") => {
    setLaunchingCdp(true)
    try {
      await onLaunchCdp(engine)
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

  return (
    <div className="flex min-h-screen w-full bg-[#07080b] text-[#f4f5f7]">
      {/* Desktop Sticky Left Studio Sidebar */}
      <aside className="hidden lg:flex lg:sticky lg:top-0 lg:h-screen w-[284px] shrink-0 flex-col justify-between border-r border-white/[0.07] bg-[#0a0c10] p-4 select-none">
        <div className="flex flex-1 min-h-0 flex-col gap-5">
          {/* Studio Brand Header + New Set Action */}
          <div className="flex items-center justify-between gap-2 px-1 pt-0.5">
            <button
              type="button"
              onClick={() => onSelectTab("create")}
              className="flex items-center gap-2.5 text-left group cursor-pointer"
            >
              <span className="flex size-9 items-center justify-center rounded-xl bg-amber-400 text-[#050505] shadow-[0_4px_16px_rgba(251,191,36,0.25)] transition-transform group-hover:scale-105">
                <Aperture size={20} weight="bold" />
              </span>
              <div>
                <p className="font-display text-sm font-semibold tracking-tight text-white">
                  Theme Set Studio
                </p>
                <p className="font-mono-tech text-[10px] text-amber-300/85">
                  v4.1 · Visual Set Atelier
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => onSelectTab("create")}
              title="Create a new Theme Image Set"
              className="inline-flex h-8 items-center gap-1 rounded-full bg-white/[0.07] px-2.5 text-[11px] font-medium text-white ring-1 ring-white/[0.12] hover:bg-amber-400 hover:text-[#050505] hover:ring-amber-300 transition-all cursor-pointer"
            >
              <Plus size={13} weight="bold" />
              New
            </button>
          </div>

          {/* 5 Workflow Views */}
          <nav aria-label="Studio stages" className="flex flex-col gap-1">
            <div className="mb-1 flex items-center justify-between px-2">
              <span className="font-mono-tech text-[10px] uppercase tracking-[0.18em] text-[#646b78]">
                Studio Pipeline
              </span>
              {activeJob && (
                <span className="font-mono-tech text-[10px] text-[#9ca3af]">
                  Set #{activeJob.id}
                </span>
              )}
            </div>
            {navItems.map((item) => {
              const active = activeTab === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectTab(item.id)}
                  className={cn(
                    "group relative flex items-center justify-between rounded-xl px-3 py-2 text-xs font-medium transition-all cursor-pointer",
                    active
                      ? "bg-white/[0.08] text-white ring-1 ring-amber-400/35 shadow-[0_4px_16px_rgba(0,0,0,0.3)]"
                      : "text-[#9ca3af] hover:bg-white/[0.035] hover:text-[#f4f5f7]"
                  )}
                >
                  {active && (
                    <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-amber-400" />
                  )}
                  <span className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        "font-mono-tech text-[10px]",
                        active ? "text-amber-300 font-semibold" : "text-[#646b78]"
                      )}
                    >
                      {item.step}
                    </span>
                    <span className={active ? "text-amber-300" : "text-[#9ca3af] group-hover:text-white"}>
                      {item.icon}
                    </span>
                    <span>{item.label}</span>
                  </span>
                  {item.badge !== undefined && (
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 font-mono-tech text-[10px] font-semibold",
                        item.badgeTone === "sky"
                          ? "bg-sky-500/20 text-sky-300 ring-1 ring-sky-400/30"
                          : item.badgeTone === "emerald"
                            ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/30"
                            : active
                              ? "bg-amber-400 text-[#050505]"
                              : "bg-white/[0.06] text-[#d1d5db]"
                      )}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              )
            })}
          </nav>

          {/* Image Sets Explorer (Flex-1 Scrollable) */}
          <div className="flex flex-1 min-h-0 flex-col gap-2 border-t border-white/[0.06] pt-3.5">
            <div className="flex items-center justify-between px-2">
              <span className="font-mono-tech text-[10px] uppercase tracking-[0.18em] text-[#646b78]">
                Image Sets ({jobs.length})
              </span>
              {jobs.length > 0 && (
                <span className="font-mono-tech text-[10px] text-[#646b78]">
                  {jobs.reduce((acc, j) => acc + j.counts.completed, 0)} imgs
                </span>
              )}
            </div>

            {jobs.length > 3 && (
              <div className="relative px-1">
                <MagnifyingGlass
                  size={12}
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#646b78]"
                />
                <input
                  type="text"
                  value={setSearch}
                  onChange={(e) => setSetSearch(e.target.value)}
                  placeholder="Filter sets by theme or #id…"
                  className="h-7 w-full rounded-lg bg-white/[0.03] pl-7 pr-6 text-[11px] text-white placeholder:text-[#646b78] ring-1 ring-white/[0.07] outline-none focus:ring-white/25"
                />
                {setSearch && (
                  <button
                    type="button"
                    onClick={() => setSetSearch("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#646b78] hover:text-white cursor-pointer"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            )}

            <div className="flex flex-1 min-h-0 flex-col gap-1.5 overflow-y-auto pr-1">
              {filteredJobs.length === 0 ? (
                <p className="px-2 py-3 text-xs text-[#646b78]">
                  {jobs.length === 0
                    ? "No sets yet. Compose your first theme brief in Step 01."
                    : "No sets match your filter."}
                </p>
              ) : (
                filteredJobs.map((job) => {
                  const isSelected = activeJob?.id === job.id
                  const done = job.counts.completed + job.counts.metadata_pending
                  const pct = Math.round(
                    (done / Math.max(1, job.counts.total)) * 100
                  )
                  const expMode = job.metadata_export_mode || "json"
                  return (
                    <div
                      key={job.id}
                      className={cn(
                        "group relative flex flex-col gap-1.5 rounded-xl p-2.5 text-left transition-all ring-1",
                        isSelected
                          ? "bg-white/[0.06] ring-white/[0.16] text-white"
                          : "bg-white/[0.015] ring-white/[0.04] text-[#9ca3af] hover:bg-white/[0.04] hover:text-[#e5e7eb]"
                      )}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            const nextTab: StudioTab =
                              job.status === "running"
                                ? "run"
                                : activeTab === "plan" || activeTab === "run" || activeTab === "gallery"
                                  ? activeTab
                                  : done > 0
                                    ? "gallery"
                                    : "plan"
                            onSelectJob(job, nextTab)
                          }}
                          className="truncate text-xs font-semibold text-left flex-1 cursor-pointer"
                        >
                          <span className="font-mono-tech text-[10px] text-amber-300/90 mr-1">
                            #{job.id}
                          </span>
                          {job.theme}
                        </button>
                        <span className="shrink-0 font-mono-tech text-[10px] text-emerald-300">
                          {done}/{job.counts.total}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            onDeleteJob(job.id, false)
                          }}
                          title={`Delete set #${job.id}`}
                          className="opacity-0 group-hover:opacity-100 rounded p-0.5 text-[#646b78] hover:bg-rose-500/20 hover:text-rose-300 transition-opacity cursor-pointer"
                        >
                          <Trash size={12} />
                        </button>
                      </div>

                      <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            job.status === "running"
                              ? "bg-sky-400"
                              : done > 0
                                ? "bg-emerald-400"
                                : "bg-amber-400/60"
                          )}
                          style={{ width: `${Math.max(pct, job.counts.planned > 0 ? 8 : 0)}%` }}
                        />
                      </div>

                      <div className="flex items-center justify-between gap-1 pt-0.5">
                        <span className="font-mono-tech text-[10px] text-[#646b78]">
                          {job.aspect_ratio} ·{" "}
                          {expMode === "caption"
                            ? "TXT"
                            : expMode === "none"
                              ? "IMG"
                              : "JSON"}
                        </span>
                        <div className="flex items-center gap-1">
                          {(["plan", "run", "gallery"] as const).map((t) => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => onSelectJob(job, t)}
                              className={cn(
                                "rounded px-1.5 py-0.5 font-mono-tech text-[9px] uppercase transition-colors cursor-pointer",
                                isSelected && activeTab === t
                                  ? "bg-amber-400/20 text-amber-300 font-semibold"
                                  : "bg-white/[0.03] text-[#9ca3af] hover:bg-white/[0.1] hover:text-white"
                              )}
                            >
                              {t}
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

        {/* Bottom AI Browser Bridge Status Card */}
        <div className="mt-3 rounded-2xl bg-white/[0.025] p-3 ring-1 ring-white/[0.07] space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BrandIcon name="gemini" size={15} />
              <span className="text-xs font-semibold text-white">
                AI Browser (:9222)
              </span>
            </div>
            <StudioBadge
              tone={isCdpConnected ? "emerald" : "amber"}
              label={isCdpConnected ? "Online" : "Standby"}
            />
          </div>
          <p className="text-[10px] text-[#9ca3af] line-clamp-1">
            {isCdpConnected
              ? `Connected: ${(status?.cdp?.open_engines || []).join(", ") || "Chrome Session"}`
              : "Launch Chrome (:9222) for Gemini / ChatGPT / Grok."}
          </p>
          <div className="flex items-center gap-1.5">
            <StudioButton
              variant="secondary"
              loading={launchingCdp}
              onClick={() => handleLaunchClick("gemini")}
              icon={<Browsers size={13} />}
              className="flex-1 justify-center h-7 text-[11px] px-2"
            >
              {launchingCdp ? "Opening…" : isCdpConnected ? "Focus Browser" : "Launch :9222"}
            </StudioButton>
          </div>
        </div>
      </aside>

      {/* Right Main Workspace Area */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Sleek Sticky Top Navigation & Context Toolbar */}
        <header className="sticky top-0 z-30 border-b border-white/[0.07] bg-[#07080b]/90 px-4 py-2.5 backdrop-blur-xl sm:px-8">
          <div className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-3">
            {/* Left: Mobile Menu Trigger + Active Set Context Pill */}
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(true)}
                aria-label="Open navigation drawer"
                className="flex lg:hidden size-9 items-center justify-center rounded-xl bg-white/[0.05] text-white ring-1 ring-white/[0.1] cursor-pointer"
              >
                <List size={18} />
              </button>

              {activeJob ? (
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <span className="rounded-lg bg-amber-400/15 px-2 py-0.5 font-mono-tech text-[11px] font-semibold text-amber-300 ring-1 ring-amber-400/30">
                    SET #{activeJob.id}
                  </span>
                  <h2 className="truncate max-w-[200px] sm:max-w-[300px] font-display text-sm font-semibold text-white">
                    {activeJob.theme}
                  </h2>
                  <StudioBadge
                    tone={
                      activeJob.status === "completed"
                        ? "emerald"
                        : activeJob.status === "running"
                          ? "sky"
                          : activeJob.status === "paused"
                            ? "amber"
                            : "neutral"
                    }
                    label={activeJob.status.replace(/_/g, " ")}
                    pulse={activeJob.status === "running"}
                  />
                  <button
                    type="button"
                    onClick={() => onOpenFolder(activeJob.id)}
                    title={`Click to open folder in Finder: ${activeJob.export_dir}`}
                    className="hidden xl:inline-flex items-center gap-1 rounded-full bg-white/[0.03] px-2.5 py-0.5 font-mono-tech text-[10px] text-[#9ca3af] ring-1 ring-white/[0.07] hover:bg-white/[0.08] hover:text-white cursor-pointer"
                  >
                    <FolderOpen size={11} />
                    <span>{formatShortFolder(activeJob.export_dir)}</span>
                    <ArrowSquareOut size={10} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2.5">
                  <span className="font-display text-sm font-semibold text-white">
                    Theme Image Set Studio
                  </span>
                  <span className="hidden sm:inline-block font-mono-tech text-[11px] text-[#646b78]">
                    · Export root: {formatShortFolder(status?.settings?.export_root_dir)}
                  </span>
                </div>
              )}
            </div>

            {/* Center/Right: Horizontal Stage Switcher + Active Set Quick Tools */}
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Compact Horizontal Workflow Bar (Quick Step Switcher) */}
              <div className="hidden md:flex items-center rounded-full bg-white/[0.03] p-1 ring-1 ring-white/[0.07]">
                {navItems.map((item) => {
                  const active = activeTab === item.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectTab(item.id)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all cursor-pointer",
                        active
                          ? "bg-[#f4f5f7] text-[#050505] font-semibold shadow-sm"
                          : "text-[#9ca3af] hover:text-white"
                      )}
                    >
                      <span className="font-mono-tech text-[10px] opacity-65">
                        {item.step}
                      </span>
                      <span>{item.shortLabel}</span>
                      {item.badge !== undefined && (
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-0.2 font-mono-tech text-[9px]",
                            active
                              ? "bg-[#050505]/15 text-[#050505]"
                              : "bg-white/[0.08] text-[#d1d5db]"
                          )}
                        >
                          {item.badge}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Active Set Export Mode & Folder Actions */}
              {activeJob && (
                <div className="flex items-center gap-1.5">
                  <div
                    className="flex items-center rounded-full bg-white/[0.03] p-0.5 ring-1 ring-white/[0.08]"
                    title="Post-image export mode: Sidecar JSON, Pinterest Caption (.txt), or Images Only"
                  >
                    {(
                      [
                        ["json", "JSON"],
                        ["caption", "Pin TXT"],
                        ["none", "Img Only"],
                      ] as const
                    ).map(([modeKey, modeLabel]) => {
                      const currentMode = activeJob.metadata_export_mode || "json"
                      const isModeActive = currentMode === modeKey
                      return (
                        <button
                          key={modeKey}
                          type="button"
                          onClick={() => onSwitchJobExportMode(activeJob.id, modeKey)}
                          className={cn(
                            "rounded-full px-2.5 py-1 text-[10px] font-mono-tech transition-all cursor-pointer",
                            isModeActive
                              ? "bg-amber-400 text-[#050505] font-semibold"
                              : "text-[#9ca3af] hover:text-white"
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
                    title="Change export folder for this set"
                    className="inline-flex h-7 items-center gap-1 rounded-full bg-white/[0.04] px-2.5 text-[11px] text-[#d1d5db] ring-1 ring-white/[0.08] hover:bg-white/[0.1] hover:text-white cursor-pointer"
                  >
                    <FolderOpen size={13} />
                    <span className="hidden sm:inline">Folder…</span>
                  </button>

                  {activeJob.counts.completed > 0 && (
                    <a
                      href={getJobZipUrl(activeJob.id)}
                      download
                      title="Download ZIP archive of this set"
                      className="inline-flex h-7 items-center gap-1 rounded-full bg-amber-400 px-3 text-[11px] font-semibold text-[#050505] hover:bg-amber-300"
                    >
                      <DownloadSimple size={13} weight="bold" />
                      <span>.ZIP</span>
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Mobile Drawer */}
        {mobileSidebarOpen && (
          <div className="fixed inset-0 z-50 flex bg-black/75 backdrop-blur-xs lg:hidden">
            <div className="flex w-72 flex-col justify-between bg-[#0a0c10] p-4 border-r border-white/[0.1]">
              <div className="flex flex-1 min-h-0 flex-col gap-4">
                <div className="flex items-center justify-between">
                  <span className="font-display text-base font-semibold text-white">
                    Theme Set Studio
                  </span>
                  <button
                    type="button"
                    onClick={() => setMobileSidebarOpen(false)}
                    className="rounded-lg p-1 text-[#9ca3af] hover:text-white"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="flex flex-col gap-1">
                  {navItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        onSelectTab(item.id)
                        setMobileSidebarOpen(false)
                      }}
                      className={cn(
                        "flex items-center justify-between rounded-xl px-3 py-2.5 text-xs font-medium",
                        activeTab === item.id
                          ? "bg-white/[0.08] text-amber-300 ring-1 ring-amber-400/30"
                          : "text-[#9ca3af]"
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span className="font-mono-tech text-[10px] opacity-60">
                          {item.step}
                        </span>
                        {item.icon}
                        <span>{item.label}</span>
                      </span>
                      {item.badge !== undefined && (
                        <span className="rounded-full bg-white/[0.08] px-2 py-0.5 font-mono-tech text-[10px]">
                          {item.badge}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {/* Mobile Sets List */}
                <div className="flex flex-1 min-h-0 flex-col gap-1.5 border-t border-white/[0.07] pt-3 overflow-y-auto">
                  <span className="px-1 font-mono-tech text-[10px] uppercase tracking-wider text-[#646b78]">
                    Image Sets ({jobs.length})
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
                        "flex items-center justify-between rounded-xl px-3 py-2 text-left text-xs",
                        activeJob?.id === job.id
                          ? "bg-white/[0.08] text-white"
                          : "text-[#9ca3af]"
                      )}
                    >
                      <span className="truncate">
                        #{job.id} · {job.theme}
                      </span>
                      <span className="font-mono-tech text-[10px] text-amber-300">
                        {job.counts.completed}/{job.counts.total}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-white/[0.07]">
                <StudioButton
                  variant="secondary"
                  loading={launchingCdp}
                  onClick={() => handleLaunchClick("gemini")}
                  icon={<Browsers size={14} />}
                  className="w-full justify-center h-8 text-xs"
                >
                  {isCdpConnected ? "AI Browser Online (:9222)" : "Open AI Browser (:9222)"}
                </StudioButton>
              </div>
            </div>
          </div>
        )}

        {/* Main Workspace Canvas */}
        <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-6 sm:px-8 sm:py-8">
          {notice && (
            <div className="mb-6 flex items-center justify-between gap-4 rounded-2xl bg-white/[0.03] px-4 py-3 ring-1 ring-white/[0.1]">
              <div className="flex items-center gap-3 text-xs sm:text-sm text-[#f4f5f7]">
                <StudioBadge tone={notice.tone} label="Studio" />
                <span>{notice.message}</span>
              </div>
              <button
                type="button"
                onClick={onDismissNotice}
                className="rounded-lg px-2.5 py-1 text-xs text-[#9ca3af] hover:bg-white/[0.06] hover:text-white cursor-pointer"
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
