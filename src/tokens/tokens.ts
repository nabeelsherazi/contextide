// Token estimates with a bundled o200k tokenizer, loaded lazily. Until it loads, chars/4.
type Counter = (s: string) => number;
let counter: Counter | null = null;
let loading: Promise<void> | null = null;
const cache = new Map<string, number>();
const listeners = new Set<() => void>();

export function loadTokenizer(): Promise<void> {
  if (!loading)
    loading = import("gpt-tokenizer/encoding/o200k_base").then((m) => {
      counter = (s) => m.countTokens(s);
      cache.clear();
      listeners.forEach((f) => f());
    });
  return loading;
}

export const tokenizerReady = () => counter !== null;
export const onTokenizerReady = (f: () => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};

export function countTokens(s: string): number {
  if (!s) return 0;
  if (!counter) return Math.ceil(s.length / 4);
  const hit = cache.get(s);
  if (hit !== undefined) return hit;
  const n = counter(s);
  if (cache.size > 5000) cache.clear();
  cache.set(s, n);
  return n;
}
