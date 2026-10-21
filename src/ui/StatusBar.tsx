import { TextSelection } from "prosemirror-state";
import { AlertTriangle } from "lucide-react";
import { useStore, currentVersion } from "../state/store";
import { updateVersionMeta } from "../state/actions";
import { cardPositions } from "../editor/convert";
import { activeEditor } from "../editor/active";
import { tokenizerReady } from "../tokens/tokens";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Choice } from "./widgets";
import { cn } from "@/lib/utils";

const KIND_COLORS: Record<string, string> = { line: "var(--k-line)", directive: "var(--k-directive)", section: "var(--k-section)", use: "var(--k-use)", data: "var(--k-data)", tool: "var(--k-tool)", schema: "var(--k-tool)" };

export function jumpToCard(id: string) {
  const ed = activeEditor();
  if (!ed) return;
  const pos = cardPositions(ed.view.state.doc).get(id);
  if (pos === undefined) return;
  ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.near(ed.view.state.doc.resolve(pos + 1))).scrollIntoView());
  ed.view.focus();
}

const Dot = () => <span className="text-ink-4">·</span>;

export function StatusBar() {
  const s = useStore();
  const a = s.analysis;
  const v = currentVersion(s);
  const pct = a && a.total ? Math.round((a.prefixTokens / a.total) * 100) : 0;
  const kinds = a ? Object.entries(a.byKind).filter(([, n]) => n > 0) : [];
  const kindTotal = kinds.reduce((x, [, n]) => x + n, 0) || 1;
  const hints = a?.hints ?? [];
  const errs = hints.filter((h) => h.level === "error").length;
  return (
    <footer className="relative z-10 flex h-9 items-center gap-3 border-t border-rule bg-glass px-5 font-mono text-[11px] tracking-[0.02em] text-ink-3 tabular-nums backdrop-blur-xl" data-testid="status">
      {a ? (
        <>
          <span title={tokenizerReady() ? "o200k tokenizer estimate" : "rough estimate (tokenizer loading)"} data-testid="token-count">
            <span className="text-ink-2">{a.total.toLocaleString()}</span> tokens
          </span>
          <Dot />
          <span title="Tokens before the first thing that changes between runs — the part a prompt cache can reuse" data-testid="prefix-count">
            <span className="text-ink-2">{a.prefixTokens.toLocaleString()}</span> stable · {pct}%
          </span>
          <span className="inline-flex h-[3px] w-[110px] overflow-hidden rounded-full bg-rule" title={kinds.map(([k, n]) => `${k}: ${Math.round((n / kindTotal) * 100)}%`).join("\n")}>
            {kinds.map(([k, n]) => (
              <span key={k} className="block h-full" style={{ width: `${(n / kindTotal) * 100}%`, background: KIND_COLORS[k] ?? "var(--ink-3)" }} />
            ))}
          </span>
        </>
      ) : null}
      <span className="flex-1" />
      {hints.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="xs" className={cn("h-6 text-[14px]", errs && "text-danger not-italic")} data-testid="hints-button">
              {errs ? (
                <>
                  <AlertTriangle className="size-3" /> {errs} error{errs > 1 ? "s" : ""}
                </>
              ) : (
                `${hints.length} hint${hints.length > 1 ? "s" : ""}`
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-[380px] p-1.5" data-testid="hints">
            {hints.map((h, i) => (
              <button
                key={i}
                className={cn("block w-full cursor-pointer rounded-lg px-2.5 py-1.5 text-left font-serif text-[15px] leading-snug hover:bg-paper-2", h.level === "error" && "text-danger")}
                onClick={() => jumpToCard(h.id)}
              >
                <span className="mr-1.5 font-mono text-[10px] text-ink-3">{h.code}</span> {h.msg}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      )}
      {v && s.view.t === "version" && (
        <span className="flex items-center gap-0.5 font-serif text-[13.5px] tracking-normal italic" title="The version's flavor picks library block variants">
          flavor
          <Choice
            value={v.flavor}
            onChange={(f) => updateVersionMeta(v.id, { flavor: f })}
            options={[...new Set([...s.ws.settings.flavors, v.flavor])]}
            className="h-6 border-transparent bg-transparent px-1.5 text-[14.5px] not-italic text-ink-2 hover:border-transparent hover:bg-paper-2"
            testid="version-flavor"
          />
        </span>
      )}
      <Dot />
      <span className={s.saveError ? "text-danger" : ""} title={s.saveError ?? s.vfs?.name} data-testid="save-state">
        {s.saveError ? "save failed" : s.saving > 0 ? "saving…" : `saved · ${s.vfs?.kind === "browser" ? "browser storage" : s.vfs?.name}`}
      </span>
    </footer>
  );
}
