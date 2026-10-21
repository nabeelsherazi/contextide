import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { useStore } from "../state/store";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "./widgets";

/** Header for library/data/project pages: a way back, a small kind label, and the title. */
export function PageHeader(p: { kind: ReactNode; title: ReactNode; right?: ReactNode }) {
  const version = useStore((s) => s.version);
  return (
    <header className="mb-9 flex max-w-[var(--page-width)] flex-col gap-3">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="xs" className="-ml-2 text-[14.5px]" onClick={() => useStore.setState({ view: { t: "version" } })} data-testid="back">
          <ArrowLeft className="size-3" /> {version ? `version ${version}` : "back"}
        </Button>
        <span className="h-3.5 w-px bg-rule-2" aria-hidden />
        <Eyebrow>{p.kind}</Eyebrow>
        {p.right && <div className="ml-auto flex items-center gap-2">{p.right}</div>}
      </div>
      <div className="min-w-0 font-serif text-[44px] leading-[1.05] font-normal tracking-[-0.01em]">{p.title}</div>
    </header>
  );
}

/** A panel on a page (settings-like groups). */
export function Panel(p: { title?: ReactNode; children: ReactNode }) {
  return (
    <section className="cx-card-panel mb-5 max-w-[var(--page-width)]">
      {p.title && <h3 className="mb-4 font-serif text-[22px] leading-tight font-normal">{p.title}</h3>}
      {p.children}
    </section>
  );
}
