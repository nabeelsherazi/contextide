import { describe, it, expect } from "vitest";
import { buildWorkspace, moveBefore } from "../workspace";

const files = (order?: string[]) =>
  new Map([
    ["contextide.json", JSON.stringify(order ? { projectOrder: order } : {})],
    ["projects/zeta/versions/A.md", "hi"],
    ["projects/alpha/versions/A.md", "hi"],
    ["projects/mid/versions/A.md", "hi"],
  ]);

describe("workflow order", () => {
  it("is alphabetical by default", () => {
    expect(buildWorkspace(files()).projects.map((p) => p.name)).toEqual(["alpha", "mid", "zeta"]);
  });

  it("follows projectOrder, with unlisted workflows after it alphabetically", () => {
    expect(buildWorkspace(files(["zeta", "gone"])).projects.map((p) => p.name)).toEqual(["zeta", "alpha", "mid"]);
  });

  it("moveBefore reorders a list", () => {
    expect(moveBefore(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(moveBefore(["a", "b", "c"], "a", null)).toEqual(["b", "c", "a"]);
    expect(moveBefore(["a", "b", "c"], "a", "c")).toEqual(["b", "a", "c"]);
  });
});
