// AST (core/doc) <-> ProseMirror document.
import type { Node as PMNode } from "prosemirror-model";
import { schema } from "./schema";
import { type Inline, type Message, type Node, type Frame, type ListStyle } from "../core/doc";
import { fmtPipeline, parsePipeline, type Call } from "../core/expr";

const s = schema;

export function inlineToPM(content: Inline[]): PMNode[] {
  const out: PMNode[] = [];
  for (const x of content) {
    if (x.t === "text") {
      if (x.text) out.push(s.text(x.text));
    } else out.push(s.nodes.insertion.create({ fn: x.fn, pos: JSON.stringify(x.pos), args: JSON.stringify(x.args) }));
  }
  return out;
}

export function pipeToString(pipe: Call[]): string {
  return fmtPipeline(pipe);
}

export function pipeFromString(src: string): Call[] {
  const t = src.trim();
  if (!t) return [];
  try {
    return parsePipeline(t).calls;
  } catch {
    return [];
  }
}

export function nodeToPM(n: Node): PMNode {
  const muted = !!n.muted;
  switch (n.k) {
    case "line":
      return s.nodes.line.create({ muted }, inlineToPM(n.content));
    case "directive":
      return s.nodes.directive.create({ muted, from: n.from ?? null }, inlineToPM(n.content));
    case "section": {
      const kids = n.children.filter((c) => c.k !== "section").map(nodeToPM);
      // flatten nested sections (not supported in the editor) into their children
      for (const c of n.children) if (c.k === "section") kids.push(...c.children.filter((x) => x.k !== "section").map(nodeToPM));
      if (!kids.length) kids.push(s.nodes.line.create());
      return s.nodes.section.create({ title: n.title, frame: n.frame, list: n.list, muted, from: n.from ?? null }, kids);
    }
    case "use":
      return s.nodes.use.create({ ref: n.ref, flavor: n.flavor ?? null, muted });
    case "data":
      return s.nodes.data.create({ source: n.source, pipe: pipeToString(n.pipe), static: !!n.static, muted });
    case "tool":
      return s.nodes.tool.create({ name: n.name, mode: n.mode, muted });
    case "schema":
      return s.nodes.schema.create({ name: n.name, mode: n.mode, strict: n.strict ?? null, muted });
  }
}

const isBlankLine = (n: PMNode | null | undefined) => !!n && n.type.name === "line" && n.content.size === 0 && !n.attrs.muted;

/** Every message ends with an empty line in the editor, so there is always somewhere to click and type. */
export function docToPM(messages: Message[]): PMNode {
  const ms = messages.map((m) => {
    const kids = m.children.map(nodeToPM);
    if (!isBlankLine(kids[kids.length - 1])) kids.push(s.nodes.line.create());
    return s.nodes.message.create({ role: m.role, muted: !!m.muted }, kids);
  });
  return s.nodes.doc.create(null, ms);
}

export function inlineFromPM(n: PMNode): Inline[] {
  const out: Inline[] = [];
  n.forEach((c) => {
    if (c.isText) {
      const last = out[out.length - 1];
      if (last && last.t === "text") last.text += c.text!;
      else out.push({ t: "text", text: c.text! });
    } else if (c.type.name === "insertion") {
      let pos = [];
      let args = {};
      try {
        pos = JSON.parse(c.attrs.pos);
        args = JSON.parse(c.attrs.args);
      } catch {
        /* keep defaults */
      }
      out.push({ t: "ins", fn: c.attrs.fn, pos, args });
    }
  });
  return out;
}

export function nodeFromPM(n: PMNode): Node {
  const muted = n.attrs.muted ? true : undefined;
  switch (n.type.name) {
    case "directive":
      return { k: "directive", content: inlineFromPM(n), muted, from: n.attrs.from ?? undefined };
    case "section": {
      const children: Node[] = [];
      n.forEach((c) => children.push(nodeFromPM(c)));
      return { k: "section", title: n.attrs.title, frame: n.attrs.frame as Frame, list: n.attrs.list as ListStyle, muted, from: n.attrs.from ?? undefined, children };
    }
    case "use":
      return { k: "use", ref: n.attrs.ref, flavor: n.attrs.flavor ?? undefined, muted };
    case "data":
      return { k: "data", source: n.attrs.source, pipe: pipeFromString(n.attrs.pipe), static: n.attrs.static ? true : undefined, muted };
    case "tool":
      return { k: "tool", name: n.attrs.name, mode: n.attrs.mode, muted };
    case "schema":
      return { k: "schema", name: n.attrs.name, mode: n.attrs.mode, strict: n.attrs.strict ?? undefined, muted };
    default:
      return { k: "line", content: inlineFromPM(n), muted };
  }
}

export function docFromPM(doc: PMNode): Message[] {
  const out: Message[] = [];
  doc.forEach((m) => {
    const children: Node[] = [];
    m.forEach((c, _o, i) => {
      if (i === m.childCount - 1 && i > 0 && isBlankLine(c)) return; // the editor's trailing line
      children.push(nodeFromPM(c));
    });
    out.push({ role: m.attrs.role, muted: m.attrs.muted ? true : undefined, children });
  });
  return out;
}

/** Keep a blank trailing line at the end of every message. */
export function trailingLineFixes(doc: PMNode): number[] {
  const at: number[] = [];
  doc.forEach((m, off) => {
    if (!isBlankLine(m.lastChild)) at.push(off + m.nodeSize - 1);
  });
  return at;
}

/** Map AST card ids ("0/3/1") to ProseMirror positions (before the node). */
export function cardPositions(doc: PMNode): Map<string, number> {
  const map = new Map<string, number>();
  doc.forEach((m, mOff, mi) => {
    const mStart = mOff + 1;
    m.forEach((c, cOff, ci) => {
      const pos = mStart + cOff;
      map.set(`${mi}/${ci}`, pos);
      if (c.type.name === "section")
        c.forEach((_g, gOff, gi) => {
          map.set(`${mi}/${ci}/${gi}`, pos + 1 + gOff);
        });
    });
  });
  return map;
}

/** The card id for a resolved position inside the doc (deepest card containing it). */
export function cardIdAt(doc: PMNode, pos: number): { id: string; pos: number } | null {
  const $p = doc.resolve(Math.min(Math.max(pos, 0), doc.content.size));
  const idx: number[] = [];
  for (let d = 0; d < $p.depth; d++) idx.push($p.index(d));
  // idx[0] = message, idx[1] = card, idx[2] = section child
  if (idx.length < 2) {
    const after = $p.nodeAfter;
    if ($p.depth === 1 && after) return { id: `${$p.index(0)}/${$p.index(1)}`, pos };
    return null;
  }
  if ($p.depth === 2 && $p.parent.type.name === "section" && $p.nodeAfter) {
    return { id: `${idx[0]}/${idx[1]}/${$p.index(2)}`, pos };
  }
  const depth = Math.min($p.depth, idx.length >= 3 && $p.node(2).type.name === "section" ? 3 : 2);
  const id = idx.slice(0, depth).join("/");
  return { id, pos: $p.before(depth) };
}
