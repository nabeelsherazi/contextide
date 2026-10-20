import { describe, it, expect } from "vitest";
import { EditorState, TextSelection, NodeSelection, type Command } from "prosemirror-state";
import { docToPM, docFromPM, cardPositions, cardIdAt } from "../convert";
import { parseBody, fmtBody } from "../../core/doc";
import { schema } from "../schema";
import * as cmd from "../commands";

const mk = (src: string) => EditorState.create({ doc: docToPM(parseBody(src)), schema });
const out = (s: EditorState) => fmtBody(docFromPM(s.doc));
const run = (s: EditorState, c: Command) => {
  let next = s;
  const ok = c(s, (tr) => (next = s.apply(tr)));
  if (!ok) throw new Error("command returned false");
  return next;
};
/** Select a substring (first occurrence), or place the cursor at its start when collapse=true. */
const sel = (s: EditorState, text: string, toText?: string) => {
  let from = -1;
  let to = -1;
  s.doc.descendants((n, pos) => {
    if (n.isText && from < 0) {
      const i = n.text!.indexOf(text);
      if (i >= 0) from = pos + i;
    }
    if (n.isText && toText && to < 0) {
      const j = n.text!.indexOf(toText);
      if (j >= 0) to = pos + j + toText.length;
    }
  });
  if (from < 0) throw new Error(`no text ${text}`);
  if (!toText) to = from + text.length;
  return s.apply(s.tr.setSelection(TextSelection.create(s.doc, from, to)));
};
const cursor = (s: EditorState, text: string) => {
  const t = sel(s, text);
  return t.apply(t.tr.setSelection(TextSelection.create(t.doc, t.selection.from)));
};

describe("convert", () => {
  it("round-trips every node kind through ProseMirror", () => {
    const src =
      '{% message system %}\nSys {{ now(format="YYYY") }}\n{% endmessage %}\n{% message user %}\n{% section title="R" frame="xml" list="bullets" muted %}\n{% directive from="directive:a/b" %}D{% enddirective %}\n{% use "directive:a/b" flavor="claude" %}\n{% endsection %}\n\n{{ data("m", static=true) | head(3) | numbered }}\n{% tool "t" mode="text" %}\n{% schema "s" mode="both" strict=false %}\n{% text muted %}m{% endtext %}\n{% endmessage %}\n';
    expect(out(mk(src))).toBe(src);
  });
  it("maps card ids to positions", () => {
    const s = mk('a\n{% section title="x" %}\nb\nc\n{% endsection %}\n');
    const map = cardPositions(s.doc);
    expect(s.doc.nodeAt(map.get("0/1/1")!)!.textContent).toBe("c");
    const t = cursor(s, "c");
    expect(cardIdAt(t.doc, t.selection.from)?.id).toBe("0/1/1");
  });
});

