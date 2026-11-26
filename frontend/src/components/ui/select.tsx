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
      className={cn("truncate text-left font-medium text-[#F5F5F5]", className)}
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
        "flex min-h-[36px] w-full items-center justify-between gap-2 rounded-md border border-[#2E2E2E] bg-[#262626] px-3 py-1.5 text-xs sm:text-sm text-[#F5F5F5] whitespace-nowrap transition-colors duration-150 outline-none select-none hover:border-[#404040] hover:bg-[#2E2E2E] focus-visible:border-[#A3A3A3] data-[popup-open]:border-[#525252] data-[popup-open]:bg-[#2E2E2E] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon className="flex shrink-0 items-center text-[#A3A3A3] transition-transform duration-150 data-[popup-open]:rotate-180">
        <CaretDown size={13} weight="regular" />
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
            "isolate z-[250] overflow-x-hidden overflow-y-auto rounded-lg border border-[#404040] bg-[#1C1C1C] p-1 text-[#F5F5F5] shadow-[0_14px_36px_rgba(0,0,0,0.7)] transition-[transform,opacity] duration-150 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 outline-none",
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
      className={cn("px-2.5 py-1.5 text-xs font-medium text-[#737373]", className)}
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
        "relative flex w-full cursor-pointer items-center justify-between gap-3 rounded-md py-1.5 pr-8 pl-2.5 text-xs sm:text-sm text-[#A3A3A3] outline-none select-none transition-colors duration-150 hover:bg-[#262626] hover:text-[#F5F5F5] data-[highlighted]:bg-[#262626] data-[highlighted]:text-[#F5F5F5] data-[selected]:bg-[#262626] data-[selected]:font-medium data-[selected]:text-[#F5F5F5] data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="flex items-center gap-2 truncate whitespace-nowrap">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2.5 flex size-4 items-center justify-center text-[#FAFAFA]">
        <Check size={13} weight="bold" />
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
        "top-0 flex w-full cursor-default items-center justify-center py-1 text-[#A3A3A3]",
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
        "bottom-0 flex w-full cursor-default items-center justify-center py-1 text-[#A3A3A3]",
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
