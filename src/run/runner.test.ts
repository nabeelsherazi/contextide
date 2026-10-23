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

describe("tool loop", () => {
  const toolFile = (front: string) => `---\nname: expand\ndescription: Read a unit in full\n${front}\n---\n\`\`\`json\n{"type":"object","properties":{"handle":{"type":"string"}},"required":["handle"]}\n\`\`\`\n`;
  const files = (front = 'handler: lookup\nsource: units\nkey: handle\nreturn: "{full}"\nnotFound: "No unit {handle}."', version = "") =>
    buildWorkspace(
      new Map(
        Object.entries({
          "contextide.json": JSON.stringify({ name: "t" }),
          "library/schemas/summary.md": '---\nname: summary\n---\n```json\n{"type":"object","properties":{"summary":{"type":"string"}}}\n```\n',
          "projects/t/blocks/tools/expand.md": toolFile(front),
          "projects/t/data/units.jsonl": '{"handle":"u1","full":"The whole first unit."}\n{"handle":"u2","full":"The whole second unit."}\n',
          "projects/t/versions/A.md": version || '---\ntitle: A\n---\nSummarize these: {{ data("units") | template("{handle}") | join(", ") }}\n{% tool "expand" mode="api" %}\n',
        }),
      ),
    );
  const planFor = (w: ReturnType<typeof buildWorkspace>, fetchImpl: typeof fetch, settings: Record<string, unknown> = {}) => {
    const pr = w.projects[0];
    return { ws: w, project: pr, version: pr.versions[0], messages: pr.versions[0].doc.messages, settings: { model: "m", ...settings }, endpoint: ep, apiKey: "", scoring: false, fetchImpl, now: new Date("2026-10-19T12:00:00Z") };
  };
  const reply = (message: Record<string, unknown>) => new Response(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 10, completion_tokens: 2 } }), { status: 200 });
  const toolCall = (id: string, handle: string) => ({ id, type: "function", function: { name: "expand", arguments: JSON.stringify({ handle }) } });

  /** Calls expand on u1 and a missing handle, then answers with what the tools returned. */
  const scripted = () => {
    const bodies: any[] = [];
    const f = (async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      const results = body.messages.filter((m: any) => m.role === "tool");
      if (!results.length && body.tools) return reply({ content: null, tool_calls: [toolCall("c1", "u1"), toolCall("c2", "u9")] });
      return reply({ content: results.length ? `final: ${results.map((m: any) => m.content).join(" | ")}` : '{"summary":"s"}' });
    }) as unknown as typeof fetch;
    return { f, bodies };
  };

  it("answers lookups, including a miss, and records the transcript", async () => {
    const { f, bodies } = scripted();
    const { record, text } = await executeRun({ ...planFor(files(), f), mode: "whole" });
    const o = record.outputs[0];
    expect(o.text).toBe("final: The whole first unit. | No unit u9.");
    expect(bodies).toHaveLength(2);
    expect(bodies[1].messages.slice(-3)).toEqual([
      { role: "assistant", content: null, tool_calls: [toolCall("c1", "u1"), toolCall("c2", "u9")] },
      { role: "tool", tool_call_id: "c1", content: "The whole first unit." },
      { role: "tool", tool_call_id: "c2", content: "No unit u9." },
    ]);
    expect(o.turns).toHaveLength(2);
    expect(o.turns![0].calls).toEqual([
      { id: "c1", name: "expand", args: { handle: "u1" }, result: "The whole first unit." },
      { id: "c2", name: "expand", args: { handle: "u9" }, result: "No unit u9." },
    ]);
    expect(o.usage).toEqual({ prompt_tokens: 20, completion_tokens: 4 });
    const back = parseRun("projects/t/runs/x.md", text)!;
    expect(back.outputs[0].turns).toEqual(o.turns);
    expect(back.outputs[0].text).toBe(o.text);
  });

  it("stops at the round cap", async () => {
    let n = 0;
    const always = (async () => reply({ content: n++ ? "" : "thinking", tool_calls: [toolCall(`c${n}`, "u1")] })) as unknown as typeof fetch;
    const { record } = await executeRun({ ...planFor(files(), always, { toolRounds: 2 }), mode: "whole" });
    expect(n).toBe(3);
    expect(record.outputs[0].turns).toHaveLength(3);
    expect(record.outputs[0].turns![2].calls![0].result).toBeUndefined();
    expect(record.outputs[0].error).toMatch(/still calling tools after 2 rounds/);
  });

  it("ends with a turn without tools, where the schema applies", async () => {
    const { f, bodies } = scripted();
    const v = '---\ntitle: A\n---\nSummarize: {{ data("units") | template("{handle}") | join(", ") }}\n{% tool "expand" mode="api" %}\n{% schema "summary" mode="format" %}\n';
    const { record } = await executeRun({ ...planFor(files(undefined, v), f, { finalNoTools: true }), mode: "whole" });
    expect(bodies).toHaveLength(3);
    expect(bodies[0].tools).toHaveLength(1);
    expect(bodies[0].response_format).toBeUndefined();
    // the second turn answered in text with tools still offered; the final turn re-asks without them
    expect(bodies[2].tools).toBeUndefined();
    expect(bodies[2].response_format.json_schema.name).toBe("summary");
    expect(bodies[2].messages.filter((m: any) => m.role === "tool")).toHaveLength(2);
    expect(record.outputs[0].turns![2].noTools).toBe(true);
    // the final request has the tool results, so the scripted model echoes them
    expect(record.outputs[0].text).toMatch(/^final:/);
  });

  it("after the cap, the final turn without tools still answers", async () => {
    let n = 0;
    const f = (async (_u: string, init: RequestInit) => {
      n++;
      return JSON.parse(String(init.body)).tools ? reply({ content: null, tool_calls: [toolCall(`c${n}`, "u2")] }) : reply({ content: "done" });
    }) as unknown as typeof fetch;
    const { record } = await executeRun({ ...planFor(files(), f, { toolRounds: 1, finalNoTools: true }), mode: "whole" });
    expect(n).toBe(3);
    expect(record.outputs[0].text).toBe("done");
    expect(record.outputs[0].error).toBeUndefined();
  });

  it("posts http tool calls and returns the body", async () => {
    const seen: string[] = [];
    let first = true;
    const f = (async (url: string, init: RequestInit) => {
      if (url === "http://tools.test/expand") {
        seen.push(String(init.body));
        return new Response("unit text from the server", { status: 200 });
      }
      if (first) {
        first = false;
        return reply({ content: null, tool_calls: [toolCall("c1", "u1")] });
      }
      const body = JSON.parse(String(init.body));
      return reply({ content: body.messages.at(-1).content });
    }) as unknown as typeof fetch;
    const { record } = await executeRun({ ...planFor(files("handler: http\nurl: http://tools.test/expand"), f), mode: "whole" });
    expect(seen).toEqual(['{"handle":"u1"}']);
    expect(record.outputs[0].text).toBe("unit text from the server");
  });

  it("prints calls to tools without a handler, as before", async () => {
    const f = (async () => reply({ content: "", tool_calls: [toolCall("c1", "u1")] })) as unknown as typeof fetch;
    const { record } = await executeRun({ ...planFor(files("type: x"), f), mode: "whole" });
    expect(record.outputs[0].text).toMatch(/^tool_calls: /);
    expect(record.outputs[0].turns![0].calls![0].result).toBeUndefined();
  });

  it("loops per output in fan-out", async () => {
    const { f, bodies } = scripted();
    const { record } = await executeRun({ ...planFor(files(), f), mode: "fanout", fanout: { source: "units", size: 1 } });
    expect(bodies).toHaveLength(4);
    expect(record.outputs.map((o) => o.turns?.length)).toEqual([2, 2]);
    // lookups read the whole source, not the fan-out chunk
    expect(record.outputs[1].text).toContain("The whole first unit.");
  });

  it("assembles streamed tool calls", async () => {
    let first = true;
    const sse = (chunks: unknown[]) => new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { status: 200 });
    const f = (async (_u: string, init: RequestInit) => {
      if (first) {
        first = false;
        return sse([
          { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "expand", arguments: '{"han' } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'dle":"u2"}' } }] } }] },
        ]);
      }
      const body = JSON.parse(String(init.body));
      return sse([{ choices: [{ delta: { content: "got " } }] }, { choices: [{ delta: { content: body.messages.at(-1).content } }] }]);
    }) as unknown as typeof fetch;
    const { record } = await executeRun({ ...planFor(files(), f, { stream: true }), mode: "whole" });
    expect(record.outputs[0].text).toBe("got The whole second unit.");
  });
});
