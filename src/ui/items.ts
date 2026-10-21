// Things you can insert: shared by the slash menu, the palette and the drawer.
import { type Workspace, type Block, mergedVars } from "../core/workspace";
import { INSERTIONS } from "../core/insertions";
import { forBlock, forData, forInsertion, forVar, newDirective, newSection, type Insertable } from "../editor/blocks";

export interface MenuItem {
  id: string;
  /** an icon name, see ui/icons.tsx */
  icon: string;
  label: string;
  hint?: string;
  group: string;
  keywords?: string;
  make(): Insertable | null;
}

export const KIND_ICON: Record<string, string> = { directive: "directive", section: "section", insertion: "clock", tool: "tool", schema: "schema", data: "data" };

/** Variants visible under a flavor filter: the flavor's own plus general. */
export function visibleBlocks(ws: Workspace, project: string | undefined, flavor: string): Block[] {
  const all = ws.blocks.filter((b) => b.scope === "library" || b.project === project);
  if (flavor === "all") return all;
  const byKey = new Map<string, Block>();
  for (const b of all) {
    if (b.flavor !== flavor && b.flavor !== "general") continue;
    const prev = byKey.get(b.key);
    if (!prev || (prev.flavor === "general" && b.flavor === flavor) || (prev.scope === "library" && b.scope === "project" && b.flavor === prev.flavor)) byKey.set(b.key, b);
  }
  return [...byKey.values()];
}

export function allItems(ws: Workspace, project: string | undefined, flavor: string): MenuItem[] {
  const items: MenuItem[] = [
    { id: "new:directive", icon: "directive", label: "Directive", hint: "new, inline", group: "New", make: newDirective },
    { id: "new:section", icon: "section", label: "Section", hint: "new, inline", group: "New", make: newSection },
  ];
  const p0 = ws.projects.find((x) => x.name === project);
  for (const [name, value] of Object.entries(mergedVars(ws, p0)))
    items.push({ id: `var:${name}`, icon: "variable", label: name, hint: value.length > 30 ? value.slice(0, 29) + "…" : value, group: "Variable", keywords: `variable var ${value}`, make: () => forVar(name) });
  for (const ins of INSERTIONS) items.push({ id: `ins:${ins.fn}`, icon: ins.icon, label: ins.label, hint: ins.fn, group: "Insertion", keywords: ins.doc, make: () => forInsertion(ins.fn) });
  for (const b of visibleBlocks(ws, project, flavor).sort((a, b2) => a.kind.localeCompare(b2.kind) || a.fn.localeCompare(b2.fn)))
    items.push({
      id: `block:${b.key}`,
      icon: KIND_ICON[b.kind],
      label: b.fn,
      hint: [b.type, b.flavor !== "general" ? b.flavor : "", b.scope === "project" ? "project" : ""].filter(Boolean).join(" · "),
      group: b.kind[0].toUpperCase() + b.kind.slice(1) + (b.kind === "insertion" ? " preset" : ""),
      keywords: `${b.kind} ${b.type} ${b.body.slice(0, 200)}`,
      make: () => forBlock(b),
    });
  const p = ws.projects.find((x) => x.name === project);
  for (const d of p?.data ?? []) items.push({ id: `data:${d.name}`, icon: "data", label: d.name, hint: d.format, group: "Data", make: () => forData(d.name) });
  return items;
}

export function matches(it: MenuItem, q: string): boolean {
  if (!q) return true;
  const hay = `${it.label} ${it.hint ?? ""} ${it.group} ${it.keywords ?? ""}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((w) => hay.includes(w));
}

export function slashItems(ws: Workspace, project: string | undefined, flavor: string, q: string): MenuItem[] {
  return allItems(ws, project, flavor).filter((i) => matches(i, q));
}
