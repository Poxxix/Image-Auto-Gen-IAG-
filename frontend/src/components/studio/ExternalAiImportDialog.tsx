import * as React from "react"
import {
  Copy,
  Check,
  UploadSimple,
  Sparkle,
  FileCode,
  ArrowsClockwise,
} from "@phosphor-icons/react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { StudioButton } from "@/components/shared/StudioPrimitives"
import {
  fetchSampleMasterPrompt,
  importExternalAxes,
  type SuggestAxesResponse,
} from "@/services/studioApi"
import { cn } from "@/lib/utils"

export interface ExternalAiImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  theme: string
  basePrompt: string
  targetCount: number
  metadataLanguage: string
  onApplyImported: (
    data: SuggestAxesResponse,
    options: { applyMetaFields: boolean }
  ) => void
}

const TEMPLATE_KINDS = [
  { id: "adaptive", label: "Auto / Adaptive" },
  { id: "wallpaper", label: "Wallpaper / Screen" },
  { id: "painting", label: "Painting / Art" },
  { id: "front_facing", label: "Front-Facing / Hero" },
  { id: "photography", label: "Editorial Photo" },
]

export function ExternalAiImportDialog({
  open,
  onOpenChange,
  theme,
  basePrompt,
  targetCount,
  metadataLanguage,
  onApplyImported,
}: ExternalAiImportDialogProps) {
  const [templateKind, setTemplateKind] = React.useState<string>("adaptive")
  const [samplePrompt, setSamplePrompt] = React.useState<string>("")
  const [loadingPrompt, setLoadingPrompt] = React.useState(false)
  const [copiedPrompt, setCopiedPrompt] = React.useState(false)

  const [rawJsonInput, setRawJsonInput] = React.useState<string>("")
  const [importing, setImporting] = React.useState(false)
  const [importError, setImportError] = React.useState<string | null>(null)
  const [applyMetaFields, setApplyMetaFields] = React.useState(true)

  const fileInputRef = React.useRef<HTMLInputElement | null>(null)

  const loadSamplePrompt = React.useCallback(
    async (kind: string) => {
      setLoadingPrompt(true)
      try {
        const res = await fetchSampleMasterPrompt({
          theme,
          base_prompt: basePrompt,
          template_kind: kind,
          target_count: targetCount,
          metadata_language: metadataLanguage,
        })
        setSamplePrompt(res.prompt)
      } catch {
        setImportError("Could not build sample prompt from backend.")
      } finally {
        setLoadingPrompt(false)
      }
    },
    [theme, basePrompt, targetCount, metadataLanguage]
  )

  React.useEffect(() => {
    if (open) {
      setImportError(null)
      loadSamplePrompt(templateKind)
    }
  }, [open, templateKind, loadSamplePrompt])

  const handleCopyPrompt = () => {
    if (!samplePrompt) return
    navigator.clipboard.writeText(samplePrompt)
    setCopiedPrompt(true)
    setTimeout(() => setCopiedPrompt(false), 1800)
  }

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      setRawJsonInput(text)
      setImportError(null)
    } catch {
      setImportError("Could not read selected file.")
    } finally {
      e.target.value = ""
    }
  }

  const handleImportApply = async () => {
    if (!rawJsonInput.trim()) {
      setImportError("Paste the JSON reply from ChatGPT / Gemini / Claude / Grok or upload a .json file.")
      return
    }
    setImporting(true)
    setImportError(null)
    try {
      const parsed = await importExternalAxes(rawJsonInput)
      onApplyImported(parsed, { applyMetaFields })
      onOpenChange(false)
    } catch (err) {
      setImportError(
        err instanceof Error
          ? err.message
          : "Could not parse pasted text into Studio Continuity & Variation Axes."
      )
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl border-white/[0.1] bg-[#090b10] text-[#f4f5f7]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-xl text-white">
            <Sparkle size={18} weight="fill" className="text-amber-300" />
            External AI Prompt Builder &amp; JSON Import
          </DialogTitle>
          <DialogDescription className="text-xs text-[#9ca3af]">
            1) Copy the tailored Master Prompt below to ChatGPT, Gemini, Claude, or Grok to refine your exact visual concept &amp; framing rules. 2) Paste or upload the AI&apos;s JSON reply back here.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* Column 1: Copyable Master Prompt */}
          <div className="flex flex-col gap-3 rounded-2xl bg-white/[0.025] p-4 ring-1 ring-white/[0.08]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono-tech text-[11px] uppercase tracking-wider text-amber-300">
                Step 1 · Sample Prompt Template
              </span>
              <button
                type="button"
                onClick={handleCopyPrompt}
                disabled={!samplePrompt || loadingPrompt}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold transition-all cursor-pointer",
                  copiedPrompt
                    ? "bg-emerald-500 text-[#050505]"
                    : "bg-amber-400 text-[#050505] hover:bg-amber-300"
                )}
              >
                {copiedPrompt ? <Check size={12} weight="bold" /> : <Copy size={12} />}
                {copiedPrompt ? "Copied Prompt!" : "Copy Sample Prompt"}
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {TEMPLATE_KINDS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => setTemplateKind(k.id)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[10px] font-medium ring-1 transition-all cursor-pointer",
                    templateKind === k.id
                      ? "bg-[#f4f5f7] text-[#050505] ring-white font-semibold"
                      : "bg-white/[0.03] text-[#9ca3af] ring-white/[0.08] hover:text-white"
                  )}
                >
                  {k.label}
                </button>
              ))}
            </div>

            <div className="relative flex-1">
              <textarea
                readOnly
                rows={13}
                value={loadingPrompt ? "Generating tailored template prompt..." : samplePrompt}
                className="w-full rounded-xl bg-black/50 p-3 font-mono-tech text-[11px] leading-relaxed text-[#d1d5db] ring-1 ring-white/[0.08] focus:outline-none"
              />
              {loadingPrompt && (
                <ArrowsClockwise
                  size={15}
                  className="animate-spin absolute right-3 top-3 text-amber-300"
                />
              )}
            </div>
            <p className="text-[11px] text-[#646b78]">
              Tip: Paste into your favorite AI chat, describe extra requirements (e.g. &ldquo;strictly front-facing minimal jewelry cards, 150 variations&rdquo;), and ask for the JSON block back.
            </p>
          </div>

          {/* Column 2: Paste / Upload JSON back */}
          <div className="flex flex-col gap-3 rounded-2xl bg-white/[0.025] p-4 ring-1 ring-white/[0.08]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono-tech text-[11px] uppercase tracking-wider text-sky-300">
                Step 2 · Paste or Upload AI JSON
              </span>
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,.txt,.md,application/json,text/plain"
                  onChange={handleUploadFile}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1 text-[11px] text-[#e5e7eb] ring-1 ring-white/[0.1] hover:bg-white/[0.12] cursor-pointer"
                >
                  <UploadSimple size={12} />
                  Upload .json File
                </button>
              </div>
            </div>

            <textarea
              rows={13}
              value={rawJsonInput}
              onChange={(e) => {
                setRawJsonInput(e.target.value)
                if (importError) setImportError(null)
              }}
              placeholder={
                'Paste the JSON reply from ChatGPT / Gemini / Claude here (markdown ```json fences are automatically stripped)...\n\n{\n  "fixed_elements": { "subject": "...", "style": "..." },\n  "variation_axes": {\n    "enabled_axes": { "camera_angles": false, "compositions": true, "lighting": true, "atmospheres": true, "custom_axis": true },\n    "custom_axis_label": "Brushwork & Surface",\n    "compositions": [...],\n    "lighting": [...],\n    "atmospheres": [...],\n    "custom_axis": [...]\n  }\n}'
              }
              className="w-full rounded-xl bg-black/50 p-3 font-mono-tech text-[11px] leading-relaxed text-white placeholder:text-[#4b5563] ring-1 ring-white/[0.08] outline-none focus:ring-2 focus:ring-sky-400/50"
            />

            <div className="flex items-center justify-between rounded-xl bg-white/[0.02] px-3 py-2 ring-1 ring-white/[0.06]">
              <span className="text-[11px] text-[#9ca3af]">
                Also update Theme / Base Direction / Aspect Ratio if included
              </span>
              <Switch
                checked={applyMetaFields}
                onCheckedChange={setApplyMetaFields}
              />
            </div>

            {importError && (
              <div className="rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-300 ring-1 ring-rose-500/30">
                {importError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <StudioButton
                variant="secondary"
                className="h-9 px-3.5 text-xs"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </StudioButton>
              <StudioButton
                variant="primary"
                className="h-9 px-4 text-xs"
                loading={importing}
                disabled={!rawJsonInput.trim() || importing}
                onClick={handleImportApply}
                icon={<FileCode size={14} />}
              >
                Import &amp; Apply into Studio
              </StudioButton>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