describe("commands", () => {
  it("makes a whole line a directive", () => {
    const s = run(cursor(mk("Output only the id.\n"), "Output"), cmd.makeDirective);
    expect(out(s)).toBe("{% directive %}Output only the id.{% enddirective %}\n");
  });
  it("splits a partial selection out into a directive", () => {
    const s = run(sel(mk("Intro text. Be terse. Then more.\n"), "Be terse."), cmd.makeDirective);
    expect(out(s)).toBe("Intro text.\n{% directive %}Be terse.{% enddirective %}\nThen more.\n");
  });
  it("converts multiple selected lines", () => {
    const s = run(sel(mk("one\ntwo\nthree\n"), "one", "two"), cmd.makeDirective);
    expect(out(s)).toBe("{% directive %}one{% enddirective %}\n{% directive %}two{% enddirective %}\nthree\n");
  });
  it("groups selected cards as a section and ungroups", () => {
    const base = mk("intro\n{% directive %}A{% enddirective %}\n{% directive %}B{% enddirective %}\ntail\n");
    const s = run(sel(base, "A", "B"), cmd.groupAsSection("Rules"));
    expect(out(s)).toBe('intro\n{% section title="Rules" %}\n{% directive %}A{% enddirective %}\n{% directive %}B{% enddirective %}\n{% endsection %}\ntail\n');
    const u = run(cursor(s, "A"), cmd.ungroupSection);
    expect(out(u)).toBe(out(base));
  });
  it("mutes and unmutes", () => {
    const s = run(cursor(mk("a\nb\n"), "b"), cmd.toggleMute);
    expect(out(s)).toBe("a\n{% text muted %}b{% endtext %}\n");
    expect(out(run(cursor(s, "b"), cmd.toggleMute))).toBe("a\nb\n");
  });
  it("moves cards up/down, and out of sections", () => {
    const s = mk('a\n{% section title="S" %}\nb\nc\n{% endsection %}\nd\n');
    expect(out(run(cursor(s, "d"), cmd.moveCard(-1)))).toBe('a\nd\n{% section title="S" %}\nb\nc\n{% endsection %}\n');
    expect(out(run(cursor(s, "c"), cmd.moveCard(-1)))).toBe('a\n{% section title="S" %}\nc\nb\n{% endsection %}\nd\n');
    expect(out(run(cursor(s, "b"), cmd.moveCard(-1)))).toBe('a\nb\n{% section title="S" %}\nc\n{% endsection %}\nd\n');
    expect(out(run(cursor(s, "c"), cmd.moveCard(1)))).toBe('a\n{% section title="S" %}\nb\n{% endsection %}\nc\nd\n');
    expect(cmd.moveCard(-1)(cursor(s, "a"), undefined)).toBe(false);
  });
  it("moves a card to a drop position", () => {
    const s = mk("a\nb\nc\n");
    const map = cardPositions(s.doc);
    const t = run(s, cmd.moveCardTo(map.get("0/0")!, map.get("0/2")! + 3));
    expect(out(t)).toBe("b\nc\na\n");
  });
  it("inserts cards after the cursor card, or replaces an empty line", () => {
    const use = schema.nodes.use.create({ ref: "directive:x/y" });
    expect(out(run(cursor(mk("a\nb\n"), "a"), cmd.insertCard(use)))).toBe('a\n{% use "directive:x/y" %}\nb\n');
    const empty = mk("a\n\nb\n");
    const at = empty.apply(empty.tr.setSelection(TextSelection.create(empty.doc, cardPositions(empty.doc).get("0/1")! + 1)));
    expect(out(run(at, cmd.insertCard(use)))).toBe('a\n{% use "directive:x/y" %}\nb\n');
  });
  it("inserts a section from inside a section after it", () => {
    const s = mk('{% section title="S" %}\nb\n{% endsection %}\n');
    const sec = schema.nodes.section.create({ title: "T" }, [schema.nodes.line.create(null, schema.text("x"))]);
    expect(out(run(cursor(s, "b"), cmd.insertCard(sec)))).toBe('{% section title="S" %}\nb\n{% endsection %}\n{% section title="T" %}\nx\n{% endsection %}\n');
  });
  it("inserts inline insertions", () => {
    const ins = schema.nodes.insertion.create({ fn: "now", pos: "[]", args: '{"format":"YYYY"}' });
    const s = cursor(mk("Today is \n"), "Today");
    const t = run(s.apply(s.tr.setSelection(TextSelection.create(s.doc, s.selection.from + 9))), cmd.insertInline(ins));
    expect(out(t)).toBe('Today is {{ now(format="YYYY") }}\n');
  });
  it("replaces selection with a ref and detaches it again", () => {
    const s = run(sel(mk("a\nRule text\nb\n"), "Rule"), cmd.replaceWithRef("directive:t/rule"));
    expect(out(s)).toBe('a\n{% use "directive:t/rule" %}\nb\n');
    const pos = cardPositions(s.doc).get("0/1")!;
    const d = run(s, cmd.detachRef(pos, { kind: "directive", body: "Rule text", fn: "rule", front: {} }));
    expect(out(d)).toBe('a\n{% directive from="directive:t/rule" %}Rule text{% enddirective %}\nb\n');
    const sec = run(s, cmd.detachRef(pos, { kind: "section", body: "{% directive %}x{% enddirective %}\ny", fn: "Core", front: { list: "bullets" } }));
    expect(out(sec)).toBe('a\n{% section title="Core" list="bullets" from="directive:t/rule" %}\n{% directive %}x{% enddirective %}\ny\n{% endsection %}\nb\n');
  });
  it("adds and removes messages", () => {
    const s = run(mk("hi\n"), cmd.addMessage("system"));
    expect(out(s)).toBe("{% message system %}\n\n{% endmessage %}\n{% message user %}\nhi\n{% endmessage %}\n");
    expect(out(run(s, cmd.removeMessage(0)))).toBe("hi\n");
  });
  it("deletes cards, leaving an empty line in an emptied parent", () => {
    const s = mk("a\n");
    expect(out(run(cursor(s, "a"), cmd.deleteCard))).toBe("\n");
    const t = mk('{% use "x:y" %}\nb\n');
    const n = t.apply(t.tr.setSelection(NodeSelection.create(t.doc, cardPositions(t.doc).get("0/0")!)));
    expect(out(run(n, cmd.deleteCard))).toBe("b\n");
  });
});
