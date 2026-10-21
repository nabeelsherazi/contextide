// Data transform pipeline: data("x") | shuffle(seed=1) | head(50) | numbered
import type { Call, Value } from "./expr";
import { num, str, bool } from "./expr";
import { type Item, type Rec, itemText, getPath, isPath, pathSegments } from "./data";
import { rng, shuffle as shuffleArr } from "./random";

export interface PipeCtx {
  /** Fallback seed when shuffle/sample has none. */
  seed: number;
  countTokens?: (s: string) => number;
}

export interface TransformInfo {
  name: string;
  group: "select" | "fields" | "format" | "cleanup";
  sig: string;
  doc: string;
}

export const TRANSFORMS: TransformInfo[] = [
  { name: "head", group: "select", sig: "head(n)", doc: "First n items" },
  { name: "tail", group: "select", sig: "tail(n)", doc: "Last n items" },
  { name: "slice", group: "select", sig: "slice(start, end)", doc: "Items from start (0-based) to end" },
  { name: "sample", group: "select", sig: "sample(n, seed=1)", doc: "n random items, original order kept" },
  { name: "shuffle", group: "select", sig: "shuffle(seed=1)", doc: "Shuffle order (seeded)" },
  { name: "sort", group: "select", sig: 'sort(field="name", desc=false)', doc: "Sort by text or field" },
  { name: "dedupe", group: "select", sig: 'dedupe(field="name")', doc: "Drop repeated items" },
  { name: "filter", group: "select", sig: 'filter("regex", field="name", invert=false)', doc: "Keep items matching a regex" },
  { name: "pick", group: "fields", sig: 'pick("a", ".b.c")', doc: "Keep only these fields; jq-style paths reach nested values" },
  { name: "drop", group: "fields", sig: 'drop("answer")', doc: "Remove record fields (e.g. hide the answer)" },
  { name: "rename", group: "fields", sig: 'rename(old="new")', doc: "Rename record fields" },
  { name: "template", group: "format", sig: 'template("Merchant: {name}")', doc: "Per-item text; {field}, {.nested.path}, {text}, {i}" },
  { name: "bullets", group: "format", sig: 'bullets(marker="-")', doc: "One bullet per item" },
  { name: "numbered", group: "format", sig: "numbered(start=1)", doc: "Numbered lines: 1. item" },
  { name: "join", group: "format", sig: 'join(", ")', doc: "Join items with a separator" },
  { name: "kv", group: "format", sig: 'kv(sep=": ")', doc: "Records as key: value blocks" },
  { name: "json", group: "format", sig: "json(indent=0, lines=true)", doc: "JSON lines (or one array)" },
  { name: "table", group: "format", sig: 'table("a", "b")', doc: "Markdown table" },
  { name: "trim", group: "cleanup", sig: "trim", doc: "Trim whitespace" },
  { name: "lower", group: "cleanup", sig: "lower", doc: "Lowercase" },
  { name: "squash", group: "cleanup", sig: "squash", doc: "Collapse runs of whitespace" },
  { name: "clip", group: "cleanup", sig: 'clip(200, field="text")', doc: "Clip each item to n chars with …" },
  { name: "cliptok", group: "cleanup", sig: "cliptok(50)", doc: "Clip each item to n tokens with …" },
];

type State = { items: Item[] } | { text: string };

const asText = (v: unknown) => (v === undefined || v === null ? "" : typeof v === "string" ? v : JSON.stringify(v));

/** A field (or jq-style path like ".a.b[0]") as text; plain-text items are their own value. */
const fieldOr = (it: Item, field: string | undefined): string => (typeof it === "string" ? it : field ? asText(getPath(it, field)) : itemText(it));

const mapStrings = (it: Item, f: (s: string) => string, field?: string): Item => {
  if (typeof it === "string") return f(it);
  const out: Rec = {};
  for (const [k, v] of Object.entries(it)) out[k] = typeof v === "string" && (!field || k === field) ? f(v) : v;
  return out;
};

export function fill(tpl: string, it: Item, i: number): string {
  // {field}, or a jq-style path: {.a.b}, {a.b[0]}
  return tpl.replace(/\{(\.?[\w$-]+(?:\.[\w$-]+|\[\d+\])*)\}/g, (m, key: string) => {
    if (key === "i") return String(i + 1);
    if (key === "i0") return String(i);
    if (key === "text") return typeof it === "string" ? it : itemText(it);
    if (key === "json") return JSON.stringify(it);
    if (typeof it !== "object") return m;
    if (isPath(key)) return asText(getPath(it, key));
    return key in it ? asText(it[key]) : m;
  });
}

