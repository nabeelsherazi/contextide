import { Plugin, PluginKey, TextSelection, NodeSelection, type EditorState, type Transaction, type Command } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { Slice, Fragment, type Node as PMNode } from "prosemirror-model";
import { keymap } from "prosemirror-keymap";
import { baseKeymap, chainCommands, splitBlock } from "prosemirror-commands";
import { undo, redo, history } from "prosemirror-history";
import { dropCursor } from "prosemirror-dropcursor";
import { schema } from "./schema";
import { cardPositions, nodeToPM, trailingLineFixes } from "./convert";
import { gapCursor } from "prosemirror-gapcursor";
import * as cmd from "./commands";
import { markdownPlugin } from "./markdown";
import { parseBody } from "../core/doc";
import { parsePipeline, fmtPipeline } from "../core/expr";
import type { Analysis } from "../state/analysis";
import type { Hint } from "../core/lint";

// ---------- analysis decorations (stable prefix tint, cut line, token gutter, hints) ----------

export const analysisKey = new PluginKey<{ a: Analysis | null; opts: AnalysisOpts; decos: DecorationSet }>("cx-analysis");
export interface AnalysisOpts {
  tint: boolean;
  gutter: boolean;
}

function analysisDecos(doc: PMNode, a: Analysis | null, opts: AnalysisOpts): DecorationSet {
  if (!a) return DecorationSet.empty;
  const decos: Decoration[] = [];
  const hints = new Map<string, Hint[]>();
  for (const h of a.hints) hints.set(h.id, [...(hints.get(h.id) ?? []), h]);
  for (const [id, pos] of cardPositions(doc)) {
    const n = doc.nodeAt(pos);
    if (!n) continue;
    const attrs: Record<string, string> = {};
    const cls: string[] = [];
    if (opts.tint && a.stable.has(id)) cls.push("cx-stable");
    if (opts.tint && a.firstDynamicId === id) {
      cls.push("cx-cut-card");
      if (a.cutInsertionIndex >= 0) {
        let k = -1;
        n.descendants((c, off) => {
          if (c.type.name === "insertion" && ++k === a.cutInsertionIndex) {
            decos.push(Decoration.widget(pos + 1 + off, () => cutMark(), { side: -1, key: "cut" }));
          }
          return true;
        });
      } else cls.push("cx-cut-top");
    }
    const t = a.tokens.get(id);
    if (opts.gutter && t !== undefined && !(n.type.name === "line" && n.content.size === 0)) attrs["data-tokens"] = String(t);
    const hs = hints.get(id);
    if (hs?.length) {
      const level = hs.some((h) => h.level === "error") ? "error" : hs.some((h) => h.level === "warn") ? "warn" : "info";
      cls.push(`cx-hint-${level}`);
      attrs["data-hint"] = hs.map((h) => h.msg).join("\n");
    }
    if (cls.length) attrs.class = cls.join(" ");
    if (Object.keys(attrs).length) decos.push(Decoration.node(pos, pos + n.nodeSize, attrs));
  }
  return DecorationSet.create(doc, decos);
}

function cutMark() {
  const s = document.createElement("span");
  s.className = "cx-cutmark";
  s.title = "Stable prefix ends here — everything after this can change between runs";
  return s;
}

export const analysisPlugin = (opts: AnalysisOpts) =>
  new Plugin({
    key: analysisKey,
    state: {
      init: (): { a: Analysis | null; opts: AnalysisOpts; decos: DecorationSet } => ({ a: null, opts, decos: DecorationSet.empty }),
      apply(tr, prev) {
        const meta = tr.getMeta(analysisKey) as { a?: Analysis | null; opts?: AnalysisOpts } | undefined;
        if (meta) {
          const a = meta.a !== undefined ? meta.a : prev.a;
          const o = meta.opts ?? prev.opts;
          return { a, opts: o, decos: analysisDecos(tr.doc, a, o) };
        }
        return { ...prev, decos: tr.docChanged ? prev.decos.map(tr.mapping, tr.doc) : prev.decos };
      },
    },
    props: { decorations: (s) => analysisKey.getState(s)?.decos },
  });

export const setAnalysis = (view: EditorView, a: Analysis | null, opts?: AnalysisOpts) => view.dispatch(view.state.tr.setMeta(analysisKey, { a, opts }).setMeta("addToHistory", false));

