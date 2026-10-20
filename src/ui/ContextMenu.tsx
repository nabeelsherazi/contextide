import { useEffect, useRef } from "react";
import { NodeSelection } from "prosemirror-state";
import { useStore, openModal } from "../state/store";
import { activeEditor, runCommand } from "../editor/active";
import * as cmd from "../editor/commands";
import { saveSelectionToLibrary } from "./modals/Modals";
import { resolveBlock } from "../core/workspace";

interface Item {
  label: string;
  keys?: string;
  run(): void;
  danger?: boolean;
  testid?: string;
}

export function ContextMenu() {
  const menu = useStore((s) => s.menu);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) useStore.setState({ menu: null });
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);
  const ed = activeEditor();
  if (!menu || !ed) return null;
  const st = ed.view.state;
  const items: (Item | "-")[] = [];
  const close = () => useStore.setState({ menu: null });
  const doCmd = (c: Parameters<typeof runCommand>[0]) => () => {
    runCommand(c);
    close();
  };

  if (menu.kind === "section" && menu.pos !== undefined) {
    const pos = menu.pos;
    const sel = () => ed.view.dispatch(ed.view.state.tr.setSelection(NodeSelection.create(ed.view.state.doc, pos)));
    items.push(
      { label: "Ungroup section", run: () => (sel(), doCmd(cmd.ungroupSection)()) },
      { label: "Save section to library…", run: () => (close(), saveSelectionToLibrary("library", pos)), testid: "menu-save-section" },
      { label: "Save section to project…", run: () => (close(), saveSelectionToLibrary("project", pos)) },
      "-",
      { label: "Move up", keys: "⌥↑", run: () => (sel(), doCmd(cmd.moveCard(-1))()) },
      { label: "Move down", keys: "⌥↓", run: () => (sel(), doCmd(cmd.moveCard(1))()) },
      { label: "Delete section", danger: true, run: () => (sel(), doCmd(cmd.deleteCard)()) },
    );
  } else {
    const card = cmd.cardAt(st);
    const isUse = card?.node.type.name === "use";
    const can = (c: Parameters<typeof runCommand>[0]) => c(st, undefined);
    if (can(cmd.makeDirective)) items.push({ label: "Make directive", keys: "⌘⇧D", run: doCmd(cmd.makeDirective), testid: "menu-make-directive" });
    if (can(cmd.makeLine)) items.push({ label: "Make plain text", keys: "⌘⇧L", run: doCmd(cmd.makeLine) });
    if (can(cmd.groupAsSection())) items.push({ label: "Group as section", keys: "⌘⇧G", run: doCmd(cmd.groupAsSection("")), testid: "menu-group" });
    if (can(cmd.ungroupSection)) items.push({ label: "Ungroup section", run: doCmd(cmd.ungroupSection) });
    if (!isUse && card && card.node.type.name !== "data" && card.node.type.name !== "tool" && card.node.type.name !== "schema") {
      items.push({ label: "Save to library…", run: () => (close(), saveSelectionToLibrary("library")), testid: "menu-save-library" });
      items.push({ label: "Save to project…", run: () => (close(), saveSelectionToLibrary("project")) });
    }
    if (isUse && card) {
      const ws = useStore.getState().ws;
      const { block } = resolveBlock(ws, card.node.attrs.ref, "general", card.node.attrs.flavor ?? undefined, useStore.getState().project ?? undefined);
      items.push({ label: "Edit referenced block…", run: () => (close(), openModal({ t: "ref-edit", pos: card.pos })) });
      if (block) items.push({ label: "Detach copy", run: doCmd(cmd.detachRef(card.pos, block)), testid: "menu-detach" });
    }
    if (card) {
      items.push("-");
      items.push({ label: card.node.attrs.muted ? "Unmute" : "Mute", keys: "⌘⇧M", run: doCmd(cmd.toggleMute), testid: "menu-mute" });
      items.push({ label: "Move up", keys: "⌥↑", run: doCmd(cmd.moveCard(-1)) });
      items.push({ label: "Move down", keys: "⌥↓", run: doCmd(cmd.moveCard(1)) });
      items.push({ label: "Delete card", danger: true, run: doCmd(cmd.deleteCard) });
    }
  }
  if (!items.length) return null;
  const x = Math.min(menu.x, window.innerWidth - 240);
  const y = Math.min(menu.y, window.innerHeight - items.length * 32 - 20);
  return (
    <div ref={ref} className="cx-popover cx-menu" style={{ left: x, top: y }} data-testid="context-menu" onMouseDown={(e) => e.preventDefault()}>
      {items.map((it, i) =>
        it === "-" ? (
          <div key={i} className="cx-menu-sep" />
        ) : (
          <button key={i} className={`cx-menu-item${it.danger ? " danger" : ""}`} onClick={it.run} data-testid={it.testid}>
            <span className="cx-menu-label">{it.label}</span>
            {it.keys && <span className="cx-menu-hint">{it.keys}</span>}
          </button>
        ),
      )}
    </div>
  );
}
