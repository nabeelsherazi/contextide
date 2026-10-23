// Execute test runs: whole, fan-out, repeat, ablation. Writes one run file per run.
import { type Message, walk, inlinePlain } from "../core/doc";
import { render, promptText, type Rendered } from "../core/render";
import { envFor } from "../core/env";
import { buildRequest, continueRequest, readResponse, readStreamDelta, mergeToolCallDeltas, finishToolCalls, toolCallsText, type BuiltRequest, type ParsedResponse, type WireMessage } from "../core/request";
import { runTool, parseArgs } from "../core/tools";
import { type Endpoint, type RunSettings, type Workspace, type Project, type Version, dataItems } from "../core/workspace";
import { score, type ScoreResult } from "../core/scoring";
import { type RunMode, type RunOutput, type RunRecord, type RunTurn, serializeRun, runFileName, chunkIds } from "../core/runs";
import { hashString } from "../core/random";
import type { Item } from "../core/data";
import { countTokens } from "../tokens/tokens";

export interface RunPlan {
  ws: Workspace;
  project: Project;
  version: Version;
  messages: Message[];
  mode: RunMode;
  settings: RunSettings;
  endpoint: Endpoint;
  apiKey: string;
  fanout?: { source: string; size: number };
  repeat?: number;
  scoring: boolean;
  signal?: AbortSignal;
  onProgress?: (p: { done: number; total: number; label: string; live: string }) => void;
  /** injectable for tests */
  fetchImpl?: typeof fetch;
  now?: Date;
}

interface Variant {
  label: string;
  dataOverride?: Record<string, Item[]>;
  mute?: Set<string>;
  muted?: string;
  mutedLabel?: string;
}

export function ablationTargets(messages: Message[]): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  walk(messages, (n, id) => {
    if (n.muted) return;
    if (n.k === "line" && !inlinePlain(n.content).trim()) return;
    const label =
      n.k === "line" || n.k === "directive"
        ? inlinePlain(n.content).slice(0, 60)
        : n.k === "section"
          ? `section ${n.title || "untitled"}`
          : n.k === "use"
            ? `${n.ref.split(":")[0]} ${(n.ref.split("/").pop() ?? n.ref).replace(/-/g, " ")}`
            : n.k === "data"
              ? `data ${n.source}`
              : `${n.k} ${n.name}`;
    out.push({ id, label });
  });
  return out;
}

function variantsFor(plan: RunPlan): Variant[] {
  switch (plan.mode) {
    case "repeat":
      return Array.from({ length: Math.max(1, plan.repeat ?? 3) }, (_, i) => ({ label: `repeat ${i + 1}` }));
    case "fanout": {
      const src = plan.project.data.find((d) => d.name === plan.fanout?.source);
      if (!src) throw new Error(`fan-out data source "${plan.fanout?.source}" not found`);
      const items = dataItems(src).items;
      const k = Math.max(1, plan.fanout!.size);
      const out: Variant[] = [];
      for (let i = 0; i < items.length; i += k)
        out.push({ label: k === 1 ? `row ${i + 1}` : `rows ${i + 1}–${Math.min(items.length, i + k)}`, dataOverride: { [src.name]: items.slice(i, i + k) } });
      return out;
    }
    case "ablation":
      return [{ label: "baseline" }, ...ablationTargets(plan.messages).map((t) => ({ label: `without ${t.label}`, mute: new Set([t.id]), muted: t.id, mutedLabel: t.label }))];
    default:
      return [{ label: "output" }];
  }
}

export function friendlyFetchError(e: unknown, url: string): string {
  const msg = (e as Error).message || String(e);
  if ((e as Error).name === "AbortError") return "stopped";
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg))
    return `Could not reach ${url}. Is the server running, and does it allow CORS from this page? (LM Studio: enable CORS in server settings; llama-server allows it by default.)`;
  return msg;
}

