import { Command, PanelLeft, PanelRight, Plus, Settings2, SlidersHorizontal } from "lucide-react";
import { useStore, setProject, setVersion, toggle, openModal, currentProject } from "../state/store";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Choice } from "./widgets";

function Tip(p: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{p.children}</TooltipTrigger>
      <TooltipContent>{p.label}</TooltipContent>
    </Tooltip>
  );
}

export function TopBar() {
  const s = useStore();
  const p = currentProject(s);
  return (
    <header className="flex min-w-0 items-center gap-2 border-b border-rule px-3.5 py-2 day:bg-[rgba(251,249,244,0.72)] day:backdrop-blur-md">
      <Tip label="Library (⌘\)">
        <Button variant="ghost" size="icon" onClick={() => toggle("left")} data-testid="toggle-left" aria-label="Toggle library">
          <PanelLeft />
        </Button>
      </Tip>
      <Choice
        value={s.project ?? ""}
        onChange={(v) => (v === "__new" ? openModal({ t: "new-project" }) : setProject(v))}
        options={[...s.ws.projects.map((x) => x.name), ["__new", "+ New project…"]]}
        className="max-w-[240px] rounded-full border-transparent bg-transparent font-serif text-[17px] font-medium hover:bg-paper-2"
        size="default"
        testid="project-select"
      />
      <Tip label="Project settings & scoring">
        <Button variant="ghost" size="icon-sm" className={s.view.t === "project" ? "bg-paper-2 text-foreground" : ""} onClick={() => useStore.setState({ view: { t: "project" } })} aria-label="Project settings">
          <SlidersHorizontal />
        </Button>
      </Tip>
      <Tabs value={s.view.t === "version" ? (s.version ?? "") : ""} onValueChange={setVersion} className="ml-2 min-w-0">
        <TabsList className="h-9 gap-0.5 overflow-x-auto bg-transparent p-0" data-testid="version-tabs">
          {p?.versions.map((v) => (
            <TabsTrigger
              key={v.id}
              value={v.id}
              onDoubleClick={() => openModal({ t: "version-settings", id: v.id })}
              title={`${v.id}${v.subtitle ? " · " + v.subtitle : ""} · ${v.flavor} — double-click to rename`}
              data-testid={`version-tab-${v.id}`}
              className="h-8 flex-none gap-2 border-transparent not-italic data-[state=active]:border-rule-2 data-[state=active]:shadow-[inset_0_-1px_0_color-mix(in_srgb,var(--gold)_70%,transparent)]"
            >
              <b className="text-[17px] font-medium text-foreground">{v.title}</b>
              {v.subtitle && <span className="max-w-[180px] truncate text-[14.5px] text-ink-3 italic">{v.subtitle}</span>}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Tip label="New version (fork current)">
        <Button variant="ghost" size="icon-sm" onClick={() => openModal({ t: "new-version", fork: s.version ?? undefined })} data-testid="new-version" aria-label="New version">
          <Plus />
        </Button>
      </Tip>
      <span className="flex-1" />
      <Button variant={s.rendered ? "outline" : "outline"} size="sm" className={s.rendered ? "border-gold/60 bg-gold-soft text-gold" : ""} onClick={() => toggle("rendered")} title="Show exactly what the model receives (⌘⇧R)" data-testid="toggle-rendered">
        {s.rendered ? "Editing view" : "Rendered view"}
      </Button>
      <Tip label="Command palette (⌘K)">
        <Button variant="ghost" size="icon" onClick={() => useStore.setState({ palette: true })} aria-label="Command palette">
          <Command />
        </Button>
      </Tip>
      <Tip label="Settings">
        <Button variant="ghost" size="icon" onClick={() => openModal({ t: "settings" })} data-testid="open-settings" aria-label="Settings">
          <Settings2 />
        </Button>
      </Tip>
      <Tip label="Run panel (⌘⇧\)">
        <Button variant="ghost" size="icon" onClick={() => toggle("right")} data-testid="toggle-right" aria-label="Toggle run panel">
          <PanelRight />
        </Button>
      </Tip>
    </header>
  );
}
