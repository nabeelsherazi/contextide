import * as React from "react"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-[34px] w-full min-w-0 rounded-[10px] border border-rule bg-field px-3 py-1 font-serif text-[16px] text-foreground placeholder:font-serif placeholder:text-[15px] placeholder:text-ink-4 placeholder:italic transition-[color,box-shadow,border-color] outline-none hover:border-rule-2 selection:bg-gold-soft file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-gold/60 focus-visible:ring-[3px] focus-visible:ring-gold-soft",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
