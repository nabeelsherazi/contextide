import { useStore, currentProject } from "../state/store";
import { patchProject } from "../state/actions";
import type { EvalConfig, ParserCfg } from "../core/scoring";
import { dataItems } from "../core/workspace";
import { Field, Seg } from "./widgets";

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
    <div className="cx-eval" data-testid="eval-form">
      <label>
        answer key
        <select className="cx-select" value={ev?.key ?? ""} onChange={(e) => (e.target.value ? set({ key: e.target.value }) : set(null))} data-testid="eval-key">
          <option value="">(no scoring)</option>
          {p.data.map((d) => (
            <option key={d.name}>{d.name}</option>
          ))}
        </select>
      </label>
      {ev && (
        <>
          {keyFields.length > 0 && (
            <div className="cx-row2">
              <label>
                key id field
                <select className="cx-select" value={ev.keyId} onChange={(e) => set({ keyId: e.target.value })}>
                  {keyFields.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </label>
              <label>
                key answer field
                <select className="cx-select" value={ev.keyAnswer} onChange={(e) => set({ keyAnswer: e.target.value })}>
                  {keyFields.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {!keyFields.length && <p className="cx-fine">Text keys use lines like <code>item -&gt; answer</code>; separate acceptable answers with <code>|</code>.</p>}
          {otherFields.length > 0 && (
            <label>
              item id field (in the data shown)
              <select className="cx-select" value={ev.itemId ?? ""} onChange={(e) => set({ itemId: e.target.value || undefined })}>
                <option value="">(auto)</option>
                {otherFields.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            read the output as
            <select className="cx-select" value={ev.parser.type} onChange={(e) => set({ parser: { type: e.target.value } as ParserCfg })} data-testid="eval-parser">
              {PARSERS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          {ev.parser.type === "json" && (
            <div className="cx-row2">
              <Field value={ev.parser.path ?? ""} placeholder="path (e.g. labels)" onCommit={(v) => set({ parser: { ...ev.parser, path: v || undefined } as ParserCfg })} />
              <Field value={ev.parser.id ?? ""} placeholder="id field" onCommit={(v) => set({ parser: { ...ev.parser, id: v || undefined } as ParserCfg })} />
              <Field value={ev.parser.answer ?? ""} placeholder="answer field" onCommit={(v) => set({ parser: { ...ev.parser, answer: v || undefined } as ParserCfg })} />
            </div>
          )}
          {ev.parser.type === "whole" && <Field value={ev.parser.field ?? ""} placeholder="JSON field (optional, e.g. category)" onCommit={(v) => set({ parser: { type: "whole", field: v || undefined } })} />}
          {ev.parser.type === "regex" && <Field value={ev.parser.pattern ?? ""} placeholder="^(?<id>.+?) -> (?<answer>.+)$" onCommit={(v) => set({ parser: { type: "regex", pattern: v } })} />}
          <label>
            match
            <Seg value={ev.match} options={[["exact", "exact"], ["ci", "ignore case"], ["loose", "loose"]]} onChange={(v) => set({ match: v })} />
          </label>
        </>
      )}
    </div>
  );
}
