import { useState } from "react";
import { create } from "zustand";
import { useStore, currentProject, currentVersion, getKey, openModal } from "../state/store";
import { startRun, stopRun, patchRunSettings, clearVersionRunOverride, compareVersions } from "../state/actions";
import { mergedRunSettings, type RunSettings } from "../core/workspace";
import type { RunMode } from "../core/runs";
import { NumField, Field, Seg, FieldRow, CheckRow, Hint, Choice } from "./widgets";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pencil, RefreshCw, Square } from "lucide-react";
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
  if (!p || !v) return <Hint>Open a version to run it.</Hint>;
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
    <div className="flex flex-col" data-testid="run-panel">
      <section className="flex flex-col gap-3 border-b border-rule pt-2 pb-4">
        <FieldRow label="endpoint">
          <span className="flex items-center gap-1.5">
            <Choice value={ep?.id ?? ""} onChange={(id) => set({ endpoint: id })} options={s.ws.settings.endpoints.map((e) => [e.id, e.name] as [string, string])} testid="run-endpoint" />
            <Button variant="ghost" size="icon-xs" title="Edit endpoints" onClick={() => openModal({ t: "settings", tab: "endpoints" })}>
              <Pencil />
            </Button>
          </span>
        </FieldRow>
        <FieldRow label="model" hint={modelErr && <span className="text-danger not-italic">{modelErr}</span>}>
          <span className="flex items-center gap-1.5">
            <Field value={rs.model ?? ""} placeholder={ep?.defaultModel || "model id"} list="cx-models" onCommit={(m) => set({ model: m || undefined })} testid="run-model" />
            <Button variant="ghost" size="icon-xs" title="Fetch the model list from the endpoint" onClick={loadModels}>
              <RefreshCw />
            </Button>
          </span>
          <datalist id="cx-models">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </FieldRow>
        <div className="grid grid-cols-2 gap-2">
          <FieldRow label="temperature">
            <NumField value={rs.temperature} onCommit={(n) => set({ temperature: n })} testid="run-temp" />
          </FieldRow>
          <FieldRow label="max tokens">
            <NumField value={rs.max_tokens} onCommit={(n) => set({ max_tokens: n })} />
          </FieldRow>
          <FieldRow label="top_p">
            <NumField value={rs.top_p} placeholder="default" onCommit={(n) => set({ top_p: n })} />
          </FieldRow>
          <FieldRow label="seed">
            <NumField value={rs.seed} placeholder="none" onCommit={(n) => set({ seed: n })} />
          </FieldRow>
        </div>
        <CheckRow checked={!!rs.stream} onChange={(c) => set({ stream: c || undefined })}>
          stream tokens
        </CheckRow>
        <CheckRow
          checked={s.runOverride || overridden}
          onChange={(c) => {
            useStore.setState({ runOverride: c });
            if (!c && overridden) clearVersionRunOverride();
          }}
        >
          settings for this version only {overridden && <Badge variant="outline" className="ml-1 text-ink-3">override</Badge>}
        </CheckRow>
      </section>

      <section className="flex flex-col gap-3 border-b border-rule py-4">
        <FieldRow label="mode">
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
        </FieldRow>
        {o.mode === "whole" && <Hint>One call with the whole prompt.</Hint>}
        {o.mode === "fanout" && (
          <div className="grid grid-cols-2 gap-2" data-testid="fanout-opts">
            <FieldRow label="iterate">
              <Choice value={fanSource} onChange={(f) => useRunOpts.setState({ fanSource: f })} options={fanSources.map((d) => d.name)} className="w-full" />
            </FieldRow>
            <FieldRow label="rows per call">
              <NumField value={o.fanSize} onCommit={(n) => useRunOpts.setState({ fanSize: Math.max(1, n ?? 1) })} testid="fan-size" />
            </FieldRow>
          </div>
        )}
        {o.mode === "repeat" && (
          <FieldRow label="times">
            <NumField value={o.repeat} onCommit={(n) => useRunOpts.setState({ repeat: Math.max(1, Math.min(50, n ?? 3)) })} />
          </FieldRow>
        )}
        {o.mode === "ablation" && <Hint>Runs once as-is, then once per card with that card muted ({nAblate + 1} calls), and ranks which cards change the result.</Hint>}
        <CheckRow checked={o.scoring && !!p.settings.eval} disabled={!p.settings.eval} onChange={(c) => useRunOpts.setState({ scoring: c })}>
          score against answer key
          {!p.settings.eval && (
            <Button variant="link" className="ml-1.5" onClick={() => useStore.setState({ view: { t: "project" } })}>
              set up
            </Button>
          )}
        </CheckRow>
      </section>

      <div className="flex items-center gap-2 pt-4">
        {prog.running ? (
          <Button variant="destructive" size="lg" className="flex-1" onClick={stopRun} data-testid="stop">
            <Square className="size-3.5" /> Stop
          </Button>
        ) : (
          <Button size="lg" className="flex-1" onClick={() => startRunFromPanel()} data-testid="run" title="⌘↵">
            Run {v.title}
          </Button>
        )}
        {p.versions.length > 1 && !prog.running && (
          <Choice
            value=""
            placeholder="Compare with…"
            title="Run two versions with the same settings and compare"
            onChange={(x) => x && compareVersions(v.id, x, o.scoring && !!p.settings.eval)}
            options={p.versions.filter((x) => x.id !== v.id).map((x) => [x.id, x.title] as [string, string])}
            size="default"
            testid="compare"
          />
        )}
      </div>
      {prog.running && (
        <div className="mt-3" data-testid="progress">
          <div className="mb-1.5 h-1 overflow-hidden rounded-full bg-rule">
            <span className="cx-rope-fill block h-full transition-[width] duration-300" style={{ width: `${prog.total ? (prog.done / prog.total) * 100 : 0}%` }} />
          </div>
          <div className="text-ink-3">
            {prog.done}/{prog.total} · {prog.label}
          </div>
          {prog.live && <pre className="cx-output mt-2 max-h-[260px]">{prog.live}</pre>}
        </div>
      )}
      {!prog.running && prog.error && (
        <div className="mt-3 rounded-lg border border-danger/25 bg-danger/10 px-2.5 py-2 text-[12px] leading-snug text-danger" data-testid="run-error">
          {prog.error}
        </div>
      )}
      {req && (
        <div className="mt-4 flex items-center gap-2.5 text-[11.5px] text-ink-3">
          copy as
          <Button variant="link" onClick={() => copy(JSON.stringify(req.body, null, 2), "Copied request JSON")}>
            JSON
          </Button>
          <Button variant="link" onClick={() => copy(curlFor(req), "Copied curl")}>
            curl
          </Button>
          <Button variant="link" onClick={() => copy(tsLiteralFor(s.analysis!.rendered), "Copied TS")}>
            TS
          </Button>
        </div>
      )}
    </div>
  );
}
