import * as React from "react"
import {
  Copy,
  Check,
  UploadSimple,
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
  { id: "adaptive", label: "Auto adaptive" },
  { id: "wallpaper", label: "Wallpaper" },
  { id: "painting", label: "Painting & art" },
  { id: "front_facing", label: "Front-facing" },
  { id: "photography", label: "Editorial photo" },
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
      setImportError(
        "Paste the JSON reply from ChatGPT, Gemini, Claude, or Grok, or upload a .json file."
      )
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
          : "Could not parse pasted text into continuity and variation axes."
      )
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Sample master prompt &amp; JSON import</DialogTitle>
          <DialogDescription>
            Copy the prompt on the left into ChatGPT, Claude, or Gemini to design custom framing and variation axes, then paste the returned JSON on the right.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Step 1: Copy Sample Prompt */}
          <div className="flex flex-col gap-3 rounded-lg border border-[#2E2E2E] bg-[#171717] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#F5F5F5]">
                1. Copy sample prompt
              </span>
              <button
                type="button"
                onClick={handleCopyPrompt}
                disabled={!samplePrompt || loadingPrompt}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-colors duration-150 cursor-pointer",
                  copiedPrompt
                    ? "border border-[#525252] bg-[#262626] text-[#F5F5F5]"
                    : "bg-[#FAFAFA] text-[#121212] hover:bg-[#E5E5E5]"
                )}
              >
                {copiedPrompt ? <Check size={12} weight="bold" /> : <Copy size={12} />}
                {copiedPrompt ? "Copied" : "Copy prompt"}
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {TEMPLATE_KINDS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => setTemplateKind(k.id)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors duration-150 cursor-pointer",
                    templateKind === k.id
                      ? "border-[#FAFAFA] bg-[#FAFAFA] text-[#121212] font-semibold"
                      : "border-[#2E2E2E] bg-[#1C1C1C] text-[#A3A3A3] hover:text-[#F5F5F5]"
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
                value={
                  loadingPrompt
                    ? "Generating tailored template prompt…"
                    : samplePrompt
                }
                className="w-full rounded-md border border-[#2E2E2E] bg-[#121212] p-3 font-mono-tech text-[11px] leading-relaxed text-[#A3A3A3] focus:outline-none"
              />
              {loadingPrompt && (
                <ArrowsClockwise
                  size={15}
                  className="animate-spin absolute right-3 top-3 text-[#A3A3A3]"
                />
              )}
            </div>
            <p className="text-[11px] text-[#737373]">
              Paste into any external chat model, describe extra constraints, and copy the JSON reply back.
            </p>
          </div>

          {/* Step 2: Paste or Upload JSON */}
          <div className="flex flex-col gap-3 rounded-lg border border-[#2E2E2E] bg-[#171717] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#F5F5F5]">
                2. Paste or upload JSON reply
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
                  className="inline-flex items-center gap-1.5 rounded-md border border-[#383838] bg-[#262626] px-2.5 py-1 text-xs text-[#F5F5F5] hover:border-[#525252] cursor-pointer"
                >
                  <UploadSimple size={12} />
                  Upload .json
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
                'Paste the JSON reply here (markdown ```json fences are stripped automatically)…\n\n{\n  "fixed_elements": { "subject": "...", "style": "..." },\n  "variation_axes": {\n    "enabled_axes": { "camera_angles": false, "compositions": true, "lighting": true, "atmospheres": true, "custom_axis": true },\n    "custom_axis_label": "Brushwork & Surface",\n    "compositions": [...],\n    "lighting": [...],\n    "atmospheres": [...],\n    "custom_axis": [...]\n  }\n}'
              }
              className="w-full rounded-md border border-[#2E2E2E] bg-[#121212] p-3 font-mono-tech text-[11px] leading-relaxed text-[#F5F5F5] placeholder:text-[#737373] outline-none focus:border-[#A3A3A3]"
            />

            <div className="flex items-center justify-between rounded-md border border-[#2E2E2E] bg-[#1C1C1C] px-3 py-2">
              <span className="text-xs text-[#A3A3A3]">
                Apply theme, base direction, and aspect ratio if included
              </span>
              <Switch
                checked={applyMetaFields}
                onCheckedChange={setApplyMetaFields}
              />
            </div>

            {importError && (
              <div className="rounded-md border border-[#EF4444]/35 bg-[#EF4444]/10 px-3 py-2 text-xs text-[#FCA5A5]">
                {importError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <StudioButton
                variant="secondary"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </StudioButton>
              <StudioButton
                variant="primary"
                loading={importing}
                disabled={!rawJsonInput.trim() || importing}
                onClick={handleImportApply}
                icon={<FileCode size={14} />}
              >
                Import &amp; apply
              </StudioButton>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
