import { useEffect, useState } from "react";
import { useStore, pollDisk, toggle } from "../state/store";
import { Welcome } from "./Welcome";
import { TopBar } from "./TopBar";
import { Library } from "./Library";
import { Page } from "./Page";
import { RightPanel } from "./RightPanel";
import { StatusBar } from "./StatusBar";
import { Modals } from "./modals/Modals";
import { Palette } from "./Palette";
import { ContextMenu } from "./ContextMenu";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Tour } from "./Tour";
import { loadTokenizer } from "../tokens/tokens";
import { startRunFromPanel } from "./RunPanel";

function useTheme() {
  const prefs = useStore((s) => s.prefs);
  // the welcome is its own composition, day and night side by side, so it ignores the theme
  const welcome = useStore((s) => !s.vfs);
  useEffect(() => {
    const r = document.documentElement;
    const mql = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => r.setAttribute("data-theme", welcome ? "dark" : prefs.theme === "system" ? (mql.matches ? "light" : "dark") : prefs.theme);
    apply();
    mql.addEventListener("change", apply);
    r.style.setProperty("--font-page", `"${prefs.font}", "EB Garamond", Georgia, serif`);
    r.style.setProperty("--font-mono", `"${prefs.mono}", ui-monospace, Menlo, monospace`);
    r.style.setProperty("--font-mono-app", `"${prefs.mono}", ui-monospace, Menlo, monospace`); // read by the font-mono utility
    r.style.setProperty("--page-size", `${prefs.fontSize}px`);
    r.style.setProperty("--page-leading", String(prefs.lineHeight));
    r.style.setProperty("--page-width", `${prefs.pageWidth}px`);
    r.classList.toggle("cx-show-ws", prefs.showWhitespace);
    return () => mql.removeEventListener("change", apply);
  }, [prefs, welcome]);
}

export function App() {
  useTheme();
  const vfs = useStore((s) => s.vfs);
  const left = useStore((s) => s.left);
  const right = useStore((s) => s.right);
  const [, force] = useState(0);

  useEffect(() => {
    loadTokenizer().then(() => force((n) => n + 1));
  }, []);

  useEffect(() => {
    if (!vfs) return;
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") pollDisk().catch(() => {});
    }, 2000);
    const onFocus = () => pollDisk().catch(() => {});
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [vfs]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useStore.setState((s) => ({ palette: !s.palette }));
      } else if (mod && e.key === "Enter") {
        e.preventDefault();
        startRunFromPanel();
      } else if (mod && e.key === "\\") {
        e.preventDefault();
        toggle(e.shiftKey ? "right" : "left");
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        toggle("rendered");
      } else if (mod && e.key === ".") {
        e.preventDefault();
        const s = useStore.getState();
        const focus = s.left || s.right;
        useStore.setState({ left: !focus, right: !focus });
      } else if (e.key === "Escape") {
        useStore.setState({ menu: null });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!vfs)
    return (
      <>
        <Welcome />
        <Toaster />
      </>
    );
  return (
    <TooltipProvider delayDuration={400}>
    <div className={`cx-app${left ? " has-left" : ""}${right ? " has-right" : ""}`}>
      <TopBar />
      <div className="cx-main">
        {left && <Library />}
        <Page />
        {right && <RightPanel />}
      </div>
      <StatusBar />
      <Modals />
      <Palette />
      <ContextMenu />
      <Toaster />
      <Tour />
    </div>
    </TooltipProvider>
  );
}
