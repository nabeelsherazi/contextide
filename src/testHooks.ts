// Read-mostly hooks for end-to-end tests (and curious humans in devtools).
import { useStore, openVfs, pollDisk } from "./state/store";
import { activeEditor, runCommand } from "./editor/active";
import { handleVfs, browserWorkspaceRoot } from "./fs/vfs";
import { SEED } from "./seed";
import { docFromPM } from "./editor/convert";
import { fmtBody } from "./core/doc";
import { promptText } from "./core/render";
import * as commands from "./editor/commands";
import { TextSelection } from "prosemirror-state";

export function exposeTestHooks() {
  (window as unknown as Record<string, unknown>).__contextide = {
    store: useStore,
    state: () => useStore.getState(),
    files: () => Object.fromEntries(useStore.getState().files),
    /** The open editor's document in file format. */
    editorText: () => {
      const e = activeEditor();
      return e ? fmtBody(docFromPM(e.view.state.doc)) : null;
    },
    rendered: () => {
      const a = useStore.getState().analysis;
      return a ? promptText(a.rendered) : null;
    },
    analysis: () => {
      const a = useStore.getState().analysis;
      return a && { total: a.total, prefixTokens: a.prefixTokens, firstDynamicId: a.firstDynamicId, hints: a.hints.map((h) => h.code), warnings: a.rendered.warnings };
    },
    command: (name: keyof typeof commands, ...args: unknown[]) => {
      const c = commands[name] as unknown;
      const cmd = typeof c === "function" && (c as { length: number }).length !== 2 ? (c as (...a: unknown[]) => never)(...args) : c;
      return runCommand(cmd as never);
    },
    /** Put the caret at the end (or start) of the first textblock containing `text`. */
    caret: (text: string, where: "end" | "start" = "end") => {
      const e = activeEditor();
      if (!e) return false;
      let pos = -1;
      e.view.state.doc.descendants((n, p) => {
        if (pos >= 0) return false;
        if (n.isTextblock && n.textContent.includes(text)) {
          pos = where === "end" ? p + n.nodeSize - 1 : p + 1;
          return false;
        }
        return true;
      });
      if (pos < 0) return false;
      e.view.focus();
      e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, pos)).scrollIntoView());
      return true;
    },
    /** Select from the start of `a` to the end of `b` (textblock contents). */
    select: (a: string, b?: string) => {
      const e = activeEditor();
      if (!e) return false;
      let from = -1;
      let to = -1;
      e.view.state.doc.descendants((n, p) => {
        if (!n.isText) return true;
        const i = n.text!.indexOf(a);
        if (from < 0 && i >= 0) from = p + i;
        const j = n.text!.indexOf(b ?? a);
        if (to < 0 && j >= 0) to = p + j + (b ?? a).length;
        return true;
      });
      if (from < 0 || to < 0) return false;
      e.view.focus();
      e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, from, to)));
      return true;
    },
    /** Write straight to disk, bypassing the app (simulates an external editor), then poll. */
    writeDisk: async (path: string, text: string) => {
      await new Promise((r) => setTimeout(r, 5));
      await useStore.getState().vfs!.write(path, text);
      await pollDisk();
    },
    pollDisk,
    /** Open (and optionally reset + seed) a browser-storage workspace. */
    openBrowserWorkspace: async (name = "e2e", seed = true, reset = true) => {
      const root = await navigator.storage.getDirectory();
      if (reset) await root.removeEntry(`ws-${name}`, { recursive: true }).catch(() => {});
      const dir = await browserWorkspaceRoot(name);
      const vfs = handleVfs(dir, "browser");
      if (seed) for (const [p, t] of Object.entries(SEED)) await vfs.write(p, t);
      await openVfs(vfs);
    },
  };
}
