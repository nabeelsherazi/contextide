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

function VersionPage() {
  const s = useStore();
  const p = currentProject(s);
  const v = currentVersion(s);
  if (!p)
    return (
      <div className="py-20 text-center font-serif text-[20px] text-ink-2">
        <p className="mb-4">No projects yet.</p>
        <Button onClick={() => openModal({ t: "new-project" })}>New project</Button>
      </div>
    );
  if (!v)
    return (
      <div className="py-20 text-center font-serif text-[20px] text-ink-2">
        <p className="mb-4">This project has no versions.</p>
        <Button onClick={() => openModal({ t: "new-version" })}>New version</Button>
      </div>
    );
  const text = s.files.get(v.file) ?? "";
  const roles = (s.liveDoc?.messages ?? v.doc.messages).map((m) => m.role);
  return (
    <>
      <header className="mb-[18px] flex min-h-[34px] flex-wrap items-baseline gap-2.5 day:[text-shadow:0_1px_12px_rgba(255,255,255,0.6)]">
        <button className="flex cursor-pointer items-baseline gap-3 text-left" onClick={() => openModal({ t: "version-settings", id: v.id })} title="Rename, change subtitle or flavor">
          <span className="font-serif text-[34px] font-normal">{v.title}</span>
          {v.subtitle && <span className="font-serif text-[21px] text-ink-3 italic day:text-[#2f3a4a]">{v.subtitle}</span>}
        </button>
        {!s.rendered && (
          <span className="ml-auto flex gap-1 opacity-60 transition-opacity hover:opacity-100">
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
      <div className="mx-auto max-w-[calc(var(--page-width)+128px)] px-16 pt-[34px] pb-[180px] max-[1100px]:px-9">
        {view.t === "version" && <VersionPage />}
        {view.t === "block" && <BlockPage />}
        {view.t === "data" && <DataPage />}
        {view.t === "project" && <ProjectPage />}
      </div>
    </main>
  );
}
