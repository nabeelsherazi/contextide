// Registry of the focused editor, so menus, the palette and tests can drive it.
import type { EditorView } from "prosemirror-view";
import type { Command } from "prosemirror-state";

export interface ActiveEditor {
  key: string;
  view: EditorView;
  /** merge into the document's frontmatter (version files) and save */
  setFront(patch: Record<string, unknown>): void;
  /** write pending edits now */
  flush(): void;
}

let active: ActiveEditor | null = null;
export const setActiveEditor = (e: ActiveEditor | null) => {
  active = e;
};
export const activeEditor = () => active;

export function runCommand(c: Command): boolean {
  const e = active;
  if (!e) return false;
  const ok = c(e.view.state, e.view.dispatch);
  e.view.focus();
  return ok;
}