// ---------- slash menu ----------

export interface SlashState {
  open: boolean;
  from: number;
  query: string;
}
export const slashKey = new PluginKey<SlashState>("cx-slash");

export interface SlashBridge {
  /** return true if the key was handled by the menu */
  onKey(key: string): boolean;
  onChange(s: SlashState, view: EditorView): void;
}

export const slashPlugin = (bridge: SlashBridge) =>
  new Plugin<SlashState>({
    key: slashKey,
    state: {
      init: () => ({ open: false, from: 0, query: "" }),
      apply(tr, prev, _old, state) {
        const meta = tr.getMeta(slashKey) as Partial<SlashState> | undefined;
        const next = meta ? { ...prev, ...meta } : { ...prev, from: tr.mapping.map(prev.from) };
        if (!next.open) return { open: false, from: 0, query: "" };
        // always derive the query from the document, so fast typing can't race the menu opening
        const { $head } = state.selection;
        const from = next.from;
        const text = $head.parent.isTextblock && from >= $head.start() && $head.pos >= from + 1 ? state.doc.textBetween(from, $head.pos) : "";
        if (!text.startsWith("/") || /\s/.test(text) || !state.selection.empty) return { open: false, from: 0, query: "" };
        return { open: true, from, query: text.slice(1) };
      },
    },
    view: () => ({
      update(view) {
        bridge.onChange(slashKey.getState(view.state)!, view);
      },
    }),
    props: {
      handleTextInput(view, from, _to, text) {
        if (text !== "/") return false;
        const $f = view.state.doc.resolve(from);
        const before = $f.parent.textBetween(0, $f.parentOffset);
        if (before.trim() !== "") return false;
        setTimeout(() => view.dispatch(view.state.tr.setMeta(slashKey, { open: true, from, query: "" })), 0);
        return false;
      },
      handleKeyDown(view, e) {
        const st = slashKey.getState(view.state);
        if (!st?.open) return false;
        if (e.key === "Escape") {
          view.dispatch(view.state.tr.setMeta(slashKey, { open: false }));
          return true;
        }
        if (["ArrowUp", "ArrowDown", "Enter", "Tab"].includes(e.key)) return bridge.onKey(e.key);
        return false;
      },
    },
  });

/** Remove the "/query" text and close the menu. */
export function consumeSlash(view: EditorView): Transaction {
  const st = slashKey.getState(view.state)!;
  const tr = view.state.tr.delete(st.from, view.state.selection.head).setMeta(slashKey, { open: false });
  return tr;
}

// ---------- keymap ----------

/** Enter on an empty directive turns it back into a plain line. */
const exitEmptyDirective: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type.name !== "directive" || $from.parent.content.size) return false;
  if (dispatch) dispatch(state.tr.setNodeMarkup($from.before(), schema.nodes.line));
  return true;
};

/** Backspace at the start of a directive turns it into a line. */
const directiveToLineAtStart: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type.name !== "directive" || $from.parentOffset > 0) return false;
  if (dispatch) dispatch(state.tr.setNodeMarkup($from.before(), schema.nodes.line, { muted: $from.parent.attrs.muted }));
  return true;
};

/** Enter in a line splits into a new plain line (never inherits directive-ness from the left side). */
const splitLine: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if ($from.parent.type.name !== "line") return false;
  return splitBlock(state, dispatch);
};

export function editorKeymap(extra: Record<string, Command> = {}) {
  return keymap({
    "Mod-z": undo,
    "Shift-Mod-z": redo,
    "Mod-y": redo,
    Enter: chainCommands(exitEmptyDirective, splitLine, splitBlock),
    Backspace: directiveToLineAtStart,
    "Alt-ArrowUp": cmd.moveCard(-1),
    "Alt-ArrowDown": cmd.moveCard(1),
    "Mod-Shift-d": cmd.makeDirective,
    "Mod-Shift-l": cmd.makeLine,
    "Mod-Shift-g": cmd.groupAsSection(""),
    "Mod-Shift-m": cmd.toggleMute,
    ...extra,
  });
}

// ---------- drop, paste, input rules ----------

export const DRAG_MIME = "application/x-contextide";

export type DragPayload = { type: "card"; node: unknown } | { type: "inline"; node: unknown };

