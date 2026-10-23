// Tool handlers: how the runner answers a model's tool call without a server of your own.
// Declared in a tool block's frontmatter (`handler: lookup` or `handler: http`).
import { type Item, type Rec, getPath, pathSegments } from "./data";
import { fill } from "./pipeline";
import type { Block } from "./workspace";

export type ToolHandler =
  | {
      kind: "lookup";
      /** project data source to search */
      source: string;
      /** record field (or jq-style path) to match */
      key: string;
      /** argument (or path into the arguments) holding the value; defaults to the key's last segment */
      arg: string;
      /** template over the matched record, like the `template` transform; default is the record as JSON */
      ret?: string;
      /** template over the arguments when nothing matches */
      notFound?: string;
    }
  | { kind: "http"; url: string; headers: Record<string, string> };

export interface ToolCall {
  id: string;
  name: string;
  /** the arguments as the model sent them: parsed JSON, or the raw string when it isn't JSON */
  args: unknown;
}

export interface ToolResult {
  text: string;
  error?: boolean;
}

export interface ToolCtx {
  data(source: string): Item[] | undefined;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));

/** The argument a lookup reads when none is named: the key's last segment ("handle", ".meta.slug" → "slug"). */
export const defaultArg = (key: string) => String(pathSegments(key).at(-1) ?? key);

/** The handler a tool block declares, or undefined when it has none (or an unknown one). */
export function toolHandler(b: Block): ToolHandler | undefined {
  const f = b.front;
  if (f.handler === "lookup") {
    const key = s(f.key) || "id";
    return { kind: "lookup", source: s(f.source), key, arg: s(f.arg) || defaultArg(key), ret: f.return === undefined ? undefined : s(f.return), notFound: f.notFound === undefined ? undefined : s(f.notFound) };
  }
  if (f.handler === "http") {
    const headers = f.headers && typeof f.headers === "object" ? Object.fromEntries(Object.entries(f.headers as Rec).map(([k, v]) => [k, s(v)])) : {};
    return { kind: "http", url: s(f.url), headers };
  }
  return undefined;
}

/** Problems with a handler that can be seen before running (missing source, no url). */
export function handlerProblem(h: ToolHandler, ctx: Pick<ToolCtx, "data">): string | undefined {
  if (h.kind === "lookup") {
    if (!h.source) return "lookup handler has no source";
    if (!ctx.data(h.source)) return `lookup source "${h.source}" not found in this workflow`;
  } else if (!h.url) return "http handler has no url";
  return undefined;
}

/** Parse a call's arguments, which servers send as a JSON string (or, some, as an object). */
export function parseArgs(raw: unknown): unknown {
  if (typeof raw !== "string") return raw ?? {};
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Answer one tool call. Failures come back as text for the model, flagged `error`. */
export async function runTool(h: ToolHandler, call: ToolCall, ctx: ToolCtx): Promise<ToolResult> {
  if (h.kind === "lookup") {
    if (typeof call.args !== "object" || call.args === null) return { text: `error: arguments for ${call.name} are not a JSON object`, error: true };
    const want = getPath(call.args, h.arg);
    const items = ctx.data(h.source);
    if (!items) return { text: `error: data source "${h.source}" not found`, error: true };
    const hit = want === undefined ? undefined : items.find((it) => typeof it === "object" && s(getPath(it, h.key)) === s(want));
    if (!hit) return { text: h.notFound !== undefined ? fill(h.notFound, call.args as Rec, 0) : `No ${h.source} record with ${h.key} = ${JSON.stringify(want ?? null)}.` };
    return { text: h.ret !== undefined ? fill(h.ret, hit, 0) : JSON.stringify(hit) };
  }
  const f = ctx.fetchImpl ?? fetch;
  try {
    const res = await f(h.url, { method: "POST", headers: { "content-type": "application/json", ...h.headers }, body: JSON.stringify(call.args), signal: ctx.signal });
    const text = await res.text();
    return res.ok ? { text } : { text: `error: HTTP ${res.status}${text ? ": " + text.slice(0, 2000) : ""}`, error: true };
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    return { text: `error: could not reach ${h.url} (${(e as Error).message || e}). The browser calls it directly, so it must allow CORS.`, error: true };
  }
}
