import { useState } from "react";
import { create } from "zustand";
import { useStore, currentProject, currentVersion, getKey, openModal } from "../state/store";
import { startRun, stopRun, patchRunSettings, clearVersionRunOverride, compareVersions } from "../state/actions";
import { mergedRunSettings, type RunSettings } from "../core/workspace";
import type { RunMode } from "../core/runs";
import { NumField, Field, Seg } from "./widgets";
import { ablationTargets } from "../run/runner";
import { docFromPM } from "../editor/convert";
import { activeEditor } from "../editor/active";
import { buildRequest, curlFor, tsLiteralFor } from "../core/request";
import { copy } from "./RenderedView";
import { friendlyFetchError } from "../run/runner";

interface RunOpts {
  mode: RunMode;
  fanSource: string;
  fanSize: number;
  repeat: number;
  scoring: boolean;
}
export const useRunOpts = create<RunOpts>(() => ({ mode: "whole", fanSource: "", fanSize: 1, repeat: 3, scoring: true }));

export function startRunFromPanel() {
  const o = useRunOpts.getState();
  const p = currentProject();
  const fanSource = o.fanSource || p?.data.find((d) => d.name !== p.settings.eval?.key && d.name !== "categories")?.name || p?.data[0]?.name || "";
  return startRun({ mode: o.mode, scoring: o.scoring, fanout: o.mode === "fanout" ? { source: fanSource, size: o.fanSize } : undefined, repeat: o.mode === "repeat" ? o.repeat : undefined });
}