export const interactionPlugin = (onContextMenu: (view: EditorView, e: MouseEvent) => void) =>
  new Plugin({
    props: {
      handleDrop(view, event) {
        const raw = event.dataTransfer?.getData(DRAG_MIME);
        if (!raw) return false;
        event.preventDefault();
        let payload: DragPayload;
        try {
          payload = JSON.parse(raw);
        } catch {
          return true;
        }
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!at) return true;
        const node = schema.nodeFromJSON(payload.node);
        if (payload.type === "inline") {
          const $p = view.state.doc.resolve(at.pos);
          if ($p.parent.isTextblock) view.dispatch(view.state.tr.insert(at.pos, node).scrollIntoView());
          else cmd.insertCard(schema.nodes.line.create(null, node), at.pos)(view.state, view.dispatch);
        } else cmd.insertCard(node, at.pos)(view.state, view.dispatch);
        view.focus();
        return true;
      },
      clipboardTextParser(text, $context) {
        const kids = parseBody(text)[0]?.children ?? [];
        const inSection = $context.node($context.depth - 1)?.type.name === "section" || $context.parent.type.name === "section";
        const nodes = kids.flatMap((k) => (k.k === "section" && inSection ? k.children.filter((c) => c.k !== "section").map(nodeToPM) : [nodeToPM(k)]));
        return new Slice(Fragment.fromArray(nodes), 1, 1);
      },
      handleTextInput(view, from, to, text) {
        if (text !== "}") return false;
        const $f = view.state.doc.resolve(from);
        if (!$f.parent.isTextblock) return false;
        const before = $f.parent.textBetween(0, $f.parentOffset, undefined, "\ufffc");
        const m = /\{\{([^{}\ufffc]+)\}$/.exec(before);
        if (!m) return false;
        try {
          const p = parsePipeline(m[1]);
          if (p.literal !== undefined || !p.calls.length) return false;
          const c = p.calls[0];
          const start0 = from - m[0].length;
          // a whole line of {{ data("x") | ... }} becomes a data card
          if (c.fn === "data" && start0 === $f.start() && $f.parentOffset === $f.parent.content.size) {
            const data = schema.nodes.data.create({ source: String(c.pos[0] ?? ""), pipe: fmtPipeline(p.calls.slice(1)), static: !!c.args.static });
            const at = $f.before();
            const tr = view.state.tr.replaceWith(at, $f.after(), data);
            view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, at)));
            return true;
          }
          if (p.calls.length !== 1) return false;
          const node = schema.nodes.insertion.create({ fn: c.fn, pos: JSON.stringify(c.pos), args: JSON.stringify(c.args) });
          const start = from - m[0].length;
          view.dispatch(view.state.tr.replaceWith(start, to, node));
          return true;
        } catch {
          return false;
        }
      },
      handleDOMEvents: {
        contextmenu(view, e) {
          const at = view.posAtCoords({ left: e.clientX, top: e.clientY });
          if (at) {
            const { from, to } = view.state.selection;
            if (at.pos < from || at.pos > to) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(at.pos))));
          }
          e.preventDefault();
          onContextMenu(view, e);
          return true;
        },
      },
      attributes: (state: EditorState): Record<string, string> => {
        const single = state.doc.childCount === 1 && state.doc.firstChild!.attrs.role === "user";
        return { class: single ? "cx-editor cx-single" : "cx-editor" };
      },
    },
  });

const trailingLinePlugin = () =>
  new Plugin({
    appendTransaction(trs, _old, state) {
      if (!trs.some((t) => t.docChanged)) return null;
      const fixes = trailingLineFixes(state.doc);
      if (!fixes.length) return null;
      const tr = state.tr;
      for (const pos of fixes.reverse()) tr.insert(pos, schema.nodes.line.create());
      return tr.setMeta("addToHistory", false);
    },
  });

export function basePlugins(o: { slash: SlashBridge; onContextMenu: (view: EditorView, e: MouseEvent) => void; analysis: AnalysisOpts; extraKeys?: Record<string, Command> }) {
  return [
    slashPlugin(o.slash),
    interactionPlugin(o.onContextMenu),
    editorKeymap(o.extraKeys),
    keymap(baseKeymap),
    history(),
    dropCursor({ class: "cx-dropcursor", width: 2 }),
    gapCursor(),
    trailingLinePlugin(),
    markdownPlugin(),
    analysisPlugin(o.analysis),
  ];
}
