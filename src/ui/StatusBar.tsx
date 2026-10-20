import { useState } from "react";
import { useStore, currentVersion } from "../state/store";
import { updateVersionMeta } from "../state/actions";
import { cardPositions } from "../editor/convert";
import { activeEditor } from "../editor/active";
import { TextSelection } from "prosemirror-state";
import { tokenizerReady } from "../tokens/tokens";

const KIND_COLORS: Record<string, string> = { line: "var(--k-line)", directive: "var(--k-directive)", section: "var(--k-section)", use: "var(--k-use)", data: "var(--k-data)", tool: "var(--k-tool)", schema: "var(--k-tool)" };

export function jumpToCard(id: string) {
  const ed = activeEditor();
  if (!ed) return;
  const pos = cardPositions(ed.view.state.doc).get(id);
  if (pos === undefined) return;
  ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.near(ed.view.state.doc.resolve(pos + 1))).scrollIntoView());
  ed.view.focus();
}

export function StatusBar() {
  const s = useStore();
  const a = s.analysis;
  const v = currentVersion(s);
  const [hintsOpen, setHintsOpen] = useState(false);
  const pct = a && a.total ? Math.round((a.prefixTokens / a.total) * 100) : 0;
  const kinds = a ? Object.entries(a.byKind).filter(([, n]) => n > 0) : [];
  const kindTotal = kinds.reduce((x, [, n]) => x + n, 0) || 1;
  const hints = a?.hints ?? [];
  const errs = hints.filter((h) => h.level === "error").length;
  return (
    <footer className="cx-status" data-testid="status">
      {a ? (
        <>
          <span title={tokenizerReady() ? "o200k tokenizer estimate" : "rough estimate (tokenizer loading)"} data-testid="token-count">
            ~{a.total.toLocaleString()} tok
          </span>
          <span className="cx-dot">·</span>
          <span title="Tokens before the first thing that changes between runs — the part a prompt cache can reuse" data-testid="prefix-count">
            stable prefix {a.prefixTokens.toLocaleString()} ({pct}%)
          </span>
          <span className="cx-kindbar" title={kinds.map(([k, n]) => `${k}: ${Math.round((n / kindTotal) * 100)}%`).join("\n")}>
            {kinds.map(([k, n]) => (
              <span key={k} style={{ width: `${(n / kindTotal) * 100}%`, background: KIND_COLORS[k] ?? "var(--ink-3)" }} />
            ))}
          </span>
        </>
      ) : (
        <span className="cx-muted-text">—</span>
      )}
      <span className="cx-spacer" />
      {hints.length > 0 && (
        <span className="cx-status-hints">
          <button className={`cx-btn small ghost${errs ? " danger" : ""}`} onClick={() => setHintsOpen((o) => !o)} data-testid="hints-button">
            {errs ? `⚠ ${errs} error${errs > 1 ? "s" : ""}` : `${hints.length} hint${hints.length > 1 ? "s" : ""}`}
          </button>
          {hintsOpen && (
            <div className="cx-popover cx-hints" data-testid="hints">
              {hints.map((h, i) => (
                <button key={i} className={`cx-hint cx-hint-${h.level}`} onClick={() => jumpToCard(h.id)}>
                  <span className="cx-hint-code">{h.code}</span> {h.msg}
                </button>
              ))}
            </div>
          )}
        </span>
      )}
      {v && s.view.t === "version" && (
        <label className="cx-status-flavor" title="The version's flavor picks library block variants">
          flavor
          <select value={v.flavor} onChange={(e) => updateVersionMeta(v.id, { flavor: e.target.value })} data-testid="version-flavor">
            {[...new Set([...s.ws.settings.flavors, v.flavor])].map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
      )}
      <span className="cx-dot">·</span>
      <span className={s.saveError ? "cx-danger" : "cx-muted-text"} title={s.saveError ?? s.vfs?.name} data-testid="save-state">
        {s.saveError ? "save failed" : s.saving > 0 ? "saving…" : `saved · ${s.vfs?.kind === "browser" ? "browser storage" : s.vfs?.name}`}
      </span>
    </footer>
  );
}
