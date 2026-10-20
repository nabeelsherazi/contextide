// Live analysis of the open version: render, tokens per card, stable prefix, lint.
import type { Message } from "../core/doc";
import { render, stablePrefix, cardTexts, type Rendered } from "../core/render";
import { lint, type Hint } from "../core/lint";
import type { RenderEnv } from "../core/render";
import { countTokens } from "../tokens/tokens";

export interface Analysis {
  rendered: Rendered;
  env: RenderEnv;
  total: number;
  prefixTokens: number;
  prefixChars: number;
  firstDynamicId?: string;
  /** index of the dynamic insertion within the cut card (if it's an insertion), else -1 */
  cutInsertionIndex: number;
  /** card ids fully inside the stable prefix */
  stable: Set<string>;
  tokens: Map<string, number>;
  byKind: Record<string, number>;
  hints: Hint[];
}

export function analyze(messages: Message[], env: RenderEnv): Analysis {
  const rendered = render(messages, env);
  const sp = stablePrefix(rendered);
  const texts = cardTexts(rendered);
  const tokens = new Map<string, number>();
  for (const [id, t] of texts) tokens.set(id, countTokens(t));
  // roll section children up into the section total
  for (const id of [...tokens.keys()]) {
    const parts = id.split("/");
    if (parts.length === 3) {
      const sec = parts.slice(0, 2).join("/");
      tokens.set(sec, (tokens.get(sec) ?? 0) + (tokens.get(id) ?? 0));
    }
  }
  const byKind: Record<string, number> = {};
  for (const m of rendered.messages)
    for (const s of m.segments) {
      if (s.kind === "sep") continue;
      const k = s.kind === "frame" ? "section" : s.kind === "insertion" ? "line" : s.kind;
      byKind[k] = (byKind[k] ?? 0) + s.text.length;
    }
  const total = countTokens(sp.total);
  const prefixTokens = sp.firstDynamicId === undefined ? total : countTokens(sp.prefix);

  const stable = new Set<string>();
  let cutInsertionIndex = -1;
  let reached = false;
  for (const m of rendered.messages) {
    let insIdx = 0;
    let lastId = "";
    for (const s of m.segments) {
      if (s.id !== lastId) {
        insIdx = 0;
        lastId = s.id;
      }
      if (!reached && s.dynamic && s.text.length) {
        reached = true;
        if (s.kind === "insertion") cutInsertionIndex = insIdx;
      }
      if (s.kind === "insertion") insIdx++;
      if (!reached) stable.add(s.id);
    }
  }
  if (sp.firstDynamicId) {
    stable.delete(sp.firstDynamicId);
    // a section containing the cut is not fully stable
    const p = sp.firstDynamicId.split("/");
    if (p.length === 3) stable.delete(p.slice(0, 2).join("/"));
  }
  const hints = lint(messages, rendered, env, countTokens);
  return { rendered, env, total, prefixTokens, prefixChars: sp.prefix.length, firstDynamicId: sp.firstDynamicId, cutInsertionIndex, stable, tokens, byKind, hints };
}
