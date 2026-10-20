// Render a JSON schema's descriptions/enums/bounds as prose, because llama.cpp's
// grammar compiler drops `description` — local models never see it otherwise.

type S = Record<string, unknown>;

const typeOf = (s: S): string => {
  if (Array.isArray(s.type)) return s.type.join(" | ");
  if (s.type) return String(s.type);
  if (s.enum) return "enum";
  if (s.anyOf || s.oneOf) return ((s.anyOf ?? s.oneOf) as S[]).map(typeOf).join(" | ");
  return "any";
};

function facts(s: S): string[] {
  const f: string[] = [typeOf(s)];
  if (Array.isArray(s.enum)) f.push(`one of: ${s.enum.map((x) => JSON.stringify(x)).join(", ")}`);
  if (s.const !== undefined) f.push(`always ${JSON.stringify(s.const)}`);
  if (typeof s.maxLength === "number") f.push(`≤${s.maxLength} chars`);
  if (typeof s.minItems === "number") f.push(`at least ${s.minItems}`);
  if (typeof s.maxItems === "number") f.push(`at most ${s.maxItems}`);
  if (typeof s.minimum === "number") f.push(`≥${s.minimum}`);
  if (typeof s.maximum === "number") f.push(`≤${s.maximum}`);
  if (typeof s.pattern === "string") f.push(`matches /${s.pattern}/`);
  return f;
}

export function digestLines(schema: unknown, prefix = "", depth = 0): string[] {
  const s = (schema ?? {}) as S;
  const out: string[] = [];
  const indent = "  ".repeat(depth);
  if (s.type === "object" || s.properties) {
    const props = (s.properties ?? {}) as Record<string, S>;
    const req = new Set((s.required as string[]) ?? []);
    for (const [k, v] of Object.entries(props)) {
      const name = prefix ? `${prefix}.${k}` : k;
      const desc = v.description ? `: ${String(v.description)}` : "";
      const opt = req.size && !req.has(k) ? ", optional" : "";
      out.push(`${indent}- ${name} (${facts(v).join(", ")}${opt})${desc}`);
      if (v.type === "object" || v.properties) out.push(...digestLines(v, name, depth + 1));
      if (v.type === "array" && v.items) {
        const it = v.items as S;
        if (it.type === "object" || it.properties) out.push(...digestLines(it, `${name}[]`, depth + 1));
        else if (it.enum || it.description) out.push(`${indent}  - ${name}[] (${facts(it).join(", ")})${it.description ? `: ${String(it.description)}` : ""}`);
      }
    }
  }
  return out;
}

export const DEFAULT_DIGEST_HEADER = "Your answer is JSON and its shape is already enforced; this is what each field is for:";

export function digest(schema: unknown, header = DEFAULT_DIGEST_HEADER): string {
  const lines = digestLines(schema);
  return [header, ...lines].filter(Boolean).join("\n");
}
