import { Schema, type NodeSpec } from "prosemirror-model";

const mutedAttr = { muted: { default: false } };
const cls = (base: string, muted: boolean) => (muted ? `${base} cx-muted` : base);

const nodes: Record<string, NodeSpec> = {
  doc: { content: "message+" },
  message: {
    attrs: { role: { default: "user" }, ...mutedAttr },
    content: "block+",
    defining: true,
    isolating: true,
    toDOM: (n) => ["div", { class: cls(`cx-message cx-role-${n.attrs.role}`, n.attrs.muted) }, 0],
    parseDOM: [{ tag: "div.cx-message" }],
  },
  line: {
    group: "block child",
    content: "inline*",
    attrs: { ...mutedAttr },
    toDOM: (n) => ["p", { class: cls("cx-line cx-card", n.attrs.muted) }, 0],
    parseDOM: [{ tag: "p" }],
  },
  directive: {
    group: "block child",
    content: "inline*",
    attrs: { ...mutedAttr, from: { default: null } },
    draggable: true,
    toDOM: (n) => ["div", { class: cls("cx-directive cx-card", n.attrs.muted), "data-from": n.attrs.from ?? undefined }, 0],
    parseDOM: [{ tag: "div.cx-directive", getAttrs: (d) => ({ from: (d as HTMLElement).dataset.from ?? null }) }],
  },
  section: {
    group: "block",
    content: "child+",
    attrs: { title: { default: "" }, frame: { default: "auto" }, list: { default: "plain" }, ...mutedAttr, from: { default: null } },
    draggable: true,
    defining: true,
    toDOM: (n) => ["section", { class: cls("cx-section cx-card", n.attrs.muted) }, 0],
    parseDOM: [{ tag: "section.cx-section" }],
  },
  use: {
    group: "block child",
    atom: true,
    draggable: true,
    selectable: true,
    attrs: { ref: { default: "" }, flavor: { default: null }, ...mutedAttr },
    toDOM: (n) => ["div", { class: cls("cx-use cx-card cx-chip", n.attrs.muted), "data-ref": n.attrs.ref }],
    parseDOM: [{ tag: "div.cx-use", getAttrs: (d) => ({ ref: (d as HTMLElement).dataset.ref }) }],
  },
  data: {
    group: "block child",
    atom: true,
    draggable: true,
    selectable: true,
    attrs: { source: { default: "" }, pipe: { default: "" }, static: { default: false }, ...mutedAttr },
    toDOM: (n) => ["div", { class: cls("cx-data cx-card cx-chip", n.attrs.muted), "data-source": n.attrs.source }],
    parseDOM: [{ tag: "div.cx-data", getAttrs: (d) => ({ source: (d as HTMLElement).dataset.source }) }],
  },
  tool: {
    group: "block child",
    atom: true,
    draggable: true,
    selectable: true,
    attrs: { name: { default: "" }, mode: { default: "api" }, ...mutedAttr },
    toDOM: (n) => ["div", { class: cls("cx-tool cx-card cx-chip", n.attrs.muted) }],
    parseDOM: [{ tag: "div.cx-tool" }],
  },
  schema: {
    group: "block child",
    atom: true,
    draggable: true,
    selectable: true,
    attrs: { name: { default: "" }, mode: { default: "format" }, strict: { default: null }, ...mutedAttr },
    toDOM: (n) => ["div", { class: cls("cx-schema cx-card cx-chip", n.attrs.muted) }],
    parseDOM: [{ tag: "div.cx-schema" }],
  },
  insertion: {
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    draggable: true,
    attrs: { fn: { default: "now" }, pos: { default: "[]" }, args: { default: "{}" } },
    toDOM: (n) => ["span", { class: "cx-ins", "data-fn": n.attrs.fn }],
    parseDOM: [{ tag: "span.cx-ins", getAttrs: (d) => ({ fn: (d as HTMLElement).dataset.fn }) }],
  },
  text: { group: "inline" },
};

export const schema = new Schema({ nodes, marks: {} });

export const CARD_TYPES = new Set(["line", "directive", "section", "use", "data", "tool", "schema"]);
