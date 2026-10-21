// The workflow (project) picker: a popover list you can reorder by dragging; right-click a workflow for its menu.
import { useState } from "react";
import { Check, ChevronDown, GripVertical, Plus } from "lucide-react";
import { useStore, setProject, openModal } from "../state/store";
import { deleteProject, reorderProjects } from "../state/actions";
import { moveBefore } from "../core/workspace";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

const MIME = "application/x-contextide-workflow";

function confirmDelete(name: string, close: () => void) {
  close();
  openModal({
    t: "confirm",
    title: `Delete the workflow “${name}”?`,
    body: "This deletes its folder: every version, data source and run in it. Library blocks are kept.",
    ok: "Delete workflow",
    onOk: () => deleteProject(name),
  });
}

/** Right-click menu for one workflow. */
function WorkflowMenu(p: { name: string; close(): void; children: React.ReactNode }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{p.children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-[210px]" data-testid="workflow-menu">
        <ContextMenuItem
          onSelect={() => {
            p.close();
            setProject(p.name);
          }}
        >
          Open
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            p.close();
            setProject(p.name);
            useStore.setState({ view: { t: "project" } });
          }}
        >
          Settings & scoring
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => confirmDelete(p.name, p.close)} data-testid="workflow-delete">
          Delete workflow…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function WorkflowPicker() {
  const projects = useStore((s) => s.ws.projects);
  const current = useStore((s) => s.project);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<{ name: string | null; after: boolean } | null>(null);
  const names = projects.map((x) => x.name);
  const close = () => setOpen(false);

  const drop = (target: string | null, after: boolean) => {
    if (!dragging) return;
    const idx = target === null ? -1 : names.indexOf(target);
    const before = target === null ? null : after ? (names[idx + 1] ?? null) : target;
    if (before !== dragging) {
      const next = moveBefore(names, dragging, before);
      if (next.join("\n") !== names.join("\n")) reorderProjects(next);
    }
    setDragging(null);
    setOver(null);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <WorkflowMenu name={current ?? ""} close={close}>
        <PopoverTrigger
          className="group/wp flex h-8 max-w-[260px] min-w-0 cursor-pointer items-center gap-1.5 rounded-full pr-2.5 pl-3 font-serif text-[16px] transition-colors outline-none hover:bg-paper-2 focus-visible:ring-[3px] focus-visible:ring-gold-soft data-[state=open]:bg-paper-2"
          data-testid="project-select"
        >
          <span className="truncate">{current ?? "No workflow"}</span>
          <ChevronDown className="size-3.5 flex-none text-ink-3 transition-transform duration-200 group-data-[state=open]/wp:rotate-180" />
        </PopoverTrigger>
      </WorkflowMenu>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-[300px] p-1.5"
        data-testid="workflow-list"
        // the whole popover takes the drop, so a near miss still lands where the indicator shows
        onDragOver={(e) => {
          if (dragging) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          drop(over?.name ?? null, over?.after ?? true);
        }}
      >
        <div className="px-2.5 pt-1.5 pb-2 font-serif text-[11.5px] font-medium tracking-[0.22em] text-ink-3 uppercase">Workflows</div>
        <ul>
          {names.map((name) => (
            <li key={name} className="relative">
              {over?.name === name && dragging && dragging !== name && (
                <span className={cn("cx-rope-h pointer-events-none absolute inset-x-2 h-[2px]", over.after ? "-bottom-px" : "-top-px")} aria-hidden />
              )}
              <WorkflowMenu name={name} close={close}>
                <button
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(MIME, name);
                    e.dataTransfer.effectAllowed = "move";
                    setDragging(name);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                  onDragOver={(e) => {
                    if (!dragging) return;
                    e.preventDefault();
                    const r = e.currentTarget.getBoundingClientRect();
                    setOver({ name, after: e.clientY > r.top + r.height / 2 });
                  }}
                  onClick={() => {
                    close();
                    setProject(name);
                  }}
                  className={cn(
                    "group/wr flex w-full cursor-pointer items-center gap-2 rounded-lg py-2 pr-2.5 pl-1.5 text-left font-serif text-[16px] transition-colors hover:bg-paper-2",
                    dragging === name && "opacity-40",
                  )}
                  data-testid={`workflow-${name}`}
                >
                  <GripVertical className="size-3.5 flex-none cursor-grab text-ink-4 opacity-0 transition-opacity group-hover/wr:opacity-100" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  {name === current && <Check className="size-3.5 flex-none text-gold" />}
                </button>
              </WorkflowMenu>
            </li>
          ))}
        </ul>
        <div className="mx-1 my-1.5 h-px bg-rule" />
        <button
          className="flex w-full cursor-pointer items-center gap-2 rounded-lg py-2 pr-2.5 pl-1.5 text-left font-serif text-[16px] text-ink-2 italic transition-colors hover:bg-paper-2 hover:text-foreground"
          onClick={() => {
            close();
            openModal({ t: "new-project" });
          }}
          data-testid="new-workflow"
        >
          <Plus className="size-3.5 text-gold" /> New workflow…
        </button>
        <p className="px-2.5 pt-1 pb-1.5 font-serif text-[13.5px] text-ink-4 italic">Drag to reorder · right-click for more</p>
      </PopoverContent>
    </Popover>
  );
}
