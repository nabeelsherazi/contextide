// Render a prompt document into messages, with per-card segments that know
// whether they are expected to change between runs (for the stable-prefix cutoff).
import { type Inline, type Message, type Node, type NodeKind, type Role, parseBody, parseInline, xmlTag, type Frame, type ListStyle } from "./doc";
import { evalInsertion, isDynamic } from "./insertions";
import { applyPipeline } from "./pipeline";
import type { Item } from "./data";
import type { Block } from "./workspace";
import { extractJson } from "./workspace";
import { digest, DEFAULT_DIGEST_HEADER } from "./digest";

export interface RenderEnv {
  flavor: string;
  resolve(ref: string, pin?: string): { block?: Block; fellBack: boolean };
  data(source: string): Item[] | undefined;
  tool(name: string): Block | undefined;
  schema(name: string): Block | undefined;
  vars: Record<string, string>;
  now: Date;
  seed: number;
  /** Replace a data source's items (fan-out chunk). */
  dataOverride?: Record<string, Item[]>;
  /** Card ids to treat as muted (ablation). */
  mute?: Set<string>;
  countTokens?: (s: string) => number;
}

export type SegKind = NodeKind | "sep" | "frame" | "insertion";

export interface Segment {
  id: string;
  kind: SegKind;
  text: string;
  dynamic: boolean;
}

export interface RenderedMessage {
  role: Role;
  segments: Segment[];
  text: string;
}

export interface Warning {
  id: string;
  level: "error" | "warn" | "info";
  msg: string;
}

export interface ToolDef {
  type: "function";
  function: { name: string; description?: string; parameters: unknown };
}

export interface Rendered {
  messages: RenderedMessage[];
  tools: ToolDef[];
  responseFormat?: { type: "json_schema"; json_schema: { name: string; schema: unknown; strict?: boolean } };
  warnings: Warning[];
  /** item count per data card id, after the pipeline */
  dataCounts: Record<string, number>;
  /** card ids actually rendered, in order */
  cards: string[];
  /** the (selected, ordered) items each data card showed, for scoring */
  dataShown: Record<string, { source: string; items: Item[] }>;
}

type Line = Segment[];

export const resolveFrame = (f: Frame, flavor: string): Exclude<Frame, "auto"> => (f === "auto" ? (flavor === "claude" ? "xml" : "md") : f);

