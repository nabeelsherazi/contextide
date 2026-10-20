import { useEffect, useRef } from "react";
import { useStore, writeFile, currentProject, currentVersion, openModal } from "../state/store";
import { Editor } from "./Editor";
import { RenderedView } from "./RenderedView";
import { BlockPage } from "./BlockPage";
import { DataPage } from "./DataPage";
import { ProjectPage } from "./ProjectPage";
import { runCommand } from "../editor/active";
import { addMessage } from "../editor/commands";

function VersionPage() {
  const s = useStore();
  const p = currentProject(s);
  const v = currentVersion(s);
  if (!p)
    return (
      <div className="cx-empty-page">
        <p>No projects yet.</p>
        <button className="cx-btn primary" onClick={() => openModal({ t: "new-project" })}>
          New project
        </button>
      </div>
    );
  if (!v)
    return (
      <div className="cx-empty-page">
        <p>This project has no versions.</p>
        <button className="cx-btn primary" onClick={() => openModal({ t: "new-version" })}>
          New version
        </button>
      </div>
    );
  const text = s.files.get(v.file) ?? "";
  const roles = (s.liveDoc?.messages ?? v.doc.messages).map((m) => m.role);
  return (
    <>
      <header className="cx-page-head">
        <button className="cx-page-title" onClick={() => openModal({ t: "version-settings", id: v.id })} title="Rename, change subtitle or flavor">
          <span className="cx-page-id">{v.title}</span>
          {v.subtitle && <span className="cx-page-sub">{v.subtitle}</span>}
        </button>
        {!s.rendered && (
          <span className="cx-page-actions">
            {!roles.includes("system") && (
              <button className="cx-btn small ghost" onClick={() => runCommand(addMessage("system"))} data-testid="add-system">
                + System message
              </button>
            )}
            {roles[roles.length - 1] !== "assistant" && (
              <button className="cx-btn small ghost" onClick={() => runCommand(addMessage("assistant"))} data-testid="add-prefill">
                + Assistant prefill
              </button>
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
    <main className="cx-page" data-testid="page" ref={ref}>
      <div className="cx-page-inner">
        {view.t === "version" && <VersionPage />}
        {view.t === "block" && <BlockPage />}
        {view.t === "data" && <DataPage />}
        {view.t === "project" && <ProjectPage />}
      </div>
    </main>
  );
}