async function call(req: BuiltRequest, plan: RunPlan, onDelta: (s: string) => void): Promise<ParsedResponse> {
  const f = plan.fetchImpl ?? fetch;
  const res = await f(req.url, { method: "POST", headers: req.headers, body: JSON.stringify(req.body), signal: plan.signal });
  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(`HTTP ${res.status} ${res.statusText}${detail ? ": " + detail.slice(0, 500) : ""}`);
  }
  if (req.body.stream && res.body) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let text = "";
    let usage: RunOutput["usage"];
    const calls: Parameters<typeof mergeToolCallDeltas>[0] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const j = JSON.parse(data);
          if (j.usage) usage = j.usage;
          const d = readStreamDelta(j);
          if (d.toolCalls) mergeToolCallDeltas(calls, d.toolCalls);
          if (d.text) {
            text += d.text;
            onDelta(text);
          }
        } catch {
          /* ignore partial */
        }
      }
    }
    return { text, usage, toolCalls: finishToolCalls(calls) };
  }
  return readResponse(await res.json());
}

const addUsage = (a: RunOutput["usage"], b: RunOutput["usage"]): RunOutput["usage"] =>
  !b ? a : { prompt_tokens: (a?.prompt_tokens ?? 0) + (b.prompt_tokens ?? 0), completion_tokens: (a?.completion_tokens ?? 0) + (b.completion_tokens ?? 0) };

/**
 * One output: call the model and, while it calls tools that have handlers, answer them and call
 * again, up to `toolRounds` rounds. With `finalNoTools` the answer always comes from one last turn
 * sent without tools (and with the schema, if any).
 */
async function converse(plan: RunPlan, rendered: Rendered, data: (s: string) => Item[] | undefined, first: BuiltRequest, onLive: (live: string, round: number) => void): Promise<Pick<RunOutput, "text" | "usage" | "turns" | "error">> {
  const cap = Math.max(0, plan.settings.toolRounds ?? 4);
  const finalTurn = !!plan.settings.finalNoTools && rendered.tools.length > 0;
  const history: WireMessage[] = [];
  const turns: RunTurn[] = [];
  let usage: RunOutput["usage"];
  let req = first;
  let rounds = 0;
  const done = (o: Pick<RunOutput, "text" | "error">) => ({ ...o, usage, turns: turns.some((t) => t.calls?.length) || turns.length > 1 ? turns : undefined });
  try {
    for (;;) {
      const withTools = "tools" in req.body;
      const r = await call(req, plan, (live) => onLive(live, rounds));
      usage = addUsage(usage, r.usage);
      const turn: RunTurn = { text: r.text, ...(r.usage ? { usage: r.usage } : {}), ...(withTools || !rendered.tools.length ? {} : { noTools: true }) };
      turns.push(turn);
      const calls = withTools ? r.toolCalls : undefined;
      if (!calls) {
        // A reply given while tools were still offered is replaced by the final turn, which carries the schema.
        if (finalTurn && withTools && rendered.responseFormat) {
          req = continueRequest(first, rendered, plan.settings, history, { tools: false });
          continue;
        }
        return done({ text: r.text });
      }
      turn.calls = calls.map((c) => ({ id: c.id, name: c.function.name, args: parseArgs(c.function.arguments) }));
      if (calls.some((c) => !rendered.toolHandlers[c.function.name])) return done({ text: toolCallsText(r.text, calls) });
      if (rounds >= cap) {
        if (finalTurn) {
          req = continueRequest(first, rendered, plan.settings, history, { tools: false });
          continue;
        }
        return done({ text: r.text, error: r.text ? undefined : `the model was still calling tools after ${cap} round${cap === 1 ? "" : "s"}` });
      }
      rounds++;
      onLive("", rounds);
      const results: WireMessage[] = [];
      for (let i = 0; i < calls.length; i++) {
        const rec = turn.calls[i];
        const res = await runTool(rendered.toolHandlers[rec.name], rec, { data, fetchImpl: plan.fetchImpl, signal: plan.signal });
        rec.result = res.text;
        if (res.error) rec.error = true;
        results.push({ role: "tool", tool_call_id: calls[i].id, content: res.text });
      }
      history.push({ role: "assistant", content: r.text || null, tool_calls: calls }, ...results);
      req = continueRequest(first, rendered, plan.settings, history, { tools: true });
    }
  } catch (e) {
    return done({ text: "", error: friendlyFetchError(e, req.url) });
  }
}

