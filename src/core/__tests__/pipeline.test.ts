import { describe, it, expect } from "vitest";
import { applyPipeline } from "../pipeline";
import { parsePipeline } from "../expr";
import { parseData } from "../data";

const run = (items: any[], pipe: string) => applyPipeline(items, parsePipeline(`data("x") | ${pipe}`).calls.slice(1), { seed: 1 }).text;

describe("pipeline", () => {
  const xs = ["b", "a", "c", "a"];
  it("selects", () => {
    expect(run(xs, "head(2)")).toBe("b\na");
    expect(run(xs, "tail(1)")).toBe("a");
    expect(run(xs, "dedupe | sort")).toBe("a\nb\nc");
    expect(run(xs, 'filter("^a$", invert=true)')).toBe("b\nc");
    expect(run(xs, "slice(1, 3)")).toBe("a\nc");
  });
  it("shuffles deterministically by seed", () => {
    const a = run(["1", "2", "3", "4", "5", "6"], "shuffle(seed=7)");
    expect(run(["1", "2", "3", "4", "5", "6"], "shuffle(seed=7)")).toBe(a);
    expect(a.split("\n").sort().join("\n")).toBe("1\n2\n3\n4\n5\n6");
  });
  it("samples keeping order", () => {
    const r = run(["1", "2", "3", "4", "5", "6"], "sample(3, seed=2)").split("\n").map(Number);
    expect(r).toHaveLength(3);
    expect([...r].sort((a, b) => a - b)).toEqual(r);
  });
  it("formats", () => {
    expect(run(["x", "y"], "numbered")).toBe("1. x\n2. y");
    expect(run(["x", "y"], "bullets")).toBe("- x\n- y");
    expect(run(["x", "y"], 'join(", ")')).toBe("x, y");
    expect(run(["x"], 'template("<{i}> {text}")')).toBe("<1> x");
  });
  it("handles records", () => {
    const recs = [{ name: "A", mcc: "1", answer: "z" }, { name: "B", mcc: "2", answer: "y" }];
    expect(run(recs, 'drop("answer") | template("Merchant: {name}\\nMCC: {mcc}")')).toBe("Merchant: A\nMCC: 1\nMerchant: B\nMCC: 2");
    expect(run(recs, 'pick("name") | json')).toBe('{"name":"A"}\n{"name":"B"}');
    expect(run(recs, 'table("name", "mcc")')).toBe("| name | mcc |\n| --- | --- |\n| A | 1 |\n| B | 2 |");
    expect(run(recs, 'rename(name="merchant") | pick("merchant") | kv')).toBe("merchant: A\n\nmerchant: B");
    expect(run(recs, 'sort("name", desc=true) | pick("name") | json')).toBe('{"name":"B"}\n{"name":"A"}');
  });
  it("reaches into nested records with jq-style paths", () => {
    const recs = [
      { id: 1, derivations: { visual_description: { text: "a red door" }, tags: ["door", "red"] } },
      { id: 2, derivations: { visual_description: { text: "a blue sky" }, tags: ["sky"] } },
    ];
    expect(run(recs, 'template("{id}: {.derivations.visual_description.text}")')).toBe("1: a red door\n2: a blue sky");
    expect(run(recs, 'template("{derivations.tags[0]}")')).toBe("door\nsky");
    expect(run(recs, 'pick("id", ".derivations.visual_description.text") | json')).toBe('{"id":1,"text":"a red door"}\n{"id":2,"text":"a blue sky"}');
    expect(run(recs, 'pick(desc=".derivations.visual_description.text") | json')).toBe('{"desc":"a red door"}\n{"desc":"a blue sky"}');
    expect(run(recs, 'sort(".derivations.visual_description.text") | template("{id}")')).toBe("2\n1");
    expect(run(recs, 'filter("red", field=".derivations.visual_description.text") | template("{id}")')).toBe("1");
    expect(run(recs, 'template("{.missing.path}")')).toBe("\n");
  });
  it("cleans up", () => {
    expect(run(["  Hello   World  "], "squash | lower")).toBe("hello world");
    expect(run(["abcdefghij"], "clip(5)")).toBe("abcd…");
  });
  it("reports unknown transforms", () => {
    const r = applyPipeline(["a"], [{ fn: "nope", pos: [], args: {} }], { seed: 1 });
    expect(r.errors[0]).toMatch(/unknown/);
  });
});

describe("data parsing", () => {
  it("splits lines and paragraphs", () => {
    expect(parseData("a\n\nb\n", "text").items).toEqual(["a", "b"]);
    expect(parseData("a\nb\n\nc\n", "text", { split: "paragraphs" }).items).toEqual(["a\nb", "c"]);
  });
  it("parses csv with quotes", () => {
    const r = parseData('name,note\n"A, Inc","say ""hi"""\nB,x\n', "csv");
    expect(r.items).toEqual([{ name: "A, Inc", note: 'say "hi"' }, { name: "B", note: "x" }]);
    expect(r.fields).toEqual(["name", "note"]);
  });
  it("reports json errors", () => {
    expect(parseData("{bad", "jsonl").error).toBeTruthy();
  });
});
