// Style markdown without hiding its symbols: "# heading" grows, "**bold**" bolds, markers stay visible.
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";

export const markdownKey = new PluginKey("cx-markdown");

const INLINE: { re: RegExp; cls: string; marker: number }[] = [
  { re: /\*\*(?=\S)([^*]*?\S)\*\*/g, cls: "md-bold", marker: 2 },
  { re: /__(?=\S)([^_]*?\S)__/g, cls: "md-bold", marker: 2 },
  { re: /(?<![*\w])\*(?=[^\s*])([^*]*?[^\s*])\*(?![*\w])/g, cls: "md-italic", marker: 1 },
  { re: /(?<![_\w])_(?=[^\s_])([^_]*?[^\s_])_(?![_\w])/g, cls: "md-italic", marker: 1 },
  { re: /`([^`]+)`/g, cls: "md-code", marker: 1 },
  { re: /~~([^~]+)~~/g, cls: "md-strike", marker: 2 },
];
const XML = /<\/?[A-Za-z][\w.:-]*(?:\s+[^<>]*?)?\/?>/g;
const PLACEHOLDER = /\{[A-Za-z_][\w]*\}/g;

export function markdownDecorations(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const start = pos + 1;
    // line-level: headings, quotes, list markers (only when the line starts with text)
    const first = node.firstChild;
    if (first?.isText) {
      const t = first.text!;
      const h = /^(#{1,6})\s/.exec(t);
      if (h) {
        decos.push(Decoration.node(pos, pos + node.nodeSize, { class: `md-h md-h${h[1].length}` }));
        decos.push(Decoration.inline(start, start + h[1].length, { class: "md-mark" }));
      }
      if (/^>\s?/.test(t)) {
        decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "md-quote" }));
        decos.push(Decoration.inline(start, start + 1, { class: "md-mark" }));
      }
      const li = /^(\s*)([-*+]|\d+[.)])\s/.exec(t);
      if (li) decos.push(Decoration.inline(start + li[1].length, start + li[1].length + li[2].length, { class: "md-list" }));
      if (/^(-{3,}|\*{3,})\s*$/.test(t) && node.childCount === 1) decos.push(Decoration.inline(start, start + t.length, { class: "md-hr" }));
    }
    node.forEach((child, off) => {
      if (!child.isText) return;
      const t = child.text!;
      const base = start + off;
      for (const { re, cls, marker } of INLINE) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(t))) {
          const a = base + m.index;
          const b = a + m[0].length;
          decos.push(Decoration.inline(a, b, { class: cls }));
          decos.push(Decoration.inline(a, a + marker, { class: "md-mark" }));
          decos.push(Decoration.inline(b - marker, b, { class: "md-mark" }));
        }
      }
      XML.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = XML.exec(t))) decos.push(Decoration.inline(base + m.index, base + m.index + m[0].length, { class: "md-xml" }));
      PLACEHOLDER.lastIndex = 0;
      while ((m = PLACEHOLDER.exec(t))) decos.push(Decoration.inline(base + m.index, base + m.index + m[0].length, { class: "md-ph" }));
    });
    return false;
  });
  return DecorationSet.create(doc, decos);
}

export const markdownPlugin = () =>
  new Plugin({
    key: markdownKey,
    state: {
      init: (_c, s) => markdownDecorations(s.doc),
      apply: (tr, old) => (tr.docChanged ? markdownDecorations(tr.doc) : old),
    },
    props: { decorations: (s) => markdownKey.getState(s) },
  });
