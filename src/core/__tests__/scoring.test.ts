import { describe, it, expect } from "vitest";
import { score, parseOutput, type EvalConfig } from "../scoring";
import { parseRun, serializeRun } from "../runs";

const cfg = (parser: EvalConfig["parser"], match: EvalConfig["match"] = "ci"): EvalConfig => ({ key: "gold", keyId: "name", keyAnswer: "answer", itemId: "name", parser, match });
const key = [{ name: "JOE COFFEE", answer: ["food", "coffee"] }, { name: "DELTA AIR", answer: "travel" }];
const items = [{ name: "JOE COFFEE" }, { name: "DELTA AIR" }];

describe("scoring", () => {
  it("scores lines by order", () => {
    const r = score([{ items, output: "1. Coffee\n2. food" }], key, cfg({ type: "lines" }));
    expect(r.correct).toBe(1);
    expect(r.rows[1]).toMatchObject({ id: "DELTA AIR", got: "food", ok: false });
  });
  it("scores kv lines by id", () => {
    const r = score([{ items, output: "- delta air -> travel\n- JOE COFFEE: food\nnoise" }], key, cfg({ type: "kv" }));
    expect(r.accuracy).toBe(1);
    expect(r.unparsed).toBe(1);
  });
  it("scores json arrays and maps, inside fences", () => {
    const out = '```json\n[{"merchant":"JOE COFFEE","category":"food"},{"merchant":"DELTA AIR","category":"travel"}]\n```';
    expect(score([{ items, output: out }], key, cfg({ type: "json", id: "merchant", answer: "category" })).accuracy).toBe(1);
    expect(score([{ items, output: 'Sure! {"JOE COFFEE":"coffee","DELTA AIR":"bus"}' }], key, cfg({ type: "json" })).correct).toBe(1);
  });
  it("scores fan-out whole outputs with a json field", () => {
    const r = score(
      [
        { items: [items[0]], output: '{"category":"food","confidence":"high"}' },
        { items: [items[1]], output: '{"category":"travel"}' },
      ],
      key,
      cfg({ type: "whole", field: "category" }),
    );
    expect(r.accuracy).toBe(1);
  });
  it("scores regex", () => {
    const r = parseOutput("JOE COFFEE => food\nDELTA AIR => travel", ["JOE COFFEE", "DELTA AIR"], { type: "regex", pattern: "^(?<id>.+?) => (?<answer>.+)$" });
    expect(r.answers.get("DELTA AIR")).toBe("travel");
  });
  it("supports string answer keys", () => {
    const r = score([{ items: ["a", "b"], output: "x\ny" }], ["a -> x", "b -> z|y"], cfg({ type: "lines" }, "exact"));
    expect(r.accuracy).toBe(1);
  });
});

describe("run files", () => {
  it("round-trips", () => {
    const rec = {
      version: "B",
      time: "2026-10-19T17:30:12.000Z",
      endpoint: "lmstudio",
      model: "gemma",
      mode: "repeat" as const,
      settings: { temperature: 0.2 },
      promptHash: "abc",
      prompt: "Prompt with ``` fences\nand lines",
      request: '{"a":1}',
      outputs: [
        { label: "repeat 1", text: "out ````\nmore", ms: 120, usage: { prompt_tokens: 5 } },
        { label: "muted 0/1", text: "x", muted: "0/1", prompt: "other prompt" },
      ],
      accuracy: 0.5,
      correct: 1,
      total: 2,
      misses: [{ id: "a|b", expected: ["x"], got: "y", ok: false }],
      rating: "up" as const,
      note: "nice -- ok",
    };
    const parsed = parseRun("projects/m/runs/x.md", serializeRun(rec));
    expect(parsed).toMatchObject({ ...rec, id: "x" });
  });
});
