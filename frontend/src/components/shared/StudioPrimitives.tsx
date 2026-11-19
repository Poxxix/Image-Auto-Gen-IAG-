import * as React from "react"
import { cn } from "@/lib/utils"

export interface StudioPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  eyebrow?: string
  title?: string
  headerRight?: React.ReactNode
}

export function StudioPanel({
  eyebrow,
  title,
  headerRight,
  children,
  className,
  ...props
}: StudioPanelProps) {
  return (
    <section
      className={cn(
        "studio-panel overflow-hidden bg-[#141821] border border-white/[0.08] rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.28)]",
        className
      )}
      {...props}
    >
      {(eyebrow || title || headerRight) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] bg-[#10131a]/60 px-5 py-3.5">
          <div>
            {eyebrow && (
              <p className="font-mono-tech text-[10px] font-medium uppercase tracking-[0.16em] text-amber-400/90">
                {eyebrow}
              </p>
            )}
            {title && (
              <h2 className="mt-0.5 font-display text-base font-semibold text-white">
                {title}
              </h2>
            )}
          </div>
          {headerRight && <div>{headerRight}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  )
}

export type StudioBadgeTone =
  | "emerald"
  | "amber"
  | "rose"
  | "sky"
  | "neutral"

const BADGE_TONES: Record<StudioBadgeTone, string> = {
  emerald: "bg-emerald-500/12 text-emerald-300 border-emerald-500/30",
  amber: "bg-amber-500/12 text-amber-300 border-amber-500/30",
  rose: "bg-rose-500/12 text-rose-300 border-rose-500/30",
  sky: "bg-sky-500/12 text-sky-300 border-sky-500/30",
  neutral: "bg-white/[0.05] text-slate-300 border-white/[0.1]",
}

export function StudioBadge({
  tone = "neutral",
  label,
  pulse = false,
  className,
}: {
  tone?: StudioBadgeTone
  label: string
  pulse?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono-tech text-[11px] font-medium",
        BADGE_TONES[tone] || BADGE_TONES.neutral,
        className
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          tone === "emerald"
            ? "bg-emerald-400"
            : tone === "amber"
              ? "bg-amber-400"
              : tone === "rose"
                ? "bg-rose-400"
                : tone === "sky"
                  ? "bg-sky-400"
                  : "bg-slate-400",
          pulse && "animate-ping"
        )}
      />
      <span>{label}</span>
    </span>
  )
}

export interface StudioButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost"
  loading?: boolean
  icon?: React.ReactNode
}

export function StudioButton({
  variant = "primary",
  loading = false,
  icon,
  children,
  className,
  disabled,
  ...props
}: StudioButtonProps) {
  const styles = {
    primary:
      "bg-amber-400 text-[#0c0e13] font-semibold hover:bg-amber-300 shadow-[0_4px_18px_rgba(251,191,36,0.22)]",
    secondary:
      "bg-[#1c2230] text-slate-100 border border-white/[0.1] hover:bg-[#252c3d]",
    danger:
      "bg-rose-500/15 text-rose-200 border border-rose-500/30 hover:bg-rose-500/25",
    ghost:
      "bg-transparent text-slate-300 hover:bg-white/[0.06] hover:text-white",
  }[variant]

  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-xs font-medium transition-all disabled:opacity-45 disabled:pointer-events-none cursor-pointer",
        styles,
        className
      )}
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span>{children}</span>
    </button>
  )
}

export interface StudioPaginationProps {
  totalItems: number
  pageSize: number
  pageIndex: number
  onPageChange: (page: number) => void
  itemLabel?: string
}

export function StudioPagination({
  totalItems,
  pageSize,
  pageIndex,
  onPageChange,
  itemLabel = "shots",
}: StudioPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  if (totalItems <= pageSize) return null
  const safePage = Math.max(1, Math.min(totalPages, pageIndex))
  const start = (safePage - 1) * pageSize + 1
  const end = Math.min(totalItems, safePage * pageSize)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/[0.025] px-4 py-2.5 ring-1 ring-white/[0.07]">
      <span className="font-mono-tech text-[11px] text-[#9ca3af]">
        Showing <strong className="text-white">{start}–{end}</strong> of{" "}
        <strong className="text-white">{totalItems}</strong> {itemLabel}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={safePage <= 1}
          onClick={() => onPageChange(1)}
          className="rounded-full bg-white/[0.04] px-2.5 py-1 font-mono-tech text-[10px] text-[#d1d5db] ring-1 ring-white/[0.08] hover:bg-white/[0.1] disabled:opacity-35 cursor-pointer"
        >
          First
        </button>
        <button
          type="button"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          className="rounded-full bg-white/[0.05] px-3 py-1 text-[11px] font-medium text-white ring-1 ring-white/[0.08] hover:bg-white/[0.12] disabled:opacity-35 cursor-pointer"
        >
          ← Prev
        </button>
        <span className="px-2 font-mono-tech text-[11px] text-[#e5e7eb]">
          Page {safePage} / {totalPages}
        </span>
        <button
          type="button"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
          className="rounded-full bg-white/[0.05] px-3 py-1 text-[11px] font-medium text-white ring-1 ring-white/[0.08] hover:bg-white/[0.12] disabled:opacity-35 cursor-pointer"
        >
          Next →
        </button>
        <button
          type="button"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(totalPages)}
          className="rounded-full bg-white/[0.04] px-2.5 py-1 font-mono-tech text-[10px] text-[#d1d5db] ring-1 ring-white/[0.08] hover:bg-white/[0.1] disabled:opacity-35 cursor-pointer"
        >
          Last
        </button>
      </div>
    </div>
  )
}
