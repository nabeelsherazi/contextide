import { useStore, currentProject } from "../state/store";
import { patchProject } from "../state/actions";
import type { EvalConfig, ParserCfg } from "../core/scoring";
import { dataItems } from "../core/workspace";
import { Field, Seg, Choice, FieldRow, Hint } from "./widgets";

const PARSERS: [ParserCfg["type"], string][] = [
  ["kv", "name -> answer lines"],
  ["lines", "one line per item, in order"],
  ["json", "JSON (map or array)"],
  ["whole", "whole output (fan-out of 1)"],
  ["regex", "regex with (?<id>) (?<answer>)"],
];

export function EvalForm() {
  const s = useStore();
  const p = currentProject(s);
  if (!p) return null;
  const ev = p.settings.eval;
  const set = (patch: Partial<EvalConfig> | null) => patchProject({ eval: patch === null ? undefined : ({ ...(ev ?? { key: "", keyId: "name", keyAnswer: "answer", parser: { type: "kv" }, match: "ci" }), ...patch } as EvalConfig) });
  const keySrc = p.data.find((d) => d.name === ev?.key);
  const keyFields = keySrc ? dataItems(keySrc).fields : [];
  const otherFields = [...new Set(p.data.filter((d) => d.name !== ev?.key).flatMap((d) => dataItems(d).fields))];
  return (
    <div className="flex flex-col gap-3" data-testid="eval-form">
      <FieldRow label="answer key">
        <Choice value={ev?.key ?? ""} onChange={(k) => (k ? set({ key: k }) : set(null))} options={[["", "(no scoring)"], ...p.data.map((d) => d.name)]} testid="eval-key" />
      </FieldRow>
      {ev && (
        <>
          {keyFields.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              <FieldRow label="key id field">
                <Choice value={ev.keyId} onChange={(f) => set({ keyId: f })} options={keyFields} className="w-full" />
              </FieldRow>
              <FieldRow label="key answer field">
                <Choice value={ev.keyAnswer} onChange={(f) => set({ keyAnswer: f })} options={keyFields} className="w-full" />
              </FieldRow>
            </div>
          ) : (
            <Hint>
              Text keys use lines like <code>item -&gt; answer</code>; separate acceptable answers with <code>|</code>.
            </Hint>
          )}
          {otherFields.length > 0 && (
            <FieldRow label="item id field (in the data shown)">
              <Choice value={ev.itemId ?? ""} onChange={(f) => set({ itemId: f || undefined })} options={[["", "(auto)"], ...otherFields]} />
            </FieldRow>
          )}
          <FieldRow label="read the output as">
            <Choice value={ev.parser.type} onChange={(t) => set({ parser: { type: t } as ParserCfg })} options={PARSERS} testid="eval-parser" />
          </FieldRow>
          {ev.parser.type === "json" && (
            <div className="grid grid-cols-3 gap-2">
              <Field value={ev.parser.path ?? ""} placeholder="path (e.g. labels)" onCommit={(v) => set({ parser: { ...ev.parser, path: v || undefined } as ParserCfg })} />
              <Field value={ev.parser.id ?? ""} placeholder="id field" onCommit={(v) => set({ parser: { ...ev.parser, id: v || undefined } as ParserCfg })} />
              <Field value={ev.parser.answer ?? ""} placeholder="answer field" onCommit={(v) => set({ parser: { ...ev.parser, answer: v || undefined } as ParserCfg })} />
            </div>
          )}
          {ev.parser.type === "whole" && <Field value={ev.parser.field ?? ""} placeholder="JSON field (optional, e.g. category)" onCommit={(v) => set({ parser: { type: "whole", field: v || undefined } })} />}
          {ev.parser.type === "regex" && <Field value={ev.parser.pattern ?? ""} placeholder="^(?<id>.+?) -> (?<answer>.+)$" onCommit={(v) => set({ parser: { type: "regex", pattern: v } })} />}
          <FieldRow label="match">
            <Seg
              value={ev.match}
              options={[
                ["exact", "exact"],
                ["ci", "ignore case"],
                ["loose", "loose"],
              ]}
              onChange={(m) => set({ match: m })}
            />
          </FieldRow>
        </>
      )}
    </div>
  );
}
