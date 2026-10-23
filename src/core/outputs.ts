// Outputs as data: a fan-out run's outputs joined back onto the rows they came from, as records a
// later stage can read as a data source. DOM-free, so a script can call it on a workspace too.
import type { Item, Rec } from "./data";
import { type RunRecord, chunkIds } from "./runs";
import { type Workspace, dataItems } from "./workspace";

/** An output as JSON when it is JSON, bare or in a single ```json fence; undefined otherwise. */
export function parseOutputJson(text: string): { value: unknown } | undefined {
  const t = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(t);
  const src = fenced ? fenced[1] : t;
  if (!/^[[{"\d-]|^(true|false|null)$/.test(src)) return undefined;
  try {
    return { value: JSON.parse(src) };
  } catch {
    return undefined;
  }
}

const isObj = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);

/** One row plus its output: an object's fields are merged in (they win over the row's), anything
 * else lands in `output`. A plain-text row becomes `{ text }`. */
function join(row: Item, out: unknown): Rec {
  const base: Rec = typeof row === "string" ? { text: row } : { ...row };
  return isObj(out) ? { ...base, ...out } : { ...base, output: out };
}

export interface OutputRecords {
  records: Rec[];
  /** outputs that failed, whose rows are left out */
  skipped: number;
}

/**
 * One record per input row of a fan-out run. `rows` is the fan-out source's items as they are now;
 * they must still match the ids the run recorded for each chunk. With several rows per call, an
 * output that is a JSON array with one element per row is split across them; otherwise every row
 * of the chunk gets the whole output.
 */
export function outputRecords(run: RunRecord, rows: Item[]): OutputRecords {
  const fan = run.settings.fanout as { source?: string; size?: number } | undefined;
  if (run.mode !== "fanout" || !fan) throw new Error("only a fan-out run has one output per row");
  const k = Math.max(1, Number(fan.size) || 1);
  const records: Rec[] = [];
  let skipped = 0;
  run.outputs.forEach((o, i) => {
    const chunk = rows.slice(i * k, i * k + k);
    if (o.items && JSON.stringify(chunkIds(chunk)) !== JSON.stringify(o.items))
      throw new Error(`"${fan.source}" has changed since this run (rows ${i * k + 1}–${i * k + o.items.length} no longer match)`);
    if (o.error) {
      skipped += chunk.length;
      return;
    }
    const parsed = parseOutputJson(o.text);
    const value = parsed ? parsed.value : o.text;
    if (chunk.length > 1 && Array.isArray(value) && value.length === chunk.length) chunk.forEach((row, j) => records.push(join(row, value[j])));
    else chunk.forEach((row) => records.push(join(row, value)));
  });
  return { records, skipped };
}

export const toJsonl = (records: Rec[]) => records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : "");

/** A fan-out run's outputs as `.jsonl` text, looked up by workflow and run id (its file name without .md). */
export function outputsAsData(ws: Workspace, project: string, runId: string): OutputRecords & { text: string } {
  const p = ws.projects.find((x) => x.name === project);
  if (!p) throw new Error(`no workflow "${project}"`);
  const run = p.runs.find((r) => r.id === runId);
  if (!run) throw new Error(`no run "${runId}" in ${project}`);
  const source = (run.settings.fanout as { source?: string } | undefined)?.source;
  const src = p.data.find((d) => d.name === source);
  if (run.mode === "fanout" && !src) throw new Error(`the fan-out source "${source}" is gone`);
  const r = outputRecords(run, src ? dataItems(src).items : []);
  return { ...r, text: toJsonl(r.records) };
}
