import { useState } from "react";
import { useStore, currentProject, openModal } from "../state/store";
import { updateRunMeta, deleteRun } from "../state/actions";
import type { RunRecord } from "../core/runs";
import { Field } from "./widgets";

export const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

export const pct = (x?: number) => (x === undefined ? "" : `${Math.round(x * 100)}%`);

function RunDetail({ r, onBack }: { r: RunRecord; onBack(): void }) {
  const [oi, setOi] = useState(0);
  const o = r.outputs[oi];
  return (
    <div className="cx-run-detail" data-testid="run-detail">
      <div className="cx-inline">
        <button className="cx-btn small ghost" onClick={onBack}>
          ← runs
        </button>
        <span className="cx-spacer" />
        <button className={`cx-mini${r.rating === "up" ? " on" : ""}`} onClick={() => updateRunMeta(r.id, { rating: r.rating === "up" ? null : "up" })} title="Good" data-testid="rate-up">
          👍
        </button>
        <button className={`cx-mini${r.rating === "down" ? " on" : ""}`} onClick={() => updateRunMeta(r.id, { rating: r.rating === "down" ? null : "down" })} title="Bad">
          👎
        </button>
        <button className={`cx-mini${r.starred ? " on" : ""}`} onClick={() => updateRunMeta(r.id, { starred: !r.starred })} title="Star">
          ★
        </button>
      </div>
      <div className="cx-run-meta">
        <b>{r.version}</b> · {r.model || "(default model)"} · {r.mode} · {ago(r.time)}
        {r.accuracy !== undefined && (
          <span className="cx-score" data-testid="run-score">
            {pct(r.accuracy)}
            {r.total !== undefined && ` (${r.correct}/${r.total})`}
          </span>
        )}
      </div>
      <Field multiline rows={2} value={r.note ?? ""} placeholder="Notes on this run…" onCommit={(note) => updateRunMeta(r.id, { note })} testid="run-note" />
      {r.outputs.length > 1 && (
        <select className="cx-select" value={oi} onChange={(e) => setOi(Number(e.target.value))}>
          {r.outputs.map((x, i) => (
            <option key={i} value={i}>
              {x.label}
              {x.accuracy !== undefined ? ` · ${pct(x.accuracy)}` : ""}
              {x.error ? " · error" : ""}
            </option>
          ))}
        </select>
      )}
      {o && (
        <>
          {o.error && <div className="cx-run-error">{o.error}</div>}
          <pre className="cx-output" data-testid="run-output">
            {o.text}
          </pre>
          <div className="cx-muted-text">
            {o.ms !== undefined && `${(o.ms / 1000).toFixed(1)}s`}
            {o.usage?.prompt_tokens !== undefined && ` · ${o.usage.prompt_tokens} in / ${o.usage.completion_tokens ?? "?"} out`}
          </div>
        </>
      )}
      {r.misses && r.misses.length > 0 && (
        <details open>
          <summary>
            {r.misses.length} miss{r.misses.length > 1 ? "es" : ""}
          </summary>
          <table className="cx-table">
            <thead>
              <tr>
                <th>item</th>
                <th>expected</th>
                <th>got</th>
              </tr>
            </thead>
            <tbody>
              {r.misses.map((m, i) => (
                <tr key={i}>
                  <td>{m.id}</td>
                  <td>{m.expected.join(" / ")}</td>
                  <td className="cx-danger">{m.got ?? "∅"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      <details>
        <summary>Rendered prompt</summary>
        <pre className="cx-output cx-small">{o?.prompt ?? r.prompt}</pre>
      </details>
      <details>
        <summary>Request</summary>
        <pre className="cx-output cx-small">{r.request}</pre>
      </details>
      <div className="cx-inline">
        <button className="cx-btn small" onClick={() => useStore.setState({ rightTab: "diff", diff: { a: r.id, b: null, what: "output", ai: 0, bi: 0 } })}>
          Diff against…
        </button>
        <span className="cx-spacer" />
        <button
          className="cx-btn small ghost danger"
          onClick={() =>
            openModal({
              t: "confirm",
              title: "Delete this run?",
              body: "This deletes the run file.",
              ok: "Delete",
              onOk: () => {
                deleteRun(r.id);
                onBack();
              },
            })
          }
        >
          Delete
        </button>
      </div>
    </div>
  );
}

export function OutputsPanel() {
  const s = useStore();
  const p = currentProject(s);
  const [all, setAll] = useState(false);
  if (!p) return null;
  const runs = p.runs.filter((r) => all || r.version === s.version);
  const sel = p.runs.find((r) => r.id === s.selectedRun);
  if (sel) return <RunDetail r={sel} onBack={() => useStore.setState({ selectedRun: null })} />;
  return (
    <div className="cx-outputs" data-testid="outputs">
      <div className="cx-inline">
        <label className="cx-check">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> all versions
        </label>
      </div>
      {runs.length === 0 && <div className="cx-panel-empty">No runs yet. Press Run (⌘↵).</div>}
      <ul className="cx-run-list">
        {runs.map((r) => (
          <li key={r.id}>
            <button className="cx-run-row" onClick={() => useStore.setState({ selectedRun: r.id })} data-testid={`run-row-${r.id}`}>
              <span className="cx-run-v">{r.version}</span>
              <span className="cx-run-info">
                {r.mode !== "whole" && <span className="cx-badge">{r.mode}</span>} {r.model || "default"}
                <span className="cx-muted-text"> · {ago(r.time)}</span>
                {r.note && <span className="cx-run-note">{r.note}</span>}
              </span>
              {r.outputs.some((o) => o.error) && <span className="cx-danger">!</span>}
              {r.starred && <span>★</span>}
              {r.rating === "up" && <span>👍</span>}
              {r.rating === "down" && <span>👎</span>}
              {r.accuracy !== undefined && <span className="cx-score">{pct(r.accuracy)}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
