// Notebook-style layout: each section / chip is its own floating card, consecutive text lines
// share a card, and neighbouring cards are joined by a bridge. Purely decorations.
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";

export const layoutKey = new PluginKey("cx-layout");

const TEXT = new Set(["line", "directive"]);
const isBlank = (n: PMNode) => n.type.name === "line" && n.content.size === 0;

export interface LayoutItem {
  index: number;
  cls: string[];
}

/** Classify the children of one message. Exported for tests. */
export function layoutMessage(children: PMNode[]): LayoutItem[] {
  const out: LayoutItem[] = children.map((_, index) => ({ index, cls: [] }));
  const last = children.length - 1;
  const hasTrailing = last >= 0 && isBlank(children[last]) && !children[last].attrs.muted;
  const end = hasTrailing ? last : last + 1;
  // groups of member indexes; blank lines at the edges of a text run are gaps, not card content
  const groups: number[][] = [];
  const gaps = new Set<number>();
  let i = 0;
  while (i < end) {
    if (!TEXT.has(children[i].type.name)) {
      groups.push([i]);
      i++;
      continue;
    }
    let j = i;
    while (j < end && TEXT.has(children[j].type.name)) j++;
    let a = i;
    let b = j - 1;
    while (a <= b && isBlank(children[a])) gaps.add(a++);
    while (b >= a && isBlank(children[b])) gaps.add(b--);
    if (a <= b) groups.push(Array.from({ length: b - a + 1 }, (_, k) => a + k));
    i = j;
  }
  groups.sort((x, y) => x[0] - y[0]);
  groups.forEach((g, gi) => {
    const solo = g.length === 1 && !TEXT.has(children[g[0]].type.name);
    for (const m of g) out[m].cls.push(solo ? "cx-solo" : "cx-tc");
    if (!solo) {
      out[g[0]].cls.push("cx-tc-first");
      out[g[g.length - 1]].cls.push("cx-tc-last");
    }
    if (gi > 0) out[g[0]].cls.push("cx-has-prev");
    if (gi < groups.length - 1) out[g[g.length - 1]].cls.push("cx-has-next");
  });
  const firstStart = groups[0]?.[0] ?? Infinity;
  const lastEnd = groups.length ? groups[groups.length - 1][groups[groups.length - 1].length - 1] : -1;
  for (const gi of gaps) out[gi].cls.push(gi > firstStart && gi < lastEnd ? "cx-gap cx-gap-bridge" : "cx-gap");
  if (hasTrailing) out[last].cls.push(groups.length ? "cx-trailing" : "cx-trailing cx-empty-doc");
  return out;
}

function decorations(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.forEach((m, mOff) => {
    const kids: PMNode[] = [];
    m.forEach((c) => kids.push(c));
    const items = layoutMessage(kids);
    let pos = mOff + 1;
    kids.forEach((c, i) => {
      if (items[i].cls.length) decos.push(Decoration.node(pos, pos + c.nodeSize, { class: items[i].cls.join(" ") }));
      pos += c.nodeSize;
    });
  });
  return DecorationSet.create(doc, decos);
}

export const layoutPlugin = () =>
  new Plugin({
    key: layoutKey,
    state: {
      init: (_c, s) => decorations(s.doc),
      apply: (tr, old) => (tr.docChanged ? decorations(tr.doc) : old),
    },
    props: { decorations: (s) => layoutKey.getState(s) },
  });
