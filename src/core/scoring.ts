// Answer-key scoring: parse model output into id -> answer, compare to a key.
import { type Item, itemId } from "./data";

export type ParserCfg =
  | { type: "lines" } // line i answers item i
  | { type: "kv"; sep?: string } // "id: answer" / "id -> answer"
  | { type: "json"; path?: string; id?: string; answer?: string } // map, or array of objects
  | { type: "regex"; pattern: string } // named groups id, answer
  | { type: "whole"; field?: string }; // fan-out K=1: whole output (or a JSON field) is the answer

export interface EvalConfig {
  /** Data source holding the answer key. */
  key: string;
  keyId: string;
  keyAnswer: string;
  /** Field of the data items that holds their id (strings are their own id). */
  itemId?: string;
  parser: ParserCfg;
  match: "exact" | "ci" | "loose";
}

export interface ScoreRow {
  id: string;
  expected: string[];
  got?: string;
  ok: boolean;
}

export interface ScoreResult {
  total: number;
  correct: number;
  accuracy: number;
  unparsed: number;
  rows: ScoreRow[];
}

const norm = (s: string, m: EvalConfig["match"]) => {
  if (m === "exact") return s.trim();
  if (m === "ci") return s.trim().toLowerCase();
  return s
    .toLowerCase()
    .replace(/["'`*_.,;:!?()[\]{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
};

function stripFences(s: string): string {
  const m = /```(?:\w+)?\s*\n([\s\S]*?)\n```/.exec(s);
  return m ? m[1] : s;
}

function jsonSlice(s: string): unknown {
  const t = stripFences(s).trim();
  try {
    return JSON.parse(t);
  } catch {
    const a = Math.min(...["{", "["].map((c) => (t.indexOf(c) < 0 ? Infinity : t.indexOf(c))));
    const b = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
    if (a < Infinity && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error("no JSON found");
  }
}

const getPath = (v: unknown, path?: string): unknown => {
  if (!path) return v;
  let cur: unknown = v;
  for (const k of path.split(".").filter(Boolean)) cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[k] : undefined;
  return cur;
};

const asText = (v: unknown) => (typeof v === "string" ? v : v === undefined || v === null ? "" : JSON.stringify(v));

/** Parse one output for the given items (in the order they were shown). */
export function parseOutput(output: string, ids: string[], p: ParserCfg): { answers: Map<string, string>; unparsed: number } {
  const answers = new Map<string, string>();
  let unparsed = 0;
  const lower = new Map(ids.map((id) => [id.trim().toLowerCase(), id]));
  const findId = (raw: string) => {
    const k = raw
      .trim()
      .replace(/^["'`*]+|["'`*]+$/g, "")
      .replace(/^\d+[.)]\s*/, "")
      .toLowerCase();
    return lower.get(k) ?? (/^\d+$/.test(k) ? ids[Number(k) - 1] : undefined);
  };
  switch (p.type) {
    case "lines": {
      const lines = stripFences(output)
        .split(/\r?\n/)
        .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
        .filter(Boolean);
      ids.forEach((id, i) => lines[i] !== undefined && answers.set(id, lines[i]));
      unparsed = Math.max(0, lines.length - ids.length);
      break;
    }
    case "kv": {
      const sep = new RegExp(p.sep ?? "\\s*(?:->|=>|→|:|\\t)\\s*");
      for (const line of stripFences(output).split(/\r?\n/)) {
        const t = line.replace(/^\s*[-*•]\s*/, "").trim();
        if (!t) continue;
        // split on the LAST separator so ids may contain ':'
        const parts = t.split(sep);
        if (parts.length < 2) {
          unparsed++;
          continue;
        }
        const ans = parts.pop()!;
        const id = findId(parts.join(":"));
        if (id) answers.set(id, ans.trim());
        else unparsed++;
      }
      break;
    }
    case "json": {
      try {
        const v = getPath(jsonSlice(output), p.path);
        if (Array.isArray(v)) {
          v.forEach((row, i) => {
            if (row && typeof row === "object") {
              const r = row as Record<string, unknown>;
              const id = p.id ? findId(asText(r[p.id])) : ids[i];
              const ans = asText(p.answer ? r[p.answer] : Object.values(r).pop());
              if (id) answers.set(id, ans);
              else unparsed++;
            } else if (ids[i] !== undefined) answers.set(ids[i], asText(row));
          });
        } else if (v && typeof v === "object") {
          for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
            const id = findId(k);
            if (id) answers.set(id, asText(p.answer && val && typeof val === "object" ? (val as Record<string, unknown>)[p.answer] : val));
            else unparsed++;
          }
        } else if (ids.length === 1) answers.set(ids[0], asText(v));
      } catch {
        unparsed++;
      }
      break;
    }
    case "regex": {
      const re = new RegExp(p.pattern, "gm");
      let m: RegExpExecArray | null;
      let i = 0;
      while ((m = re.exec(output))) {
        if (m[0] === "") {
          re.lastIndex++;
          continue;
        }
        const g = m.groups ?? {};
        const id = g.id !== undefined ? findId(g.id) : ids[i];
        const ans = g.answer ?? m[1] ?? m[0];
        if (id) answers.set(id, ans.trim());
        else unparsed++;
        i++;
      }
      break;
    }
    case "whole": {
      let ans = output.trim();
      if (p.field) {
        try {
          ans = asText(getPath(jsonSlice(output), p.field));
        } catch {
          unparsed++;
        }
      }
      if (ids.length) answers.set(ids[0], ans);
      break;
    }
  }
  return { answers, unparsed };
}

export function answerKey(keyItems: Item[], cfg: EvalConfig): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const it of keyItems) {
    if (typeof it === "string") {
      // "id -> answer" / "id: answer" lines
      const m = /^(.*?)\s*(?:->|=>|→|\t|:)\s*(.*)$/.exec(it);
      if (m) out.set(m[1].trim().toLowerCase(), m[2].split("|").map((s) => s.trim()));
      continue;
    }
    const id = String(it[cfg.keyId] ?? "");
    const a = it[cfg.keyAnswer];
    out.set(id.trim().toLowerCase(), Array.isArray(a) ? a.map(String) : String(a ?? "").split("|").map((s) => s.trim()));
  }
  return out;
}

/** Score a set of (chunk items, output) pairs against the key. */
export function score(chunks: { items: Item[]; output: string }[], keyItems: Item[], cfg: EvalConfig): ScoreResult {
  const key = answerKey(keyItems, cfg);
  const rows: ScoreRow[] = [];
  let unparsed = 0;
  for (const ch of chunks) {
    const ids = ch.items.map((it) => itemId(it, cfg.itemId));
    const r = parseOutput(ch.output, ids, cfg.parser);
    unparsed += r.unparsed;
    for (const id of ids) {
      const expected = key.get(id.trim().toLowerCase());
      if (!expected) continue;
      const got = r.answers.get(id);
      const ok = got !== undefined && expected.some((e) => norm(e, cfg.match) === norm(got, cfg.match));
      rows.push({ id, expected, got, ok });
    }
  }
  const correct = rows.filter((r) => r.ok).length;
  return { total: rows.length, correct, accuracy: rows.length ? correct / rows.length : 0, unparsed, rows };
}
