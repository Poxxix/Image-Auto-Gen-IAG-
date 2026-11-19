import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full p-0.5 ring-1 ring-white/[0.12] transition-colors outline-none data-[checked]:bg-emerald-500/85 data-[unchecked]:bg-white/[0.06] data-checked:bg-emerald-500/85 data-unchecked:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-white/30 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4.5 rounded-full bg-white shadow-sm transition-transform data-[checked]:translate-x-5 data-[unchecked]:translate-x-0 data-checked:translate-x-5 data-unchecked:translate-x-0"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
