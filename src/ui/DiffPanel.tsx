import { diffWordsWithSpace } from "diff";
import { useStore, currentProject } from "../state/store";
import type { RunRecord } from "../core/runs";
import { ago, pct } from "./OutputsPanel";
import { variance, ablationRanking, similarity } from "../run/compare";
import { Seg } from "./widgets";
import { jumpToCard } from "./StatusBar";

function RunPick(p: { runs: RunRecord[]; value: string | null; index: number; onChange(id: string | null, index: number): void; testid: string }) {
  const r = p.runs.find((x) => x.id === p.value);
  return (
    <div className="cx-runpick">
      <select className="cx-select" value={p.value ?? ""} onChange={(e) => p.onChange(e.target.value || null, 0)} data-testid={p.testid}>
        <option value="">choose a run…</option>
        {p.runs.map((x) => (
          <option key={x.id} value={x.id}>
            {x.version} · {x.mode} · {ago(x.time)}
            {x.accuracy !== undefined ? ` · ${pct(x.accuracy)}` : ""}
          </option>
        ))}
      </select>
      {r && r.outputs.length > 1 && (
        <select className="cx-select" value={p.index} onChange={(e) => p.onChange(p.value, Number(e.target.value))}>
          {r.outputs.map((o, i) => (
            <option key={i} value={i}>
              {o.label}
            </option>
          ))}
        </select>
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
    <div className="cx-card-panel" data-testid="variance">
      <h4>Repeat variance</h4>
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
        <details key={i} open={i === 0}>
          <summary>
            ×{g.length} {i === 0 ? "(most common)" : ""}
          </summary>
          {i === 0 ? <pre className="cx-output cx-small">{r.outputs[g[0]].text}</pre> : <WordDiff a={r.outputs[v.groups[0][0]].text} b={r.outputs[g[0]].text} />}
        </details>
      ))}
    </div>
  );
}

function Ablation({ r }: { r: RunRecord }) {
  const rows = ablationRanking(r);
  return (
    <div className="cx-card-panel" data-testid="ablation">
      <h4>Ablation: what each card does</h4>
      <p className="cx-fine">Each row muted one card. Bigger change = that card matters more. Click to jump to it.</p>
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
    <div className="cx-diffpanel" data-testid="diff-panel">
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
            <details>
              <summary>Side by side</summary>
              <div className="cx-sbs">
                <pre className="cx-output cx-small">{textOf(ra, ai)}</pre>
                <pre className="cx-output cx-small">{textOf(rb, bi)}</pre>
              </div>
            </details>
          )}
        </>
      )}
      {ra && !rb && ra.mode === "repeat" && <Variance r={ra} />}
      {ra && !rb && ra.mode === "ablation" && <Ablation r={ra} />}
      {ra && !rb && ra.mode !== "repeat" && ra.mode !== "ablation" && <p className="cx-panel-empty">Pick a second run to diff against.</p>}
      {!ra && <p className="cx-panel-empty">Pick a run. Repeat runs show their variance, ablation runs show which cards matter.</p>}
    </div>
  );
}
