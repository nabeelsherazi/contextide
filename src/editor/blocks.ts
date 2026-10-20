// Build editor nodes for things in the drawer / slash menu.
import type { Node as PMNode } from "prosemirror-model";
import { schema } from "./schema";
import type { Block } from "../core/workspace";
import { INSERTIONS } from "../core/insertions";
import { inlineToPM } from "./convert";
import { parseInline } from "../core/doc";

export type Insertable = { mode: "card"; node: PMNode } | { mode: "inline"; nodes: PMNode[] };

export function forBlock(b: Block): Insertable {
  switch (b.kind) {
    case "directive":
    case "section":
      return { mode: "card", node: schema.nodes.use.create({ ref: b.key }) };
    case "tool":
      return { mode: "card", node: schema.nodes.tool.create({ name: b.path }) };
    case "schema":
      return { mode: "card", node: schema.nodes.schema.create({ name: b.path }) };
    case "insertion":
      return { mode: "inline", nodes: inlineToPM(parseInline(b.body.split("\n")[0] ?? "")) };
  }
}

export const forData = (source: string, pipe = ""): Insertable => ({ mode: "card", node: schema.nodes.data.create({ source, pipe }) });

export function forInsertion(fn: string): Insertable {
  const info = INSERTIONS.find((x) => x.fn === fn)!;
  return { mode: "inline", nodes: [schema.nodes.insertion.create({ fn, pos: JSON.stringify(info.defaults.pos), args: JSON.stringify(info.defaults.args) })] };
}

export const forVar = (name: string): Insertable => ({ mode: "inline", nodes: [schema.nodes.insertion.create({ fn: "var", pos: JSON.stringify([name]), args: "{}" })] });

export const newDirective = (): Insertable => ({ mode: "card", node: schema.nodes.directive.create() });
export const newSection = (): Insertable => ({ mode: "card", node: schema.nodes.section.create({ title: "" }, [schema.nodes.line.create()]) });

export function dragPayload(i: Insertable): string {
  if (i.mode === "card") return JSON.stringify({ type: "card", node: i.node.toJSON() });
  // one inline node drops inline; several (an insertion preset with text) travel as a line card
  if (i.nodes.length === 1) return JSON.stringify({ type: "inline", node: i.nodes[0].toJSON() });
  return JSON.stringify({ type: "card", node: schema.nodes.line.create(null, i.nodes).toJSON() });
}