function scoreOutput(plan: RunPlan, rendered: Rendered, output: string): ScoreResult | undefined {
  const ev = plan.project.settings.eval;
  if (!plan.scoring || !ev) return;
  const key = plan.project.data.find((d) => d.name === ev.key);
  if (!key) return;
  const shown = Object.values(rendered.dataShown).find((d) => d.source !== ev.key && d.source !== "categories") ?? Object.values(rendered.dataShown).find((d) => d.source !== ev.key);
  if (!shown) return;
  return score([{ items: shown.items, output }], dataItems(key).items, ev);
}

export async function executeRun(plan: RunPlan): Promise<{ record: Omit<RunRecord, "id" | "file">; fileName: string; text: string }> {
  const now = plan.now ?? new Date();
  const variants = variantsFor(plan);
  const outputs: RunOutput[] = [];
  const allRows: ScoreResult["rows"] = [];
  let firstPrompt = "";
  let firstRequest = "";
  for (let i = 0; i < variants.length; i++) {
    const va = variants[i];
    if (plan.signal?.aborted) break;
    plan.onProgress?.({ done: i, total: variants.length, label: va.label, live: "" });
    const env = envFor(plan.ws, plan.project, plan.version, { now, dataOverride: va.dataOverride, mute: va.mute, countTokens });
    const rendered = render(plan.messages, env);
    const prompt = promptText(rendered);
    const req = buildRequest(rendered, plan.settings, plan.endpoint, plan.apiKey);
    if (i === 0) {
      firstPrompt = prompt;
      firstRequest = JSON.stringify({ url: req.url, body: req.body }, null, 2);
    }
    const t0 = performance.now();
    const out: RunOutput = { label: va.label, text: "" };
    if (va.muted) {
      out.muted = va.muted;
      out.mutedLabel = va.mutedLabel;
    }
    if (prompt !== firstPrompt) out.prompt = prompt;
    const r = await converse(plan, rendered, env.data, req, (live, round) => plan.onProgress?.({ done: i, total: variants.length, label: round ? `${va.label} · tool round ${round}` : va.label, live }));
    Object.assign(out, Object.fromEntries(Object.entries(r).filter(([, x]) => x !== undefined)));
    if (out.error === "stopped") break;
    out.ms = Math.round(performance.now() - t0);
    if (!out.error) {
      const s = scoreOutput(plan, rendered, out.text);
      if (s) {
        out.accuracy = s.accuracy;
        if (plan.mode === "whole" || plan.mode === "fanout" || (plan.mode === "ablation" && i === 0) || (plan.mode === "repeat" && i === 0)) allRows.push(...s.rows);
      }
    }
    if (va.dataOverride) out.items = chunkIds(Object.values(va.dataOverride)[0]);
    outputs.push(out);
    plan.onProgress?.({ done: i + 1, total: variants.length, label: va.label, live: out.text });
  }
  const scored = outputs.filter((o) => o.accuracy !== undefined);
  let accuracy: number | undefined;
  let correct: number | undefined;
  let total: number | undefined;
  if (scored.length) {
    if (plan.mode === "repeat") accuracy = scored.reduce((a, o) => a + o.accuracy!, 0) / scored.length;
    if (allRows.length) {
      correct = allRows.filter((r) => r.ok).length;
      total = allRows.length;
      if (plan.mode !== "repeat") accuracy = correct / total;
    }
  }
  const time = now.toISOString();
  const record: Omit<RunRecord, "id" | "file"> = {
    version: plan.version.id,
    time,
    endpoint: plan.endpoint.id,
    model: String(plan.settings.model || plan.endpoint.defaultModel || ""),
    mode: plan.mode,
    settings: { ...plan.settings, ...(plan.fanout ? { fanout: plan.fanout } : {}), ...(plan.repeat ? { repeat: plan.repeat } : {}), flavor: plan.version.flavor },
    promptHash: hashString(firstRequest).toString(16),
    prompt: firstPrompt,
    request: firstRequest,
    outputs,
    accuracy,
    correct,
    total,
    misses: allRows.filter((r) => !r.ok),
  };
  return { record, fileName: runFileName(time, plan.version.id), text: serializeRun(record) };
}
