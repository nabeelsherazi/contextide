// Build OpenAI-compatible request bodies from a render, and read responses.
import type { Rendered } from "./render";
import type { Endpoint, RunSettings } from "./workspace";

export interface BuiltRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export function flattenForCompletions(r: Rendered): string {
  if (r.messages.length === 1 && r.messages[0].role === "user") return r.messages[0].text;
  const title = (role: string) => role[0].toUpperCase() + role.slice(1);
  const parts = r.messages.map((m) => `### ${title(m.role)}:\n${m.text}`);
  const last = r.messages[r.messages.length - 1];
  if (last?.role !== "assistant") parts.push("### Assistant:\n");
  return parts.join("\n\n");
}

export function buildRequest(r: Rendered, s: RunSettings, ep: Endpoint, apiKey?: string): BuiltRequest {
  const base = ep.baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = { "content-type": "application/json", ...ep.headers };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const sampling: Record<string, unknown> = {};
  if (s.temperature !== undefined) sampling.temperature = s.temperature;
  if (s.top_p !== undefined) sampling.top_p = s.top_p;
  if (s.max_tokens !== undefined) sampling.max_tokens = s.max_tokens;
  if (s.seed !== undefined) sampling.seed = s.seed;
  if (s.stop?.length) sampling.stop = s.stop;
  if (s.stream) sampling.stream = true;
  const model = s.model || ep.defaultModel || "";
  if (ep.style === "completions") {
    const body: Record<string, unknown> = { ...ep.extraBody, ...(s.extra ?? {}), model, prompt: flattenForCompletions(r), ...sampling };
    if (r.responseFormat) body.json_schema = r.responseFormat.json_schema.schema;
    return { url: `${base}/completions`, headers, body };
  }
  const body: Record<string, unknown> = {
    ...ep.extraBody,
    ...(s.extra ?? {}),
    model,
    messages: r.messages.map((m) => ({ role: m.role, content: m.text })),
    ...sampling,
  };
  if (r.tools.length) body.tools = r.tools;
  // llama.cpp can't apply a json_schema grammar and tools in one request: with "final turn without
  // tools" the schema waits for that last turn (see continueRequest).
  if (r.responseFormat && !(r.tools.length && s.finalNoTools)) body.response_format = r.responseFormat;
  return { url: `${base}/chat/completions`, headers, body };
}

/** A chat message in the wire format, including the tool-loop shapes. */
export type WireMessage =
  | { role: "system" | "user" | "assistant"; content: string | null; tool_calls?: WireToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface WireToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** The next request of a tool loop: the same body with the turns so far appended. `tools: false` is
 * the last turn of "final turn without tools", which is also where the schema applies. */
export function continueRequest(first: BuiltRequest, r: Rendered, s: RunSettings, turns: WireMessage[], o: { tools: boolean }): BuiltRequest {
  const body: Record<string, unknown> = { ...first.body, messages: [...(first.body.messages as WireMessage[]), ...turns] };
  delete body.tools;
  delete body.response_format;
  if (o.tools && r.tools.length) body.tools = r.tools;
  if (r.responseFormat && !(body.tools && s.finalNoTools)) body.response_format = r.responseFormat;
  return { ...first, body };
}

export interface ParsedResponse {
  text: string;
  toolCalls?: WireToolCall[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  finish?: string;
}

interface RawToolCall {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: unknown };
}

const wireCall = (c: RawToolCall, i: number): WireToolCall => ({
  id: c.id || `call_${i + 1}`,
  type: "function",
  function: { name: c.function?.name ?? "", arguments: typeof c.function?.arguments === "string" ? c.function.arguments : JSON.stringify(c.function?.arguments ?? {}) },
});

export function readResponse(json: unknown): ParsedResponse {
  const j = json as {
    choices?: { message?: { content?: string | null; tool_calls?: RawToolCall[]; reasoning_content?: string }; text?: string; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string } | string;
  };
  if (j.error) throw new Error(typeof j.error === "string" ? j.error : (j.error.message ?? "API error"));
  const c = j.choices?.[0];
  const text = c?.message?.content ?? c?.text ?? "";
  const calls = c?.message?.tool_calls;
  return { text, toolCalls: calls?.length ? calls.map(wireCall) : undefined, usage: j.usage, finish: c?.finish_reason };
}

/** How tool calls read when nothing answers them: appended to the text, as before the tool loop. */
export const toolCallsText = (text: string, calls: WireToolCall[]) => (text ? text + "\n\n" : "") + "tool_calls: " + JSON.stringify(calls, null, 2);

/** Parse one SSE chunk payload: its text delta and any tool-call fragments. */
export function readStreamDelta(json: unknown): { text: string; toolCalls?: RawToolCall[] } {
  const j = json as { choices?: { delta?: { content?: string | null; tool_calls?: RawToolCall[] }; text?: string }[] };
  const c = j.choices?.[0];
  return { text: c?.delta?.content ?? c?.text ?? "", toolCalls: c?.delta?.tool_calls };
}

/** Fold streamed tool-call fragments (keyed by index; arguments arrive in pieces) into whole calls. */
export function mergeToolCallDeltas(acc: RawToolCall[], deltas: RawToolCall[]): void {
  for (const d of deltas) {
    const i = d.index ?? acc.length;
    const cur = (acc[i] ??= { function: { name: "", arguments: "" } });
    if (d.id) cur.id = d.id;
    if (d.function?.name) cur.function!.name = (cur.function!.name ?? "") + d.function.name;
    if (d.function?.arguments !== undefined) cur.function!.arguments = String(cur.function!.arguments ?? "") + (typeof d.function.arguments === "string" ? d.function.arguments : JSON.stringify(d.function.arguments));
  }
}

export const finishToolCalls = (acc: RawToolCall[]): WireToolCall[] | undefined => {
  const calls = acc.filter(Boolean);
  return calls.length ? calls.map(wireCall) : undefined;
};

export function curlFor(req: BuiltRequest, redactKey = true): string {
  const h = Object.entries(req.headers)
    .map(([k, v]) => `  -H ${shq(`${k}: ${redactKey && k === "authorization" ? "Bearer $API_KEY" : v}`)}`)
    .join(" \\\n");
  return `curl ${shq(req.url)} \\\n${h} \\\n  -d ${shq(JSON.stringify(req.body, null, 2))}`;
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export function tsLiteralFor(r: Rendered): string {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
  const msgs = r.messages.map((m) => `  { role: "${m.role}", content: \`${esc(m.text)}\` },`).join("\n");
  return `const messages = [\n${msgs}\n];`;
}
