import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { useStore } from "../state/store";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "./widgets";

/** Header for library/data/project pages: a way back, a small kind label, and the title. */
export function PageHeader(p: { kind: ReactNode; title: ReactNode; right?: ReactNode }) {
  const version = useStore((s) => s.version);
  return (
    <header className="mb-[18px] flex flex-wrap items-center gap-[18px]">
      <Button variant="ghost" size="sm" onClick={() => useStore.setState({ view: { t: "version" } })} data-testid="back">
        <ArrowLeft className="size-3.5" /> {version ?? "back"}
      </Button>
      <div className="flex min-w-0 flex-col gap-0.5">
        <Eyebrow>{p.kind}</Eyebrow>
        <div className="font-serif text-[34px] leading-tight font-normal">{p.title}</div>
      </div>
      {p.right && <div className="ml-auto flex items-center gap-2">{p.right}</div>}
    </header>
  );
}

/** A panel on a page (settings-like groups). */
export function Panel(p: { title?: ReactNode; children: ReactNode }) {
  return (
    <section className="cx-card-panel mb-3.5 max-w-[var(--page-width)]">
      {p.title && <h3 className="mb-2 font-serif text-[20px] font-normal">{p.title}</h3>}
      {p.children}
    </section>
  );
}