export function RunPanel() {
  const s = useStore();
  const o = useRunOpts();
  const p = currentProject(s);
  const v = currentVersion(s);
  const [models, setModels] = useState<string[]>([]);
  const [modelErr, setModelErr] = useState<string | null>(null);
  if (!p || !v) return <div className="cx-panel-empty">Open a version to run it.</div>;
  const rs = mergedRunSettings(p, v);
  const overridden = !!v.doc.front.run;
  const ep = s.ws.settings.endpoints.find((e) => e.id === rs.endpoint) ?? s.ws.settings.endpoints[0];
  const set = (patch: Partial<RunSettings>) => patchRunSettings(patch);
  const prog = s.progress;
  const fanSources = p.data.filter((d) => d.name !== p.settings.eval?.key);
  const fanSource = o.fanSource || fanSources.find((d) => d.name !== "categories")?.name || fanSources[0]?.name || "";
  const messages = activeEditor()?.key === v.file ? docFromPM(activeEditor()!.view.state.doc) : v.doc.messages;
  const nAblate = o.mode === "ablation" ? ablationTargets(messages).length : 0;

  const loadModels = async () => {
    if (!ep) return;
    setModelErr(null);
    try {
      const key = getKey(ep.id);
      const res = await fetch(ep.baseUrl.replace(/\/+$/, "") + "/models", { headers: { ...ep.headers, ...(key ? { authorization: `Bearer ${key}` } : {}) } });
      const j = await res.json();
      const ids = (j.data ?? j.models ?? []).map((m: { id?: string; name?: string }) => m.id ?? m.name).filter(Boolean);
      setModels(ids);
      if (!rs.model && ids[0]) set({ model: ids[0] });
    } catch (e) {
      setModelErr(friendlyFetchError(e, ep.baseUrl));
    }
  };

  const req = (() => {
    const a = s.analysis;
    return a && ep ? buildRequest(a.rendered, rs, ep) : null;
  })();

  return (
    <div className="cx-run" data-testid="run-panel">
      <div className="cx-form">
        <label>
          endpoint
          <span className="cx-inline">
            <select className="cx-select" value={ep?.id ?? ""} onChange={(e) => set({ endpoint: e.target.value })} data-testid="run-endpoint">
              {s.ws.settings.endpoints.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <button className="cx-mini" title="Edit endpoints" onClick={() => openModal({ t: "settings", tab: "endpoints" })}>
              ✎
            </button>
          </span>
        </label>
        <label>
          model
          <span className="cx-inline">
            <Field value={rs.model ?? ""} placeholder={ep?.defaultModel || "model id"} list="cx-models" onCommit={(m) => set({ model: m || undefined })} testid="run-model" />
            <button className="cx-mini" title="Fetch the model list from the endpoint" onClick={loadModels}>
              ⟳
            </button>
          </span>
          <datalist id="cx-models">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          {modelErr && <span className="cx-field-err">{modelErr}</span>}
        </label>
        <div className="cx-row2">
          <label>
            temperature
            <NumField value={rs.temperature} onCommit={(n) => set({ temperature: n })} testid="run-temp" />
          </label>
          <label>
            max tokens
            <NumField value={rs.max_tokens} onCommit={(n) => set({ max_tokens: n })} />
          </label>
        </div>
        <div className="cx-row2">
          <label>
            top_p
            <NumField value={rs.top_p} placeholder="default" onCommit={(n) => set({ top_p: n })} />
          </label>
          <label>
            seed
            <NumField value={rs.seed} placeholder="none" onCommit={(n) => set({ seed: n })} />
          </label>
        </div>
        <label className="cx-check">
          <input type="checkbox" checked={!!rs.stream} onChange={(e) => set({ stream: e.target.checked || undefined })} /> stream tokens
        </label>
        <label className="cx-check" title="Save these settings on this version only, instead of for the whole project">
          <input
            type="checkbox"
            checked={s.runOverride || overridden}
            onChange={(e) => {
              useStore.setState({ runOverride: e.target.checked });
              if (!e.target.checked && overridden) clearVersionRunOverride();
            }}
          />{" "}
          settings for this version only {overridden && <span className="cx-badge">override</span>}
        </label>
      </div>

      <div className="cx-form">
        <label>
          mode
          <Seg
            value={o.mode}
            options={[
              ["whole", "whole"],
              ["fanout", "fan-out"],
              ["repeat", "repeat"],
              ["ablation", "ablation"],
            ]}
            onChange={(m) => useRunOpts.setState({ mode: m })}
            testid="run-mode"
          />
        </label>
        {o.mode === "whole" && <p className="cx-fine">One call with the whole prompt.</p>}
        {o.mode === "fanout" && (
          <div className="cx-row2">
            <label>
              iterate
              <select className="cx-select" value={fanSource} onChange={(e) => useRunOpts.setState({ fanSource: e.target.value })}>
                {fanSources.map((d) => (
                  <option key={d.name}>{d.name}</option>
                ))}
              </select>
            </label>
            <label>
              rows per call
              <NumField value={o.fanSize} onCommit={(n) => useRunOpts.setState({ fanSize: Math.max(1, n ?? 1) })} />
            </label>
          </div>
        )}
        {o.mode === "repeat" && (
          <label>
            times
            <NumField value={o.repeat} onCommit={(n) => useRunOpts.setState({ repeat: Math.max(1, Math.min(50, n ?? 3)) })} />
          </label>
        )}
        {o.mode === "ablation" && <p className="cx-fine">Runs once as-is, then once per card with that card muted ({nAblate + 1} calls), and ranks which cards change the result.</p>}
        <label className="cx-check">
          <input type="checkbox" checked={o.scoring && !!p.settings.eval} disabled={!p.settings.eval} onChange={(e) => useRunOpts.setState({ scoring: e.target.checked })} /> score against answer key
          {!p.settings.eval && (
            <button className="cx-link" onClick={() => useStore.setState({ view: { t: "project" } })}>
              set up
            </button>
          )}
        </label>
      </div>

      <div className="cx-run-actions">
        {prog.running ? (
          <button className="cx-btn danger" onClick={stopRun} data-testid="stop">
            Stop
          </button>
        ) : (
          <button className="cx-btn primary" onClick={() => startRunFromPanel()} data-testid="run" title="⌘↵">
            Run {v.title}
          </button>
        )}
        {p.versions.length > 1 && !prog.running && (
          <select
            className="cx-select"
            value=""
            title="Run two versions with the same settings and compare"
            onChange={(e) => e.target.value && compareVersions(v.id, e.target.value, o.scoring && !!p.settings.eval)}
            data-testid="compare"
          >
            <option value="">Compare with…</option>
            {p.versions
              .filter((x) => x.id !== v.id)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.title}
                </option>
              ))}
          </select>
        )}
      </div>
      {prog.running && (
        <div className="cx-progress" data-testid="progress">
          <div className="cx-progress-bar">
            <span style={{ width: `${prog.total ? (prog.done / prog.total) * 100 : 0}%` }} />
          </div>
          <div className="cx-muted-text">
            {prog.done}/{prog.total} · {prog.label}
          </div>
          {prog.live && <pre className="cx-live">{prog.live}</pre>}
        </div>
      )}
      {!prog.running && prog.error && (
        <div className="cx-run-error" data-testid="run-error">
          {prog.error}
        </div>
      )}
      {req && (
        <div className="cx-copyas">
          copy as
          <button className="cx-link" onClick={() => copy(JSON.stringify(req.body, null, 2), "Copied request JSON")}>
            JSON
          </button>
          <button className="cx-link" onClick={() => copy(curlFor(req), "Copied curl")}>
            curl
          </button>
          <button className="cx-link" onClick={() => copy(tsLiteralFor(s.analysis!.rendered), "Copied TS")}>
            TS
          </button>
        </div>
      )}
    </div>
  );
}
