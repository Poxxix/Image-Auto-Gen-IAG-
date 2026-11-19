import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"
import { Check, CaretDown, CaretUp } from "@phosphor-icons/react"

import { cn } from "@/lib/utils"

const Select = SelectPrimitive.Root

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("p-1", className)}
      {...props}
    />
  )
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("truncate text-left font-medium text-[#f4f5f7]", className)}
      {...props}
    />
  )
}

function SelectTrigger({
  className,
  children,
  ...props
}: SelectPrimitive.Trigger.Props) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "flex min-h-[42px] w-full items-center justify-between gap-2.5 rounded-full bg-white/[0.04] px-4 py-2 text-sm text-[#f4f5f7] ring-1 ring-white/[0.09] whitespace-nowrap transition-all duration-150 outline-none select-none hover:bg-white/[0.07] hover:ring-white/[0.16] focus-visible:ring-2 focus-visible:ring-white/30 data-[popup-open]:bg-white/[0.08] data-[popup-open]:ring-white/25 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon className="flex shrink-0 items-center text-[#9ca3af] transition-transform duration-150 data-[popup-open]:rotate-180">
        <CaretDown size={14} weight="regular" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  side = "bottom",
  sideOffset = 6,
  align = "start",
  alignOffset = 0,
  alignItemWithTrigger = false,
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<
    SelectPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger"
  >) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className="z-[250] outline-none select-none"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          style={{
            minWidth: "max(var(--anchor-width, 160px), 160px)",
            maxHeight: "min(var(--available-height, 320px), 320px)",
          }}
          className={cn(
            "isolate z-[250] overflow-x-hidden overflow-y-auto rounded-2xl bg-[#0c0e12] p-1.5 text-[#f4f5f7] ring-1 ring-white/[0.12] shadow-[0_20px_50px_rgba(0,0,0,0.85)] transition-[transform,opacity] duration-150 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 outline-none",
            className
          )}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List className="flex flex-col gap-0.5 outline-none">
            {children}
          </SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn(
        "px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-[#646b78]",
        className
      )}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl py-2 pr-8 pl-3 text-sm text-[#d1d5db] outline-none select-none transition-colors hover:bg-white/[0.08] hover:text-white data-[highlighted]:bg-white/[0.09] data-[highlighted]:text-white data-[selected]:bg-white/[0.05] data-[selected]:font-medium data-[selected]:text-white data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="flex items-center gap-2 truncate whitespace-nowrap">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2.5 flex size-4 items-center justify-center text-emerald-400">
        <Check size={14} weight="bold" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: SelectPrimitive.ScrollUpArrow.Props) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        "top-0 flex w-full cursor-default items-center justify-center py-1 text-[#9ca3af]",
        className
      )}
      {...props}
    >
      <CaretUp size={14} weight="light" />
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: SelectPrimitive.ScrollDownArrow.Props) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        "bottom-0 flex w-full cursor-default items-center justify-center py-1 text-[#9ca3af]",
        className
      )}
      {...props}
    >
      <CaretDown size={14} weight="light" />
    </SelectPrimitive.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectTrigger,
  SelectValue,
}
