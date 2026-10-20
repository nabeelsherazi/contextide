import { useEffect, useRef, useState } from "react";
import { useStore, writeFile, removeFile, renameFile, openModal, currentProject } from "../state/store";
import { dataItems } from "../core/workspace";
import { itemText } from "../core/data";
import { patchProject } from "../state/actions";
import { Seg, Field, Choice, FieldRow } from "./widgets";
import { PageHeader } from "./PageHeader";
import { Fold } from "./OutputsPanel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2 } from "lucide-react";
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
  }, [d?.text]); // pick up external edits, but not echoes of our own saves
  useEffect(() => {
    setText(d?.text ?? "");
    lastSaved.current = d?.text ?? "";
  }, [d?.file]); // switching data sources resets the editor
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
    <div data-testid="data-page">
      <PageHeader
        kind={`▤ data · ${d.format}`}
        title={
          <Field
            className="h-auto border-transparent bg-transparent px-0 font-serif text-[34px] focus-visible:ring-0"
            value={d.name}
            onCommit={(v) => {
              const n = slug(v);
              if (n && n !== d.name) {
                const ext = d.file.split(".").pop();
                renameFile(d.file, `${p.dir}/data/${n}.${ext}`).then(() => useStore.setState({ view: { t: "data", name: n } }));
              }
            }}
          />
        }
        right={isKey ? <Badge variant="outline">answer key</Badge> : null}
      />
      <div className="mb-3.5 flex max-w-[var(--page-width)] flex-wrap items-end gap-x-4 gap-y-2.5">
        {d.format === "text" && (
          <FieldRow label="items are">
            <Seg
              value={d.opts.split ?? "lines"}
              options={[
                ["lines", "lines"],
                ["paragraphs", "paragraphs"],
                ["whole", "one item"],
              ]}
              onChange={(v) => setOpts({ split: v })}
              testid="data-split"
            />
          </FieldRow>
        )}
        {parsed.fields.length > 0 && (
          <FieldRow label="id field">
            <Choice value={d.opts.id ?? ""} onChange={(v) => setOpts({ id: v || undefined })} options={[["", "(auto: id / name)"], ...parsed.fields]} />
          </FieldRow>
        )}
        <span className="flex-1" />
        <span className={parsed.error ? "text-danger" : "text-ink-3"} data-testid="data-count">
          {parsed.error ? `parse error: ${parsed.error}` : `${parsed.items.length} items${parsed.fields.length ? ` · fields: ${parsed.fields.join(", ")}` : ""}`}
        </span>
      </div>
      <textarea className="cx-data-text" spellCheck={false} value={text} onChange={(e) => save(e.target.value)} placeholder="Paste your data here — one item per line, paragraphs, JSONL, CSV…" data-testid="data-text" />
      {parsed.items.length > 0 && (
        <div className="mt-3 max-w-[var(--page-width)] text-ink-2">
          <Fold defaultOpen title="First items as parsed">
            <ol className="my-1.5 pl-6">
              {parsed.items.slice(0, 6).map((it, i) => (
                <li key={i}>
                  <code className="text-[11.5px]">{itemText(it).slice(0, 300)}</code>
                </li>
              ))}
            </ol>
          </Fold>
        </div>
      )}
      <footer className="mt-[18px] flex max-w-[var(--page-width)] items-center justify-between text-[12px] text-ink-3">
        <span>{d.file}</span>
        <Button
          variant="ghost"
          size="sm"
          className="text-danger"
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
          <Trash2 className="size-3.5" /> Delete
        </Button>
      </footer>
    </div>
  );
}
