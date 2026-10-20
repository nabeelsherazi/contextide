// Pure editor commands. Each takes (state, dispatch?) like ProseMirror commands,
// so they can be tested headlessly and bound to keys, menus and the palette.
import { type EditorState, type Transaction, NodeSelection, TextSelection, type Command } from "prosemirror-state";
import { Fragment, Slice, type Node as PMNode, type ResolvedPos } from "prosemirror-model";
import { dropPoint } from "prosemirror-transform";
import { schema } from "./schema";
import { nodeToPM, inlineToPM } from "./convert";
import { parseBody, parseInline } from "../core/doc";

export type Dispatch = ((tr: Transaction) => void) | undefined;

const CARD = new Set(["line", "directive", "section", "use", "data", "tool", "schema"]);

export interface CardRef {
  node: PMNode;
  pos: number;
  depth: number;
}

/** The card containing the selection head (deepest card). */
export function cardAt(state: EditorState, at?: number): CardRef | null {
  const sel = state.selection;
  if (at === undefined && sel instanceof NodeSelection && CARD.has(sel.node.type.name)) return { node: sel.node, pos: sel.from, depth: sel.$from.depth + 1 };
  const $p = state.doc.resolve(at ?? sel.from);
  for (let d = $p.depth; d > 0; d--) {
    const n = $p.node(d);
    if (CARD.has(n.type.name)) return { node: n, pos: $p.before(d), depth: d };
  }
  const after = $p.nodeAfter;
  if (after && CARD.has(after.type.name)) return { node: after, pos: $p.pos, depth: $p.depth + 1 };
  return null;
}

/** Top-level card ranges (within one parent) covered by the selection. */
function selectedSiblings(state: EditorState): { start: number; end: number; parent: PMNode; from: number; to: number; $from: ResolvedPos } | null {
  const { $from, $to } = state.selection;
  const range = $from.blockRange($to, (n) => n.type.name === "message" || n.type.name === "section");
  if (!range) return null;
  return { start: range.start, end: range.end, parent: range.parent, from: range.startIndex, to: range.endIndex, $from: range.$from };
}

// ---------- insertion ----------

