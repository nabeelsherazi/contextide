import { describe, it, expect } from "vitest";
import { SEED } from "../seed";
import { buildWorkspace } from "../core/workspace";
import { executeRun, ablationTargets } from "./runner";
import { parseRun } from "../core/runs";

const ws = buildWorkspace(new Map(Object.entries(SEED)));
const p = ws.projects[0];
const v = p.versions[0];
const ep = ws.settings.endpoints[0];

/** A fake OpenAI-compatible server that answers every merchant it sees with its gold label. */
const gold = new Map(SEED["projects/merchant-categorizer/data/merchant-gold.jsonl"].trim().split("\n").map((l) => JSON.parse(l)).map((r) => [r.name, r.category[0]]));
const fakeFetch = (async (_url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body));
  const text = body.messages.map((m: { content: string }) => m.content).join("\n");
  const lines = [...gold].filter(([name]) => text.includes(name)).map(([name, cat]) => `${name} -> ${name.startsWith("NETFLIX") ? "wrong.answer" : cat}`);
  return new Response(JSON.stringify({ choices: [{ message: { content: lines.join("\n") } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
}) as unknown as typeof fetch;

const base = { ws, project: p, version: v, messages: v.doc.messages, settings: { model: "m", temperature: 0 }, endpoint: ep, apiKey: "", scoring: true, fetchImpl: fakeFetch, now: new Date("2026-10-19T12:00:00Z") };

describe("runner", () => {
  it("runs whole and scores", async () => {
    const { record, fileName, text } = await executeRun({ ...base, mode: "whole" });
    expect(fileName).toBe("2026-10-19T12-00-00_A.md");
    expect(record.total).toBe(16);
    expect(record.correct).toBe(15);
    expect(record.misses?.[0].id).toBe("NETFLIX.COM");
    expect(parseRun("projects/x/runs/" + fileName, text)?.accuracy).toBeCloseTo(15 / 16);
  });
  it("fans out in chunks", async () => {
    const { record } = await executeRun({ ...base, mode: "fanout", fanout: { source: "merchants", size: 5 } });
    expect(record.outputs.map((o) => o.label)).toEqual(["rows 1–5", "rows 6–10", "rows 11–15", "rows 16–16"]);
    expect(record.total).toBe(16);
    expect(record.correct).toBe(15);
  });
  it("repeats", async () => {
    const { record } = await executeRun({ ...base, mode: "repeat", repeat: 3 });
    expect(record.outputs).toHaveLength(3);
    expect(record.accuracy).toBeCloseTo(15 / 16);
  });
  it("ablates every card", async () => {
    const targets = ablationTargets(v.doc.messages);
    const { record } = await executeRun({ ...base, mode: "ablation" });
    expect(record.outputs).toHaveLength(targets.length + 1);
    const noMerchants = record.outputs.find((o) => o.mutedLabel === "section Merchants")!;
    expect(noMerchants.prompt).toBeDefined();
    expect(noMerchants.accuracy).toBe(0);
  });
  it("reports unreachable servers helpfully", async () => {
    const failing = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const { record } = await executeRun({ ...base, mode: "whole", fetchImpl: failing });
    expect(record.outputs[0].error).toMatch(/CORS/);
  });
});

import { similarity, variance, ablationRanking } from "./compare";
describe("compare", () => {
  it("measures similarity", () => {
    expect(similarity("a b c", "a b c")).toBe(1);
    expect(similarity("a b c", "x y z")).toBeLessThan(0.3);
    expect(similarity("the cat sat", "the cat sat down")).toBeGreaterThan(0.7);
  });
  it("summarizes variance and ranks ablation", async () => {
    const rec = { outputs: [{ label: "1", text: "x" }, { label: "2", text: "x" }, { label: "3", text: "y" }] } as never;
    const v = variance(rec);
    expect(v.unique).toBe(2);
    expect(v.agreement).toBeCloseTo(2 / 3);
    const ab = ablationRanking({ outputs: [{ label: "b", text: "base", accuracy: 0.9 }, { label: "w1", text: "base", accuracy: 0.9, mutedLabel: "one" }, { label: "w2", text: "other", accuracy: 0.2, mutedLabel: "two" }] } as never);
    expect(ab[0].label).toBe("two");
    expect(ab[0].delta).toBeCloseTo(-0.7);
  });
});
