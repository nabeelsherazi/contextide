import { describe, it, expect } from "vitest";
import { ws } from "./fixtures";
import { envFor } from "../env";
import { render } from "../render";
import { parseDoc } from "../doc";
import { toolHandler, runTool, parseArgs } from "../tools";
import { buildRequest, continueRequest, readResponse, mergeToolCallDeltas, finishToolCalls } from "../request";
import { parseRun, serializeRun, type RunRecord } from "../runs";
import type { Block } from "../workspace";

const block = (front: Record<string, unknown>) => ({ front }) as Block;
const units = [{ handle: "u1", full: "First in full.", meta: { slug: "one" } }, { handle: "u2", full: "Second." }, "a plain line"];
const ctx = { data: (s: string) => (s === "units" ? units : undefined) };
const call = (args: unknown) => ({ id: "c1", name: "expand", args });

describe("tool handlers", () => {
  it("parses lookup and http frontmatter", () => {
    expect(toolHandler(block({ handler: "lookup", source: "units", key: "handle", return: "{full}" }))).toEqual({ kind: "lookup", source: "units", key: "handle", arg: "handle", ret: "{full}", notFound: undefined });
    expect(toolHandler(block({ handler: "lookup", source: "units", key: ".meta.slug" }))).toMatchObject({ arg: "slug" });
    expect(toolHandler(block({ handler: "http", url: "http://x/t", headers: { "x-k": 1 } }))).toEqual({ kind: "http", url: "http://x/t", headers: { "x-k": "1" } });
    expect(toolHandler(block({}))).toBeUndefined();
  });

  it("looks records up by a field or a path, with templates", async () => {
    const h = toolHandler(block({ handler: "lookup", source: "units", key: "handle", return: "{handle}: {full}" }))!;
    expect(await runTool(h, call({ handle: "u1" }), ctx)).toEqual({ text: "u1: First in full." });
    expect((await runTool(toolHandler(block({ handler: "lookup", source: "units", key: "handle" }))!, call({ handle: "u2" }), ctx)).text).toBe('{"handle":"u2","full":"Second."}');
    const byPath = toolHandler(block({ handler: "lookup", source: "units", key: ".meta.slug", arg: "name", return: "{.meta.slug} → {full}" }))!;
    expect((await runTool(byPath, call({ name: "one" }), ctx)).text).toBe("one → First in full.");
  });

  it("says when nothing matches, or the call is malformed", async () => {
    const h = toolHandler(block({ handler: "lookup", source: "units", key: "handle", notFound: "No unit {handle}." }))!;
    expect(await runTool(h, call({ handle: "zz" }), ctx)).toEqual({ text: "No unit zz." });
    const plain = toolHandler(block({ handler: "lookup", source: "units", key: "handle" }))!;
    expect((await runTool(plain, call({}), ctx)).text).toBe("No units record with handle = null.");
    expect(await runTool(plain, call("not json"), ctx)).toMatchObject({ error: true });
    expect(await runTool(toolHandler(block({ handler: "lookup", source: "gone", key: "id" }))!, call({ id: 1 }), ctx)).toMatchObject({ error: true });
  });

  it("reports http failures to the model", async () => {
    const h = toolHandler(block({ handler: "http", url: "http://x/t" }))!;
    const down = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await runTool(h, call({}), { ...ctx, fetchImpl: down })).toMatchObject({ error: true, text: expect.stringMatching(/CORS/) });
    const bad = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    expect(await runTool(h, call({}), { ...ctx, fetchImpl: bad })).toEqual({ text: "error: HTTP 500: nope", error: true });
  });

  it("parses arguments leniently", () => {
    expect(parseArgs('{"a":1}')).toEqual({ a: 1 });
    expect(parseArgs({ a: 1 })).toEqual({ a: 1 });
    expect(parseArgs("")).toEqual({});
    expect(parseArgs("{oops")).toBe("{oops");
  });

  it("render collects handlers and warns about broken ones", () => {
    const w = ws({
      "library/tools/expand.md": "---\nname: expand\nhandler: lookup\nsource: nowhere\nkey: id\n---\n```json\n{}\n```\n",
    });
    const env = envFor(w, w.projects[0], undefined);
    const r = render(parseDoc('Go.\n{% tool "expand" %}\n{% tool "lookup" %}\n').messages, env);
    expect(Object.keys(r.toolHandlers)).toEqual(["expand"]);
    expect(r.warnings.map((x) => x.msg)).toContain('tool expand: lookup source "nowhere" not found in this workflow');
  });
});

