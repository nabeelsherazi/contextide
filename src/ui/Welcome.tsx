import { useEffect, useState } from "react";
import { openVfs } from "../state/store";
import { handleVfs, fsAccessSupported, browserWorkspaceRoot } from "../fs/vfs";
import { loadSaved, saveWorkspace, hasPermission, forgetWorkspace, type Saved } from "../fs/persist";
import { SEED, EMPTY } from "../seed";

async function seedIfEmpty(vfs: ReturnType<typeof handleVfs>, withSample: boolean) {
  const all = await vfs.readAll();
  if (all.has("contextide.json")) return false;
  const files = withSample ? SEED : EMPTY;
  for (const [p, t] of Object.entries(files)) if (!all.has(p)) await vfs.write(p, t);
  return true;
}

export function Welcome() {
  const [saved, setSaved] = useState<Saved | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [pendingInit, setPendingInit] = useState<FileSystemDirectoryHandle | null>(null);
  const supported = fsAccessSupported();

  useEffect(() => {
    loadSaved()
      .then(async (s) => {
        setSaved(s ?? null);
        if (s?.kind === "folder" && (await hasPermission(s.handle, false))) await openVfs(handleVfs(s.handle, "folder"));
        else if (s?.kind === "browser") await openVfs(handleVfs(await browserWorkspaceRoot(s.name), "browser"));
      })
      .catch(() => setSaved(null));
  }, []);

  const openFolder = async () => {
    setErr(null);
    try {
      const h = await window.showDirectoryPicker({ mode: "readwrite", id: "contextide" });
      const vfs = handleVfs(h, "folder");
      const all = await vfs.readAll();
      if (!all.has("contextide.json")) {
        setPendingInit(h);
        return;
      }
      await saveWorkspace({ kind: "folder", handle: h });
      await openVfs(vfs);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setErr((e as Error).message);
    }
  };

  const init = async (withSample: boolean) => {
    if (!pendingInit) return;
    const vfs = handleVfs(pendingInit, "folder");
    await seedIfEmpty(vfs, withSample);
    await saveWorkspace({ kind: "folder", handle: pendingInit });
    await openVfs(vfs);
  };

  const reopen = async () => {
    if (saved?.kind !== "folder") return;
    if (await hasPermission(saved.handle, true)) await openVfs(handleVfs(saved.handle, "folder"));
  };

  const browser = async () => {
    const dir = await browserWorkspaceRoot("default");
    const vfs = handleVfs(dir, "browser");
    await seedIfEmpty(vfs, true);
    await saveWorkspace({ kind: "browser", name: "default" });
    await openVfs(vfs);
  };

  return (
    <div className="cx-welcome">
      <div className="cx-welcome-card">
        <h1>ContextIDE</h1>
        <p className="cx-lede">A writing desk for context engineering. Compose prompts from reusable blocks, A/B test versions, and run them against your models — all as plain text in a folder.</p>
        {pendingInit ? (
          <div className="cx-welcome-actions">
            <p>
              <b>{pendingInit.name}</b> isn't a ContextIDE workspace yet. Set it up?
            </p>
            <button className="cx-btn primary" onClick={() => init(true)} data-testid="init-sample">
              Starter library + sample project
            </button>
            <button className="cx-btn" onClick={() => init(false)}>
              Empty workspace
            </button>
            <button className="cx-btn ghost" onClick={() => setPendingInit(null)}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="cx-welcome-actions">
            {saved?.kind === "folder" && (
              <button className="cx-btn primary" onClick={reopen}>
                Reopen “{saved.handle.name}”
              </button>
            )}
            {supported ? (
              <button className={`cx-btn${saved?.kind === "folder" ? "" : " primary"}`} onClick={openFolder} data-testid="open-folder">
                Open a folder…
              </button>
            ) : (
              <p className="cx-warn">This browser can't open local folders. Use Chrome, Edge, Arc or Brave — or try a browser workspace below.</p>
            )}
            <button className="cx-btn" onClick={browser} data-testid="browser-workspace">
              Try it in browser storage
            </button>
            {saved && (
              <button className="cx-btn ghost" onClick={() => forgetWorkspace().then(() => setSaved(null))}>
                Forget last workspace
              </button>
            )}
          </div>
        )}
        {err && <p className="cx-warn">{err}</p>}
        <p className="cx-fine">Your files never leave your machine. API keys are kept in this browser, not in the folder.</p>
      </div>
    </div>
  );
}
