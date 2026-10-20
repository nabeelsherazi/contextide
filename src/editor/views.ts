// NodeViews: cards with drag handles, section headers, chips for refs/data/tools/schemas, insertion pills.
import { NodeSelection } from "prosemirror-state";
import type { EditorView, NodeView, ViewMutationRecord } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import type { Workspace } from "../core/workspace";
import { resolveBlock, dataItems, variantsOf, keyKind } from "../core/workspace";
import { insertionInfo, describeInsertion } from "../core/insertions";
import { pipeFromString } from "./convert";
import { applyPipeline } from "../core/pipeline";
import { setCardAttrs, removeMessage } from "./commands";

export interface EditorCtx {
  ws(): Workspace;
  project(): string | undefined;
  flavor(): string;
  vars(): Record<string, string>;
  subscribe(fn: () => void): () => void;
  open(kind: "ref" | "data" | "insertion" | "tool" | "schema", pos: number): void;
  sectionMenu(pos: number, anchor: HTMLElement): void;
  readOnly?: boolean;
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

function handle(view: EditorView, getPos: () => number | undefined, dom: HTMLElement): HTMLElement {
  const g = h("span", "cx-handle");
  g.contentEditable = "false";
  g.draggable = true;
  g.title = "Drag to move · click to select";
  g.addEventListener("mousedown", (e) => {
    const pos = getPos();
    if (pos === undefined || e.button !== 0) return;
    e.stopPropagation();
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
  });
  g.addEventListener("dragstart", (e) => {
    const pos = getPos();
    if (pos === undefined || !e.dataTransfer) return;
    const sel = NodeSelection.create(view.state.doc, pos);
    view.dispatch(view.state.tr.setSelection(sel));
    const slice = sel.content();
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", sel.node.textContent);
    e.dataTransfer.setDragImage(dom, 10, 10);
    view.dragging = { slice, move: true };
  });
  return g;
}

/** Let the browser (not ProseMirror) handle mouse/drag events that start on a card handle. */
const isDrop = (e: Event) => e.type === "dragover" || e.type === "dragenter" || e.type === "dragleave" || e.type === "drop";
const fromHandle = (e: Event) => !!(e.target as HTMLElement)?.closest?.(".cx-handle") && (e.type === "mousedown" || e.type === "dragstart" || e.type === "click");

const muteBtn = (view: EditorView, getPos: () => number | undefined, muted: boolean) => {
  const b = h("button", "cx-mini cx-mute", muted ? "◌" : "●");
  b.title = muted ? "Unmute (include in prompt)" : "Mute (exclude from prompt without deleting)";
  b.contentEditable = "false";
  b.addEventListener("mousedown", (e) => e.preventDefault());
  b.addEventListener("click", () => {
    const pos = getPos();
    if (pos === undefined) return;
    const n = view.state.doc.nodeAt(pos);
    if (n) setCardAttrs(pos, { muted: !n.attrs.muted })(view.state, view.dispatch);
  });
  return b;
};

// ---------- text cards (line, directive) ----------

class TextCardView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  constructor(
    private node: PMNode,
    view: EditorView,
    getPos: () => number | undefined,
  ) {
    const kind = node.type.name;
    this.dom = h("div", `cx-card cx-${kind}`);
    this.dom.appendChild(handle(view, getPos, this.dom));
    this.contentDOM = h(kind === "line" ? "p" : "div", "cx-text");
    this.dom.appendChild(this.contentDOM);
    if (kind === "directive") {
      const b = h("span", "cx-badge");
      b.contentEditable = "false";
      this.dom.appendChild(b);
    }
    this.sync(node);
  }
  sync(n: PMNode) {
    this.dom.classList.toggle("cx-muted", !!n.attrs.muted);
    this.dom.classList.toggle("cx-empty", n.content.size === 0);
    const badge = this.dom.querySelector(".cx-badge");
    if (badge) badge.textContent = n.attrs.from ? "⇢ detached" : "";
    if (n.attrs.from) this.dom.title = `Detached copy of ${n.attrs.from}`;
  }
  update(n: PMNode) {
    if (n.type !== this.node.type) return false;
    this.node = n;
    this.sync(n);
    return true;
  }
  stopEvent(e: Event) {
    return fromHandle(e);
  }
  ignoreMutation(m: ViewMutationRecord) {
    return m.type === "attributes" || !this.contentDOM.contains(m.target);
  }
}

// ---------- message ----------

