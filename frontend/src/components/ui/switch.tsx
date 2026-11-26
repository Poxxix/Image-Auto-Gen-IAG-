import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-[#404040] p-0.5 transition-colors duration-150 outline-none data-[checked]:border-[#FAFAFA] data-[checked]:bg-[#FAFAFA] data-[unchecked]:bg-[#262626] data-checked:border-[#FAFAFA] data-checked:bg-[#FAFAFA] data-unchecked:bg-[#262626] focus-visible:outline-2 focus-visible:outline-white/50 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-3.5 rounded-full bg-[#A3A3A3] transition-transform duration-150 data-[checked]:translate-x-4 data-[checked]:bg-[#121212] data-[unchecked]:translate-x-0 data-checked:translate-x-4 data-checked:bg-[#121212] data-unchecked:translate-x-0"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
