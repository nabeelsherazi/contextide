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
    <footer className="flex min-h-7 items-center gap-2 border-t border-rule px-4 py-1 font-sans text-[11.5px] text-ink-3 tabular-nums day:bg-[rgba(251,249,244,0.72)] day:backdrop-blur-md" data-testid="status">
      {a ? (
        <>
          <span title={tokenizerReady() ? "o200k tokenizer estimate" : "rough estimate (tokenizer loading)"} data-testid="token-count">
            ~{a.total.toLocaleString()} tok
          </span>
          <Dot />
          <span title="Tokens before the first thing that changes between runs — the part a prompt cache can reuse" data-testid="prefix-count">
            stable prefix {a.prefixTokens.toLocaleString()} ({pct}%)
          </span>
          <span className="ml-1.5 inline-flex h-[5px] w-[120px] overflow-hidden rounded-full bg-rule" title={kinds.map(([k, n]) => `${k}: ${Math.round((n / kindTotal) * 100)}%`).join("\n")}>
            {kinds.map(([k, n]) => (
              <span key={k} className="block h-full" style={{ width: `${(n / kindTotal) * 100}%`, background: KIND_COLORS[k] ?? "var(--ink-3)" }} />
            ))}
          </span>
        </>
      ) : (
        <span>—</span>
      )}
      <span className="flex-1" />
      {hints.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="xs" className={cn("text-[13px]", errs && "text-danger not-italic")} data-testid="hints-button">
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
                className={cn("block w-full cursor-pointer rounded-lg px-2.5 py-1.5 text-left text-[12px] leading-snug hover:bg-paper-2", h.level === "error" && "text-danger")}
                onClick={() => jumpToCard(h.id)}
              >
                <span className="mr-1 font-mono text-[10px] text-ink-3">{h.code}</span> {h.msg}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      )}
      {v && s.view.t === "version" && (
        <span className="flex items-center gap-1" title="The version's flavor picks library block variants">
          flavor
          <Choice
            value={v.flavor}
            onChange={(f) => updateVersionMeta(v.id, { flavor: f })}
            options={[...new Set([...s.ws.settings.flavors, v.flavor])]}
            className="h-6 border-transparent bg-transparent px-1.5 font-serif text-[14px]"
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
