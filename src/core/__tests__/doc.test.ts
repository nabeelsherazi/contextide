import { describe, it, expect } from "vitest";
import { parseDoc, fmtDoc, parseInline, fmtInline } from "../doc";

const roundtrip = (s: string) => fmtDoc(parseDoc(s));

describe("doc format", () => {
  it("round-trips a full version", () => {
    const src = `---
title: B
flavor: claude
---
{% message system %}
You are a categorizer.
{% endmessage %}
{% message user %}
{% section title="Rules" frame="xml" list="bullets" %}
Follow these:
{% directive %}Output only the id.{% enddirective %}
{% directive from="directive:tone/you" muted %}Address the reader as you.{% enddirective %}
{% use "directive:safety/anti-prompt-injection" flavor="gemini" %}
{% endsection %}

Today is {{ now(format="dddd, MMMM D") }}.
{{ data("merchants", static=true) | shuffle(seed=1) | head(50) | template("Merchant: {name}") | numbered }}
{% tool "lookup" mode="both" %}
{% schema "label" mode="digest" strict=false %}
{% text muted %}an old idea{% endtext %}
{% endmessage %}
`;
    expect(roundtrip(src)).toBe(src);
  });

  it("treats tagless bodies as one user message and keeps whitespace", () => {
    const src = "  indented line\n\n# Heading\n**bold** text\n";
    const d = parseDoc(src);
    expect(d.messages).toHaveLength(1);
    expect(d.messages[0].role).toBe("user");
    expect(d.messages[0].children).toHaveLength(4);
    expect(fmtDoc(d)).toBe(src);
  });

  it("escapes literal template syntax in text", () => {
    const c = [{ t: "text" as const, text: "use {{ and {% literally" }];
    const s = fmtInline(c);
    expect(parseInline(s)).toEqual(c);
  });

  it("parses inline insertions", () => {
    const c = parseInline('Hi {{ var("name") }}, it is {{ now }}.');
    expect(c.map((x) => x.t)).toEqual(["text", "ins", "text", "ins", "text"]);
  });

  it("keeps unparseable interpolations as text", () => {
    const c = parseInline("weird {{ (( }} stuff");
    expect(c).toEqual([{ t: "text", text: "weird {{ (( }} stuff" }]);
  });

  it("keeps unknown tags as text", () => {
    const d = parseDoc("{% foo bar %}\n");
    expect(d.messages[0].children[0].k).toBe("line");
    expect(fmtDoc(d)).toBe("{{ \"{%\" }} foo bar %}\n");
    expect(fmtDoc(parseDoc(fmtDoc(d)))).toBe(fmtDoc(d));
  });
});