class MessageView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private label: HTMLElement;
  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined,
  ) {
    this.dom = h("div", "cx-message");
    const head = h("div", "cx-message-head");
    head.contentEditable = "false";
    this.label = h("span", "cx-role");
    const rm = h("button", "cx-mini", "×");
    rm.title = "Remove this message";
    rm.addEventListener("click", () => {
      const pos = this.getPos();
      if (pos !== undefined) removeMessage(pos)(this.view.state, this.view.dispatch);
    });
    head.append(this.label, rm);
    this.contentDOM = h("div", "cx-message-body");
    this.dom.append(head, this.contentDOM);
    this.sync();
  }
  sync() {
    const r = this.node.attrs.role as string;
    this.dom.className = `cx-message cx-role-${r}${this.node.attrs.muted ? " cx-muted" : ""}`;
    this.label.textContent = r === "assistant" ? "Assistant prefill" : r[0].toUpperCase() + r.slice(1);
  }
  update(n: PMNode) {
    if (n.type !== this.node.type) return false;
    this.node = n;
    this.sync();
    return true;
  }
  stopEvent(e: Event) {
    if (isDrop(e)) return false;
    return !this.contentDOM.contains(e.target as globalThis.Node);
  }
  ignoreMutation(m: ViewMutationRecord) {
    return !this.contentDOM.contains(m.target);
  }
}

// ---------- section ----------

const FRAMES: [string, string][] = [
  ["auto", "frame: auto"],
  ["md", "## heading"],
  ["xml", "<xml> tags"],
  ["none", "no frame"],
];
const LISTS: [string, string][] = [
  ["plain", "plain lines"],
  ["bullets", "- bullets"],
  ["numbered", "1. numbered"],
];

function select(options: [string, string][], value: string, onChange: (v: string) => void, title: string) {
  const s = h("select", "cx-select");
  s.title = title;
  for (const [v, l] of options) {
    const o = h("option", undefined, l);
    o.value = v;
    s.appendChild(o);
  }
  s.value = value;
  s.addEventListener("change", () => onChange(s.value));
  return s;
}

class SectionView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private title: HTMLInputElement;
  private frame: HTMLSelectElement;
  private list: HTMLSelectElement;
  private mute: HTMLButtonElement;
  private from: HTMLElement;
  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined,
    ctx: EditorCtx,
  ) {
    this.dom = h("section", "cx-card cx-section");
    const head = h("div", "cx-section-head");
    head.contentEditable = "false";
    const set = (attrs: Record<string, unknown>) => {
      const pos = this.getPos();
      if (pos !== undefined) setCardAttrs(pos, attrs)(this.view.state, this.view.dispatch);
    };
    this.title = h("input", "cx-section-title");
    this.title.placeholder = "Section title";
    this.title.addEventListener("change", () => set({ title: this.title.value }));
    this.title.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        set({ title: this.title.value });
        this.view.focus();
      }
    });
    this.frame = select(FRAMES, node.attrs.frame, (v) => set({ frame: v }), "How the section is framed in the rendered prompt");
    this.list = select(LISTS, node.attrs.list, (v) => set({ list: v }), "How directives inside render");
    this.mute = muteBtn(view, getPos, node.attrs.muted) as HTMLButtonElement;
    this.from = h("span", "cx-badge");
    const more = h("button", "cx-mini", "⋯");
    more.title = "Section actions";
    more.addEventListener("click", () => {
      const pos = this.getPos();
      if (pos !== undefined) ctx.sectionMenu(pos, more);
    });
    head.append(handle(view, getPos, this.dom), this.title, this.from, h("span", "cx-spacer"), this.frame, this.list, this.mute, more);
    this.contentDOM = h("div", "cx-section-body");
    this.dom.append(head, this.contentDOM);
    this.sync();
  }
  sync() {
    const a = this.node.attrs;
    if (document.activeElement !== this.title) this.title.value = a.title;
    this.frame.value = a.frame;
    this.list.value = a.list;
    this.dom.classList.toggle("cx-muted", !!a.muted);
    this.mute.textContent = a.muted ? "◌" : "●";
    this.from.textContent = a.from ? "⇢ detached" : "";
    this.from.title = a.from ? `Detached copy of ${a.from}` : "";
  }
  update(n: PMNode) {
    if (n.type !== this.node.type) return false;
    this.node = n;
    this.sync();
    return true;
  }
  stopEvent(e: Event) {
    if (isDrop(e)) return false;
    return fromHandle(e) || !this.contentDOM.contains(e.target as globalThis.Node);
  }
  ignoreMutation(m: ViewMutationRecord) {
    return m.type === "attributes" || !this.contentDOM.contains(m.target);
  }
}

// ---------- chips ----------

