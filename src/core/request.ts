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
  if (r.responseFormat) body.response_format = r.responseFormat;
  return { url: `${base}/chat/completions`, headers, body };
}

export interface ParsedResponse {
  text: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  finish?: string;
}

export function readResponse(json: unknown): ParsedResponse {
  const j = json as {
    choices?: { message?: { content?: string | null; tool_calls?: unknown[]; reasoning_content?: string }; text?: string; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string } | string;
  };
  if (j.error) throw new Error(typeof j.error === "string" ? j.error : (j.error.message ?? "API error"));
  const c = j.choices?.[0];
  let text = c?.message?.content ?? c?.text ?? "";
  if (c?.message?.tool_calls?.length) text = (text ? text + "\n\n" : "") + "tool_calls: " + JSON.stringify(c.message.tool_calls, null, 2);
  return { text, usage: j.usage, finish: c?.finish_reason };
}

/** Parse one SSE chunk payload and return the text delta. */
export function readStreamDelta(json: unknown): string {
  const j = json as { choices?: { delta?: { content?: string | null }; text?: string }[] };
  const c = j.choices?.[0];
  return c?.delta?.content ?? c?.text ?? "";
}

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
