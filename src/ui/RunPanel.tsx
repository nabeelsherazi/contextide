import { useState } from "react";
import { create } from "zustand";
import { useStore, currentProject, currentVersion, getKey, openModal } from "../state/store";
import { startRun, stopRun, patchRunSettings, clearVersionRunOverride, compareVersions } from "../state/actions";
import { mergedRunSettings, type RunSettings } from "../core/workspace";
import type { RunMode } from "../core/runs";
import { NumField, Field, Seg, FieldRow, CheckRow, Hint, Choice, Eyebrow } from "./widgets";
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
    <div className="flex flex-col gap-8" data-testid="run-panel">
      <section className="flex flex-col gap-4">
        <FieldRow label="endpoint">
          <span className="flex items-center gap-1">
            <Choice value={ep?.id ?? ""} onChange={(id) => set({ endpoint: id })} options={s.ws.settings.endpoints.map((e) => [e.id, e.name] as [string, string])} className="min-w-0 flex-1" testid="run-endpoint" />
            <Button variant="ghost" size="icon-sm" title="Edit endpoints" onClick={() => openModal({ t: "settings", tab: "endpoints" })}>
              <Pencil className="size-3.5" />
            </Button>
          </span>
        </FieldRow>
        <FieldRow label="model" hint={modelErr && <span className="text-danger not-italic">{modelErr}</span>}>
          <span className="flex items-center gap-1">
            <Field value={rs.model ?? ""} placeholder={ep?.defaultModel || "model id"} list="cx-models" onCommit={(m) => set({ model: m || undefined })} className="font-mono text-[12.5px] placeholder:font-serif" testid="run-model" />
            <Button variant="ghost" size="icon-sm" title="Fetch the model list from the endpoint" onClick={loadModels}>
              <RefreshCw className="size-3.5" />
            </Button>
          </span>
          <datalist id="cx-models">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </FieldRow>
      </section>

      <section>
        <Eyebrow className="mb-3">Sampling</Eyebrow>
        <div className="grid grid-cols-4 divide-x divide-rule overflow-hidden rounded-xl border border-rule bg-field">
          <Param label="temp">
            <NumField value={rs.temperature} placeholder="—" onCommit={(n) => set({ temperature: n })} className={PARAM} testid="run-temp" />
          </Param>
          <Param label="max tok">
            <NumField value={rs.max_tokens} placeholder="—" onCommit={(n) => set({ max_tokens: n })} className={PARAM} />
          </Param>
          <Param label="top p">
            <NumField value={rs.top_p} placeholder="—" onCommit={(n) => set({ top_p: n })} className={PARAM} />
          </Param>
          <Param label="seed">
            <NumField value={rs.seed} placeholder="—" onCommit={(n) => set({ seed: n })} className={PARAM} />
          </Param>
        </div>
        <div className="mt-4 flex flex-col gap-2.5">
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
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Eyebrow>Mode</Eyebrow>
        <Seg
          value={o.mode}
          options={[
            ["whole", "whole"],
            ["fanout", "fan-out"],
            ["repeat", "repeat"],
            ["ablation", "ablation"],
          ]}
          onChange={(m) => useRunOpts.setState({ mode: m })}
          className="w-full [&>*]:flex-1"
          testid="run-mode"
        />
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
          score against the answer key
          {!p.settings.eval && (
            <Button variant="link" className="ml-1.5" onClick={() => useStore.setState({ view: { t: "project" } })}>
              set up
            </Button>
          )}
        </CheckRow>
      </section>

      <section className="flex flex-col gap-3 border-t border-rule pt-7">
        {prog.running ? (
          <Button variant="destructive" size="lg" className="h-12 w-full text-[19px]" onClick={stopRun} data-testid="stop">
            <Square className="size-3.5" /> Stop
          </Button>
        ) : (
          <Button size="lg" className="relative h-12 w-full text-[19px]" onClick={() => startRunFromPanel()} data-testid="run" title="⌘↵">
            Run {v.title}
            <kbd className="absolute right-4 font-mono text-[10.5px] tracking-[0.08em] opacity-55">⌘↵</kbd>
          </Button>
        )}
        {p.versions.length > 1 && !prog.running && (
          <div className="flex items-center justify-center gap-1 font-serif text-[14.5px] text-ink-3 italic">
            or run side by side with
            <Choice
              value=""
              placeholder="another version"
              title="Run two versions with the same settings and compare"
              onChange={(x) => x && compareVersions(v.id, x, o.scoring && !!p.settings.eval)}
              options={p.versions.filter((x) => x.id !== v.id).map((x) => [x.id, <>{x.title} <span className="text-ink-3 italic">{x.subtitle}</span></>] as [string, React.ReactNode])}
              className="h-7 border-transparent bg-transparent px-1.5 text-[15px] hover:border-transparent hover:bg-paper-2"
              testid="compare"
            />
          </div>
        )}
      </section>
      {prog.running && (
        <div data-testid="progress">
          <div className="mb-2 h-[3px] overflow-hidden rounded-full bg-rule">
            <span className="cx-rope-fill block h-full transition-[width] duration-300" style={{ width: `${prog.total ? (prog.done / prog.total) * 100 : 0}%` }} />
          </div>
          <div className="font-mono text-[11px] text-ink-3">
            {prog.done}/{prog.total} · {prog.label}
          </div>
          {prog.live && <pre className="cx-output mt-2 max-h-[260px]">{prog.live}</pre>}
        </div>
      )}
      {!prog.running && prog.last && prog.last.version === v.id && (
        <div data-testid="last-output">
          <div className="mb-1.5 flex items-baseline gap-2">
            <span className="font-serif text-[15px] text-ink-3 italic">{prog.last.outputs > 1 ? `first of ${prog.last.outputs} outputs` : "output"}</span>
            {prog.last.accuracy !== undefined && <span className="font-serif text-[15px] text-good">{Math.round(prog.last.accuracy * 100)}%</span>}
            <span className="flex-1" />
            <Button variant="link" className="text-[14px]" onClick={() => useStore.setState({ rightTab: "outputs", selectedRun: prog.last!.run })}>
              open run
            </Button>
          </div>
          <pre className="cx-output max-h-[320px]">{prog.last.text || "(empty)"}</pre>
        </div>
      )}
      {!prog.running && prog.error && (
        <div className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 font-serif text-[14.5px] leading-snug text-danger" data-testid="run-error">
          {prog.error}
        </div>
      )}
      {req && (
        <div className="flex items-center gap-1.5">
          <span className="mr-1 font-serif text-[14px] text-ink-3 italic">copy the request as</span>
          <Button variant="outline" size="xs" className={CHIP} onClick={() => copy(JSON.stringify(req.body, null, 2), "Copied request JSON")}>
            json
          </Button>
          <Button variant="outline" size="xs" className={CHIP} onClick={() => copy(curlFor(req), "Copied curl")}>
            curl
          </Button>
          <Button variant="outline" size="xs" className={CHIP} onClick={() => copy(tsLiteralFor(s.analysis!.rendered), "Copied TS")}>
            ts
          </Button>
        </div>
      )}
    </div>
  );
}

/** A cell of the sampling strip: an italic label over a bare mono number. */
function Param(p: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 cursor-text flex-col gap-1.5 px-3 pt-2.5 pb-1.5 transition-colors focus-within:bg-paper-2 hover:bg-paper">
      <span className="font-serif text-[14px] leading-none text-ink-3 italic">{p.label}</span>
      {p.children}
    </label>
  );
}

const PARAM = "h-6 rounded-none border-0 bg-transparent px-0 text-[14px] shadow-none focus-visible:ring-0 placeholder:text-ink-4";
const CHIP = "h-7 rounded-full px-3 font-mono text-[11px] tracking-[0.04em]";
