// Automatic insertions: {{ now(format="YYYY-MM-DD") }}, {{ var("hostname") }}, ...
import { type Args, type Value, num, str } from "./expr";
import { rng, uuidFrom } from "./random";

export interface InsertionCtx {
  now: Date;
  vars: Record<string, string>;
  seed: number;
}

export interface InsertionInfo {
  fn: string;
  label: string;
  /** an icon name (ui/icons.tsx, editor/icons.ts) */
  icon: string;
  doc: string;
  defaults: { pos: Value[]; args: Args };
}

export const INSERTIONS: InsertionInfo[] = [
  { fn: "now", label: "Date / time", icon: "clock", doc: "Current date/time with a format, timezone and offset; can be frozen", defaults: { pos: [], args: { format: "dddd, MMMM D, YYYY" } } },
  { fn: "var", label: "Variable", icon: "variable", doc: "A workspace or project variable", defaults: { pos: [], args: {} } },
  { fn: "uuid", label: "UUID", icon: "hash", doc: "Random UUID (seed it to make it stable)", defaults: { pos: [], args: {} } },
  { fn: "randint", label: "Random int", icon: "dice", doc: "Random integer between min and max", defaults: { pos: [], args: { min: 1, max: 100 } } },
  { fn: "pick", label: "Random pick", icon: "shuffle", doc: "Pick one of a list", defaults: { pos: [["a", "b", "c"]], args: {} } },
];

export const insertionInfo = (fn: string) => INSERTIONS.find((x) => x.fn === fn);

/** Is this insertion expected to change between runs? (Determines the stable-prefix cutoff.) */
export function isDynamic(fn: string, args: Args): boolean {
  switch (fn) {
    case "now":
      return args.frozen === undefined;
    case "var":
      return false;
    case "uuid":
    case "randint":
    case "pick":
      return args.seed === undefined;
    default:
      return false;
  }
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Parse offsets like "-1d", "+2h", "30m", "-1w". */
export function applyOffset(d: Date, off: string): Date {
  let t = d.getTime();
  const re = /([+-]?\d+(?:\.\d+)?)\s*([smhdw])/g;
  let m: RegExpExecArray | null;
  const unit: Record<string, number> = { s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5 };
  while ((m = re.exec(off))) t += Number(m[1]) * unit[m[2]];
  return new Date(t);
}

function partsIn(d: Date, tz?: string) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz || undefined,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    weekday: "long",
    hourCycle: "h23",
    timeZoneName: "short",
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(d)) p[x.type] = x.value;
  return {
    Y: Number(p.year),
    M: Number(p.month),
    D: Number(p.day),
    H: Number(p.hour) % 24,
    m: Number(p.minute),
    s: Number(p.second),
    wd: p.weekday,
    tzName: p.timeZoneName ?? "",
  };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function formatDate(d: Date, fmt: string, tz?: string): string {
  if (fmt === "iso") return d.toISOString();
  let p: ReturnType<typeof partsIn>;
  try {
    p = partsIn(d, tz);
  } catch {
    p = partsIn(d);
  }
  const h12 = p.H % 12 === 0 ? 12 : p.H % 12;
  const tokens: Record<string, string> = {
    YYYY: String(p.Y),
    YY: String(p.Y).slice(-2),
    MMMM: MONTHS[p.M - 1],
    MMM: MONTHS[p.M - 1].slice(0, 3),
    MM: pad(p.M),
    M: String(p.M),
    DD: pad(p.D),
    D: String(p.D),
    dddd: p.wd,
    ddd: p.wd.slice(0, 3),
    HH: pad(p.H),
    H: String(p.H),
    hh: pad(h12),
    h: String(h12),
    mm: pad(p.m),
    ss: pad(p.s),
    A: p.H < 12 ? "AM" : "PM",
    a: p.H < 12 ? "am" : "pm",
    z: p.tzName,
  };
  // [literal] escapes, then longest tokens first
  return fmt.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|hh|h|mm|ss|A|a|z/g, (m, lit) => (lit !== undefined ? lit : (tokens[m] ?? m)));
}

export function evalInsertion(fn: string, pos: Value[], args: Args, ctx: InsertionCtx, salt: string): { text: string; error?: string } {
  const seeded = (k: string) => rng(`${args.seed !== undefined ? str(args.seed) : ctx.seed}:${k}`);
  switch (fn) {
    case "now": {
      let d = args.frozen !== undefined ? new Date(str(args.frozen)) : ctx.now;
      if (isNaN(d.getTime())) return { text: "", error: `bad frozen date "${str(args.frozen)}"` };
      if (args.offset) d = applyOffset(d, str(args.offset));
      return { text: formatDate(d, str(args.format ?? pos[0], "YYYY-MM-DD"), args.tz ? str(args.tz) : undefined) };
    }
    case "var": {
      const name = str(pos[0] ?? args.name);
      const v = ctx.vars[name];
      if (v === undefined) return args.default !== undefined ? { text: str(args.default) } : { text: `{${name}}`, error: `variable "${name}" is not set` };
      return { text: v };
    }
    case "uuid":
      return { text: uuidFrom(args.seed !== undefined ? seeded(salt) : Math.random) };
    case "randint": {
      const lo = num(args.min ?? pos[0], 1);
      const hi = num(args.max ?? pos[1], 100);
      const r = args.seed !== undefined ? seeded(salt)() : Math.random();
      return { text: String(Math.floor(lo + r * (hi - lo + 1))) };
    }
    case "pick": {
      const list = Array.isArray(pos[0]) ? pos[0] : Array.isArray(args.from) ? args.from : [];
      if (!list.length) return { text: "", error: "pick() needs a list" };
      const r = args.seed !== undefined ? seeded(salt)() : Math.random();
      return { text: str(list[Math.floor(r * list.length)]) };
    }
    default:
      return { text: "", error: `unknown insertion "${fn}"` };
  }
}

export function describeInsertion(fn: string, pos: Value[], args: Args, ctx: InsertionCtx): string {
  if (fn === "var") {
    const name = str(pos[0] ?? args.name);
    const v = ctx.vars[name] ?? (args.default !== undefined ? str(args.default) : undefined);
    if (!name) return "choose a variable…";
    if (v === undefined) return `${name}: (unset)`;
    return `${name}: ${v.length > 40 ? v.slice(0, 39) + "…" : v}`;
  }
  if (fn === "pick") return `pick ${Array.isArray(pos[0]) ? pos[0].length : 0}`;
  const r = evalInsertion(fn, pos, args, { ...ctx, seed: ctx.seed }, "preview");
  return r.error ? fn : r.text;
}
