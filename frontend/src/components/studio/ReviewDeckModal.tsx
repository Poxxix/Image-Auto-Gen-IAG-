import * as React from "react"
import {
  ArrowLeft,
  ArrowRight,
  ArrowCounterClockwise,
  BoundingBox,
  Check,
  Crop,
  Eraser,
  Eye,
  FloppyDisk,
  Sparkle,
  Star,
  Trash,
  X,
} from "@phosphor-icons/react"
import { Switch } from "@/components/ui/switch"
import {
  editGenerationImage,
  getGenerationImageUrl,
  type GenerationItem,
  type ImageSetJob,
} from "@/services/studioApi"
import { cn } from "@/lib/utils"

export interface ReviewDeckModalProps {
  open: boolean
  items: GenerationItem[]
  initialGenId: number | null
  jobTitle: string
  onClose: () => void
  onTogglePeak: (gen: GenerationItem) => Promise<void>
  onDeleteGeneration: (genId: number) => Promise<void>
  onJobSynced?: (job: ImageSetJob) => void
}

type EraserMode = "brush" | "box"

export function ReviewDeckModal({
  open,
  items,
  initialGenId,
  jobTitle,
  onClose,
  onTogglePeak,
  onDeleteGeneration,
  onJobSynced,
}: ReviewDeckModalProps) {
  const [currentIndex, setCurrentIndex] = React.useState(0)
  const [toolMode, setToolMode] = React.useState<EraserMode>("brush")
  const [brushSize, setBrushSize] = React.useState(34)
  const [autoSaveOnNext, setAutoSaveOnNext] = React.useState(true)

  // Stack of edited data URLs for the current frame (`[]` = original disk image)
  const [previewStack, setPreviewStack] = React.useState<string[]>([])
  const [processing, setProcessing] = React.useState(false)
  const [savingDisk, setSavingDisk] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [comparingOriginal, setComparingOriginal] = React.useState(false)
  const [statusNote, setStatusNote] = React.useState<string>("")

  const imgRef = React.useRef<HTMLImageElement | null>(null)
  const overlayCanvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const drawingRef = React.useRef(false)
  const hasStrokePixelsRef = React.useRef(false)
  const lastPtRef = React.useRef<{ x: number; y: number } | null>(null)
  const boxStartRef = React.useRef<{ x: number; y: number } | null>(null)
  const boxCurrRef = React.useRef<{ x: number; y: number } | null>(null)

  // Initialize index when modal opens
  React.useEffect(() => {
    if (!open || items.length === 0) return
    if (initialGenId !== null) {
      const idx = items.findIndex((g) => g.id === initialGenId)
      setCurrentIndex(idx >= 0 ? idx : 0)
    } else {
      setCurrentIndex(0)
    }
    setPreviewStack([])
    setStatusNote("")
    setComparingOriginal(false)
  }, [open, initialGenId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clamp index if items shrink after deletion
  React.useEffect(() => {
    if (items.length === 0 && open) {
      onClose()
      return
    }
    if (currentIndex >= items.length && items.length > 0) {
      setCurrentIndex(items.length - 1)
    }
  }, [items.length, currentIndex, open, onClose])

  const currentGen = items[currentIndex] || null

  // Reset edit stack when switching to a different generation
  const currentGenId = currentGen?.id ?? null
  React.useEffect(() => {
    setPreviewStack([])
    setComparingOriginal(false)
    clearOverlayCanvas()
  }, [currentGenId])

  // Preload adjacent full-size images (-1, +1, +2) for instant 0ms navigation
  React.useEffect(() => {
    if (!open || items.length === 0) return
    const neighbors = [currentIndex - 1, currentIndex + 1, currentIndex + 2]
    for (const ni of neighbors) {
      if (ni >= 0 && ni < items.length) {
        const g = items[ni]
        if (g?.image_file) {
          const pre = new Image()
          pre.src = getGenerationImageUrl(g.id, g.md5 || g.updated_at)
        }
      }
    }
  }, [open, currentIndex, items])

  const syncCanvasGeometry = React.useCallback(() => {
    const imgEl = imgRef.current
    const cvs = overlayCanvasRef.current
    if (!imgEl || !cvs) return
    const rect = imgEl.getBoundingClientRect()
    const w = Math.max(1, Math.round(rect.width))
    const h = Math.max(1, Math.round(rect.height))
    if (cvs.width !== w || cvs.height !== h) {
      cvs.width = w
      cvs.height = h
    }
  }, [])

  React.useEffect(() => {
    if (!open) return
    const handleResize = () => syncCanvasGeometry()
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [open, syncCanvasGeometry])

  function clearOverlayCanvas() {
    const cvs = overlayCanvasRef.current
    if (!cvs) return
    const ctx = cvs.getContext("2d")
    if (ctx) ctx.clearRect(0, 0, cvs.width, cvs.height)
    hasStrokePixelsRef.current = false
    lastPtRef.current = null
    boxStartRef.current = null
    boxCurrRef.current = null
  }

  const originalUrl = currentGen
    ? getGenerationImageUrl(currentGen.id, currentGen.md5 || currentGen.updated_at)
    : ""
  const latestPreview =
    previewStack.length > 0 ? previewStack[previewStack.length - 1] : null
  const displayedSrc =
    comparingOriginal || !latestPreview ? originalUrl : latestPreview
  const hasUnsavedEdits = previewStack.length > 0

  const getLocalCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cvs = overlayCanvasRef.current
    if (!cvs) return { x: 0, y: 0 }
    const rect = cvs.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(cvs.width, e.clientX - rect.left)),
      y: Math.max(0, Math.min(cvs.height, e.clientY - rect.top)),
    }
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!currentGen || processing || savingDisk || comparingOriginal) return
    syncCanvasGeometry()
    const cvs = overlayCanvasRef.current
    if (!cvs) return
    cvs.setPointerCapture(e.pointerId)
    drawingRef.current = true
    const pt = getLocalCoords(e)

    if (toolMode === "brush") {
      hasStrokePixelsRef.current = true
      lastPtRef.current = pt
      const ctx = cvs.getContext("2d")
      if (ctx) {
        ctx.fillStyle = "rgba(250, 250, 250, 0.78)"
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, brushSize / 2, 0, Math.PI * 2)
        ctx.fill()
      }
    } else {
      boxStartRef.current = pt
      boxCurrRef.current = pt
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    const cvs = overlayCanvasRef.current
    if (!cvs) return
    const ctx = cvs.getContext("2d")
    if (!ctx) return
    const pt = getLocalCoords(e)

    if (toolMode === "brush") {
      const prev = lastPtRef.current || pt
      ctx.strokeStyle = "rgba(250, 250, 250, 0.78)"
      ctx.lineWidth = brushSize
      ctx.lineCap = "round"
      ctx.lineJoin = "round"
      ctx.beginPath()
      ctx.moveTo(prev.x, prev.y)
      ctx.lineTo(pt.x, pt.y)
      ctx.stroke()
      lastPtRef.current = pt
      hasStrokePixelsRef.current = true
    } else if (boxStartRef.current) {
      boxCurrRef.current = pt
      const sx = Math.min(boxStartRef.current.x, pt.x)
      const sy = Math.min(boxStartRef.current.y, pt.y)
      const sw = Math.abs(pt.x - boxStartRef.current.x)
      const sh = Math.abs(pt.y - boxStartRef.current.y)
      ctx.clearRect(0, 0, cvs.width, cvs.height)
      ctx.fillStyle = "rgba(250, 250, 250, 0.24)"
      ctx.strokeStyle = "rgba(250, 250, 250, 0.95)"
      ctx.lineWidth = 1.5
      ctx.fillRect(sx, sy, sw, sh)
      ctx.strokeRect(sx, sy, sw, sh)
    }
  }

  const handlePointerUp = async (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || !currentGen) return
    drawingRef.current = false
    const cvs = overlayCanvasRef.current
    if (cvs) {
      try {
        cvs.releasePointerCapture(e.pointerId)
      } catch {
        // ignore
      }
    }

    if (toolMode === "brush") {
      if (!cvs || !hasStrokePixelsRef.current) {
        clearOverlayCanvas()
        return
      }
      // Build clean opaque white-on-transparent mask PNG for backend NumPy inpaint
      const maskDataUrl = cvs.toDataURL("image/png")
      clearOverlayCanvas()
      await runPreviewOperation({
        operation: "inpaint",
        mask_base64: maskDataUrl,
      })
    } else {
      const start = boxStartRef.current
      const end = boxCurrRef.current
      const w = cvs?.width || 1
      const h = cvs?.height || 1
      clearOverlayCanvas()
      if (!start || !end) return
      const rx = Math.min(start.x, end.x) / w
      const ry = Math.min(start.y, end.y) / h
      const rw = Math.abs(end.x - start.x) / w
      const rh = Math.abs(end.y - start.y) / h
      if (rw < 0.006 || rh < 0.006) return
      await runPreviewOperation({
        operation: "inpaint",
        boxes: [{ x: rx, y: ry, w: rw, h: rh }],
      })
    }
  }

  const runPreviewOperation = async (payload: {
    operation: "inpaint" | "force_star" | "trim"
    mask_base64?: string
    boxes?: Array<{ x: number; y: number; w: number; h: number }>
    trim_percent?: number
    trim_anchor?: "bottom_right" | "center"
  }) => {
    if (!currentGen || processing) return
    setProcessing(true)
    setStatusNote("")
    try {
      const res = await editGenerationImage(currentGen.id, {
        ...payload,
        source_base64: latestPreview || undefined,
        save_to_disk: false,
      })
      if (res.preview_data_url) {
        setPreviewStack((prev) => [...prev, res.preview_data_url!])
        setStatusNote("Cleaned preview ready — press Enter or → to overwrite in folder")
      }
    } catch (err) {
      setStatusNote(err instanceof Error ? err.message : "Could not process edit")
    } finally {
      setProcessing(false)
    }
  }

  const commitEditsToDisk = async (): Promise<boolean> => {
    if (!currentGen || !latestPreview || savingDisk) return true
    setSavingDisk(true)
    try {
      const res = await editGenerationImage(currentGen.id, {
        operation: "commit_base64",
        source_base64: latestPreview,
        save_to_disk: true,
      })
      if (res.job && onJobSynced) {
        onJobSynced(res.job)
      }
      setPreviewStack([])
      setStatusNote(`Replaced ${currentGen.image_file} in export folder`)
      return true
    } catch (err) {
      setStatusNote(err instanceof Error ? err.message : "Failed to save to folder")
      return false
    } finally {
      setSavingDisk(false)
    }
  }

  const handleAdvance = async (delta: number) => {
    if (processing || savingDisk || deleting) return
    if (hasUnsavedEdits && autoSaveOnNext) {
      const ok = await commitEditsToDisk()
      if (!ok) return
    }
    const nextIdx = currentIndex + delta
    if (nextIdx >= 0 && nextIdx < items.length) {
      setCurrentIndex(nextIdx)
      setStatusNote("")
    } else if (delta > 0 && nextIdx >= items.length) {
      setStatusNote("Reached last image in set")
    }
  }

  const handleSaveAndNext = async () => {
    const ok = await commitEditsToDisk()
    if (!ok) return
    if (currentIndex + 1 < items.length) {
      setCurrentIndex(currentIndex + 1)
    }
  }

  const handleRejectDelete = async () => {
    if (!currentGen || deleting || processing || savingDisk) return
    setDeleting(true)
    try {
      await onDeleteGeneration(currentGen.id)
      setPreviewStack([])
      setStatusNote("Deleted & re-sequenced folder + pin-import.csv")
    } finally {
      setDeleting(false)
    }
  }

  const handleUndo = () => {
    setPreviewStack((prev) => prev.slice(0, -1))
    setStatusNote("")
  }

  // Keyboard shortcuts for rapid one-hand dating-app style review
  React.useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase()
      if (tag === "input" || tag === "textarea" || tag === "select") return

      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault()
        handleUndo()
        return
      }
      if (e.key === "ArrowRight" || e.key.toLowerCase() === "d") {
        e.preventDefault()
        void handleAdvance(1)
        return
      }
      if (e.key === "ArrowLeft" || e.key.toLowerCase() === "a") {
        e.preventDefault()
        void handleAdvance(-1)
        return
      }
      if (e.key === "Enter" && hasUnsavedEdits) {
        e.preventDefault()
        void handleSaveAndNext()
        return
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault()
        void handleRejectDelete()
        return
      }
      if (e.key.toLowerCase() === "s" && currentGen) {
        e.preventDefault()
        void onTogglePeak(currentGen)
        return
      }
      if (e.key.toLowerCase() === "w") {
        e.preventDefault()
        void runPreviewOperation({ operation: "force_star" })
        return
      }
      if (e.key.toLowerCase() === "b") {
        e.preventDefault()
        setToolMode((m) => (m === "brush" ? "box" : "brush"))
        return
      }
      if (e.key.toLowerCase() === "c" && hasUnsavedEdits) {
        setComparingOriginal(true)
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "c") {
        setComparingOriginal(false)
      }
    }

    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
    }
  })

  if (!open || !currentGen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Full-size Review Deck"
      className="fixed inset-0 z-50 flex flex-col bg-[#0D0D0D] text-[#F5F5F5] select-none"
    >
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#262626] bg-[#171717] px-4 py-2.5">
        <div className="flex items-center gap-3 min-w-0">
          <span className="rounded bg-[#262626] px-2 py-0.5 font-mono-tech text-xs font-semibold text-[#FAFAFA]">
            {currentIndex + 1} / {items.length}
          </span>
          <span className="truncate text-sm font-medium text-[#F5F5F5]">
            {currentGen.image_file || jobTitle}
          </span>
          <span className="hidden sm:inline font-mono-tech text-xs text-[#737373]">
            {currentGen.width}×{currentGen.height}
          </span>
          {hasUnsavedEdits && (
            <span className="rounded border border-[#525252] bg-[#262626] px-2 py-0.5 text-[11px] font-medium text-[#FAFAFA]">
              Edited ({previewStack.length})
            </span>
          )}
          {statusNote && (
            <span className="hidden lg:inline truncate text-xs text-[#A3A3A3]">
              {statusNote}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          <label className="hidden md:inline-flex items-center gap-2 text-xs text-[#A3A3A3] cursor-pointer">
            <Switch
              checked={autoSaveOnNext}
              onCheckedChange={setAutoSaveOnNext}
            />
            <span>Auto-save on Next</span>
          </label>

          <button
            type="button"
            onClick={() => onTogglePeak(currentGen)}
            title="Toggle Peak of Picassy (Shortcut: S)"
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold transition-colors cursor-pointer",
              currentGen.is_peak
                ? "border-[#FAFAFA] bg-[#FAFAFA] text-[#121212]"
                : "border-[#2E2E2E] bg-[#262626] text-[#D4D4D4] hover:border-[#525252]"
            )}
          >
            <Star size={13} weight={currentGen.is_peak ? "fill" : "regular"} />
            Peak (S)
          </button>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-[#2E2E2E] bg-[#262626] px-2.5 text-xs font-medium text-[#D4D4D4] hover:bg-[#303030] hover:text-[#FAFAFA] cursor-pointer"
            title="Close Review Deck (Esc)"
          >
            <X size={14} />
            Close
          </button>
        </div>
      </div>

      {/* Center Full-Size Stage */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden px-12 py-3">
        {/* Previous Button */}
        <button
          type="button"
          disabled={currentIndex <= 0 || processing || savingDisk}
          onClick={() => handleAdvance(-1)}
          title="Previous image (← or A)"
          className="absolute left-3 z-20 flex size-10 items-center justify-center rounded-full border border-[#2E2E2E] bg-[#171717]/90 text-[#F5F5F5] hover:border-[#525252] hover:bg-[#262626] disabled:opacity-30 cursor-pointer"
        >
          <ArrowLeft size={18} />
        </button>

        {/* Artwork + Interactive Eraser Canvas */}
        <div className="relative inline-flex max-h-full max-w-full items-center justify-center">
          <img
            ref={imgRef}
            src={displayedSrc}
            alt={currentGen.title || currentGen.image_file}
            onLoad={syncCanvasGeometry}
            draggable={false}
            className="max-h-[calc(100vh-148px)] max-w-[calc(100vw-120px)] rounded border border-[#262626] bg-[#121212] object-contain shadow-2xl"
          />

          <canvas
            ref={overlayCanvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className={cn(
              "absolute inset-0 touch-none",
              processing || savingDisk
                ? "cursor-wait"
                : toolMode === "brush"
                  ? "cursor-crosshair"
                  : "cursor-cell"
            )}
            title="Paint or drag a box directly over any remaining logo/watermark to erase it"
          />

          {(processing || savingDisk) && (
            <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md border border-[#383838] bg-[#171717]/95 px-3 py-1.5 text-xs font-medium text-[#FAFAFA]">
              {savingDisk ? "Overwriting file in export folder…" : "Erasing logo…"}
            </div>
          )}

          {comparingOriginal && (
            <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded bg-[#171717]/95 border border-[#404040] px-2.5 py-1 text-[11px] font-semibold text-[#FAFAFA]">
              Original before edit
            </div>
          )}
        </div>

        {/* Next Button */}
        <button
          type="button"
          disabled={currentIndex >= items.length - 1 || processing || savingDisk}
          onClick={() => handleAdvance(1)}
          title="Keep & Next image (→ or D)"
          className="absolute right-3 z-20 flex size-10 items-center justify-center rounded-full border border-[#2E2E2E] bg-[#171717]/90 text-[#F5F5F5] hover:border-[#525252] hover:bg-[#262626] disabled:opacity-30 cursor-pointer"
        >
          <ArrowRight size={18} />
        </button>
      </div>

      {/* Bottom Action & Logo Eraser Dock */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#262626] bg-[#171717] px-4 py-2.5">
        {/* Left: Reject / Delete */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={deleting || processing || savingDisk}
            onClick={handleRejectDelete}
            title="Delete bad image, re-sequence folder & sync CSV (Backspace / Delete)"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#EF4444]/35 bg-[#1C1C1C] px-3 text-xs font-medium text-[#FCA5A5] hover:bg-[#EF4444]/15 disabled:opacity-40 cursor-pointer"
          >
            <Trash size={14} />
            Reject (Del)
          </button>
        </div>

        {/* Center: Instant Logo Eraser & Trim Tools */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-md border border-[#2E2E2E] bg-[#121212] p-0.5">
            <button
              type="button"
              onClick={() => setToolMode("brush")}
              title="Paint directly over any logo to erase (Shortcut: B)"
              className={cn(
                "inline-flex h-7.5 items-center gap-1.5 rounded px-2.5 text-xs font-medium cursor-pointer",
                toolMode === "brush"
                  ? "bg-[#FAFAFA] text-[#121212] font-semibold"
                  : "text-[#A3A3A3] hover:text-[#F5F5F5]"
              )}
            >
              <Eraser size={13} />
              Brush erase
            </button>
            <button
              type="button"
              onClick={() => setToolMode("box")}
              title="Drag a rectangle over any logo/text to erase (Shortcut: B)"
              className={cn(
                "inline-flex h-7.5 items-center gap-1.5 rounded px-2.5 text-xs font-medium cursor-pointer",
                toolMode === "box"
                  ? "bg-[#FAFAFA] text-[#121212] font-semibold"
                  : "text-[#A3A3A3] hover:text-[#F5F5F5]"
              )}
            >
              <BoundingBox size={13} />
              Box erase
            </button>
          </div>

          {toolMode === "brush" && (
            <div className="hidden sm:flex items-center gap-2 rounded-md border border-[#2E2E2E] bg-[#1C1C1C] px-2.5 h-8.5">
              <span className="text-[11px] text-[#A3A3A3]">Size</span>
              <input
                type="range"
                min={14}
                max={84}
                value={brushSize}
                onChange={(e) => setBrushSize(Number(e.target.value))}
                className="w-20 accent-[#FAFAFA] cursor-pointer"
              />
              <span className="w-6 font-mono-tech text-[11px] text-[#D4D4D4]">
                {brushSize}
              </span>
            </div>
          )}

          <button
            type="button"
            disabled={processing || savingDisk}
            onClick={() => runPreviewOperation({ operation: "force_star" })}
            title="Force-clean faint Gemini bottom-right star watermark (Shortcut: W)"
            className="inline-flex h-8.5 items-center gap-1.5 rounded-md border border-[#383838] bg-[#262626] px-2.5 text-xs font-medium text-[#F5F5F5] hover:border-[#525252] hover:bg-[#303030] disabled:opacity-40 cursor-pointer"
          >
            <Sparkle size={13} />
            Force Star (W)
          </button>

          <button
            type="button"
            disabled={processing || savingDisk}
            onClick={() =>
              runPreviewOperation({
                operation: "trim",
                trim_percent: 3.0,
                trim_anchor: "bottom_right",
              })
            }
            title="Shave 3% off bottom-right edges while locking exact aspect ratio"
            className="inline-flex h-8.5 items-center gap-1.5 rounded-md border border-[#2E2E2E] bg-[#262626] px-2.5 text-xs font-medium text-[#D4D4D4] hover:border-[#525252] hover:text-[#FAFAFA] disabled:opacity-40 cursor-pointer"
          >
            <Crop size={13} />
            Trim corner 3%
          </button>

          {hasUnsavedEdits && (
            <>
              <button
                type="button"
                onPointerDown={() => setComparingOriginal(true)}
                onPointerUp={() => setComparingOriginal(false)}
                onPointerLeave={() => setComparingOriginal(false)}
                title="Hold to compare with original image (Shortcut: hold C)"
                className="inline-flex h-8.5 items-center gap-1 rounded-md border border-[#2E2E2E] bg-[#1C1C1C] px-2.5 text-xs text-[#A3A3A3] hover:text-[#FAFAFA] cursor-pointer"
              >
                <Eye size={13} />
                Hold compare (C)
              </button>

              <button
                type="button"
                onClick={handleUndo}
                disabled={processing || savingDisk}
                title="Undo last edit (Cmd/Ctrl+Z)"
                className="inline-flex h-8.5 items-center gap-1 rounded-md border border-[#2E2E2E] bg-[#1C1C1C] px-2.5 text-xs text-[#D4D4D4] hover:text-[#FAFAFA] cursor-pointer"
              >
                <ArrowCounterClockwise size={13} />
                Undo
              </button>
            </>
          )}
        </div>

        {/* Right: Save & Keep / Next */}
        <div className="flex items-center gap-2">
          {hasUnsavedEdits ? (
            <button
              type="button"
              disabled={processing || savingDisk}
              onClick={handleSaveAndNext}
              title="Overwrite file directly in output folder and advance to next image (Enter)"
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#FAFAFA] px-4 text-xs font-semibold text-[#121212] hover:bg-[#E5E5E5] disabled:opacity-50 cursor-pointer"
            >
              <FloppyDisk size={14} weight="bold" />
              Save to folder &amp; Next (↵)
            </button>
          ) : (
            <button
              type="button"
              disabled={currentIndex >= items.length - 1 || processing}
              onClick={() => handleAdvance(1)}
              title="Keep image & move to next (→ or D)"
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#FAFAFA] px-4 text-xs font-semibold text-[#121212] hover:bg-[#E5E5E5] disabled:opacity-40 cursor-pointer"
            >
              <Check size={14} weight="bold" />
              Keep &amp; Next (→)
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
