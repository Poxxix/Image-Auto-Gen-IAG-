import * as React from "react"
import {
  TerminalWindow,
  FloppyDisk,
  FolderOpen,
  Key,
  Trash,
  ShieldCheck,
} from "@phosphor-icons/react"
import { StudioPanel, StudioButton, StudioBadge } from "@/components/shared/StudioPrimitives"
import { BrandIcon } from "@/components/shared/BrandIcon"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import type {
  CdpStatus,
  ProviderModel,
  StudioSettings,
} from "@/services/studioApi"

export interface SettingsPanelProps {
  settings: StudioSettings | null
  providers: ProviderModel[]
  cdp: CdpStatus | null
  aspectRatios: string[]
  metadataLanguages: string[]
  onSaveSettings: (updates: Partial<StudioSettings>) => Promise<void>
  onPickExportFolder: () => Promise<string | null>
  onLaunchCdp: (engine?: string) => Promise<void>
  onResetWorkspace: (opts: {
    clear_references: boolean
    delete_exports: boolean
  }) => Promise<void>
}

export function SettingsPanel({
  settings,
  providers,
  cdp,
  aspectRatios,
  metadataLanguages,
  onSaveSettings,
  onPickExportFolder,
  onLaunchCdp,
  onResetWorkspace,
}: SettingsPanelProps) {
  const [form, setForm] = React.useState<StudioSettings>({
    default_model: settings?.default_model || "chrome-cdp/gemini",
    default_target_count: settings?.default_target_count || 6,
    default_batch_size: settings?.default_batch_size || 4,
    default_session_cap: settings?.default_session_cap || 20,
    default_aspect_ratio: settings?.default_aspect_ratio || "1:1",
    default_metadata_language: settings?.default_metadata_language || "English",
    default_metadata_export_mode:
      settings?.default_metadata_export_mode || "json",
    default_caption_prompt: settings?.default_caption_prompt || "",
    use_ai_caption_prompt: settings?.use_ai_caption_prompt ?? true,
    optimize_prompt_english: settings?.optimize_prompt_english ?? true,
    remove_watermark: settings?.remove_watermark ?? true,
    fresh_chat_per_turn: settings?.fresh_chat_per_turn ?? true,
    max_turn_retries: settings?.max_turn_retries ?? 2,
    reference_similarity_check: settings?.reference_similarity_check ?? true,
    drop_ref_on_similarity_retry: settings?.drop_ref_on_similarity_retry ?? true,
    export_root_dir: settings?.export_root_dir || "",
    export_image_format: settings?.export_image_format || "original",
    max_concurrency: settings?.max_concurrency || 1,
    dhash_warning_threshold: settings?.dhash_warning_threshold || 6,
    gemini_api_key: settings?.gemini_api_key || "",
    openai_api_key: settings?.openai_api_key || "",
    pinterest_access_token: settings?.pinterest_access_token || "",
  })

  const [saving, setSaving] = React.useState(false)
  const [launching, setLaunching] = React.useState(false)
  const [clearRefs, setClearRefs] = React.useState(false)
  const [deleteExports, setDeleteExports] = React.useState(false)
  const [resetting, setResetting] = React.useState(false)

  React.useEffect(() => {
    if (settings) {
      setForm((prev) => ({
        ...prev,
        ...settings,
      }))
    }
  }, [settings])

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSaveSettings(form)
    } finally {
      setSaving(false)
    }
  }

  const handleLaunch = async (engine = "gemini") => {
    setLaunching(true)
    try {
      await onLaunchCdp(engine)
    } finally {
      setLaunching(false)
    }
  }

  const handleReset = async () => {
    setResetting(true)
    try {
      await onResetWorkspace({
        clear_references: clearRefs,
        delete_exports: deleteExports,
      })
    } finally {
      setResetting(false)
    }
  }

  const isCdpOnline = Boolean(cdp?.connected || cdp?.online)

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex flex-col justify-between gap-6 border-b border-white/[0.06] pb-8 lg:flex-row lg:items-end">
        <div>
          <p className="font-mono-tech text-[11px] uppercase tracking-[0.22em] text-[#9ca3af]">
            05 · STUDIO CONFIGURATION
          </p>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-semibold tracking-tight text-[#f4f5f7]">
            Providers, Exports & Limits.
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-[#9ca3af]">
            Configure your AI generation providers, default export folder, output image format, and session safety caps. API keys are never written to manifest.json or logs.
          </p>
        </div>

        <StudioButton
          variant="primary"
          loading={saving}
          onClick={handleSave}
          icon={<FloppyDisk size={16} weight="light" />}
        >
          {saving ? "Saving…" : "Save Studio Settings"}
        </StudioButton>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left 7 Columns: AI Providers & Credentials */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          <StudioPanel
            eyebrow="BROWSER CDP BRIDGE (:9222)"
            title="Local AI Browser Session"
          >
            <div className="flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/[0.08]">
                <div className="flex items-center gap-3.5">
                  <span className="flex size-11 items-center justify-center rounded-2xl bg-white/[0.06] text-white ring-1 ring-white/[0.12]">
                    <BrandIcon name="gemini" size={22} />
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-white">
                        Chrome AI Master (:9222)
                      </p>
                      <StudioBadge
                        tone={isCdpOnline ? "emerald" : "amber"}
                        label={isCdpOnline ? "Connected" : "Standby"}
                      />
                    </div>
                    <p className="mt-0.5 text-xs text-[#9ca3af]">
                      {isCdpOnline
                        ? `${cdp?.browser || "Chrome"} · Open tabs: ${(cdp?.open_engines || []).join(", ") || "ready"}`
                        : "Launch Chrome (:9222) and sign into Gemini, ChatGPT, or Grok."}
                    </p>
                  </div>
                </div>

                <StudioButton
                  variant="secondary"
                  loading={launching}
                  onClick={() => handleLaunch("gemini")}
                  icon={<TerminalWindow size={15} weight="light" />}
                >
                  {launching ? "Launching…" : "Launch Browser (:9222)"}
                </StudioButton>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">
                    Default Model Provider
                  </label>
                  <Select
                    value={form.default_model}
                    onValueChange={(v) => v && setForm((f) => ({ ...f, default_model: v }))}
                  >
                    <SelectTrigger className="h-11 rounded-2xl bg-white/[0.04] px-4 text-xs text-white ring-1 ring-white/[0.08]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {providers.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">
                    Default Metadata Language
                  </label>
                  <Select
                    value={form.default_metadata_language}
                    onValueChange={(v) =>
                      v && setForm((f) => ({ ...f, default_metadata_language: v }))
                    }
                  >
                    <SelectTrigger className="h-11 rounded-2xl bg-white/[0.04] px-4 text-xs text-white ring-1 ring-white/[0.08]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {metadataLanguages.map((lang) => (
                        <SelectItem key={lang} value={lang}>
                          {lang}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Default Post-Image Caption & Export Mode */}
              <div className="rounded-2xl bg-white/[0.025] p-4 ring-1 ring-white/[0.08] flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium text-white">
                      Default Post-Image Export Mode
                    </p>
                    <p className="text-[11px] text-[#9ca3af]">
                      Choose default output after each generated image (JSON, Pinterest Caption .txt, or Image Only).
                    </p>
                  </div>
                  <Select
                    value={form.default_metadata_export_mode || "json"}
                    onValueChange={(v) =>
                      v &&
                      setForm((f) => ({
                        ...f,
                        default_metadata_export_mode:
                          v as StudioSettings["default_metadata_export_mode"],
                      }))
                    }
                  >
                    <SelectTrigger className="h-10 w-52 rounded-xl bg-white/[0.04] px-3 text-xs text-white ring-1 ring-white/[0.08]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="json">Xuất JSON (.json)</SelectItem>
                      <SelectItem value="caption">Xuất Caption (.txt Pin)</SelectItem>
                      <SelectItem value="none">Không xuất (Chỉ ảnh)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-medium uppercase tracking-wider text-amber-200/90">
                    Default Post-Image Caption Prompt
                  </label>
                  <textarea
                    rows={2}
                    value={form.default_caption_prompt || ""}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        default_caption_prompt: e.target.value,
                      }))
                    }
                    className="w-full rounded-xl bg-white/[0.03] p-3 text-xs text-white ring-1 ring-white/[0.08]"
                  />
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-[#9ca3af]">
                    Send follow-up prompt in AI Browser (:9222) after each image by default
                  </span>
                  <Switch
                    checked={form.use_ai_caption_prompt ?? true}
                    onCheckedChange={(checked) =>
                      setForm((f) => ({ ...f, use_ai_caption_prompt: checked }))
                    }
                  />
                </div>
              </div>
            </div>
          </StudioPanel>

          <StudioPanel
            eyebrow="OFFICIAL API KEYS (OPTIONAL)"
            title="Direct API & Authorized Integrations"
          >
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-200 ring-1 ring-emerald-400/25">
                <ShieldCheck size={16} weight="fill" />
                <span>
                  Keys are stored locally in SQLite and are never exported into manifest.json, sidecar JSON, or logs.
                </span>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-1.5 text-xs font-medium text-[#d1d5db]">
                  <Key size={14} weight="light" />
                  Google Gemini / Imagen API Key
                </label>
                <input
                  type="password"
                  value={form.gemini_api_key}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, gemini_api_key: e.target.value }))
                  }
                  placeholder="AIzaSy... (Enables Imagen 3 API & fast Gemini Vision metadata)"
                  className="h-11 w-full rounded-2xl bg-white/[0.03] px-4 font-mono-tech text-xs text-white placeholder:text-[#646b78] ring-1 ring-white/[0.08]"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-1.5 text-xs font-medium text-[#d1d5db]">
                  <Key size={14} weight="light" />
                  OpenAI API Key
                </label>
                <input
                  type="password"
                  value={form.openai_api_key}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, openai_api_key: e.target.value }))
                  }
                  placeholder="sk-... (Enables OpenAI GPT-Image-1 official API)"
                  className="h-11 w-full rounded-2xl bg-white/[0.03] px-4 font-mono-tech text-xs text-white placeholder:text-[#646b78] ring-1 ring-white/[0.08]"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-1.5 text-xs font-medium text-[#d1d5db]">
                  <Key size={14} weight="light" />
                  Pinterest API v5 Access Token (Optional)
                </label>
                <input
                  type="password"
                  value={form.pinterest_access_token}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      pinterest_access_token: e.target.value,
                    }))
                  }
                  placeholder="pina_... (Optional official Pinterest v5 API token)"
                  className="h-11 w-full rounded-2xl bg-white/[0.03] px-4 font-mono-tech text-xs text-white placeholder:text-[#646b78] ring-1 ring-white/[0.08]"
                />
              </div>
            </div>
          </StudioPanel>
        </div>

        {/* Right 5 Columns: Export Format, Limits & Workspace Reset */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          <StudioPanel
            eyebrow="EXPORT & FILE SYSTEM"
            title="Output Directory & Format"
          >
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">
                  Default Export Root Directory
                </label>
                <div className="flex items-center gap-2">
                  <div className="relative flex flex-1 items-center">
                    <FolderOpen
                      size={15}
                      weight="light"
                      className="pointer-events-none absolute left-3.5 text-[#9ca3af]"
                    />
                    <input
                      type="text"
                      value={form.export_root_dir}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, export_root_dir: e.target.value }))
                      }
                      className="h-11 w-full rounded-2xl bg-white/[0.03] pl-10 pr-4 font-mono-tech text-xs text-white ring-1 ring-white/[0.08]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const chosen = await onPickExportFolder()
                      if (chosen) {
                        setForm((f) => ({ ...f, export_root_dir: chosen }))
                      }
                    }}
                    className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-2xl bg-white/[0.06] px-3.5 text-xs font-medium text-[#f4f5f7] ring-1 ring-white/[0.1] hover:bg-white/[0.12] cursor-pointer"
                    title="Choose folder in macOS Finder"
                  >
                    <FolderOpen size={15} weight="light" />
                    Browse…
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">
                    Export Image Format
                  </label>
                  <Select
                    value={form.export_image_format}
                    onValueChange={(v) =>
                      v &&
                      setForm((f) => ({
                        ...f,
                        export_image_format: v as StudioSettings["export_image_format"],
                      }))
                    }
                  >
                    <SelectTrigger className="h-11 rounded-2xl bg-white/[0.04] px-4 text-xs text-white ring-1 ring-white/[0.08]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="original">
                        Original (Preserve Provenance)
                      </SelectItem>
                      <SelectItem value="png">PNG (.png)</SelectItem>
                      <SelectItem value="jpg">JPEG (.jpg)</SelectItem>
                      <SelectItem value="webp">WebP (.webp)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">
                    Default Aspect Ratio
                  </label>
                  <Select
                    value={form.default_aspect_ratio}
                    onValueChange={(v) =>
                      v && setForm((f) => ({ ...f, default_aspect_ratio: v }))
                    }
                  >
                    <SelectTrigger className="h-11 rounded-2xl bg-white/[0.04] px-4 text-xs text-white ring-1 ring-white/[0.08]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {aspectRatios.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 pt-1">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-mono-tech uppercase text-[#9ca3af]">
                    Default Set Size
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={form.default_target_count}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        default_target_count: Math.max(1, Math.min(1000, Number(e.target.value) || 6)),
                      }))
                    }
                    className="h-10 rounded-xl bg-white/[0.03] px-3 text-center font-mono-tech text-xs text-white ring-1 ring-white/[0.08]"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-mono-tech uppercase text-[#9ca3af]">
                    Wave Batch
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={form.default_batch_size}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        default_batch_size: Math.max(1, Math.min(50, Number(e.target.value) || 4)),
                      }))
                    }
                    className="h-10 rounded-xl bg-white/[0.03] px-3 text-center font-mono-tech text-xs text-white ring-1 ring-white/[0.08]"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-mono-tech uppercase text-[#9ca3af]">
                    Session Cap
                  </label>
                  <input
                    type="number"
                    min={2}
                    max={1000}
                    value={form.default_session_cap}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        default_session_cap: Math.max(2, Math.min(1000, Number(e.target.value) || 20)),
                      }))
                    }
                    className="h-10 rounded-xl bg-white/[0.03] px-3 text-center font-mono-tech text-xs text-white ring-1 ring-white/[0.08]"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-white/[0.06] pt-3">
                <div>
                  <p className="text-xs font-medium text-white">
                    Auto-Remove Gemini Watermark
                  </p>
                  <p className="text-[11px] text-[#9ca3af]">
                    Lossless Reverse Alpha Blending + Subpixel/Isophote Polish after each image
                  </p>
                </div>
                <Switch
                  checked={form.remove_watermark ?? true}
                  onCheckedChange={(checked) =>
                    setForm((f) => ({ ...f, remove_watermark: checked }))
                  }
                />
              </div>

              <div className="flex items-center justify-between border-t border-white/[0.06] pt-3">
                <div>
                  <p className="text-xs font-medium text-white">
                    Open Fresh New Chat per Shot
                  </p>
                  <p className="text-[11px] text-[#9ca3af]">
                    Starts an isolated New Chat thread for each image so prior shots cannot bias layout
                  </p>
                </div>
                <Switch
                  checked={form.fresh_chat_per_turn ?? true}
                  onCheckedChange={(checked) =>
                    setForm((f) => ({ ...f, fresh_chat_per_turn: checked }))
                  }
                />
              </div>

              <div className="flex items-center justify-between border-t border-white/[0.06] pt-3">
                <div>
                  <p className="text-xs font-medium text-white">
                    Input Similarity Guard &amp; Auto Re-Roll
                  </p>
                  <p className="text-[11px] text-[#9ca3af]">
                    Rejects images too close to reference input, rotates axes, and drops raw ref on final retry
                  </p>
                </div>
                <Switch
                  checked={form.reference_similarity_check ?? true}
                  onCheckedChange={(checked) =>
                    setForm((f) => ({
                      ...f,
                      reference_similarity_check: checked,
                      drop_ref_on_similarity_retry: checked,
                    }))
                  }
                />
              </div>

              <div className="flex items-center justify-between border-t border-white/[0.06] pt-3">
                <span className="text-xs text-[#9ca3af]">
                  Max Auto-Retries per Shot (on stall, network drop, or clone rejection)
                </span>
                <input
                  type="number"
                  min={0}
                  max={4}
                  value={form.max_turn_retries ?? 2}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      max_turn_retries: Math.max(0, Math.min(4, Number(e.target.value) || 0)),
                    }))
                  }
                  className="h-9 w-16 rounded-xl bg-white/[0.04] text-center font-mono-tech text-xs text-white ring-1 ring-white/[0.08]"
                />
              </div>

              <div className="flex items-center justify-between border-t border-white/[0.06] pt-3">
                <div>
                  <p className="text-xs font-medium text-white">
                    Recycle Chrome Browser Tab Interval (100–1000 Image Stability)
                  </p>
                  <p className="text-[11px] text-[#9ca3af]">
                    Automatically opens a clean fresh browser tab every N shots to keep memory flat across huge sets
                  </p>
                </div>
                <input
                  type="number"
                  min={5}
                  max={100}
                  value={form.cdp_recycle_tab_interval ?? 20}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      cdp_recycle_tab_interval: Math.max(5, Math.min(100, Number(e.target.value) || 20)),
                    }))
                  }
                  className="h-9 w-16 rounded-xl bg-white/[0.04] text-center font-mono-tech text-xs text-white ring-1 ring-white/[0.08]"
                />
              </div>

              <div className="flex items-center justify-between border-t border-white/[0.06] pt-3">
                <span className="text-xs text-[#9ca3af]">
                  dHash Near-Duplicate Warning Threshold (0–16 bits)
                </span>
                <input
                  type="number"
                  min={1}
                  max={16}
                  value={form.dhash_warning_threshold}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      dhash_warning_threshold: Number(e.target.value) || 6,
                    }))
                  }
                  className="h-9 w-16 rounded-xl bg-white/[0.04] text-center font-mono-tech text-xs text-white ring-1 ring-white/[0.08]"
                />
              </div>
            </div>
          </StudioPanel>

          <StudioPanel
            eyebrow="WORKSPACE MAINTENANCE"
            title="Reset Studio History"
          >
            <div className="flex flex-col gap-3 text-xs text-[#9ca3af]">
              <div className="flex items-center justify-between py-1">
                <span>Also delete uploaded reference images</span>
                <Switch checked={clearRefs} onCheckedChange={setClearRefs} />
              </div>
              <div className="flex items-center justify-between py-1">
                <span>Also delete exported folders inside ./exports/</span>
                <Switch
                  checked={deleteExports}
                  onCheckedChange={setDeleteExports}
                />
              </div>
              <div className="pt-2">
                <StudioButton
                  variant="danger"
                  loading={resetting}
                  onClick={handleReset}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Trash size={14} weight="light" />
                    Reset Studio Workspace
                  </span>
                </StudioButton>
              </div>
            </div>
          </StudioPanel>
        </div>
      </div>
    </div>
  )
}