/** Insert a card node after the card at the selection (or at `pos`). */
export function insertCard(node: PMNode, pos?: number): Command {
  return (state, dispatch) => {
    let at: number;
    if (pos !== undefined) {
      const p = dropPoint(state.doc, pos, new Slice(Fragment.from(node), 0, 0));
      at = p ?? pos;
    } else {
      const c = cardAt(state);
      if (!c) at = state.doc.child(state.doc.childCount - 1).nodeSize + positionOfLastMessage(state) - 1;
      else {
        // sections only live in messages: if inserting a section from inside a section, go after the section
        let ref = c;
        if (node.type.name === "section" && c.depth > 2) ref = cardAt(state, state.doc.resolve(c.pos).before(c.depth - 1))!;
        const empty = ref.node.type.name === "line" && ref.node.content.size === 0;
        if (empty) {
          if (dispatch) {
            const tr = state.tr.replaceWith(ref.pos, ref.pos + ref.node.nodeSize, node);
            selectAfterInsert(tr, ref.pos, node);
            dispatch(tr.scrollIntoView());
          }
          return true;
        }
        at = ref.pos + ref.node.nodeSize;
      }
    }
    const $at = state.doc.resolve(at);
    if (!$at.parent.canReplaceWith($at.index(), $at.index(), node.type)) return false;
    if (dispatch) {
      const tr = state.tr.insert(at, node);
      selectAfterInsert(tr, at, node);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

function positionOfLastMessage(state: EditorState) {
  let pos = 0;
  state.doc.forEach((_n, off) => (pos = off));
  return pos;
}

function selectAfterInsert(tr: Transaction, at: number, node: PMNode) {
  if (node.isTextblock) tr.setSelection(TextSelection.create(tr.doc, at + 1 + node.content.size));
  else if (node.type.name === "section") tr.setSelection(TextSelection.near(tr.doc.resolve(at + 2)));
  else tr.setSelection(NodeSelection.create(tr.doc, at));
}

export function insertInline(node: PMNode): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    if (!$from.parent.isTextblock) return false;
    if (dispatch) dispatch(state.tr.replaceSelectionWith(node, false).scrollIntoView());
    return true;
  };
}

// ---------- structure ----------

/** Convert the selected line(s) to directives. A partial selection in one line is split out. */
export const makeDirective: Command = (state, dispatch) => {
  const { $from, $to, from, to, empty } = state.selection;
  if (!$from.parent.isTextblock) return false;
  const tr = state.tr;
  if (!empty && $from.sameParent($to) && $from.parent.type.name === "line" && (from > $from.start() || to < $to.end())) {
    // split the selected text out into its own directive line
    const line = $from.parent;
    const start = $from.start();
    const before = trimFrag(line.content.cut(0, from - start), "end");
    const mid = trimFrag(line.content.cut(from - start, to - start), "both");
    const after = trimFrag(line.content.cut(to - start), "start");
    const nodes: PMNode[] = [];
    if (before.size) nodes.push(schema.nodes.line.create({ muted: line.attrs.muted }, before));
    nodes.push(schema.nodes.directive.create(null, mid));
    if (after.size) nodes.push(schema.nodes.line.create({ muted: line.attrs.muted }, after));
    tr.replaceWith($from.before(), $from.after(), nodes);
    if (dispatch) dispatch(tr.scrollIntoView());
    return true;
  }
  let changed = false;
  state.doc.nodesBetween(from, to, (n, pos) => {
    if (n.type.name === "line") {
      tr.setNodeMarkup(pos, schema.nodes.directive, { muted: n.attrs.muted, from: null });
      changed = true;
    }
    return n.type.name === "doc" || n.type.name === "message" || n.type.name === "section";
  });
  if (!changed) return false;
  if (dispatch) dispatch(tr.scrollIntoView());
  return true;
};

function trimFrag(f: Fragment, side: "start" | "end" | "both"): Fragment {
  const nodes: PMNode[] = [];
  f.forEach((n) => nodes.push(n));
  const trimText = (n: PMNode, fn: (t: string) => string) => {
    const t = fn(n.text!);
    return t ? schema.text(t) : null;
  };
  if ((side === "start" || side === "both") && nodes[0]?.isText) {
    const t = trimText(nodes[0], (x) => x.trimStart());
    if (t) nodes[0] = t;
    else nodes.shift();
  }
  const last = nodes.length - 1;
  if ((side === "end" || side === "both") && nodes[last]?.isText) {
    const t = trimText(nodes[last], (x) => x.trimEnd());
    if (t) nodes[last] = t;
    else nodes.pop();
  }
  return Fragment.fromArray(nodes);
}

/** Convert directive(s) back to plain lines. */
export const makeLine: Command = (state, dispatch) => {
  const { from, to } = state.selection;
  const tr = state.tr;
  let changed = false;
  state.doc.nodesBetween(from, to, (n, pos) => {
    if (n.type.name === "directive") {
      tr.setNodeMarkup(pos, schema.nodes.line, { muted: n.attrs.muted });
      changed = true;
    }
    return n.type.name === "doc" || n.type.name === "message" || n.type.name === "section";
  });
  if (!changed) return false;
  if (dispatch) dispatch(tr);
  return true;
};

/** Wrap the selected cards (siblings in a message) in a section. */
export function groupAsSection(title = ""): Command {
  return (state, dispatch) => {
    const r = selectedSiblings(state);
    if (!r || r.parent.type.name !== "message") return false;
    const kids: PMNode[] = [];
    for (let i = r.from; i < r.to; i++) {
      const c = r.parent.child(i);
      if (c.type.name === "section") c.forEach((g) => kids.push(g));
      else kids.push(c);
    }
    if (!kids.length) return false;
    const sec = schema.nodes.section.create({ title }, kids);
    const { start, end } = r;
    if (dispatch) {
      const tr = state.tr.replaceWith(start, end, sec);
      tr.setSelection(NodeSelection.create(tr.doc, start));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** Dissolve the section at the selection into its children. */
export const ungroupSection: Command = (state, dispatch) => {
  const c = cardAt(state);
  if (!c) return false;
  const sec = c.node.type.name === "section" ? c : c.depth > 2 ? cardAt(state, state.doc.resolve(c.pos).before(c.depth - 1)) : null;
  if (!sec || sec.node.type.name !== "section") return false;
  if (dispatch) dispatch(state.tr.replaceWith(sec.pos, sec.pos + sec.node.nodeSize, sec.node.content).scrollIntoView());
  return true;
};

/** Toggle muted on the selected card(s). */
export const toggleMute: Command = (state, dispatch) => {
  const sel = state.selection;
  const targets: CardRef[] = [];
  if (sel.empty || sel instanceof NodeSelection) {
    const c = cardAt(state);
    if (c) targets.push(c);
  } else {
    state.doc.nodesBetween(sel.from, sel.to, (n, pos) => {
      if (CARD.has(n.type.name) && n.type.name !== "section") targets.push({ node: n, pos, depth: 0 });
      return !CARD.has(n.type.name) || n.type.name === "section";
    });
  }
  if (!targets.length) return false;
  const to = !targets[0].node.attrs.muted;
  if (dispatch) {
    const tr = state.tr;
    for (const t of targets) tr.setNodeAttribute(t.pos, "muted", to);
    dispatch(tr);
  }
  return true;
};

/** Move the card at the selection up (-1) or down (+1). Leaves a section at its edges. */
export function moveCard(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const c = cardAt(state);
    if (!c) return false;
    const $c = state.doc.resolve(c.pos);
    const parent = $c.parent;
    const idx = $c.index();
    const node = c.node;
    const sel = state.selection;
    const relSel = sel instanceof NodeSelection ? null : { a: sel.anchor - c.pos, h: sel.head - c.pos };
    const tr = state.tr;
    let newPos: number;
    const target = idx + dir;
    if (target >= 0 && target < parent.childCount) {
      const sib = parent.child(target);
      tr.delete(c.pos, c.pos + node.nodeSize);
      if (dir < 0) {
        newPos = c.pos - sib.nodeSize;
      } else {
        newPos = c.pos + sib.nodeSize;
      }
      tr.insert(newPos, node);
    } else if (parent.type.name === "section") {
      // move out of the section, before or after it
      const secPos = $c.before();
      const sec = parent;
      if (sec.childCount === 1) return false;
      tr.delete(c.pos, c.pos + node.nodeSize);
      newPos = dir < 0 ? secPos : tr.mapping.map(secPos + sec.nodeSize);
      tr.insert(newPos, node);
    } else return false;
    if (relSel) tr.setSelection(TextSelection.create(tr.doc, newPos + relSel.a, newPos + relSel.h));
    else tr.setSelection(NodeSelection.create(tr.doc, newPos));
    if (dispatch) dispatch(tr.scrollIntoView());
    return true;
  };
}

/** Move a card at `from` to a drop position. */
export function moveCardTo(from: number, to: number): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(from);
    if (!node) return false;
    const tr = state.tr.delete(from, from + node.nodeSize);
    const mapped = tr.mapping.map(to);
    const at = dropPoint(tr.doc, mapped, new Slice(Fragment.from(node), 0, 0));
    if (at === null) return false;
    tr.insert(at, node);
    if (dispatch) dispatch(tr.setSelection(NodeSelection.create(tr.doc, at)).scrollIntoView());
    return true;
  };
}

export const deleteCard: Command = (state, dispatch) => {
  const c = cardAt(state);
  if (!c) return false;
  const $c = state.doc.resolve(c.pos);
  if (dispatch) {
    const tr = state.tr;
    if ($c.parent.childCount === 1) tr.replaceWith(c.pos, c.pos + c.node.nodeSize, schema.nodes.line.create());
    else tr.delete(c.pos, c.pos + c.node.nodeSize);
    dispatch(tr.scrollIntoView());
  }
  return true;
};

export function setCardAttrs(pos: number, attrs: Record<string, unknown>): Command {
  return (state, dispatch) => {
    const n = state.doc.nodeAt(pos);
    if (!n) return false;
    if (dispatch) dispatch(state.tr.setNodeMarkup(pos, undefined, { ...n.attrs, ...attrs }));
    return true;
  };
}

/** Replace the card(s) in the selection with a library reference. */
export function replaceWithRef(ref: string): Command {
  return (state, dispatch) => {
    const r = selectedSiblings(state);
    if (!r) return false;
    const { start, end } = r;
    const use = schema.nodes.use.create({ ref });
    if (!r.parent.canReplaceWith(r.from, r.to, use.type)) return false;
    if (dispatch) {
      const tr = state.tr.replaceWith(start, end, use);
      dispatch(tr.setSelection(NodeSelection.create(tr.doc, start)));
    }
    return true;
  };
}

/** Replace a `use` card with an editable copy of the block's text. */
export function detachRef(pos: number, block: { kind: string; body: string; fn: string; front: Record<string, unknown> }): Command {
  return (state, dispatch) => {
    const n = state.doc.nodeAt(pos);
    if (!n || n.type.name !== "use") return false;
    const from = n.attrs.ref;
    let nodes: PMNode[];
    if (block.kind === "section") {
      const kids = (parseBody(block.body)[0]?.children ?? []).filter((c) => c.k !== "section").map(nodeToPM);
      const inSection = state.doc.resolve(pos).parent.type.name === "section";
      if (inSection) nodes = kids;
      else
        nodes = [
          schema.nodes.section.create(
            { title: String(block.front.title ?? block.fn), frame: block.front.frame ?? "auto", list: block.front.list ?? "plain", from },
            kids.length ? kids : [schema.nodes.line.create()],
          ),
        ];
    } else {
      const lines = block.body.split("\n");
      nodes = lines.map((l, i) => (block.kind === "directive" && i === 0 ? schema.nodes.directive.create({ from }, inlineToPM(parseInline(l))) : schema.nodes.line.create(null, inlineToPM(parseInline(l)))));
    }
    if (dispatch) dispatch(state.tr.replaceWith(pos, pos + n.nodeSize, nodes).scrollIntoView());
    return true;
  };
}

/** Add a message with a role. System goes first, assistant (prefill) goes last. */
export function addMessage(role: "system" | "user" | "assistant"): Command {
  return (state, dispatch) => {
    const msg = schema.nodes.message.create({ role }, [schema.nodes.line.create()]);
    const at = role === "system" ? 0 : state.doc.content.size;
    if (dispatch) {
      const tr = state.tr.insert(at, msg);
      dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 2)).scrollIntoView());
    }
    return true;
  };
}

export function removeMessage(pos: number): Command {
  return (state, dispatch) => {
    if (state.doc.childCount <= 1) return false;
    const n = state.doc.nodeAt(pos);
    if (!n || n.type.name !== "message") return false;
    if (dispatch) dispatch(state.tr.delete(pos, pos + n.nodeSize));
    return true;
  };
}

/** Selected text (plain), for "save to library". */
export function selectedText(state: EditorState): string {
  const { from, to } = state.selection;
  return state.doc.textBetween(from, to, "\n", (n) => (n.type.name === "insertion" ? `{{${n.attrs.fn}}}` : ""));
}

/** The selected sibling cards as a Fragment (for saving a section). */
export function selectedCards(state: EditorState): PMNode[] {
  const r = selectedSiblings(state);
  if (!r) return [];
  const out: PMNode[] = [];
  for (let i = r.from; i < r.to; i++) out.push(r.parent.child(i));
  return out;
}
