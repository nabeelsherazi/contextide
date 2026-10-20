import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-[9px] border border-rule bg-field px-2.5 py-2 font-sans text-[13px] text-foreground placeholder:italic transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-gold/60 focus-visible:ring-[3px] focus-visible:ring-gold-soft disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
