// Run records: one markdown file per run under projects/<p>/runs/.
import { joinFront, splitFront } from "./doc";
import type { ScoreRow } from "./scoring";
import type { Item } from "./data";

export type RunMode = "whole" | "fanout" | "repeat" | "ablation";

export interface RunOutput {
  label: string;
  text: string;
  error?: string;
  ms?: number;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  /** ids of the data items in this chunk (fan-out) */
  items?: string[];
  /** card id muted for this output (ablation) */
  muted?: string;
  mutedLabel?: string;
  accuracy?: number;
  /** rendered prompt when it differs from the run's main prompt */
  prompt?: string;
  /** the tool loop's transcript, when the model called tools; `text` is the last turn's */
  turns?: RunTurn[];
}

/** One model reply in a tool loop, with the calls it made and what they returned. */
export interface RunTurn {
  text: string;
  calls?: RunToolCall[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  /** this turn was sent without tools ("final turn without tools") */
  noTools?: boolean;
}

export interface RunToolCall {
  id: string;
  name: string;
  /** parsed JSON arguments, or the raw string when they weren't JSON */
  args: unknown;
  /** absent when the call wasn't answered (no handler, or the round cap) */
  result?: string;
  error?: boolean;
}

export interface RunRecord {
  id: string;
  file: string;
  version: string;
  time: string;
  endpoint: string;
  model: string;
  mode: RunMode;
  settings: Record<string, unknown>;
  promptHash: string;
  prompt: string;
  request: string;
  outputs: RunOutput[];
  accuracy?: number;
  correct?: number;
  total?: number;
  misses?: ScoreRow[];
  rating?: "up" | "down";
  starred?: boolean;
  note?: string;
}

const fence = (s: string, info = "text") => {
  const longest = Math.max(0, ...(s.match(/`+/g) ?? []).map((x) => x.length));
  const f = "`".repeat(Math.max(3, longest + 1));
  return `${f}${info}\n${s}\n${f}`;
};

const comment = (v: unknown) => `<!-- ${JSON.stringify(v).replace(/--/g, "\\u002d\\u002d")} -->`;

type Tok = { t: "h"; level: number; text: string } | { t: "fence"; info: string; body: string } | { t: "meta"; value: unknown };

/** Headings, fenced blocks and meta comments, in order. Fence-aware, so a "## " line inside a
 * prompt or output is content, not a section break. */
function tokens(body: string): Tok[] {
  const lines = body.split("\n");
  const out: Tok[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const f = /^(`{3,})(.*)$/.exec(l);
    if (f) {
      let j = i + 1;
      while (j < lines.length && lines[j] !== f[1]) j++;
      out.push({ t: "fence", info: f[2].trim(), body: lines.slice(i + 1, j).join("\n") });
      i = j;
      continue;
    }
    const h = /^(#{2,4}) (.*)$/.exec(l);
    if (h) {
      out.push({ t: "h", level: h[1].length, text: h[2] });
      continue;
    }
    const m = /^<!-- (.*) -->$/.exec(l);
    if (m)
      try {
        out.push({ t: "meta", value: JSON.parse(m[1]) });
      } catch {
        /* ignore */
      }
  }
  return out;
}

export function serializeRun(r: Omit<RunRecord, "id" | "file">): string {
  const front: Record<string, unknown> = {
    version: r.version,
    time: r.time,
    endpoint: r.endpoint,
    model: r.model,
    mode: r.mode,
    promptHash: r.promptHash,
    accuracy: r.accuracy,
    correct: r.correct,
    total: r.total,
    rating: r.rating,
    starred: r.starred || undefined,
    note: r.note,
    settings: r.settings,
  };
  const parts: string[] = [`## Prompt\n\n${fence(r.prompt)}`, `## Request\n\n${fence(r.request, "json")}`];
  r.outputs.forEach((o, i) => {
    const meta: Record<string, unknown> = {};
    for (const k of ["error", "ms", "usage", "items", "muted", "mutedLabel", "accuracy"] as const) if (o[k] !== undefined) meta[k] = o[k];
    let s = `## Output ${i + 1} · ${o.label.replace(/\n/g, " ")}\n\n${comment(meta)}\n\n${fence(o.text)}`;
    if (o.prompt !== undefined) s += `\n\n${fence(o.prompt, "prompt")}`;
    o.turns?.forEach((t, ti) => {
      s += `\n\n### Turn ${ti + 1}`;
      const tm: Record<string, unknown> = {};
      if (t.usage) tm.usage = t.usage;
      if (t.noTools) tm.noTools = true;
      if (Object.keys(tm).length) s += `\n\n${comment(tm)}`;
      if (t.text) s += `\n\n${fence(t.text)}`;
      for (const c of t.calls ?? []) {
        s += `\n\n#### Call · ${c.name}\n\n${comment({ id: c.id, name: c.name, ...(c.error ? { error: true } : {}) })}\n\n`;
        s += typeof c.args === "string" ? fence(c.args, "args") : fence(JSON.stringify(c.args, null, 2), "json");
        if (c.result !== undefined) s += `\n\n${fence(c.result, "result")}`;
      }
    });
    parts.push(s);
  });
  if (r.misses?.length) {
    parts.push(
      `## Misses\n\n${comment(r.misses)}\n\n| id | expected | got |\n| --- | --- | --- |\n` +
        r.misses.map((m) => `| ${m.id.replace(/\|/g, "\\|")} | ${m.expected.join(" / ").replace(/\|/g, "\\|")} | ${(m.got ?? "∅").replace(/\|/g, "\\|").replace(/\n/g, " ")} |`).join("\n"),
    );
  }
  return joinFront(front, parts.join("\n\n") + "\n");
}

export function parseRun(file: string, text: string): RunRecord | null {
  const { front, body } = splitFront(text);
  if (!front.time) return null;
  let prompt = "";
  let request = "";
  const outputs: RunOutput[] = [];
  let misses: ScoreRow[] | undefined;
  let sec = "";
  let out: RunOutput | undefined;
  let turn: RunTurn | undefined;
  let call: RunToolCall | undefined;
  let gotText = false;
  for (const k of tokens(body)) {
    if (k.t === "h") {
      if (k.level === 2) {
        sec = k.text;
        out = turn = call = undefined;
        if (sec.startsWith("Output")) {
          out = { label: sec.replace(/^Output \d+ · ?/, ""), text: "" };
          gotText = false;
          outputs.push(out);
        }
      } else if (out && k.level === 3 && k.text.startsWith("Turn")) {
        turn = { text: "" };
        call = undefined;
        (out.turns ??= []).push(turn);
      } else if (turn && k.level === 4 && k.text.startsWith("Call")) {
        call = { id: "", name: k.text.replace(/^Call · ?/, ""), args: {} };
        (turn.calls ??= []).push(call);
      }
      continue;
    }
    if (k.t === "meta") {
      if (sec === "Misses") misses = k.value as ScoreRow[];
      else if (call) Object.assign(call, k.value);
      else if (turn) Object.assign(turn, k.value);
      else if (out) Object.assign(out, k.value);
      continue;
    }
    if (sec === "Prompt") prompt = k.body;
    else if (sec === "Request") request = k.body;
    else if (call) {
      if (k.info === "result") call.result = k.body;
      else if (k.info === "args") call.args = k.body;
      else
        try {
          call.args = JSON.parse(k.body);
        } catch {
          call.args = k.body;
        }
    } else if (turn) turn.text = k.body;
    else if (out) {
      if (k.info === "prompt") out.prompt = k.body;
      else if (!gotText) {
        out.text = k.body;
        gotText = true;
      }
    }
  }
  const name = file.split("/").pop()!.replace(/\.md$/, "");
  const n = (v: unknown) => (typeof v === "number" ? v : undefined);
  return {
    id: name,
    file,
    version: String(front.version ?? ""),
    time: String(front.time),
    endpoint: String(front.endpoint ?? ""),
    model: String(front.model ?? ""),
    mode: (front.mode as RunMode) ?? "whole",
    settings: (front.settings as Record<string, unknown>) ?? {},
    promptHash: String(front.promptHash ?? ""),
    prompt,
    request,
    outputs,
    accuracy: n(front.accuracy),
    correct: n(front.correct),
    total: n(front.total),
    misses,
    rating: front.rating === "up" || front.rating === "down" ? front.rating : undefined,
    starred: front.starred === true,
    note: front.note ? String(front.note) : undefined,
  };
}

export const runFileName = (time: string, version: string) => `${time.replace(/:/g, "-").replace(/\..*$/, "")}_${version}.md`;

/** How a fan-out output names the rows it covered (RunOutput.items). */
export const chunkIds = (items: Item[]): string[] => items.map((x) => (typeof x === "string" ? x : String(x.name ?? x.id ?? JSON.stringify(x))));