abstract class ChipView implements NodeView {
  dom: HTMLElement;
  protected body: HTMLElement;
  private unsub: () => void;
  constructor(
    protected node: PMNode,
    protected view: EditorView,
    protected getPos: () => number | undefined,
    protected ctx: EditorCtx,
    kind: string,
  ) {
    this.dom = h("div", `cx-card cx-chip cx-${kind}`);
    this.body = h("div", "cx-chip-body");
    this.dom.append(handle(view, getPos, this.dom), this.body);
    this.dom.addEventListener("dblclick", () => this.activate());
    this.body.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("button,select,input")) return;
      const pos = this.getPos();
      if (pos !== undefined) this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)));
    });
    this.unsub = ctx.subscribe(() => this.render());
    this.render();
  }
  abstract render(): void;
  abstract activate(): void;
  update(n: PMNode) {
    if (n.type !== this.node.type) return false;
    this.node = n;
    this.render();
    return true;
  }
  stopEvent(e: Event) {
    if (isDrop(e)) return false;
    const t = e.target as HTMLElement;
    return fromHandle(e) || !!t.closest?.("button,select,input");
  }
  ignoreMutation() {
    return true;
  }
  destroy() {
    this.unsub();
  }
  protected setMuted() {
    this.dom.classList.toggle("cx-muted", !!this.node.attrs.muted);
  }
}

class UseView extends ChipView {
  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined, ctx: EditorCtx) {
    super(node, view, getPos, ctx, "use");
  }
  render() {
    this.setMuted();
    const ws = this.ctx.ws();
    const ref = this.node.attrs.ref as string;
    const pin = this.node.attrs.flavor ?? undefined;
    const { block, fellBack } = resolveBlock(ws, ref, this.ctx.flavor(), pin, this.ctx.project());
    this.body.replaceChildren();
    const head = h("div", "cx-chip-head");
    head.append(h("span", "cx-chip-icon", "⛓"), h("span", "cx-chip-kind", keyKind(ref)));
    if (!block) {
      head.append(h("span", "cx-chip-title cx-broken", `missing: ${ref}`));
      this.body.append(head);
      return;
    }
    head.append(h("span", "cx-chip-title", `${block.type ? block.type + " › " : ""}${block.fn}`));
    const fl = h("span", `cx-flavor${fellBack ? " cx-fallback" : ""}`, block.flavor);
    fl.title = fellBack ? `No ${pin ?? this.ctx.flavor()} variant — falling back to ${block.flavor}` : pin ? "Pinned variant" : "Resolved from the version's flavor";
    head.append(fl);
    if (pin) head.append(h("span", "cx-badge", "📌"));
    const n = variantsOf(ws, ref, this.ctx.project()).length;
    if (n > 1) head.append(h("span", "cx-muted-text", `${n} variants`));
    this.body.append(head);
    const preview = block.kind === "section" ? block.body.replace(/\{%\s*directive[^%]*%\}|\{%\s*enddirective\s*%\}/g, "").replace(/\{%[^%]*%\}/g, "…") : block.body;
    const p = h("div", "cx-chip-preview", preview);
    this.body.append(p);
    this.dom.title = "Live library reference · double-click to edit or detach";
  }
  activate() {
    const pos = this.getPos();
    if (pos !== undefined) this.ctx.open("ref", pos);
  }
}

class DataView extends ChipView {
  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined, ctx: EditorCtx) {
    super(node, view, getPos, ctx, "data");
  }
  render() {
    this.setMuted();
    const ws = this.ctx.ws();
    const p = ws.projects.find((x) => x.name === this.ctx.project());
    const src = p?.data.find((d) => d.name === this.node.attrs.source);
    this.body.replaceChildren();
    const head = h("div", "cx-chip-head");
    head.append(h("span", "cx-chip-icon", "▤"), h("span", "cx-chip-title", this.node.attrs.source || "(no source)"));
    const pipe = this.node.attrs.pipe as string;
    if (pipe) head.append(h("code", "cx-pipe", "| " + pipe));
    if (!src) {
      head.append(h("span", "cx-broken", "missing"));
    } else {
      const items = dataItems(src).items;
      const r = applyPipeline(items, pipeFromString(pipe), { seed: 1 });
      head.append(h("span", "cx-muted-text", `${r.count} of ${items.length} rows`));
      this.body.append(head);
      const prev = h("div", "cx-chip-preview cx-mono", r.text.split("\n").slice(0, 3).join("\n") + (r.text.split("\n").length > 3 ? "\n…" : ""));
      this.body.append(prev);
    }
    if (!src) this.body.append(head);
    const st = h("button", `cx-mini cx-static${this.node.attrs.static ? " on" : ""}`, this.node.attrs.static ? "static" : "dynamic");
    st.title = "Static data counts toward the cacheable prefix; dynamic data ends it";
    st.addEventListener("click", () => {
      const pos = this.getPos();
      if (pos !== undefined) setCardAttrs(pos, { static: !this.node.attrs.static })(this.view.state, this.view.dispatch);
    });
    head.append(h("span", "cx-spacer"), st);
    this.dom.title = "Data source · double-click to edit the transform pipeline";
  }
  activate() {
    const pos = this.getPos();
    if (pos !== undefined) this.ctx.open("data", pos);
  }
}

