import { describe, it, expect } from "vitest";
import { SEED } from "../../seed";
import { buildWorkspace } from "../workspace";
import { envFor } from "../env";
import { render, promptText } from "../render";
import { fmtDoc } from "../doc";
import { score } from "../scoring";
import { dataItems } from "../workspace";

describe("seed workspace", () => {
  const ws = buildWorkspace(new Map(Object.entries(SEED)));
  const p = ws.projects[0];
  it("loads", () => {
    expect(p.name).toBe("merchant-categorizer");
    expect(p.versions.map((v) => v.id)).toEqual(["A", "B"]);
    expect(ws.blocks.length).toBeGreaterThan(10);
  });
  for (const id of ["A", "B"])
    it(`renders version ${id} cleanly and round-trips`, () => {
      const v = p.versions.find((x) => x.id === id)!;
      const r = render(v.doc.messages, envFor(ws, p, v, { now: new Date("2026-10-19T12:00:00Z") }));
      expect(r.warnings.filter((w) => w.level !== "info")).toEqual([]);
      expect(promptText(r)).toContain("SQ *JOE COFFEE COMPANY");
      expect(fmtDoc(v.doc)).toBe(SEED[v.file]);
    });
  it("scores a perfect answer", () => {
    const merchants = dataItems(p.data.find((d) => d.name === "merchants")!).items;
    const gold = dataItems(p.data.find((d) => d.name === "merchant-gold")!).items;
    const output = gold.map((g: any) => `${g.name} -> ${g.category[0]}`).join("\n");
    const r = score([{ items: merchants, output }], gold, p.settings.eval!);
    expect(r.accuracy).toBe(1);
  });
});
