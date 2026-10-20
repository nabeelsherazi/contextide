import { describe, it, expect } from "vitest";
import { layoutMessage } from "../layout";
import { docToPM } from "../convert";
import { parseBody } from "../../core/doc";

const layout = (src: string) => {
  const doc = docToPM(parseBody(src));
  const kids: any[] = [];
  doc.firstChild!.forEach((c) => kids.push(c));
  return layoutMessage(kids).map((x) => x.cls.join(" "));
};

describe("card layout", () => {
  it("groups text runs, isolates sections and chips, and bridges neighbours", () => {
    expect(layout('a\nb\n{% section title="S" %}\nx\n{% endsection %}\n{% use "directive:x/y" %}\n')).toEqual([
      "cx-tc cx-tc-first",
      "cx-tc cx-tc-last cx-has-next",
      "cx-solo cx-has-prev cx-has-next",
      "cx-solo cx-has-prev",
      "cx-trailing",
    ]);
  });
  it("treats blank lines between cards as bridged gaps", () => {
    expect(layout('a\n\n{% use "directive:x/y" %}\n')).toEqual(["cx-tc cx-tc-first cx-tc-last cx-has-next", "cx-gap cx-gap-bridge", "cx-solo cx-has-prev", "cx-trailing"]);
  });
  it("an empty document is just the trailing line", () => {
    expect(layout("")).toEqual(["cx-trailing cx-empty-doc"]);
  });
  it("blank lines inside a text run stay in the card", () => {
    expect(layout("a\n\nb\n")).toEqual(["cx-tc cx-tc-first", "cx-tc", "cx-tc cx-tc-last", "cx-trailing"]);
  });
});