const clipStr = (s: string, n: number) => (s.length > n ? s.slice(0, Math.max(0, n - 1)).trimEnd() + "…" : s);

const isText = (s: State): s is { text: string } => "text" in s;

function asItems(st: State): Item[] {
  return "items" in st ? st.items : [st.text];
}

function finalize(st: State): string {
  if ("text" in st) return st.text;
  const allStr = st.items.every((x) => typeof x === "string");
  if (allStr) return (st.items as string[]).join("\n");
  return st.items.map((x) => (typeof x === "string" ? x : kvBlock(x, ": "))).join("\n\n");
}

const kvBlock = (r: Rec, sep: string) =>
  Object.entries(r)
    .map(([k, v]) => `${k}${sep}${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("\n");

const strs = (pos: Value[]) => pos.flatMap((p) => (Array.isArray(p) ? p.map(String) : [String(p)]));

export function applyPipeline(items: Item[], pipe: Call[], ctx: PipeCtx): { text: string; count: number; errors: string[]; items: Item[] } {
  let st: State = { items };
  const errors: string[] = [];
  let count = items.length;
  let shown: Item[] = items;
  for (const c of pipe) {
    const a0 = c.pos[0];
    try {
      const its = asItems(st);
      switch (c.fn) {
        case "head":
          st = { items: its.slice(0, num(a0 ?? c.args.n, 10)) };
          break;
        case "tail": {
          const n = num(a0 ?? c.args.n, 10);
          st = { items: n <= 0 ? [] : its.slice(-n) };
          break;
        }
        case "slice":
          st = { items: its.slice(num(a0 ?? c.args.start, 0), c.pos[1] !== undefined || c.args.end !== undefined ? num(c.pos[1] ?? c.args.end, its.length) : undefined) };
          break;
        case "shuffle":
          st = { items: shuffleArr(its, rng(num(a0 ?? c.args.seed, ctx.seed))) };
          break;
        case "sample": {
          const n = num(a0 ?? c.args.n, 10);
          const r = rng(num(c.pos[1] ?? c.args.seed, ctx.seed));
          const idx = shuffleArr(
            its.map((_, i) => i),
            r,
          )
            .slice(0, n)
            .sort((x, y) => x - y);
          st = { items: idx.map((i) => its[i]) };
          break;
        }
        case "sort": {
          const f = c.args.field ? str(c.args.field) : a0 !== undefined ? str(a0) : undefined;
          const desc = bool(c.args.desc);
          st = { items: its.slice().sort((x, y) => fieldOr(x, f).localeCompare(fieldOr(y, f), undefined, { numeric: true }) * (desc ? -1 : 1)) };
          break;
        }
        case "dedupe": {
          const f = c.args.field ? str(c.args.field) : a0 !== undefined ? str(a0) : undefined;
          const seen = new Set<string>();
          st = {
            items: its.filter((x) => {
              const key = fieldOr(x, f).trim().toLowerCase();
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            }),
          };
          break;
        }
        case "filter": {
          const re = new RegExp(str(a0 ?? c.args.pattern), str(c.args.flags, "i"));
          const f = c.args.field ? str(c.args.field) : undefined;
          const inv = bool(c.args.invert);
          st = { items: its.filter((x) => re.test(fieldOr(x, f)) !== inv) };
          break;
        }
        case "pick": {
          // pick("a", ".b.c") keeps a and c; pick(alias=".b.c") names it
          const want: [string, string][] = [...strs(c.pos).map((k): [string, string] => [isPath(k) ? String(pathSegments(k).at(-1) ?? k) : k, k]), ...Object.entries(c.args).map(([k, v]): [string, string] => [k, str(v)])];
          st = { items: its.map((x) => (typeof x === "string" ? x : Object.fromEntries(want.filter(([, path]) => getPath(x, path) !== undefined).map(([name, path]) => [name, getPath(x, path)])))) };
          break;
        }
        case "drop": {
          const del = new Set(strs(c.pos));
          st = { items: its.map((x) => (typeof x === "string" ? x : Object.fromEntries(Object.entries(x).filter(([k]) => !del.has(k))))) };
          break;
        }
        case "rename":
          st = {
            items: its.map((x) => {
              if (typeof x === "string") return x;
              const out: Rec = {};
              for (const [k, v] of Object.entries(x)) out[c.args[k] !== undefined ? str(c.args[k]) : k] = v;
              return out;
            }),
          };
          break;
        case "template": {
          const tpl = str(a0 ?? c.args.t, "{text}");
          st = { items: its.map((x, i) => fill(tpl, x, i)) };
          break;
        }
        case "bullets": {
          const mk = str(a0 ?? c.args.marker, "-");
          st = { text: its.map((x) => `${mk} ${typeof x === "string" ? x : itemText(x)}`).join("\n") };
          break;
        }
        case "numbered": {
          const start = num(a0 ?? c.args.start, 1);
          const sep = str(c.args.sep, ". ");
          st = { text: its.map((x, i) => `${i + start}${sep}${typeof x === "string" ? x : itemText(x)}`).join("\n") };
          break;
        }
        case "join":
          st = { text: its.map((x) => (typeof x === "string" ? x : itemText(x))).join(str(a0 ?? c.args.sep, "\n")) };
          break;
        case "kv": {
          const sep = str(a0 ?? c.args.sep, ": ");
          const between = str(c.args.between, "\n\n");
          st = { text: its.map((x) => (typeof x === "string" ? x : kvBlock(x, sep))).join(between) };
          break;
        }
        case "json": {
          const indent = num(c.args.indent ?? a0, 0);
          const lines = c.args.lines === undefined ? indent === 0 : bool(c.args.lines);
          st = { text: lines ? its.map((x) => JSON.stringify(x)).join("\n") : JSON.stringify(its, null, indent || undefined) };
          break;
        }
        case "table": {
          const recs = its.map((x) => (typeof x === "string" ? { text: x } : x));
          const cols = c.pos.length ? strs(c.pos) : [...new Set(recs.flatMap((r) => Object.keys(r)))];
          const cell = (v: unknown) => (typeof v === "string" ? v : v === undefined ? "" : JSON.stringify(v)).replace(/\|/g, "\\|").replace(/\n/g, " ");
          st = {
            text: [`| ${cols.join(" | ")} |`, `| ${cols.map(() => "---").join(" | ")} |`, ...recs.map((r) => `| ${cols.map((k) => cell(r[k])).join(" | ")} |`)].join("\n"),
          };
          break;
        }
        case "trim":
        case "lower":
        case "upper":
        case "squash": {
          const f =
            c.fn === "trim" ? (s: string) => s.trim() : c.fn === "lower" ? (s: string) => s.toLowerCase() : c.fn === "upper" ? (s: string) => s.toUpperCase() : (s: string) => s.replace(/\s+/g, " ").trim();
          st = isText(st) ? { text: f(st.text) } : { items: its.map((x) => mapStrings(x, f, c.args.field ? str(c.args.field) : undefined)) };
          break;
        }
        case "clip": {
          const n = num(a0 ?? c.args.n, 200);
          const f = (s: string) => clipStr(s, n);
          st = isText(st) ? { text: f(st.text) } : { items: its.map((x) => mapStrings(x, f, c.args.field ? str(c.args.field) : undefined)) };
          break;
        }
        case "cliptok": {
          const n = num(a0 ?? c.args.n, 50);
          const count = ctx.countTokens ?? ((s: string) => Math.ceil(s.length / 4));
          const f = (s: string) => {
            if (count(s) <= n) return s;
            let lo = 0;
            let hi = s.length;
            while (lo < hi) {
              const mid = Math.ceil((lo + hi) / 2);
              if (count(s.slice(0, mid)) <= n) lo = mid;
              else hi = mid - 1;
            }
            return s.slice(0, lo).trimEnd() + "…";
          };
          st = isText(st) ? { text: f(st.text) } : { items: its.map((x) => mapStrings(x, f, c.args.field ? str(c.args.field) : undefined)) };
          break;
        }
        default:
          errors.push(`unknown transform "${c.fn}"`);
      }
      if ("items" in st) {
        count = st.items.length;
        if (["head", "tail", "slice", "shuffle", "sample", "sort", "dedupe", "filter"].includes(c.fn)) shown = st.items;
      }
    } catch (e) {
      errors.push(`${c.fn}: ${(e as Error).message}`);
    }
  }
  return { text: finalize(st), count, errors, items: shown };
}
