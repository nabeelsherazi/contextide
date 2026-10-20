// Pure helpers for diff views: similarity, variance, ablation ranking.
import { diffWordsWithSpace } from "diff";
import type { RunRecord } from "../core/runs";

export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length && !b.length) return 1;
  const parts = diffWordsWithSpace(a, b);
  let same = 0;
  let total = 0;
  for (const p of parts) {
    const n = p.value.replace(/\s+/g, "").length;
    if (!p.added && !p.removed) {
      same += n * 2;
      total += n * 2;
    } else total += n;
  }
  return total ? same / total : 1;
}

export function variance(r: RunRecord) {
  const outs = r.outputs.filter((o) => !o.error);
  const groups = new Map<string, number[]>();
  outs.forEach((o, i) => {
    const k = o.text.trim().replace(/\s+/g, " ");
    groups.set(k, [...(groups.get(k) ?? []), i]);
  });
  const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const accs = outs.map((o) => o.accuracy).filter((x): x is number => x !== undefined);
  const mean = accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : undefined;
  const sd = accs.length > 1 && mean !== undefined ? Math.sqrt(accs.reduce((a, b) => a + (b - mean) ** 2, 0) / (accs.length - 1)) : undefined;
  let pair = 0;
  let n = 0;
  for (let i = 0; i < outs.length; i++)
    for (let j = i + 1; j < outs.length; j++) {
      pair += similarity(outs[i].text, outs[j].text);
      n++;
    }
  return {
    n: outs.length,
    unique: groups.size,
    agreement: outs.length ? sorted[0][1].length / outs.length : 0,
    meanSimilarity: n ? pair / n : 1,
    groups: sorted.map(([, idx]) => idx),
    mean,
    sd,
  };
}

export function ablationRanking(r: RunRecord) {
  const base = r.outputs[0];
  if (!base) return [];
  return r.outputs
    .slice(1)
    .map((o, i) => ({
      index: i + 1,
      label: o.mutedLabel ?? o.label,
      id: o.muted,
      delta: o.accuracy !== undefined && base.accuracy !== undefined ? o.accuracy - base.accuracy : undefined,
      change: o.error ? undefined : 1 - similarity(base.text, o.text),
      error: o.error,
    }))
    .sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0) || (b.change ?? 0) - (a.change ?? 0));
}
