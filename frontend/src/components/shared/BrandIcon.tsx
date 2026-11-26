import * as React from "react"
import { cn } from "@/lib/utils"

export type BrandIconName =
  | "gemini"
  | "chatgpt"
  | "openai"
  | "grok"
  | "pinterest"
  | "chrome"
  | "google-chrome"

const ICON_FILE_MAP: Record<BrandIconName, { file: string; isInkMono?: boolean; label: string }> = {
  gemini: { file: "/icons/gemini.svg", label: "Gemini" },
  chatgpt: { file: "/icons/openai.svg", isInkMono: true, label: "ChatGPT" },
  openai: { file: "/icons/openai.svg", isInkMono: true, label: "OpenAI" },
  grok: { file: "/icons/grok.svg", isInkMono: true, label: "Grok" },
  pinterest: { file: "/icons/pinterest.svg", label: "Pinterest" },
  chrome: { file: "/icons/google-chrome.svg", label: "Google Chrome" },
  "google-chrome": { file: "/icons/google-chrome.svg", label: "Google Chrome" },
}

interface BrandIconProps {
  name: BrandIconName | string
  size?: number
  className?: string
  withTile?: boolean
}

export function BrandIcon({
  name,
  size = 18,
  className,
  withTile = false,
}: BrandIconProps) {
  const key = (name || "gemini").toLowerCase() as BrandIconName
  const meta = ICON_FILE_MAP[key] || ICON_FILE_MAP.gemini

  const imgEl = (
    <img
      src={meta.file}
      alt={meta.label}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={cn(
        "inline-block shrink-0 object-contain select-none grayscale opacity-85",
        meta.isInkMono && "invert brightness-100",
        className
      )}
    />
  )

  if (!withTile) {
    return imgEl
  }

  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-md border border-[#2E2E2E] bg-[#262626]"
      style={{ width: size + 16, height: size + 16 }}
    >
      {imgEl}
    </span>
  )
}