const MODES: Record<string, [string, string][]> = {
  tool: [
    ["api", "send as API tools"],
    ["text", "render as text"],
    ["both", "both"],
  ],
  schema: [
    ["format", "response_format"],
    ["digest", "digest in prompt"],
    ["both", "both"],
  ],
};

class ToolSchemaView extends ChipView {
  constructor(
    node: PMNode,
    view: EditorView,
    getPos: () => number | undefined,
    ctx: EditorCtx,
    private kind: "tool" | "schema",
  ) {
    super(node, view, getPos, ctx, kind);
  }
  render() {
    this.setMuted();
    const ws = this.ctx.ws();
    const key = `${this.kind}:${this.node.attrs.name}`;
    const b = variantsOf(ws, key, this.ctx.project())[0];
    this.body.replaceChildren();
    const head = h("div", "cx-chip-head");
    head.append(h("span", "cx-chip-icon", this.kind === "tool" ? "⚒" : "{ }"), h("span", "cx-chip-kind", this.kind), h("span", `cx-chip-title${b ? "" : " cx-broken"}`, b ? String(b.front.name ?? b.path) : `missing: ${this.node.attrs.name}`));
    if (b?.front.description) this.body.append();
    head.append(h("span", "cx-spacer"));
    head.append(
      select(MODES[this.kind], this.node.attrs.mode, (v) => {
        const pos = this.getPos();
        if (pos !== undefined) setCardAttrs(pos, { mode: v })(this.view.state, this.view.dispatch);
      }, "How this is sent"),
    );
    this.body.append(head);
    if (b?.front.description) this.body.append(h("div", "cx-chip-preview", String(b.front.description)));
  }
  activate() {
    const pos = this.getPos();
    if (pos !== undefined) this.ctx.open(this.kind, pos);
  }
}

// ---------- inline insertion ----------

class InsertionView implements NodeView {
  dom: HTMLElement;
  private unsub: () => void;
  constructor(
    private node: PMNode,
    private getPos: () => number | undefined,
    private ctx: EditorCtx,
  ) {
    this.dom = h("span", "cx-ins");
    this.dom.contentEditable = "false";
    this.dom.addEventListener("click", () => {
      const pos = this.getPos();
      if (pos !== undefined) this.ctx.open("insertion", pos);
    });
    this.unsub = ctx.subscribe(() => this.render());
    this.render();
  }
  render() {
    let pos: never[] = [];
    let args = {};
    try {
      pos = JSON.parse(this.node.attrs.pos);
      args = JSON.parse(this.node.attrs.args);
    } catch {
      /* ignore */
    }
    const fn = this.node.attrs.fn as string;
    const info = insertionInfo(fn);
    const txt = describeInsertion(fn, pos, args, { now: new Date(), vars: this.ctx.vars(), seed: 1 });
    this.dom.textContent = `${info?.icon ?? "ƒ"} ${txt}`;
    this.dom.title = `${info?.label ?? fn} — click to configure`;
    this.dom.dataset.fn = fn;
  }
  update(n: PMNode) {
    if (n.type !== this.node.type) return false;
    this.node = n;
    this.render();
    return true;
  }
  ignoreMutation() {
    return true;
  }
  destroy() {
    this.unsub();
  }
}

export function nodeViews(ctx: EditorCtx) {
  return {
    line: (n: PMNode, v: EditorView, g: () => number | undefined) => new TextCardView(n, v, g),
    directive: (n: PMNode, v: EditorView, g: () => number | undefined) => new TextCardView(n, v, g),
    message: (n: PMNode, v: EditorView, g: () => number | undefined) => new MessageView(n, v, g),
    section: (n: PMNode, v: EditorView, g: () => number | undefined) => new SectionView(n, v, g, ctx),
    use: (n: PMNode, v: EditorView, g: () => number | undefined) => new UseView(n, v, g, ctx),
    data: (n: PMNode, v: EditorView, g: () => number | undefined) => new DataView(n, v, g, ctx),
    tool: (n: PMNode, v: EditorView, g: () => number | undefined) => new ToolSchemaView(n, v, g, ctx, "tool"),
    schema: (n: PMNode, v: EditorView, g: () => number | undefined) => new ToolSchemaView(n, v, g, ctx, "schema"),
    insertion: (n: PMNode, _v: EditorView, g: () => number | undefined) => new InsertionView(n, g, ctx),
  };
}
