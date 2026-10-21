import { NodeSelection } from "prosemirror-state";
import { useStore, openModal } from "../state/store";
import { activeEditor, runCommand } from "../editor/active";
import * as cmd from "../editor/commands";
import { saveSelectionToLibrary } from "./modals/Modals";
import { resolveBlock } from "../core/workspace";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

interface Item {
  label: string;
  keys?: string;
  run(): void;
  danger?: boolean;
  testid?: string;
}

export function ContextMenu() {
  const menu = useStore((s) => s.menu);
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
      { label: "Save section to this workflow…", run: () => (close(), saveSelectionToLibrary("project", pos)) },
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
      items.push({ label: "Save to this workflow…", run: () => (close(), saveSelectionToLibrary("project")) });
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
  return (
    <DropdownMenu
      open
      modal={false}
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      {/* an invisible anchor at the click point */}
      <DropdownMenuTrigger asChild>
        <span aria-hidden style={{ position: "fixed", left: menu.x, top: menu.y, width: 1, height: 1 }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[230px]" data-testid="context-menu" onCloseAutoFocus={(e) => e.preventDefault()}>
        {items.map((it, i) =>
          it === "-" ? (
            <DropdownMenuSeparator key={i} />
          ) : (
            <DropdownMenuItem key={i} variant={it.danger ? "destructive" : "default"} onSelect={it.run} data-testid={it.testid}>
              {it.label}
              {it.keys && <DropdownMenuShortcut>{it.keys}</DropdownMenuShortcut>}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
