import { diffWordsWithSpace } from "diff";
import { useStore, currentProject } from "../state/store";
import type { RunRecord } from "../core/runs";
import { ago, pct } from "./OutputsPanel";
import { variance, ablationRanking, similarity } from "../run/compare";
import { Seg, Choice, Hint } from "./widgets";
import { Fold } from "./OutputsPanel";
import { jumpToCard } from "./StatusBar";

function RunPick(p: { runs: RunRecord[]; value: string | null; index: number; onChange(id: string | null, index: number): void; testid: string }) {
  const r = p.runs.find((x) => x.id === p.value);
  return (
    <div className="flex min-w-0 gap-1.5">
      <Choice
        value={p.value ?? ""}
        placeholder="choose a run…"
        onChange={(v) => p.onChange(v || null, 0)}
        options={p.runs.map((x) => [x.id, `${x.version} · ${x.mode} · ${ago(x.time)}${x.accuracy !== undefined ? ` · ${pct(x.accuracy)}` : ""}`] as [string, string])}
        className="min-w-0 flex-1"
        testid={p.testid}
      />
      {r && r.outputs.length > 1 && (
        <Choice value={String(p.index)} onChange={(v) => p.onChange(p.value, Number(v))} options={r.outputs.map((o, i) => [String(i), o.label] as [string, string])} className="max-w-[45%] min-w-0" />
      )}
    </div>
  );
}

export function WordDiff({ a, b }: { a: string; b: string }) {
  const parts = diffWordsWithSpace(a, b);
  return (
    <pre className="cx-output cx-diff" data-testid="word-diff">
      {parts.map((p, i) => (
        <span key={i} className={p.added ? "cx-add" : p.removed ? "cx-del" : undefined}>
          {p.value}
        </span>
      ))}
    </pre>
  );
}

function Variance({ r }: { r: RunRecord }) {
  const v = variance(r);
  return (
    <div className="rounded-xl border border-rule bg-paper p-3" data-testid="variance">
      <h4 className="mb-1.5 font-serif text-[18px] font-normal">Repeat variance</h4>
      <p>
        {v.n} outputs · <b>{v.unique}</b> distinct · top answer {pct(v.agreement)} of runs · mean similarity {pct(v.meanSimilarity)}
        {v.mean !== undefined && (
          <>
            {" "}
            · accuracy {pct(v.mean)}
            {v.sd !== undefined && ` ± ${pct(v.sd)}`}
          </>
        )}
      </p>
      {v.groups.slice(0, 4).map((g, i) => (
        <Fold key={i} defaultOpen={i === 0} title={`×${g.length} ${i === 0 ? "(most common)" : ""}`}>
          {i === 0 ? <pre className="cx-output cx-small">{r.outputs[g[0]].text}</pre> : <WordDiff a={r.outputs[v.groups[0][0]].text} b={r.outputs[g[0]].text} />}
        </Fold>
      ))}
    </div>
  );
}

function Ablation({ r }: { r: RunRecord }) {
  const rows = ablationRanking(r);
  return (
    <div className="rounded-xl border border-rule bg-paper p-3" data-testid="ablation">
      <h4 className="mb-1.5 font-serif text-[18px] font-normal">Ablation: what each card does</h4>
      <Hint>Each row muted one card. Bigger change = that card matters more. Click to jump to it.</Hint>
      <table className="cx-table">
        <thead>
          <tr>
            <th>without</th>
            <th>Δ score</th>
            <th>output change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.index} onClick={() => x.id && jumpToCard(x.id)} className="cx-clickable">
              <td>{x.label}</td>
              <td className={x.delta === undefined ? "" : x.delta < 0 ? "cx-danger" : x.delta > 0 ? "cx-good" : ""}>{x.delta === undefined ? "—" : `${x.delta > 0 ? "+" : ""}${Math.round(x.delta * 100)}`}</td>
              <td>{x.error ? <span className="cx-danger">error</span> : <span className="cx-bar" style={{ ["--w" as string]: `${Math.round((x.change ?? 0) * 100)}%` }}>{pct(x.change)}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DiffPanel() {
  const s = useStore();
  const p = currentProject(s);
  if (!p) return null;
  const { a, b, what, ai, bi } = s.diff;
  const set = (patch: Partial<typeof s.diff>) => useStore.setState({ diff: { ...s.diff, ...patch } });
  const ra = p.runs.find((x) => x.id === a);
  const rb = p.runs.find((x) => x.id === b);
  const textOf = (r: RunRecord, i: number) => (what === "output" ? (r.outputs[i]?.text ?? "") : (r.outputs[i]?.prompt ?? r.prompt));
  return (
    <div className="flex flex-col gap-2" data-testid="diff-panel">
      <RunPick runs={p.runs} value={a} index={ai} onChange={(id, i) => set({ a: id, ai: i })} testid="diff-a" />
      <RunPick runs={p.runs} value={b} index={bi} onChange={(id, i) => set({ b: id, bi: i })} testid="diff-b" />
      <Seg
        value={what}
        options={[
          ["output", "outputs"],
          ["prompt", "prompts"],
        ]}
        onChange={(w) => set({ what: w })}
      />
      {ra && rb && (
        <>
          <div className="cx-diff-head">
            <span className="cx-del">
              {ra.version} {pct(ra.accuracy)}
            </span>{" "}
            →{" "}
            <span className="cx-add">
              {rb.version} {pct(rb.accuracy)}
            </span>
            <span className="cx-muted-text"> · {pct(similarity(textOf(ra, ai), textOf(rb, bi)))} similar</span>
          </div>
          <WordDiff a={textOf(ra, ai)} b={textOf(rb, bi)} />
          {what === "output" && (
            <Fold title="Side by side">
              <div className="grid grid-cols-2 gap-1.5">
                <pre className="cx-output cx-small">{textOf(ra, ai)}</pre>
                <pre className="cx-output cx-small">{textOf(rb, bi)}</pre>
              </div>
            </Fold>
          )}
        </>
      )}
      {ra && !rb && ra.mode === "repeat" && <Variance r={ra} />}
      {ra && !rb && ra.mode === "ablation" && <Ablation r={ra} />}
      {ra && !rb && ra.mode !== "repeat" && ra.mode !== "ablation" && <Hint>Pick a second run to diff against.</Hint>}
      {!ra && <Hint>Pick a run. Repeat runs show their variance, ablation runs show which cards matter.</Hint>}
    </div>
  );
}
