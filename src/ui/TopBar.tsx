import { PanelLeft, PanelRight, Plus, Settings2, SlidersHorizontal } from "lucide-react";
import { useStore, setProject, setVersion, toggle, openModal, currentProject } from "../state/store";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Choice } from "./widgets";
import { cn } from "@/lib/utils";

function Tip(p: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{p.children}</TooltipTrigger>
      <TooltipContent>{p.label}</TooltipContent>
    </Tooltip>
  );
}

const Divider = () => <span className="mx-1.5 h-5 w-px flex-none bg-rule-2" aria-hidden />;

/** A two-state switch that names both states, so its label never flips under the pointer. */
function ViewSwitch(p: { rendered: boolean; onToggle(): void }) {
  const side = (on: boolean) => cn("relative z-10 px-3 transition-colors duration-300", on ? "text-foreground not-italic" : "text-ink-3 italic");
  return (
    <button
      className="relative flex h-8 flex-none cursor-pointer items-center rounded-full border border-rule bg-field p-[3px] font-serif text-[14.5px] hover:border-rule-2"
      onClick={p.onToggle}
      title="Show exactly what the model receives (⌘⇧R)"
      aria-pressed={p.rendered}
      data-testid="toggle-rendered"
    >
      <span
        className="absolute top-[3px] bottom-[3px] rounded-full bg-gold-soft shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--gold)_30%,transparent)] transition-all duration-300 ease-[var(--ease)]"
        style={p.rendered ? { left: "50%", right: 3 } : { left: 3, right: "50%" }}
        aria-hidden
      />
      <span className={cn(side(!p.rendered), "w-1/2 text-center")}>compose</span>
      <span className={cn(side(p.rendered), "w-1/2 text-center")}>rendered</span>
    </button>
  );
}

export function TopBar() {
  const s = useStore();
  const p = currentProject(s);
  return (
    <header className="relative z-10 flex h-14 min-w-0 items-center gap-1.5 border-b border-rule bg-glass px-3 backdrop-blur-xl">
      <Tip label="Library (⌘\)">
        <Button variant="ghost" size="icon" onClick={() => toggle("left")} data-testid="toggle-left" aria-label="Toggle library" className={s.left ? "text-ink-2" : ""}>
          <PanelLeft />
        </Button>
      </Tip>
      <Divider />
      <Choice
        value={s.project ?? ""}
        onChange={(v) => (v === "__new" ? openModal({ t: "new-project" }) : setProject(v))}
        options={[...s.ws.projects.map((x) => x.name), ["__new", <span className="text-ink-3 italic">New project…</span>]]}
        className="h-8 max-w-[240px] rounded-full border-transparent bg-transparent pr-2 pl-2.5 text-[18px] hover:border-transparent hover:bg-paper-2"
        size="default"
        testid="project-select"
      />
      <Tip label="Project settings & scoring">
        <Button variant="ghost" size="icon-sm" className={s.view.t === "project" ? "bg-paper-2 text-foreground" : ""} onClick={() => useStore.setState({ view: { t: "project" } })} aria-label="Project settings">
          <SlidersHorizontal />
        </Button>
      </Tip>
      <Divider />
      <Tabs value={s.view.t === "version" ? (s.version ?? "") : ""} onValueChange={setVersion} className="min-w-0">
        <TabsList className="h-14 gap-1 overflow-x-auto overflow-y-hidden bg-transparent p-0" data-testid="version-tabs">
          {p?.versions.map((v) => (
            <TabsTrigger
              key={v.id}
              value={v.id}
              onDoubleClick={() => openModal({ t: "version-settings", id: v.id })}
              title={`${v.id}${v.subtitle ? " · " + v.subtitle : ""} · ${v.flavor} — double-click to rename`}
              data-testid={`version-tab-${v.id}`}
              className="group/vt h-full flex-none rounded-none border-0 px-3.5 not-italic hover:text-foreground data-[state=active]:bg-transparent"
            >
              <span className="flex items-baseline gap-2">
                <b className="text-[19px] leading-none font-normal text-ink-2 group-data-[state=active]/vt:text-foreground">{v.title}</b>
                {v.subtitle && <span className="max-w-[180px] truncate text-[15px] leading-none text-ink-3 italic group-data-[state=active]/vt:text-ink-2">{v.subtitle}</span>}
              </span>
              {/* the active version hangs from a short length of rope */}
              <span className="cx-rope-h pointer-events-none absolute inset-x-3 bottom-[-1px] h-[2px] scale-x-0 transition-transform duration-300 ease-[var(--ease)] group-data-[state=active]/vt:scale-x-100" aria-hidden />
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
      <ViewSwitch rendered={s.rendered} onToggle={() => toggle("rendered")} />
      <Divider />
      <Tip label="Command palette">
        <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 not-italic" onClick={() => useStore.setState({ palette: true })} aria-label="Command palette">
          <kbd className="rounded-[5px] border border-rule-2 bg-field px-1.5 py-px font-mono text-[10.5px] text-ink-2 shadow-[0_1px_0_var(--rule-2)]">⌘K</kbd>
        </Button>
      </Tip>
      <Tip label="Settings">
        <Button variant="ghost" size="icon" onClick={() => openModal({ t: "settings" })} data-testid="open-settings" aria-label="Settings">
          <Settings2 />
        </Button>
      </Tip>
      <Tip label="Run panel (⌘⇧\)">
        <Button variant="ghost" size="icon" onClick={() => toggle("right")} data-testid="toggle-right" aria-label="Toggle run panel" className={s.right ? "text-ink-2" : ""}>
          <PanelRight />
        </Button>
      </Tip>
    </header>
  );
}
