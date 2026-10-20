import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full font-serif text-[15.5px] leading-tight whitespace-nowrap transition-all duration-200 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border border-gold/70 bg-gradient-to-b from-gold/15 to-gold/5 text-foreground shadow-[0_0_22px_rgba(232,184,120,0.16)] hover:border-gold hover:from-gold/25 hover:to-gold/10 hover:shadow-[0_0_30px_rgba(232,184,120,0.26)] day:border-transparent day:bg-gold day:bg-none day:text-gold-ink day:shadow-[0_6px_18px_rgba(168,98,42,0.25)] day:hover:bg-gold/90",
        destructive:
          "border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20",
        outline:
          "border border-rule-2 bg-paper text-foreground hover:border-gold/55",
        secondary:
          "bg-paper-2 text-foreground hover:bg-paper-2/80",
        ghost:
          "italic text-ink-2 hover:bg-paper-2 hover:text-foreground",
        link: "h-auto px-0 font-sans text-[12px] text-gold underline decoration-gold/40 underline-offset-[3px] hover:decoration-gold",
      },
      size: {
        default: "h-9 px-4 has-[>svg]:px-3",
        xs: "h-6 gap-1 px-2 text-[13px] has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1.5 px-3 text-[14px] has-[>svg]:px-2.5",
        lg: "h-11 px-6 text-[17px] has-[>svg]:px-4",
        icon: "size-8 text-ink-3 hover:text-foreground",
        "icon-xs": "size-6 text-ink-3 hover:text-foreground [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 text-ink-3 hover:text-foreground",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
