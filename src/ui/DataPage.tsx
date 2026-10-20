import { useEffect, useRef, useState } from "react";
import { useStore, writeFile, removeFile, renameFile, openModal, currentProject } from "../state/store";
import { dataItems } from "../core/workspace";
import { itemText } from "../core/data";
import { patchProject } from "../state/actions";
import { Seg, Field } from "./widgets";
import { slug } from "../core/doc";

export function DataPage() {
  const s = useStore();
  const p = currentProject(s);
  const name = s.view.t === "data" ? s.view.name : "";
  const d = p?.data.find((x) => x.name === name);
  const [text, setText] = useState(d?.text ?? "");
  const timer = useRef<number | undefined>(undefined);
  const lastSaved = useRef(d?.text ?? "");
  useEffect(() => {
    if (d && d.text !== lastSaved.current) {
      setText(d.text);
      lastSaved.current = d.text;
    }
  }, [d?.text]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setText(d?.text ?? "");
    lastSaved.current = d?.text ?? "";
  }, [d?.file]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!p || !d) return <div className="cx-empty-page">That data source no longer exists.</div>;
  const parsed = dataItems({ ...d, text });
  const save = (t: string) => {
    setText(t);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      lastSaved.current = t;
      writeFile(d.file, t);
    }, 400);
  };
  const setOpts = (patch: Record<string, unknown>) => patchProject({ data: { ...(p.settings.data ?? {}), [d.name]: { ...(p.settings.data?.[d.name] ?? {}), ...patch } } });
  const isKey = p.settings.eval?.key === d.name;
  return (
    <div className="cx-datapage" data-testid="data-page">
      <header className="cx-page-head">
        <button className="cx-btn small ghost" onClick={() => useStore.setState({ view: { t: "version" } })}>
          ← {s.version ?? "back"}
        </button>
        <span className="cx-page-title static">
          <span className="cx-page-kind">▤ data · {d.format}</span>
          <Field
            className="cx-page-id cx-bare"
            value={d.name}
            onCommit={(v) => {
              const n = slug(v);
              if (n && n !== d.name) {
                const ext = d.file.split(".").pop();
                renameFile(d.file, `${p.dir}/data/${n}.${ext}`).then(() => useStore.setState({ view: { t: "data", name: n } }));
              }
            }}
          />
        </span>
      </header>
      <div className="cx-block-meta">
        {d.format === "text" && (
          <label>
            items are
            <Seg value={d.opts.split ?? "lines"} options={[["lines", "lines"], ["paragraphs", "paragraphs"], ["whole", "one item"]]} onChange={(v) => setOpts({ split: v })} testid="data-split" />
          </label>
        )}
        {parsed.fields.length > 0 && (
          <label>
            id field
            <select className="cx-select" value={d.opts.id ?? ""} onChange={(e) => setOpts({ id: e.target.value || undefined })}>
              <option value="">(auto: id / name)</option>
              {parsed.fields.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
        )}
        <span className="cx-spacer" />
        <span className={parsed.error ? "cx-danger" : "cx-muted-text"} data-testid="data-count">
          {parsed.error ? `parse error: ${parsed.error}` : `${parsed.items.length} items${parsed.fields.length ? ` · fields: ${parsed.fields.join(", ")}` : ""}`}
        </span>
        {isKey ? <span className="cx-badge">answer key</span> : null}
      </div>
      <textarea className="cx-data-text" spellCheck={false} value={text} onChange={(e) => save(e.target.value)} placeholder="Paste your data here — one item per line, paragraphs, JSONL, CSV…" data-testid="data-text" />
      {parsed.items.length > 0 && (
        <details className="cx-data-preview" open>
          <summary>First items as parsed</summary>
          <ol>
            {parsed.items.slice(0, 6).map((it, i) => (
              <li key={i}>
                <code>{itemText(it).slice(0, 300)}</code>
              </li>
            ))}
          </ol>
        </details>
      )}
      <footer className="cx-block-foot">
        <span className="cx-muted-text">{d.file}</span>
        <button
          className="cx-btn small ghost danger"
          onClick={() =>
            openModal({
              t: "confirm",
              title: `Delete data source “${d.name}”?`,
              body: "This deletes the file. Data cards that use it will show as missing.",
              ok: "Delete",
              onOk: () => {
                removeFile(d.file);
                useStore.setState({ view: { t: "version" } });
              },
            })
          }
        >
          Delete
        </button>
      </footer>
    </div>
  );
}
