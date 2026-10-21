import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-[10px] border border-rule bg-field px-3 py-2 font-serif text-[16px] leading-snug text-foreground placeholder:font-serif placeholder:italic placeholder:text-ink-4 transition-[color,box-shadow,border-color] outline-none hover:border-rule-2 focus-visible:border-gold/60 focus-visible:ring-[3px] focus-visible:ring-gold-soft disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
