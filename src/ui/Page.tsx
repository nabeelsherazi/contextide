import { useEffect, useRef } from "react";
import { useStore, writeFile, currentProject, currentVersion, openModal } from "../state/store";
import { Editor } from "./Editor";
import { RenderedView } from "./RenderedView";
import { BlockPage } from "./BlockPage";
import { DataPage } from "./DataPage";
import { ProjectPage } from "./ProjectPage";
import { runCommand } from "../editor/active";
import { addMessage } from "../editor/commands";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

function VersionPage() {
  const s = useStore();
  const p = currentProject(s);
  const v = currentVersion(s);
  if (!p)
    return (
      <div className="py-20 text-center font-serif text-[20px] text-ink-2">
        <p className="mb-5 italic">No workflows yet.</p>
        <Button onClick={() => openModal({ t: "new-project" })}>New workflow</Button>
      </div>
    );
  if (!v)
    return (
      <div className="py-20 text-center font-serif text-[20px] text-ink-2">
        <p className="mb-5 italic">This workflow has no versions.</p>
        <Button onClick={() => openModal({ t: "new-version" })}>New version</Button>
      </div>
    );
  const text = s.files.get(v.file) ?? "";
  const roles = (s.liveDoc?.messages ?? v.doc.messages).map((m) => m.role);
  return (
    <>
      <header className="mb-10 flex flex-wrap items-end gap-3 day:text-[#fffaf0] day:[text-shadow:0_1px_2px_rgba(15,35,75,0.35),0_0_22px_rgba(15,35,75,0.3)]">
        <button className="group/vh flex cursor-pointer items-baseline gap-4 text-left" onClick={() => openModal({ t: "version-settings", id: v.id })} title="Rename, change subtitle or flavor">
          <span className={cn("font-serif leading-[0.9] font-normal tracking-[-0.01em]", v.title.length > 3 ? "text-[44px]" : "text-[58px]")}>{v.title}</span>
          {v.subtitle && <span className="font-serif text-[25px] leading-none text-ink-2 italic transition-colors group-hover/vh:text-foreground day:text-[#eef3fb] day:group-hover/vh:text-white">{v.subtitle}</span>}
        </button>
        {!s.rendered && (
          <span className="ml-auto flex gap-0.5 pb-0.5 opacity-60 transition-opacity hover:opacity-100 day:opacity-90 day:[&_button]:text-white day:[&_button:hover]:bg-white/15">
            {!roles.includes("system") && (
              <Button variant="ghost" size="sm" onClick={() => runCommand(addMessage("system"))} data-testid="add-system">
                <Plus className="size-3.5" /> System message
              </Button>
            )}
            {roles[roles.length - 1] !== "assistant" && (
              <Button variant="ghost" size="sm" onClick={() => runCommand(addMessage("assistant"))} data-testid="add-prefill">
                <Plus className="size-3.5" /> Assistant prefill
              </Button>
            )}
          </span>
        )}
      </header>
      {s.rendered && <RenderedView />}
      {(
        <div className="cx-canvas" style={s.rendered ? { display: "none" } : undefined}>
          <Editor
            key={v.file}
            docKey={v.file}
            text={text}
            mode="version"
            flavor={v.flavor}
            onSave={(t) => writeFile(v.file, t)}
            onLive={(messages) => useStore.setState({ liveDoc: { front: v.doc.front, messages } })}
          />
        </div>
      )}
    </>
  );
}

export function Page() {
  const view = useStore((s) => s.view);
  const ref = useRef<HTMLElement>(null);
  const viewKey = view.t === "block" ? view.file : view.t === "data" ? view.name : view.t;
  useEffect(() => {
    ref.current?.scrollTo({ top: 0 });
  }, [viewKey]);
  return (
    <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto [scroll-padding:80px]" data-testid="page" ref={ref}>
      <div className="mx-auto max-w-[calc(var(--page-width)+160px)] px-20 pt-14 pb-[200px] max-[1100px]:px-10">
        {view.t === "version" && <VersionPage />}
        {view.t !== "version" && (
          <div className="cx-sheet">
            {view.t === "block" && <BlockPage />}
            {view.t === "data" && <DataPage />}
            {view.t === "project" && <ProjectPage />}
          </div>
        )}
      </div>
    </main>
  );
}
