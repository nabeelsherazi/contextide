// Lint hints for a version: broken refs, fallbacks, empties, duplicates, dominance, drift, cache order.
import { type Message, inlinePlain, walk } from "./doc";
import { type Rendered, type Warning, cardTexts } from "./render";
import type { RenderEnv } from "./render";

export interface Hint extends Warning {
  code: string;
}

const normText = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[.!]$/, "").trim();

export function lint(messages: Message[], r: Rendered, env: RenderEnv, countTokens: (s: string) => number): Hint[] {
  const hints: Hint[] = r.warnings.map((w) => ({
    ...w,
    code: w.msg.startsWith("missing") ? "broken-ref" : w.msg.startsWith("no ") ? "flavor-fallback" : w.msg.includes("renders nothing") ? "empty-section" : "render",
  }));

  // duplicate directives (own + referenced)
  const seen = new Map<string, string>();
  walk(messages, (n, id) => {
    if (n.muted) return;
    let text: string | undefined;
    if (n.k === "directive") text = inlinePlain(n.content);
    if (n.k === "use" && n.ref.startsWith("directive:")) text = env.resolve(n.ref, n.flavor).block?.body;
    if (!text?.trim()) return;
    const k = normText(text);
    const prev = seen.get(k);
    if (prev) hints.push({ id, level: "warn", code: "duplicate", msg: `duplicate of the directive at ${prev}` });
    else seen.set(k, id);
  });

  // drift of detached copies
  walk(messages, (n, id) => {
    if ((n.k === "directive" || n.k === "section") && n.from) {
      const { block } = env.resolve(n.from);
      if (!block) hints.push({ id, level: "info", code: "drift", msg: `detached from ${n.from}, which no longer exists` });
      else if (n.k === "directive" && normText(inlinePlain(n.content)) !== normText(block.body)) hints.push({ id, level: "info", code: "drift", msg: `differs from its origin ${block.fn} (${block.flavor})` });
      else if (n.k === "directive") hints.push({ id, level: "info", code: "drift-same", msg: `identical to ${block.fn}; could be a live reference again` });
    }
  });

  // token dominance + cache ordering
  const texts = cardTexts(r);
  const counts = new Map([...texts].map(([id, t]) => [id, countTokens(t)]));
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total > 200) {
    for (const [id, c] of counts) {
      const kind = r.messages.flatMap((m) => m.segments).find((s) => s.id === id)?.kind;
      if (kind === "data" && c / total > 0.7) hints.push({ id, level: "info", code: "dominant", msg: `this data is ${Math.round((c / total) * 100)}% of the prompt` });
    }
  }
  // static cards that sit after the first dynamic one (they are excluded from the cacheable prefix)
  const order = r.cards.filter((id) => counts.has(id));
  const dynamicIds = new Set(r.messages.flatMap((m) => m.segments.filter((s) => s.dynamic && s.text).map((s) => s.id)));
  const firstDyn = order.findIndex((id) => dynamicIds.has(id));
  if (firstDyn >= 0) {
    const after = order.slice(firstDyn + 1).filter((id) => !dynamicIds.has(id) && !order.some((o) => o !== id && id.startsWith(o + "/")));
    const lost = after.reduce((a, id) => a + (counts.get(id) ?? 0), 0);
    if (lost >= 32) hints.push({ id: order[firstDyn], level: "info", code: "cache-order", msg: `${lost} static tokens come after this dynamic card; moving it later would cache them` });
  }
  return hints;
}