export function render(messages: Message[], env: RenderEnv): Rendered {
  const warnings: Warning[] = [];
  const tools: ToolDef[] = [];
  let responseFormat: Rendered["responseFormat"];
  const dataCounts: Record<string, number> = {};
  const cards: string[] = [];
  const dataShown: Rendered["dataShown"] = {};
  let insCounter = 0;

  const muted = (n: { muted?: boolean }, id: string) => !!n.muted || !!env.mute?.has(id);

  const inline = (content: Inline[], id: string, kind: SegKind): Line => {
    const line: Line = [];
    for (const x of content) {
      if (x.t === "text") line.push({ id, kind, text: x.text, dynamic: false });
      else {
        const r = evalInsertion(x.fn, x.pos, x.args, { now: env.now, vars: env.vars, seed: env.seed }, `${id}:${insCounter++}`);
        if (r.error) warnings.push({ id, level: "warn", msg: r.error });
        line.push({ id, kind: "insertion", text: r.text, dynamic: isDynamic(x.fn, x.args) });
      }
    }
    return line;
  };

  const textLines = (text: string, id: string, kind: SegKind, dynamic: boolean): Line[] => text.split("\n").map((t) => [{ id, kind, text: t, dynamic }]);

  const prefixFirst = (lines: Line[], prefix: string, id: string): Line[] => {
    if (!prefix || !lines.length) return lines;
    return [[{ id, kind: "frame", text: prefix, dynamic: false }, ...lines[0]], ...lines.slice(1)];
  };

  const renderNodes = (nodes: Node[], prefix: string, list: ListStyle, depth: number, refId?: string): Line[] => {
    const out: Line[] = [];
    let num = 0;
    nodes.forEach((n, i) => {
      const id = refId ?? `${prefix}/${i}`;
      if (muted(n, `${prefix}/${i}`)) return;
      if (!refId) cards.push(id);
      const marker = () => (list === "bullets" ? "- " : list === "numbered" ? `${++num}. ` : "");
      switch (n.k) {
        case "line":
          out.push(inline(n.content, id, "line"));
          break;
        case "directive":
          out.push(...prefixFirst([inline(n.content, id, "directive")], marker(), id));
          break;
        case "section":
          out.push(...renderSection(n.children, n.title, n.frame, n.list, id, depth, refId));
          break;
        case "use": {
          if (depth > 6) {
            warnings.push({ id, level: "error", msg: `reference nesting too deep at ${n.ref}` });
            break;
          }
          const { block, fellBack } = env.resolve(n.ref, n.flavor);
          if (!block) {
            warnings.push({ id, level: "error", msg: `missing block ${n.ref}` });
            break;
          }
          if (fellBack && (n.flavor || block.flavor !== "general")) warnings.push({ id, level: "info", msg: `no ${n.flavor ?? env.flavor} variant of ${block.fn}; using ${block.flavor}` });
          if (block.kind === "section") {
            const f = block.front;
            const kids = parseBody(block.body)[0]?.children ?? [];
            out.push(...renderSection(kids, String(f.title ?? block.fn), (f.frame as Frame) ?? "auto", (f.list as ListStyle) ?? "plain", id, depth + 1, id));
          } else {
            const ls = block.body.split("\n").map((l) => inline(parseInline(l), id, "use"));
            out.push(...prefixFirst(ls, block.kind === "directive" ? marker() : "", id));
          }
          break;
        }
        case "data": {
          const items = env.dataOverride?.[n.source] ?? env.data(n.source);
          if (!items) {
            warnings.push({ id, level: "error", msg: `missing data source "${n.source}"` });
            break;
          }
          const r = applyPipeline(items, n.pipe, { seed: env.seed, countTokens: env.countTokens });
          r.errors.forEach((e) => warnings.push({ id, level: "error", msg: e }));
          dataCounts[id] = r.count;
          dataShown[id] = { source: n.source, items: r.items };
          out.push(...textLines(r.text, id, "data", !n.static));
          break;
        }
        case "tool": {
          const b = env.tool(n.name);
          if (!b) {
            warnings.push({ id, level: "error", msg: `missing tool "${n.name}"` });
            break;
          }
          const params = extractJson(b.body);
          if (params.error) warnings.push({ id, level: "error", msg: `tool ${n.name}: ${params.error}` });
          const name = String(b.front.name ?? b.path.split("/").pop());
          const description = b.front.description ? String(b.front.description) : undefined;
          if (n.mode !== "text") tools.push({ type: "function", function: { name, description, parameters: params.value ?? {} } });
          if (n.mode !== "api") {
            const text = [`Tool: ${name}`, description ?? "", `Parameters (JSON schema): ${JSON.stringify(params.value ?? {})}`].filter(Boolean).join("\n");
            out.push(...textLines(text, id, "tool", false));
          }
          break;
        }
        case "schema": {
          const b = env.schema(n.name);
          if (!b) {
            warnings.push({ id, level: "error", msg: `missing schema "${n.name}"` });
            break;
          }
          const s = extractJson(b.body);
          if (s.error) warnings.push({ id, level: "error", msg: `schema ${n.name}: ${s.error}` });
          const name = String(b.front.name ?? b.path.split("/").pop());
          const strict = n.strict ?? (b.front.strict === undefined ? true : !!b.front.strict);
          if (n.mode !== "digest") {
            if (responseFormat) warnings.push({ id, level: "warn", msg: "more than one schema sent as response_format; the last wins" });
            responseFormat = { type: "json_schema", json_schema: { name, schema: s.value ?? {}, strict } };
          }
          if (n.mode !== "format") out.push(...textLines(digest(s.value, String(b.front.digestHeader ?? DEFAULT_DIGEST_HEADER)), id, "schema", false));
          break;
        }
      }
    });
    return out;
  };

  const renderSection = (children: Node[], title: string, frame: Frame, list: ListStyle, id: string, depth: number, refId?: string): Line[] => {
    const inner = renderNodes(children, id, list, depth + 1, refId);
    if (!inner.length) {
      warnings.push({ id, level: "warn", msg: `section "${title || "untitled"}" renders nothing` });
      return [];
    }
    const f = resolveFrame(frame, env.flavor);
    const fr = (text: string): Line => [{ id, kind: "frame", text, dynamic: false }];
    if (f === "md" && title) return [fr(`## ${title}`), ...inner];
    if (f === "xml") {
      const tag = xmlTag(title || "section");
      return [fr(`<${tag}>`), ...inner, fr(`</${tag}>`)];
    }
    return inner;
  };

  const out: RenderedMessage[] = [];
  messages.forEach((m, mi) => {
    if (m.muted) return;
    const lines = renderNodes(m.children, String(mi), "plain", 0);
    const segments: Segment[] = [];
    lines.forEach((l, i) => {
      if (i > 0) segments.push({ id: segments[segments.length - 1]?.id ?? String(mi), kind: "sep", text: "\n", dynamic: false });
      segments.push(...l);
    });
    const text = segments.map((s) => s.text).join("");
    if (!text.trim() && m.role !== "assistant") {
      warnings.push({ id: String(mi), level: "warn", msg: `${m.role} message is empty` });
      return;
    }
    out.push({ role: m.role, segments, text });
  });
  return { messages: out, tools, responseFormat, warnings, dataCounts, cards, dataShown };
}

/** The stable prefix: everything before the first dynamic segment, across messages in order. */
export function stablePrefix(r: Rendered): { prefix: string; total: string; firstDynamicId?: string; cutMessage?: number; cutOffset?: number } {
  let prefix = "";
  let found: { id: string; m: number; off: number } | undefined;
  const parts: string[] = [];
  r.messages.forEach((m, mi) => {
    const head = mi > 0 ? "\n\n" : "";
    parts.push(head + m.text);
    if (found) return;
    prefix += head;
    let off = 0;
    for (const s of m.segments) {
      if (s.dynamic && s.text.length) {
        found = { id: s.id, m: mi, off };
        return;
      }
      prefix += s.text;
      off += s.text.length;
    }
  });
  return { prefix, total: parts.join(""), firstDynamicId: found?.id, cutMessage: found?.m, cutOffset: found?.off };
}

/** Plain text form used for run files and diffs. */
export function promptText(r: Rendered): string {
  if (r.messages.length === 1 && r.messages[0].role === "user") return r.messages[0].text;
  return r.messages.map((m) => `[${m.role}]\n${m.text}`).join("\n\n");
}

/** The rendered text of each card id (its segments joined), for per-card token counts. */
export function cardTexts(r: Rendered): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of r.messages)
    for (const s of m.segments) {
      if (s.kind === "sep") continue;
      const top = s.id;
      map.set(top, (map.get(top) ?? "") + s.text + (s.kind === "frame" ? "\n" : ""));
    }
  return map;
}
