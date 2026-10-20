import { Toaster as Sonner, type ToasterProps } from "sonner"

/** Toasts as a quiet glass pill; follows ContextIDE's day/night theme. */
function Toaster(props: ToasterProps) {
  const dark = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") !== "light"
  return (
    <Sonner
      theme={dark ? "dark" : "light"}
      position="bottom-center"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "!rounded-full !border !border-rule-2 !bg-popover !text-foreground !font-serif !italic !text-[15px] !shadow-[var(--shadow-pop)] backdrop-blur-xl !py-2.5 !px-5 !w-auto",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
