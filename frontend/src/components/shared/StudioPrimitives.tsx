import * as React from "react"
import { cn } from "@/lib/utils"

export interface StudioPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  eyebrow?: string
  title?: string
  subtitle?: string
  headerRight?: React.ReactNode
  noPadding?: boolean
}

export function StudioPanel({
  eyebrow,
  title,
  subtitle,
  headerRight,
  noPadding = false,
  children,
  className,
  ...props
}: StudioPanelProps) {
  return (
    <section
      className={cn(
        "studio-panel overflow-hidden rounded-lg border border-[#2E2E2E] bg-[#1C1C1C]",
        className
      )}
      {...props}
    >
      {(title || subtitle || headerRight) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#2E2E2E] px-4 py-3 sm:px-5">
          <div className="min-w-0">
            {title && (
              <h2 className="text-sm font-semibold text-[#F5F5F5]">{title}</h2>
            )}
            {subtitle && (
              <p className="mt-0.5 text-xs text-[#A3A3A3]">{subtitle}</p>
            )}
          </div>
          {headerRight && (
            <div className="flex items-center gap-2">{headerRight}</div>
          )}
        </div>
      )}
      <div className={cn(!noPadding && "p-4 sm:p-5")} data-eyebrow={eyebrow ? undefined : undefined}>
        {children}
      </div>
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
  emerald: "bg-[#262626] text-[#F5F5F5] border-[#404040]",
  amber: "bg-[#262626] text-[#D4D4D4] border-[#383838]",
  sky: "bg-[#262626] text-[#F5F5F5] border-[#404040]",
  rose: "bg-[#EF4444]/10 text-[#FCA5A5] border-[#EF4444]/30",
  neutral: "bg-[#222222] text-[#A3A3A3] border-[#2E2E2E]",
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
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium tabular-nums",
        BADGE_TONES[tone] || BADGE_TONES.neutral,
        className
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full shrink-0",
          tone === "rose"
            ? "bg-[#F87171]"
            : tone === "emerald" || tone === "sky"
              ? "bg-[#FAFAFA]"
              : "bg-[#737373]",
          pulse && "animate-pulse"
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
      "bg-[#FAFAFA] text-[#121212] font-semibold border border-[#FAFAFA] hover:bg-[#E5E5E5] hover:border-[#E5E5E5]",
    secondary:
      "bg-[#262626] text-[#F5F5F5] border border-[#383838] hover:bg-[#303030] hover:border-[#4A4A4A]",
    danger:
      "bg-[#262626] text-[#FCA5A5] border border-[#EF4444]/35 hover:bg-[#EF4444]/15",
    ghost:
      "bg-transparent text-[#A3A3A3] border border-transparent hover:bg-[#262626] hover:text-[#F5F5F5]",
  }[variant]

  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cn(
        "inline-flex h-9 items-center justify-center gap-2 rounded-md px-3.5 text-xs font-medium transition-colors duration-150 disabled:opacity-45 disabled:pointer-events-none cursor-pointer",
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
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#2E2E2E] bg-[#1C1C1C] px-4 py-2.5">
      <span className="text-xs text-[#A3A3A3] tabular-nums">
        Showing <strong className="font-semibold text-[#F5F5F5]">{start}–{end}</strong> of{" "}
        <strong className="font-semibold text-[#F5F5F5]">{totalItems}</strong> {itemLabel}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={safePage <= 1}
          onClick={() => onPageChange(1)}
          className="rounded-md border border-[#2E2E2E] bg-[#262626] px-2.5 py-1 text-xs text-[#A3A3A3] transition-colors duration-150 hover:border-[#404040] hover:text-[#F5F5F5] disabled:opacity-35 cursor-pointer"
        >
          First
        </button>
        <button
          type="button"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          className="rounded-md border border-[#2E2E2E] bg-[#262626] px-3 py-1 text-xs font-medium text-[#F5F5F5] transition-colors duration-150 hover:border-[#404040] disabled:opacity-35 cursor-pointer"
        >
          Previous
        </button>
        <span className="px-2 font-mono-tech text-xs text-[#A3A3A3]">
          {safePage} / {totalPages}
        </span>
        <button
          type="button"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
          className="rounded-md border border-[#2E2E2E] bg-[#262626] px-3 py-1 text-xs font-medium text-[#F5F5F5] transition-colors duration-150 hover:border-[#404040] disabled:opacity-35 cursor-pointer"
        >
          Next
        </button>
        <button
          type="button"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(totalPages)}
          className="rounded-md border border-[#2E2E2E] bg-[#262626] px-2.5 py-1 text-xs text-[#A3A3A3] transition-colors duration-150 hover:border-[#404040] hover:text-[#F5F5F5] disabled:opacity-35 cursor-pointer"
        >
          Last
        </button>
      </div>
    </div>
  )
}
