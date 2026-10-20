// Run records: one markdown file per run under projects/<p>/runs/.
import { joinFront, splitFront } from "./doc";
import type { ScoreRow } from "./scoring";

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

function unfence(block: string): string {
  const lines = block.split("\n");
  const start = lines.findIndex((l) => /^`{3,}/.test(l));
  if (start < 0) return block.trim();
  const f = /^(`{3,})/.exec(lines[start])![1];
  let end = lines.length - 1;
  for (let i = lines.length - 1; i > start; i--)
    if (lines[i] === f) {
      end = i;
      break;
    }
  return lines.slice(start + 1, end).join("\n");
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
    let s = `## Output ${i + 1} · ${o.label.replace(/\n/g, " ")}\n\n<!-- ${JSON.stringify(meta).replace(/--/g, "\\u002d\\u002d")} -->\n\n${fence(o.text)}`;
    if (o.prompt !== undefined) s += `\n\n${fence(o.prompt, "prompt")}`;
    parts.push(s);
  });
  if (r.misses?.length) {
    parts.push(
      `## Misses\n\n<!-- ${JSON.stringify(r.misses).replace(/--/g, "\\u002d\\u002d")} -->\n\n| id | expected | got |\n| --- | --- | --- |\n` +
        r.misses.map((m) => `| ${m.id.replace(/\|/g, "\\|")} | ${m.expected.join(" / ").replace(/\|/g, "\\|")} | ${(m.got ?? "∅").replace(/\|/g, "\\|").replace(/\n/g, " ")} |`).join("\n"),
    );
  }
  return joinFront(front, parts.join("\n\n") + "\n");
}

export function parseRun(file: string, text: string): RunRecord | null {
  const { front, body } = splitFront(text);
  if (!front.time) return null;
  const sections = body.split(/^## /m).slice(1);
  let prompt = "";
  let request = "";
  const outputs: RunOutput[] = [];
  let misses: ScoreRow[] | undefined;
  for (const sec of sections) {
    const nl = sec.indexOf("\n");
    const head = sec.slice(0, nl);
    const rest = sec.slice(nl + 1);
    if (head === "Prompt") prompt = unfence(rest);
    else if (head === "Request") request = unfence(rest);
    else if (head.startsWith("Output")) {
      const label = head.replace(/^Output \d+ · ?/, "");
      const metaM = /<!-- (.*?) -->/.exec(rest);
      let meta: Partial<RunOutput> = {};
      try {
        if (metaM) meta = JSON.parse(metaM[1]);
      } catch {
        /* ignore */
      }
      const afterMeta = metaM ? rest.slice(metaM.index + metaM[0].length) : rest;
      // output fence, then optional prompt fence
      const pi = afterMeta.search(/^`{3,}prompt$/m);
      const o: RunOutput = { label, text: unfence(pi >= 0 ? afterMeta.slice(0, pi) : afterMeta), ...meta };
      if (pi >= 0) o.prompt = unfence(afterMeta.slice(pi));
      outputs.push(o);
    } else if (head === "Misses") {
      const m = /<!-- (.*?) -->/.exec(rest);
      try {
        if (m) misses = JSON.parse(m[1]);
      } catch {
        /* ignore */
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
