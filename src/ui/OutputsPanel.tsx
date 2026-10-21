import { useState } from "react";
import { ArrowLeft, Star, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";
import { useStore, currentProject, openModal } from "../state/store";
import { updateRunMeta, deleteRun } from "../state/actions";
import type { RunRecord } from "../core/runs";
import { Field, Choice, CheckRow, Hint } from "./widgets";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

/** A version's display title from its id (runs store the id). */
export const titleOf = (id: string) => currentProject()?.versions.find((v) => v.id === id)?.title ?? id;

export const pct = (x?: number) => (x === undefined ? "" : `${Math.round(x * 100)}%`);

/** A collapsible "details" section in the panel's voice. */
export function Fold(p: { title: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <Collapsible defaultOpen={p.defaultOpen}>
      <CollapsibleTrigger className="group/f flex cursor-pointer items-center gap-1.5 py-1 font-serif text-[15px] text-ink-2 italic hover:text-foreground">
        <span className="inline-block transition-transform group-data-[state=open]/f:rotate-90">›</span> {p.title}
      </CollapsibleTrigger>
      <CollapsibleContent>{p.children}</CollapsibleContent>
    </Collapsible>
  );
}

function RunDetail({ r, onBack }: { r: RunRecord; onBack(): void }) {
  const [oi, setOi] = useState(0);
  const o = r.outputs[oi];
  const toggleBtn = (on: boolean) => cn(on && "bg-gold-soft text-gold");
  return (
    <div className="flex flex-col gap-2.5" data-testid="run-detail">
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-3.5" /> runs
        </Button>
        <span className="flex-1" />
        <Button variant="ghost" size="icon-sm" className={toggleBtn(r.rating === "up")} onClick={() => updateRunMeta(r.id, { rating: r.rating === "up" ? null : "up" })} title="Good" data-testid="rate-up">
          <ThumbsUp />
        </Button>
        <Button variant="ghost" size="icon-sm" className={toggleBtn(r.rating === "down")} onClick={() => updateRunMeta(r.id, { rating: r.rating === "down" ? null : "down" })} title="Bad">
          <ThumbsDown />
        </Button>
        <Button variant="ghost" size="icon-sm" className={toggleBtn(!!r.starred)} onClick={() => updateRunMeta(r.id, { starred: !r.starred })} title="Star">
          <Star />
        </Button>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2 font-mono text-[10.5px] text-ink-3">
        <b className="font-serif text-[22px] leading-none font-normal text-foreground">{titleOf(r.version)}</b>
        <span>{r.model || "default model"}</span>·<span>{r.mode}</span>·<span>{ago(r.time)}</span>
        {r.accuracy !== undefined && (
          <span className="ml-auto font-serif text-[17px] text-good" data-testid="run-score">
            {pct(r.accuracy)}
            {r.total !== undefined && ` (${r.correct}/${r.total})`}
          </span>
        )}
      </div>
      <Field multiline rows={2} value={r.note ?? ""} placeholder="Notes on this run…" onCommit={(note) => updateRunMeta(r.id, { note })} testid="run-note" />
      {r.outputs.length > 1 && (
        <Choice
          value={String(oi)}
          onChange={(v) => setOi(Number(v))}
          options={r.outputs.map((x, i) => [String(i), `${x.label}${x.accuracy !== undefined ? ` · ${pct(x.accuracy)}` : ""}${x.error ? " · error" : ""}`] as [string, string])}
          className="w-full"
        />
      )}
      {o && (
        <>
          {o.error && <div className="rounded-lg border border-danger/25 bg-danger/10 px-2.5 py-2 text-[12px] text-danger">{o.error}</div>}
          <pre className="cx-output" data-testid="run-output">
            {o.text}
          </pre>
          <div className="-mt-1 font-mono text-[10.5px] text-ink-3">
            {o.ms !== undefined && `${(o.ms / 1000).toFixed(1)}s`}
            {o.usage?.prompt_tokens !== undefined && ` · ${o.usage.prompt_tokens} in / ${o.usage.completion_tokens ?? "?"} out`}
          </div>
        </>
      )}
      {r.misses && r.misses.length > 0 && (
        <Fold defaultOpen title={`${r.misses.length} miss${r.misses.length > 1 ? "es" : ""}`}>
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
                  <td className="text-danger">{m.got ?? "∅"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Fold>
      )}
      <Fold title="Rendered prompt">
        <pre className="cx-output cx-small">{o?.prompt ?? r.prompt}</pre>
      </Fold>
      <Fold title="Request">
        <pre className="cx-output cx-small">{r.request}</pre>
      </Fold>
      <div className="flex items-center">
        <Button variant="outline" size="sm" onClick={() => useStore.setState({ rightTab: "diff", diff: { a: r.id, b: null, what: "output", ai: 0, bi: 0 } })}>
          Diff against…
        </Button>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="text-danger"
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
          <Trash2 className="size-3.5" /> Delete
        </Button>
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
    <div className="flex flex-col gap-2" data-testid="outputs">
      <CheckRow checked={all} onChange={setAll}>
        all versions
      </CheckRow>
      {runs.length === 0 && <Hint>No runs yet. Press Run (⌘↵).</Hint>}
      <ul className="flex flex-col">
        {runs.map((r) => (
          <li key={r.id}>
            <button
              className="flex w-full cursor-pointer items-center gap-2 rounded-[10px] px-2 py-2 text-left transition-colors hover:bg-paper-2"
              onClick={() => useStore.setState({ selectedRun: r.id })}
              data-testid={`run-row-${r.id}`}
            >
              <span className="max-w-[45%] min-w-[22px] truncate font-serif text-[18px]">{titleOf(r.version)}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-2">
                {r.mode !== "whole" && (
                  <Badge variant="outline" className="mr-1 text-ink-3">
                    {r.mode}
                  </Badge>
                )}
                {r.model || "default"}
                <span className="text-ink-3"> · {ago(r.time)}</span>
                {r.note && <span className="block truncate font-serif text-[13px] text-ink-3 italic">{r.note}</span>}
              </span>
              {r.outputs.some((o) => o.error) && <span className="text-danger">!</span>}
              {r.starred && <Star className="size-3.5 text-gold" />}
              {r.rating === "up" && <ThumbsUp className="size-3.5" />}
              {r.rating === "down" && <ThumbsDown className="size-3.5" />}
              {r.accuracy !== undefined && <span className="font-serif text-[16px] text-good">{pct(r.accuracy)}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
