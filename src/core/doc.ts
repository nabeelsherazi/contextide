// The prompt document model, and its text format (Jinja-ish tags in markdown).
import YAML from "yaml";
import { type Args, type Call, type Value, fmtPipeline, fmtTagArgs, fmtValue, parsePipeline, parseTagArgs, str, bool } from "./expr";

export type Role = "system" | "user" | "assistant";
export type Frame = "auto" | "none" | "md" | "xml";
export type ListStyle = "plain" | "bullets" | "numbered";
export type ToolMode = "api" | "text" | "both";
export type SchemaMode = "format" | "digest" | "both";

export type Inline = { t: "text"; text: string } | { t: "ins"; fn: string; pos: Value[]; args: Args };

export type Node =
  | { k: "line"; content: Inline[]; muted?: boolean }
  | { k: "directive"; content: Inline[]; muted?: boolean; from?: string }
  | { k: "section"; title: string; frame: Frame; list: ListStyle; muted?: boolean; from?: string; children: Node[] }
  | { k: "use"; ref: string; flavor?: string; muted?: boolean }
  | { k: "data"; source: string; pipe: Call[]; static?: boolean; muted?: boolean }
  | { k: "tool"; name: string; mode: ToolMode; muted?: boolean }
  | { k: "schema"; name: string; mode: SchemaMode; strict?: boolean; muted?: boolean };

export type NodeKind = Node["k"];

export interface Message {
  role: Role;
  muted?: boolean;
  children: Node[];
}

export interface PromptDoc {
  front: Record<string, unknown>;
  messages: Message[];
}

// ---------- frontmatter ----------

export function splitFront(text: string): { front: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { front: {}, body: text };
  let front: Record<string, unknown> = {};
  try {
    const parsed = YAML.parse(m[1]);
    if (parsed && typeof parsed === "object") front = parsed as Record<string, unknown>;
  } catch {
    /* keep empty */
  }
  return { front, body: text.slice(m[0].length) };
}

export function joinFront(front: Record<string, unknown>, body: string): string {
  const clean = Object.fromEntries(Object.entries(front).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  if (Object.keys(clean).length === 0) return body;
  return `---\n${YAML.stringify(clean).trimEnd()}\n---\n${body}`;
}

// ---------- inline ----------

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  let i = 0;
  const push = (text: string) => {
    buf += text;
  };
  const flush = () => {
    if (buf) out.push({ t: "text", text: buf });
    buf = "";
  };
  while (i < s.length) {
    const open = s.indexOf("{{", i);
    if (open < 0) {
      push(s.slice(i));
      break;
    }
    push(s.slice(i, open));
    const close = s.indexOf("}}", open + 2);
    if (close < 0) {
      push(s.slice(open));
      break;
    }
    const inner = s.slice(open + 2, close);
    try {
      const p = parsePipeline(inner);
      if (p.literal !== undefined) push(p.literal);
      else if (p.calls.length === 1) {
        flush();
        out.push({ t: "ins", fn: p.calls[0].fn, pos: p.calls[0].pos, args: p.calls[0].args });
      } else push(s.slice(open, close + 2));
    } catch {
      push(s.slice(open, close + 2));
    }
    i = close + 2;
  }
  flush();
  return out;
}

