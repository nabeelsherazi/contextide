import { describe, it, expect } from "vitest";
import { outputRecords, outputsAsData, parseOutputJson, toJsonl } from "../outputs";
import { serializeRun, chunkIds, type RunRecord, type RunOutput } from "../runs";
import { ws } from "./fixtures";
import type { Item } from "../data";

const rows = [{ name: "JOE COFFEE", mcc: "5812" }, { name: "DELTA AIR", mcc: "3058" }, { name: "UBER EATS", mcc: "5814" }];
const run = (size: number, outputs: Omit<RunOutput, "label" | "items">[], items: Item[] = rows): RunRecord => ({
  id: "r",
  file: "projects/m/runs/r.md",
  version: "A",
  time: "2026-10-19T12:00:00.000Z",
  endpoint: "e",
  model: "m",
  mode: "fanout",
  settings: { fanout: { source: "recs", size } },
  promptHash: "1",
  prompt: "",
  request: "",
  outputs: outputs.map((o, i) => ({ label: `rows ${i}`, items: chunkIds(items.slice(i * size, i * size + size)), ...o })),
});

describe("outputs as data", () => {
  it("reads JSON outputs, bare or fenced", () => {
    expect(parseOutputJson('{"a":1}')).toEqual({ value: { a: 1 } });
    expect(parseOutputJson('```json\n{"a":1}\n```')).toEqual({ value: { a: 1 } });
    expect(parseOutputJson(" [1, 2] ")).toEqual({ value: [1, 2] });
    expect(parseOutputJson("food.coffee")).toBeUndefined();
    expect(parseOutputJson("{not json")).toBeUndefined();
  });

  it("joins one output per row, merging JSON objects and keeping text under output", () => {
    const r = outputRecords(run(1, [{ text: '{"category":"food","mcc":"override"}' }, { text: "travel" }, { text: "", error: "HTTP 500" }]), rows);
    expect(r.records).toEqual([
      { name: "JOE COFFEE", mcc: "override", category: "food" },
      { name: "DELTA AIR", mcc: "3058", output: "travel" },
    ]);
    expect(r.skipped).toBe(1);
    expect(toJsonl(r.records).split("\n")).toHaveLength(3);
  });

  it("splits an array output across a chunk, or gives each row the whole output", () => {
    const r = outputRecords(run(2, [{ text: '[{"c":"food"},"travel"]' }, { text: '{"c":"food"}' }]), rows);
    expect(r.records).toEqual([
      { name: "JOE COFFEE", mcc: "5812", c: "food" },
      { name: "DELTA AIR", mcc: "3058", output: "travel" },
      { name: "UBER EATS", mcc: "5814", c: "food" },
    ]);
    const plain = outputRecords(run(2, [{ text: "both food" }], ["a", "b"]), ["a", "b"]);
    expect(plain.records).toEqual([
      { text: "a", output: "both food" },
      { text: "b", output: "both food" },
    ]);
  });

  it("keeps plain-text rows as text", () => {
    const r = outputRecords(run(1, [{ text: "x" }], ["first line"]), ["first line"]);
    expect(r.records).toEqual([{ text: "first line", output: "x" }]);
  });

  it("refuses runs that aren't fan-out, and data that changed since", () => {
    expect(() => outputRecords({ ...run(1, [{ text: "x" }]), mode: "whole" }, rows)).toThrow(/fan-out/);
    expect(() => outputRecords(run(1, [{ text: "x" }]), rows.slice(1))).toThrow(/has changed since this run/);
  });

  it("finds the run and its source in a workspace", () => {
    const rec = run(1, [{ text: '{"category":"food"}' }, { text: '{"category":"travel"}' }], rows.slice(0, 2));
    const w = ws({ "projects/m/runs/2026-10-19T12-00-00_A.md": serializeRun(rec) });
    const out = outputsAsData(w, "m", "2026-10-19T12-00-00_A");
    expect(out.text).toBe('{"name":"JOE COFFEE","mcc":"5812","category":"food"}\n{"name":"DELTA AIR","mcc":"3058","category":"travel"}\n');
    expect(() => outputsAsData(w, "m", "nope")).toThrow(/no run/);
  });
});