describe("tool requests", () => {
  const ep = { id: "x", name: "x", baseUrl: "http://h/v1", style: "chat" as const, headers: {}, extraBody: {} };
  const rendered = () => {
    const w = ws();
    return render(parseDoc('Go.\n{% tool "lookup" %}\n{% schema "label" mode="format" %}\n').messages, envFor(w, w.projects[0], undefined));
  };

  it("holds the schema back for the final turn without tools", () => {
    const r = rendered();
    expect(buildRequest(r, { model: "m" }, ep).body).toMatchObject({ tools: [{}], response_format: {} });
    const first = buildRequest(r, { model: "m", finalNoTools: true }, ep);
    expect(first.body.response_format).toBeUndefined();
    const turns = [{ role: "assistant" as const, content: null, tool_calls: [{ id: "c", type: "function" as const, function: { name: "lookup", arguments: "{}" } }] }, { role: "tool" as const, tool_call_id: "c", content: "r" }];
    const next = continueRequest(first, r, { finalNoTools: true }, turns, { tools: true });
    expect(next.body.tools).toBeDefined();
    expect(next.body.response_format).toBeUndefined();
    expect((next.body.messages as unknown[]).slice(-2)).toEqual(turns);
    const last = continueRequest(first, r, { finalNoTools: true }, turns, { tools: false });
    expect(last.body.tools).toBeUndefined();
    expect(last.body.response_format).toMatchObject({ type: "json_schema" });
    expect((first.body.messages as unknown[]).length).toBe(1);
  });

  it("reads tool calls, whole and streamed", () => {
    const r = readResponse({ choices: [{ message: { content: null, tool_calls: [{ id: "a", function: { name: "f", arguments: { q: 1 } } }] } }] });
    expect(r.text).toBe("");
    expect(r.toolCalls).toEqual([{ id: "a", type: "function", function: { name: "f", arguments: '{"q":1}' } }]);
    const acc: Parameters<typeof mergeToolCallDeltas>[0] = [];
    mergeToolCallDeltas(acc, [{ index: 0, id: "a", function: { name: "f", arguments: '{"q"' } }, { index: 1, function: { name: "g", arguments: "{}" } }]);
    mergeToolCallDeltas(acc, [{ index: 0, function: { arguments: ":1}" } }]);
    expect(finishToolCalls(acc)).toEqual([
      { id: "a", type: "function", function: { name: "f", arguments: '{"q":1}' } },
      { id: "call_2", type: "function", function: { name: "g", arguments: "{}" } },
    ]);
  });
});

describe("run files", () => {
  const rec: Omit<RunRecord, "id" | "file"> = {
    version: "A",
    time: "2026-10-19T12:00:00.000Z",
    endpoint: "e",
    model: "m",
    mode: "whole",
    settings: {},
    promptHash: "1",
    prompt: "## Categories\n- a\n\n### Not a turn",
    request: "{}",
    outputs: [
      {
        label: "output",
        text: "## Answer\nok",
        usage: { prompt_tokens: 3, completion_tokens: 1 },
        turns: [
          { text: "", calls: [{ id: "c1", name: "expand", args: { handle: "u1" }, result: "## heading in a result\n```\ncode\n```" }, { id: "c2", name: "expand", args: "{broken", result: "error: bad", error: true }], usage: { prompt_tokens: 1 } },
          { text: "draft", calls: [{ id: "c3", name: "expand", args: {} }] },
          { text: "## Answer\nok", noTools: true },
        ],
      },
      { label: "two", text: "plain" },
    ],
  };

  it("round-trips transcripts and markdown headings inside fences", () => {
    const back = parseRun("projects/m/runs/x.md", serializeRun(rec))!;
    expect(back.prompt).toBe(rec.prompt);
    expect(back.outputs).toEqual(rec.outputs);
  });
});
