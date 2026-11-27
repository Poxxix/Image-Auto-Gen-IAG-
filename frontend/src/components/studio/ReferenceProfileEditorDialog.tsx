import * as React from "react"
import { ArrowCounterClockwise, FloppyDisk } from "@phosphor-icons/react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { StudioButton } from "@/components/shared/StudioPrimitives"
import type {
  ReferenceModeProfile,
  ReferenceStrengthMode,
} from "@/services/studioApi"

export interface ReferenceProfileEditorDialogProps {
  open: boolean
  modeId: ReferenceStrengthMode | null
  activeProfile: ReferenceModeProfile | null
  factoryProfile: ReferenceModeProfile | null
  onClose: () => void
  onSaveModeOverride: (
    modeId: ReferenceStrengthMode,
    override: Partial<ReferenceModeProfile>
  ) => Promise<void>
  onResetModeToFactory: (modeId: ReferenceStrengthMode) => Promise<void>
}

const splitCleanLines = (val: string) =>
  val
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)

export function ReferenceProfileEditorDialog({
  open,
  modeId,
  activeProfile,
  factoryProfile,
  onClose,
  onSaveModeOverride,
  onResetModeToFactory,
}: ReferenceProfileEditorDialogProps) {
  const [label, setLabel] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [instructionTemplate, setInstructionTemplate] = React.useState("")
  const [customAxisLabel, setCustomAxisLabel] = React.useState("")
  const [customAxisText, setCustomAxisText] = React.useState("")
  const [compositionsText, setCompositionsText] = React.useState("")
  const [lightingText, setLightingText] = React.useState("")
  const [saving, setSaving] = React.useState(false)

  const hydrateFromProfile = React.useCallback(
    (prof: ReferenceModeProfile | null) => {
      if (!prof) return
      setLabel(prof.label || "")
      setDescription(prof.description || "")
      setInstructionTemplate(prof.instruction_template || "")
      setCustomAxisLabel(prof.custom_axis_label || "Custom Variation")
      setCustomAxisText((prof.custom_axis || []).join("\n"))
      setCompositionsText((prof.compositions || []).join("\n"))
      setLightingText((prof.lighting || []).join("\n"))
    },
    []
  )

  React.useEffect(() => {
    if (open && activeProfile) {
      hydrateFromProfile(activeProfile)
    }
  }, [open, activeProfile, hydrateFromProfile])

  if (!modeId || !activeProfile) return null

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSaveModeOverride(modeId, {
        label: label.trim() || activeProfile.label,
        description: description.trim() || activeProfile.description,
        instruction_template:
          instructionTemplate.trim() || activeProfile.instruction_template,
        custom_axis_label:
          customAxisLabel.trim() || activeProfile.custom_axis_label,
        custom_axis: splitCleanLines(customAxisText),
        compositions: splitCleanLines(compositionsText),
        lighting: splitCleanLines(lightingText),
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    setSaving(true)
    try {
      if (factoryProfile) {
        hydrateFromProfile(factoryProfile)
      }
      await onResetModeToFactory(modeId)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Customize reference mode: {activeProfile.label}
          </DialogTitle>
          <DialogDescription className="text-xs text-[#A3A3A3]">
            Edit the AI prompt rule and rotation axes for this reference mode. Click{" "}
            <strong className="text-[#F5F5F5]">Reset to default</strong> anytime to
            restore factory settings.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-3 flex flex-col gap-3.5 text-xs">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="font-medium text-[#A3A3A3]">Mode title</label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="h-9 rounded-md border border-[#2E2E2E] bg-[#262626] px-3 text-xs text-[#F5F5F5] outline-none focus:border-[#A3A3A3]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="font-medium text-[#A3A3A3]">
                5th rotation axis label
              </label>
              <input
                type="text"
                value={customAxisLabel}
                onChange={(e) => setCustomAxisLabel(e.target.value)}
                className="h-9 rounded-md border border-[#2E2E2E] bg-[#262626] px-3 text-xs text-[#F5F5F5] outline-none focus:border-[#A3A3A3]"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-medium text-[#A3A3A3]">
              Short note (shown on card)
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="h-9 rounded-md border border-[#2E2E2E] bg-[#262626] px-3 text-xs text-[#F5F5F5] outline-none focus:border-[#A3A3A3]"
            />
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <label className="font-semibold text-[#F5F5F5]">
                Core AI reference instruction (English)
              </label>
              <span className="font-mono-tech text-[10px] text-[#737373]">
                Placeholders: {"{theme}"} · {"{carrier_clause}"}
              </span>
            </div>
            <textarea
              rows={3}
              value={instructionTemplate}
              onChange={(e) => setInstructionTemplate(e.target.value)}
              className="rounded-md border border-[#383838] bg-[#121212] p-2.5 font-mono-tech text-[11px] leading-relaxed text-[#F5F5F5] outline-none focus:border-[#A3A3A3]"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-medium text-[#A3A3A3]">
              {customAxisLabel || "Primary"} rotation options (1 per line)
            </label>
            <textarea
              rows={4}
              value={customAxisText}
              onChange={(e) => setCustomAxisText(e.target.value)}
              className="rounded-md border border-[#2E2E2E] bg-[#121212] p-2.5 font-mono-tech text-[11px] text-[#F5F5F5] outline-none focus:border-[#A3A3A3]"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="font-medium text-[#A3A3A3]">
                Compositions pool (1 per line)
              </label>
              <textarea
                rows={4}
                value={compositionsText}
                onChange={(e) => setCompositionsText(e.target.value)}
                className="rounded-md border border-[#2E2E2E] bg-[#121212] p-2 font-mono-tech text-[11px] text-[#F5F5F5] outline-none focus:border-[#A3A3A3]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="font-medium text-[#A3A3A3]">
                Lighting / shading pool (1 per line)
              </label>
              <textarea
                rows={4}
                value={lightingText}
                onChange={(e) => setLightingText(e.target.value)}
                className="rounded-md border border-[#2E2E2E] bg-[#121212] p-2 font-mono-tech text-[11px] text-[#F5F5F5] outline-none focus:border-[#A3A3A3]"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#2E2E2E] pt-3">
            <StudioButton
              variant="secondary"
              loading={saving}
              onClick={handleReset}
              icon={<ArrowCounterClockwise size={14} />}
            >
              Reset to default
            </StudioButton>

            <div className="flex items-center gap-2">
              <StudioButton variant="secondary" onClick={onClose}>
                Cancel
              </StudioButton>
              <StudioButton
                variant="primary"
                loading={saving}
                onClick={handleSave}
                icon={<FloppyDisk size={14} />}
              >
                Save customization
              </StudioButton>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