const escapeText = (t: string) => t.replace(/\{\{|\{%|\{#/g, (m) => `{{ ${JSON.stringify(m)} }}`);

export function fmtInline(c: Inline[]): string {
  return c.map((x) => (x.t === "text" ? escapeText(x.text) : `{{ ${fmtPipeline([{ fn: x.fn, pos: x.pos, args: x.args }])} }}`)).join("");
}

export const inlinePlain = (c: Inline[]): string => c.map((x) => (x.t === "text" ? x.text : `{{${x.fn}}}`)).join("");

// ---------- block parsing ----------

const TAG = /^\s*\{%\s*([a-z]+)\b(.*?)%\}\s*$/;
const PAIRED = (name: string) => new RegExp(`^\\s*\\{%\\s*${name}\\b(.*?)%\\}(.*)\\{%\\s*end${name}\\s*%\\}\\s*$`);
const DIRECTIVE = PAIRED("directive");
const TEXT = PAIRED("text");
const DATA = /^\s*\{\{\s*(data\s*\(.*)\}\}\s*$/;

const asFrame = (v: Value | undefined): Frame => {
  const s = str(v, "auto");
  return s === "none" || s === "md" || s === "xml" ? s : "auto";
};
const asList = (v: Value | undefined): ListStyle => {
  const s = str(v, "plain");
  return s === "bullets" || s === "numbered" ? s : "plain";
};
const asRole = (v: string): Role => (v === "system" || v === "assistant" ? v : "user");

/** Parse a body (no frontmatter) into messages. Bodies without message tags become one user message. */
export function parseBody(body: string): Message[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  // Files end with a newline; that's not an extra empty line.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  const messages: Message[] = [];
  let implicit: Message | null = null;
  let cur: Message | null = null;
  const stack: Extract<Node, { k: "section" }>[] = [];

  const target = (): Node[] => {
    if (stack.length) return stack[stack.length - 1].children;
    if (!cur) {
      if (!implicit) {
        implicit = { role: "user", children: [] };
        messages.push(implicit);
      }
      return implicit.children;
    }
    return cur.children;
  };

  for (const line of lines) {
    let m: RegExpExecArray | null;
    if ((m = DIRECTIVE.exec(line))) {
      const { args } = safeTag(m[1]);
      target().push({ k: "directive", content: parseInline(m[2]), muted: bool(args.muted) || undefined, from: args.from ? str(args.from) : undefined });
      continue;
    }
    if ((m = TEXT.exec(line))) {
      const { args } = safeTag(m[1]);
      target().push({ k: "line", content: parseInline(m[2]), muted: bool(args.muted) || undefined });
      continue;
    }
    if ((m = DATA.exec(line))) {
      try {
        const p = parsePipeline(m[1]);
        const [head, ...rest] = p.calls;
        if (head && head.fn === "data") {
          target().push({
            k: "data",
            source: str(head.pos[0] ?? head.args.source),
            pipe: rest,
            static: bool(head.args.static) || undefined,
            muted: bool(head.args.muted) || undefined,
          });
          continue;
        }
      } catch {
        /* fall through to text */
      }
    }
    if ((m = TAG.exec(line))) {
      const name = m[1];
      const { pos, args } = safeTag(m[2]);
      let handled = true;
      switch (name) {
        case "message": {
          stack.length = 0;
          const bare = (["system", "user", "assistant"] as const).find((r) => args[r] === true);
          cur = { role: asRole(str(pos[0] ?? args.role ?? bare, "user")), children: [], muted: bool(args.muted) || undefined };
          messages.push(cur);
          break;
        }
        case "endmessage":
          stack.length = 0;
          cur = null;
          break;
        case "section": {
          const sec: Extract<Node, { k: "section" }> = {
            k: "section",
            title: str(args.title ?? pos[0]),
            frame: asFrame(args.frame),
            list: asList(args.list),
            muted: bool(args.muted) || undefined,
            from: args.from ? str(args.from) : undefined,
            children: [],
          };
          target().push(sec);
          stack.push(sec);
          break;
        }
        case "endsection":
          stack.pop();
          break;
        case "use":
          target().push({ k: "use", ref: str(pos[0] ?? args.ref), flavor: args.flavor ? str(args.flavor) : undefined, muted: bool(args.muted) || undefined });
          break;
        case "tool": {
          const mode = str(args.mode, "api");
          target().push({ k: "tool", name: str(pos[0] ?? args.name), mode: mode === "text" || mode === "both" ? mode : "api", muted: bool(args.muted) || undefined });
          break;
        }
        case "schema": {
          const mode = str(args.mode, "format");
          target().push({
            k: "schema",
            name: str(pos[0] ?? args.name),
            mode: mode === "digest" || mode === "both" ? mode : "format",
            strict: args.strict === undefined ? undefined : bool(args.strict),
            muted: bool(args.muted) || undefined,
          });
          break;
        }
        default:
          handled = false;
      }
      if (handled) continue;
    }
    target().push({ k: "line", content: parseInline(line) });
  }
  if (messages.length === 0) messages.push({ role: "user", children: [] });
  return messages;
}

function safeTag(src: string) {
  try {
    return parseTagArgs(src);
  } catch {
    return { pos: [], args: {} as Args };
  }
}

export function parseDoc(text: string): PromptDoc {
  const { front, body } = splitFront(text);
  return { front, messages: parseBody(body) };
}

// ---------- serialization ----------

export function fmtNode(n: Node, out: string[]): void {
  switch (n.k) {
    case "line":
      out.push(n.muted ? `{% text muted %}${fmtInline(n.content)}{% endtext %}` : fmtInline(n.content));
      break;
    case "directive": {
      const a = fmtTagArgs([], { from: n.from ?? "", muted: !!n.muted });
      out.push(`{% directive${a ? " " + a : ""} %}${fmtInline(n.content)}{% enddirective %}`);
      break;
    }
    case "section": {
      const a = fmtTagArgs([], {
        title: n.title,
        frame: n.frame === "auto" ? "" : n.frame,
        list: n.list === "plain" ? "" : n.list,
        from: n.from ?? "",
        muted: !!n.muted,
      });
      out.push(`{% section${a ? " " + a : ""} %}`);
      for (const c of n.children) fmtNode(c, out);
      out.push(`{% endsection %}`);
      break;
    }
    case "use":
      out.push(`{% use ${fmtTagArgs([n.ref], { flavor: n.flavor ?? "", muted: !!n.muted })} %}`);
      break;
    case "data": {
      const head: Call = { fn: "data", pos: [n.source], args: {} };
      if (n.static) head.args.static = true;
      if (n.muted) head.args.muted = true;
      out.push(`{{ ${fmtPipeline([head, ...n.pipe])} }}`);
      break;
    }
    case "tool":
      out.push(`{% tool ${fmtTagArgs([n.name], { mode: n.mode === "api" ? "" : n.mode, muted: !!n.muted })} %}`);
      break;
    case "schema": {
      const parts = [fmtValue(n.name)];
      if (n.mode !== "format") parts.push(`mode=${fmtValue(n.mode)}`);
      if (n.strict !== undefined) parts.push(`strict=${n.strict}`);
      if (n.muted) parts.push("muted");
      out.push(`{% schema ${parts.join(" ")} %}`);
      break;
    }
  }
}

export function fmtBody(messages: Message[]): string {
  const out: string[] = [];
  const single = messages.length === 1 && messages[0].role === "user" && !messages[0].muted;
  if (single) {
    for (const c of messages[0].children) fmtNode(c, out);
  } else {
    for (const m of messages) {
      out.push(`{% message ${m.role}${m.muted ? " muted" : ""} %}`);
      for (const c of m.children) fmtNode(c, out);
      out.push(`{% endmessage %}`);
    }
  }
  return out.join("\n") + "\n";
}

export function fmtDoc(doc: PromptDoc): string {
  return joinFront(doc.front, fmtBody(doc.messages));
}

// ---------- helpers ----------

/** Visit every node with a stable path id like "0/3/1" (message/child/child). */
export function walk(messages: Message[], fn: (n: Node, id: string, depth: number, parent: Node | null) => void) {
  const rec = (nodes: Node[], prefix: string, depth: number, parent: Node | null) =>
    nodes.forEach((n, i) => {
      const id = `${prefix}/${i}`;
      fn(n, id, depth, parent);
      if (n.k === "section") rec(n.children, id, depth + 1, n);
    });
  messages.forEach((m, mi) => rec(m.children, String(mi), 0, null));
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "untitled";

export const xmlTag = (s: string) => slug(s).replace(/-/g, "_");
