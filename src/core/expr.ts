// Tiny expression language shared by tags ({% name args %}) and
// interpolations ({{ fn(args) | filter(args) }}).

export type Value = string | number | boolean | Value[];
export type Args = Record<string, Value>;
export interface Call {
  fn: string;
  pos: Value[];
  args: Args;
}

class Lexer {
  i = 0;
  constructor(readonly s: string) {}
  ws() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }
  peek() {
    this.ws();
    return this.s[this.i];
  }
  eat(ch: string) {
    if (this.peek() === ch) {
      this.i++;
      return true;
    }
    return false;
  }
  expect(ch: string) {
    if (!this.eat(ch)) throw new Error(`expected '${ch}' at ${this.i} in ${this.s}`);
  }
  done() {
    this.ws();
    return this.i >= this.s.length;
  }
  ident(): string | null {
    this.ws();
    const m = /^[A-Za-z_][\w.-]*/.exec(this.s.slice(this.i));
    if (!m) return null;
    this.i += m[0].length;
    return m[0];
  }
  string(): string | null {
    this.ws();
    const q = this.s[this.i];
    if (q !== '"' && q !== "'") return null;
    let out = "";
    this.i++;
    while (this.i < this.s.length) {
      const c = this.s[this.i++];
      if (c === q) return out;
      if (c === "\\") {
        const n = this.s[this.i++];
        out += n === "n" ? "\n" : n === "t" ? "\t" : n;
      } else out += c;
    }
    throw new Error("unterminated string");
  }
  number(): number | null {
    this.ws();
    const m = /^-?\d+(\.\d+)?/.exec(this.s.slice(this.i));
    if (!m) return null;
    this.i += m[0].length;
    return Number(m[0]);
  }
  value(): Value {
    const s = this.string();
    if (s !== null) return s;
    const n = this.number();
    if (n !== null) return n;
    if (this.eat("[")) {
      const arr: Value[] = [];
      if (!this.eat("]")) {
        do arr.push(this.value());
        while (this.eat(","));
        this.expect("]");
      }
      return arr;
    }
    const id = this.ident();
    if (id === "true") return true;
    if (id === "false") return false;
    if (id !== null) return id;
    throw new Error(`unexpected value at ${this.i} in ${this.s}`);
  }
}

function parseArgList(lx: Lexer, close: string | null, sep: boolean): { pos: Value[]; args: Args } {
  const pos: Value[] = [];
  const args: Args = {};
  const atEnd = () => (close ? lx.peek() === close : lx.done() || lx.peek() === "|");
  while (!atEnd()) {
    const save = lx.i;
    const id = lx.ident();
    if (id !== null && lx.eat("=")) {
      args[id] = lx.value();
    } else if (id !== null && !close) {
      // bare flag inside a tag: {% use "x" muted %}
      if (id === "true" || id === "false") pos.push(id === "true");
      else args[id] = true;
    } else {
      lx.i = save;
      pos.push(lx.value());
    }
    if (sep) {
      if (!lx.eat(",")) break;
    }
  }
  return { pos, args };
}

/** Parse `fn(a, k=v)` or bare `fn`. */
function parseCall(lx: Lexer): Call {
  const fn = lx.ident();
  if (!fn) throw new Error(`expected function name in ${lx.s}`);
  if (lx.eat("(")) {
    const { pos, args } = parseArgList(lx, ")", true);
    lx.expect(")");
    return { fn, pos, args };
  }
  return { fn, pos: [], args: {} };
}

/** Parse an interpolation body: `fn(...) | f2 | f3(x=1)` or a bare string literal. */
export function parsePipeline(src: string): { literal?: string; calls: Call[] } {
  const lx = new Lexer(src);
  const save = lx.i;
  const lit = lx.string();
  if (lit !== null && lx.done()) return { literal: lit, calls: [] };
  lx.i = save;
  const calls: Call[] = [parseCall(lx)];
  while (lx.eat("|")) calls.push(parseCall(lx));
  if (!lx.done()) throw new Error(`trailing input in ${src}`);
  return { calls };
}

/** Parse tag body after the name: `"ref" flavor="x" muted`. */
export function parseTagArgs(src: string): { pos: Value[]; args: Args } {
  const lx = new Lexer(src);
  const r = parseArgList(lx, null, false);
  if (!lx.done()) throw new Error(`trailing input in tag: ${src}`);
  return r;
}

export function fmtValue(v: Value): string {
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(fmtValue).join(", ")}]`;
  return String(v);
}

export function fmtCall(c: Call): string {
  const parts = [...c.pos.map(fmtValue), ...Object.entries(c.args).map(([k, v]) => `${k}=${fmtValue(v)}`)];
  if (parts.length === 0 && c.pos.length === 0) return c.fn;
  return `${c.fn}(${parts.join(", ")})`;
}

export function fmtPipeline(calls: Call[]): string {
  return calls.map(fmtCall).join(" | ");
}

export function fmtTagArgs(pos: Value[], args: Args): string {
  const parts: string[] = pos.map(fmtValue);
  for (const [k, v] of Object.entries(args)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    parts.push(v === true ? k : `${k}=${fmtValue(v)}`);
  }
  return parts.join(" ");
}

export const str = (v: Value | undefined, d = ""): string => (v === undefined ? d : Array.isArray(v) ? v.join(",") : String(v));
export const num = (v: Value | undefined, d: number): number => {
  if (v === undefined) return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
export const bool = (v: Value | undefined, d = false): boolean => (v === undefined ? d : v === true || v === "true" || v === 1);
