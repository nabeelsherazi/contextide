import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useStore, closeModal, currentProject, currentVersion, setPrefs, setKey, getKey, closeWorkspace, type Modal } from "../../state/store";
import { createVersion, updateVersionMeta, deleteVersion, createProject, saveBlock, createDataSource, patchWorkspace, updateBlockBody, nextVersionId } from "../../state/actions";
import { activeEditor } from "../../editor/active";
import { replaceWithRef, detachRef, setCardAttrs, selectedCards } from "../../editor/commands";
import { nodeFromPM, pipeFromString } from "../../editor/convert";
import { fmtBody, slug, type Node } from "../../core/doc";
import { resolveBlock, variantsOf, dataItems, usages, type Endpoint, type BlockKind, mergedVars } from "../../core/workspace";
import { applyPipeline, TRANSFORMS } from "../../core/pipeline";
import { evalInsertion, insertionInfo } from "../../core/insertions";
import { Field, KeyValues, JsonField, Seg, NumField } from "../widgets";
import { forgetWorkspace } from "../../fs/persist";
import { startTour } from "../Tour";

function Dialog(p: { title: string; children: ReactNode; footer?: ReactNode; wide?: boolean; testid?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeModal();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="cx-overlay" onMouseDown={(e) => e.target === e.currentTarget && closeModal()}>
      <div className={`cx-dialog${p.wide ? " wide" : ""}`} role="dialog" aria-label={p.title} data-testid={p.testid ?? "dialog"}>
        <h2>{p.title}</h2>
        <div className="cx-dialog-body">{p.children}</div>
        {p.footer && <div className="cx-dialog-foot">{p.footer}</div>}
      </div>
    </div>
  );
}

const Cancel = () => (
  <button className="cx-btn ghost" onClick={closeModal}>
    Cancel
  </button>
);

/** Quick-pick chips plus free text. */
function QuickPick(p: { value: string; options: string[]; onChange(v: string): void; placeholder?: string; testid?: string }) {
  return (
    <div className="cx-quickpick">
      <input className="cx-input" value={p.value} placeholder={p.placeholder} onChange={(e) => p.onChange(e.target.value)} data-testid={p.testid} />
      <div className="cx-chips">
        {p.options.map((o) => (
          <button key={o} className={`cx-chip-btn${o === p.value ? " on" : ""}`} onClick={() => p.onChange(o)}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- save to library ----------

function SaveBlock({ m }: { m: Extract<Modal, { t: "save-block" }> }) {
  const s = useStore();
  const v = currentVersion(s);
  const [kind, setKind] = useState<"directive" | "section">(m.kind);
  const [type, setType] = useState("");
  const [fn, setFn] = useState(m.title ?? "");
  const [flavor, setFlavor] = useState(v?.flavor ?? "general");
  const [scope, setScope] = useState<"library" | "project">(m.scope ?? "library");
  const [link, setLink] = useState(true);
  const existing = useMemo(() => [...new Set(s.ws.blocks.filter((b) => b.kind === kind).map((b) => b.type).filter(Boolean))], [s.ws, kind]);
  const fns = useMemo(() => s.ws.blocks.filter((b) => b.kind === kind && b.type === type).map((b) => b.fn), [s.ws, kind, type]);
  const types = [...new Set([...existing, ...s.ws.settings.types])];
  const can = fn.trim().length > 0;
  const save = async () => {
    const r = await saveBlock({ kind, type: type.trim(), fn: fn.trim(), flavor, scope, body: m.text, extraFront: kind === "section" ? { title: fn.trim() } : undefined });
    if (link) m.onSaved(r.key, scope);
    closeModal();
  };
  return (
    <Dialog
      title={`Save to ${scope}`}
      testid="save-block"
      footer={
        <>
          <Cancel />
          <button className="cx-btn primary" disabled={!can} onClick={save} data-testid="save-block-ok">
            Save
          </button>
        </>
      }
    >
      <label>
        kind
        <Seg
          value={kind}
          options={[
            ["directive", "Directive"],
            ["section", "Section"],
          ]}
          onChange={setKind}
        />
      </label>
      <label>
        type
        <QuickPick value={type} options={types} onChange={setType} placeholder="e.g. safety, tone, task instruction" testid="save-type" />
      </label>
      <label>
        function
        <QuickPick value={fn} options={fns} onChange={setFn} placeholder="e.g. Anti Prompt Injection" testid="save-fn" />
        {fns.includes(fn) && <span className="cx-fine">Adds a {flavor} variant to the existing “{fn}”.</span>}
      </label>
      <label>
        flavor
        <QuickPick value={flavor} options={s.ws.settings.flavors} onChange={(f) => setFlavor(slug(f) === "untitled" ? "general" : f.toLowerCase())} testid="save-flavor" />
      </label>
      <label>
        scope
        <Seg
          value={scope}
          options={[
            ["library", "Library (all projects)"],
            ["project", "This project"],
          ]}
          onChange={setScope}
        />
      </label>
      <label className="cx-check">
        <input type="checkbox" checked={link} onChange={(e) => setLink(e.target.checked)} /> replace the selection with a live reference
      </label>
      <pre className="cx-output cx-small">{m.text}</pre>
    </Dialog>
  );
}

// ---------- versions & projects ----------

function NewVersion({ fork }: { fork?: string }) {
  const s = useStore();
  const p = currentProject(s);
  const [id, setId] = useState(nextVersionId(p?.versions.map((v) => v.id) ?? []));
  const [subtitle, setSubtitle] = useState("");
  const [from, setFrom] = useState(fork ?? "");
  const src = p?.versions.find((v) => v.id === from);
  const [flavor, setFlavor] = useState(src?.flavor ?? "general");
  const taken = p?.versions.some((v) => v.id === id);
  return (
    <Dialog
      title="New version"
      testid="new-version-dialog"
      footer={
        <>
          <Cancel />
          <button
            className="cx-btn primary"
            disabled={!id.trim() || taken}
            onClick={async () => {
              closeModal();
              await createVersion({ id, subtitle, flavor, fork: from || undefined });
            }}
            data-testid="new-version-ok"
          >
            Create
          </button>
        </>
      }
    >
      <label>
        name
        <input className="cx-input" value={id} onChange={(e) => setId(e.target.value)} data-testid="version-id" />
        {taken && <span className="cx-field-err">already exists</span>}
      </label>
      <label>
        subtitle — the philosophy of this approach
        <input className="cx-input" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="e.g. few-shot heavy, XML everything, terse" data-testid="version-subtitle" autoFocus />
      </label>
      <label>
        start from
        <select className="cx-select" value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="">a blank page</option>
          {p?.versions.map((v) => (
            <option key={v.id} value={v.id}>
              a copy of {v.title}
              {v.subtitle ? ` · ${v.subtitle}` : ""}
            </option>
          ))}
        </select>
      </label>
      <label>
        flavor
        <select className="cx-select" value={flavor} onChange={(e) => setFlavor(e.target.value)}>
          {s.ws.settings.flavors.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </label>
    </Dialog>
  );
}

function VersionSettings({ id }: { id: string }) {
  const s = useStore();
  const p = currentProject(s);
  const v = p?.versions.find((x) => x.id === id);
  const [name, setName] = useState(v?.id ?? "");
  const [subtitle, setSubtitle] = useState(v?.subtitle ?? "");
  const [flavor, setFlavor] = useState(v?.flavor ?? "general");
  const [confirmDel, setConfirmDel] = useState(false);
  if (!p || !v) return null;
  const taken = name !== v.id && p.versions.some((x) => x.id === name);
  return (
    <Dialog
      title={`Version ${v.title}`}
      testid="version-settings"
      footer={
        <>
          {p.versions.length > 1 &&
            (confirmDel ? (
              <button
                className="cx-btn danger"
                onClick={() => {
                  closeModal();
                  deleteVersion(v.id);
                }}
              >
                Really delete {v.id}
              </button>
            ) : (
              <button className="cx-btn ghost danger" onClick={() => setConfirmDel(true)}>
                Delete…
              </button>
            ))}
          <span className="cx-spacer" />
          <Cancel />
          <button
            className="cx-btn primary"
            disabled={!name.trim() || taken}
            onClick={() => {
              closeModal();
              updateVersionMeta(v.id, { id: name !== v.id ? name : undefined, subtitle, flavor });
            }}
            data-testid="version-settings-ok"
          >
            Save
          </button>
        </>
      }
    >
      <label>
        name
        <input className="cx-input" value={name} onChange={(e) => setName(e.target.value)} />
        {taken && <span className="cx-field-err">already exists</span>}
      </label>
      <label>
        subtitle
        <input className="cx-input" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} autoFocus />
      </label>
      <label>
        flavor
        <select className="cx-select" value={flavor} onChange={(e) => setFlavor(e.target.value)}>
          {[...new Set([...s.ws.settings.flavors, v.flavor])].map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </label>
    </Dialog>
  );
}

function NewProject() {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const exists = useStore((s) => s.ws.projects.some((p) => p.name === slug(name)));
  return (
    <Dialog
      title="New project"
      testid="new-project"
      footer={
        <>
          <Cancel />
          <button
            className="cx-btn primary"
            disabled={!name.trim() || exists}
            onClick={() => {
              closeModal();
              createProject(name, desc);
            }}
            data-testid="new-project-ok"
          >
            Create
          </button>
        </>
      }
    >
      <label>
        name
        <input className="cx-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. sentiment-triage" autoFocus data-testid="project-name" />
        {name && <span className="cx-fine">folder: projects/{slug(name)}</span>}
        {exists && <span className="cx-field-err">already exists</span>}
      </label>
      <label>
        what is it for?
        <textarea className="cx-input" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />
      </label>
    </Dialog>
  );
}

const BLOCK_DEFAULT_BODY: Record<BlockKind, string> = {
  directive: "",
  section: "",
  insertion: 'Today is {{ now(format="dddd, MMMM D, YYYY") }}.',
  tool: '```json\n{\n  "type": "object",\n  "properties": {\n    "query": { "type": "string", "description": "What to look up" }\n  },\n  "required": ["query"]\n}\n```',
  schema: '```json\n{\n  "type": "object",\n  "properties": {\n    "answer": { "type": "string", "description": "Your answer" }\n  },\n  "required": ["answer"],\n  "additionalProperties": false\n}\n```',
};

function NewBlock({ kind }: { kind: BlockKind }) {
  const s = useStore();
  const v = currentVersion(s);
  const [type, setType] = useState("");
  const [fn, setFn] = useState("");
  const [flavor, setFlavor] = useState(v?.flavor ?? "general");
  const [scope, setScope] = useState<"library" | "project">("library");
  const named = kind === "tool" || kind === "schema" || kind === "insertion";
  return (
    <Dialog
      title={`New ${kind}`}
      testid="new-block"
      footer={
        <>
          <Cancel />
          <button
            className="cx-btn primary"
            disabled={!fn.trim()}
            data-testid="new-block-ok"
            onClick={async () => {
              const r = await saveBlock({ kind, type: named ? "" : type.trim(), fn: fn.trim(), flavor, scope, body: BLOCK_DEFAULT_BODY[kind], extraFront: kind === "tool" || kind === "schema" ? { name: slug(fn).replace(/-/g, "_") } : kind === "section" ? { title: fn.trim() } : undefined });
              closeModal();
              useStore.setState({ view: { t: "block", key: r.key, flavor, file: r.file } });
            }}
          >
            Create
          </button>
        </>
      }
    >
      {!named && (
        <label>
          type
          <QuickPick value={type} options={s.ws.settings.types} onChange={setType} placeholder="e.g. safety" testid="new-block-type" />
        </label>
      )}
      <label>
        {named ? "name" : "function"}
        <input className="cx-input" value={fn} onChange={(e) => setFn(e.target.value)} autoFocus data-testid="new-block-fn" />
      </label>
      {!named && (
        <label>
          flavor
          <QuickPick value={flavor} options={s.ws.settings.flavors} onChange={(f) => setFlavor(f.toLowerCase())} />
        </label>
      )}
      <label>
        scope
        <Seg
          value={scope}
          options={[
            ["library", "Library"],
            ["project", "This project"],
          ]}
          onChange={setScope}
        />
      </label>
    </Dialog>
  );
}

function NewData() {
  const [name, setName] = useState("");
  const [fmt, setFmt] = useState("txt");
  const [text, setText] = useState("");
  return (
    <Dialog
      title="New data source"
      wide
      testid="new-data-dialog"
      footer={
        <>
          <Cancel />
          <button
            className="cx-btn primary"
            disabled={!slug(name) || slug(name) === "untitled"}
            data-testid="new-data-ok"
            onClick={async () => {
              closeModal();
              await createDataSource(name, fmt, text);
            }}
          >
            Create
          </button>
        </>
      }
    >
      <label>
        name
        <input className="cx-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. merchants, paragraphs-under-test" autoFocus data-testid="data-name" />
      </label>
      <label>
        format
        <Seg
          value={fmt}
          options={[
            ["txt", "text lines"],
            ["jsonl", "JSONL"],
            ["csv", "CSV"],
            ["tsv", "TSV"],
            ["json", "JSON"],
          ]}
          onChange={setFmt}
        />
      </label>
      <textarea className="cx-data-text small" placeholder="Paste data here (you can also do it later)" value={text} onChange={(e) => setText(e.target.value)} data-testid="new-data-text" />
    </Dialog>
  );
}

// ---------- card editors ----------

function useNode(pos: number) {
  const ed = activeEditor();
  const n = ed?.view.state.doc.nodeAt(pos);
  return { ed, n };
}

function RefEdit({ pos }: { pos: number }) {
  const s = useStore();
  const { ed, n } = useNode(pos);
  const v = currentVersion(s);
  const ref = n?.attrs.ref as string | undefined;
  const pin = (n?.attrs.flavor as string | null) ?? undefined;
  const { block } = ref ? resolveBlock(s.ws, ref, v?.flavor ?? "general", pin, s.project ?? undefined) : { block: undefined };
  const [body, setBody] = useState(block?.body ?? "");
  if (!ed || !n || n.type.name !== "use") return null;
  const variants = variantsOf(s.ws, ref!, s.project ?? undefined);
  const used = usages(s.ws, ref!);
  const changed = block && body !== block.body;
  return (
    <Dialog
      title={block ? `${block.type ? block.type + " › " : ""}${block.fn}` : `Missing: ${ref}`}
      wide
      testid="ref-edit"
      footer={
        <>
          {block && (
            <button className="cx-btn ghost" onClick={() => (closeModal(), useStore.setState({ view: { t: "block", key: block.key, flavor: block.flavor, file: block.file } }))}>
              Open in library
            </button>
          )}
          <span className="cx-spacer" />
          <Cancel />
          {block && (
            <button
              className="cx-btn"
              data-testid="ref-detach"
              onClick={() => {
                detachRef(pos, { kind: block.kind, body, fn: block.fn, front: block.front })(ed.view.state, ed.view.dispatch);
                closeModal();
              }}
              title="Replace the live reference with an editable copy that remembers where it came from"
            >
              Detach copy
            </button>
          )}
          {block && (
            <button
              className="cx-btn primary"
              disabled={!changed}
              data-testid="ref-update"
              onClick={async () => {
                await updateBlockBody(block.file, body);
                closeModal();
              }}
            >
              Update library{used.length > 1 ? ` (${used.length} versions)` : ""}
            </button>
          )}
        </>
      }
    >
      {block ? (
        <>
          <div className="cx-inline">
            <span className="cx-muted-text">variant</span>
            <select className="cx-select" value={pin ?? ""} onChange={(e) => setCardAttrs(pos, { flavor: e.target.value || null })(ed.view.state, ed.view.dispatch)} data-testid="ref-pin">
              <option value="">follow version flavor ({block.flavor})</option>
              {variants.map((x) => (
                <option key={x.flavor} value={x.flavor}>
                  pin: {x.flavor}
                </option>
              ))}
            </select>
            <span className="cx-spacer" />
            <span className="cx-muted-text">used in {used.map((u) => `${u.project}/${u.version}`).join(", ") || "nothing"}</span>
          </div>
          <textarea className="cx-input cx-ref-body" rows={block.kind === "section" ? 10 : 4} value={body} onChange={(e) => setBody(e.target.value)} data-testid="ref-body" />
          <p className="cx-fine">Editing here changes the shared library block for every version that uses it — or detach a local copy for just this version.</p>
        </>
      ) : (
        <p>This reference points at a block that doesn't exist. Delete the card or create the block.</p>
      )}
    </Dialog>
  );
}

function DataPipe({ pos }: { pos: number }) {
  const s = useStore();
  const { ed, n } = useNode(pos);
  const p = currentProject(s);
  const [source, setSource] = useState<string>(n?.attrs.source ?? "");
  const [pipe, setPipe] = useState<string>(n?.attrs.pipe ?? "");
  const [isStatic, setStatic] = useState<boolean>(!!n?.attrs.static);
  const src = p?.data.find((d) => d.name === source);
  const preview = useMemo(() => {
    if (!src) return null;
    return applyPipeline(dataItems(src).items, pipeFromString(pipe), { seed: 1 });
  }, [src, pipe]);
  const parseErr = pipe.trim() && pipeFromString(pipe).length === 0 ? "can't parse this pipeline" : null;
  if (!ed || !n) return null;
  return (
    <Dialog
      title="Data card"
      wide
      testid="data-pipe"
      footer={
        <>
          <Cancel />
          <button
            className="cx-btn primary"
            disabled={!!parseErr}
            data-testid="data-pipe-ok"
            onClick={() => {
              setCardAttrs(pos, { source, pipe: pipe.trim(), static: isStatic })(ed.view.state, ed.view.dispatch);
              closeModal();
            }}
          >
            Apply
          </button>
        </>
      }
    >
      <div className="cx-row2">
        <label>
          source
          <select className="cx-select" value={source} onChange={(e) => setSource(e.target.value)}>
            {p?.data.map((d) => (
              <option key={d.name}>{d.name}</option>
            ))}
          </select>
        </label>
        <label className="cx-check">
          <input type="checkbox" checked={isStatic} onChange={(e) => setStatic(e.target.checked)} /> static (same every run — counts toward the cacheable prefix)
        </label>
      </div>
      <label>
        transforms
        <input className="cx-input cx-mono" value={pipe} onChange={(e) => setPipe(e.target.value)} placeholder='shuffle(seed=1) | head(50) | template("{name}") | numbered' data-testid="pipe-input" />
        {parseErr && <span className="cx-field-err">{parseErr}</span>}
      </label>
      <div className="cx-transforms">
        {(["select", "fields", "format", "cleanup"] as const).map((g) => (
          <div key={g}>
            <span className="cx-type-label">{g}</span>
            {TRANSFORMS.filter((t) => t.group === g).map((t) => (
              <button key={t.name} className="cx-chip-btn" title={t.doc} onClick={() => setPipe((x) => (x.trim() ? `${x.trim()} | ${t.sig}` : t.sig))}>
                {t.name}
              </button>
            ))}
          </div>
        ))}
      </div>
      {src && <div className="cx-fine">fields: {dataItems(src).fields.join(", ") || "(text items)"} · use them as {"{field}"} in template()</div>}
      {preview && (
        <>
          <div className="cx-muted-text">
            {preview.count} of {dataItems(src!).items.length} items {preview.errors.length > 0 && <span className="cx-danger">· {preview.errors.join("; ")}</span>}
          </div>
          <pre className="cx-output cx-small" data-testid="pipe-preview">
            {preview.text.slice(0, 4000)}
          </pre>
        </>
      )}
    </Dialog>
  );
}

const DATE_FORMATS = ["dddd, MMMM D, YYYY", "YYYY-MM-DD", "YYYY-MM-DD HH:mm", "MMMM D", "h:mm A", "iso"];
const TZS = ["America/New_York", "America/Los_Angeles", "America/Chicago", "Europe/London", "Europe/Berlin", "Asia/Tokyo", "UTC"];

function Insertion({ pos }: { pos: number }) {
  const s = useStore();
  const { ed, n } = useNode(pos);
  const p = currentProject(s);
  const parse = (x: string, d: unknown) => {
    try {
      return JSON.parse(x);
    } catch {
      return d;
    }
  };
  const [fn] = useState<string>(n?.attrs.fn ?? "now");
  const [posArgs, setPos] = useState<unknown[]>(parse(n?.attrs.pos ?? "[]", []));
  const [args, setArgs] = useState<Record<string, unknown>>(parse(n?.attrs.args ?? "{}", {}));
  if (!ed || !n) return null;
  const vars = mergedVars(s.ws, p);
  const setArg = (k: string, v: unknown) => setArgs((a) => {
    const next = { ...a, [k]: v };
    if (v === undefined || v === "") delete next[k];
    return next;
  });
  const preview = evalInsertion(fn, posArgs as never, args as never, { now: new Date(), vars, seed: 1 }, "preview");
  const info = insertionInfo(fn);
  return (
    <Dialog
      title={`${info?.icon ?? ""} ${info?.label ?? fn}`}
      testid="insertion-dialog"
      footer={
        <>
          <button
            className="cx-btn ghost danger"
            onClick={() => {
              ed.view.dispatch(ed.view.state.tr.delete(pos, pos + 1));
              closeModal();
            }}
          >
            Remove
          </button>
          <span className="cx-spacer" />
          <Cancel />
          <button
            className="cx-btn primary"
            data-testid="insertion-ok"
            onClick={() => {
              setCardAttrs(pos, { pos: JSON.stringify(posArgs), args: JSON.stringify(args) })(ed.view.state, ed.view.dispatch);
              closeModal();
            }}
          >
            Apply
          </button>
        </>
      }
    >
      {fn === "now" && (
        <>
          <label>
            format
            <QuickPick value={String(args.format ?? "")} options={DATE_FORMATS} onChange={(v) => setArg("format", v)} testid="ins-format" />
            <span className="cx-fine">tokens: YYYY MMMM MMM MM DD D dddd ddd HH hh h mm ss A z, [literal]</span>
          </label>
          <label>
            timezone
            <QuickPick value={String(args.tz ?? "")} options={TZS} onChange={(v) => setArg("tz", v)} placeholder="local" />
          </label>
          <label>
            offset
            <input className="cx-input" value={String(args.offset ?? "")} onChange={(e) => setArg("offset", e.target.value)} placeholder="e.g. -1d (yesterday), +2h" />
          </label>
          <label className="cx-check">
            <input type="checkbox" checked={args.frozen !== undefined} onChange={(e) => setArg("frozen", e.target.checked ? new Date().toISOString() : undefined)} data-testid="ins-frozen" /> freeze to a fixed time (reproducible, cache-friendly)
          </label>
          {args.frozen !== undefined && <input className="cx-input" value={String(args.frozen)} onChange={(e) => setArg("frozen", e.target.value)} />}
        </>
      )}
      {fn === "var" && (
        <>
          <label>
            variable
            <QuickPick value={String(posArgs[0] ?? "")} options={Object.keys(vars)} onChange={(v) => setPos([v])} testid="ins-var" />
          </label>
          <label>
            default if unset
            <input className="cx-input" value={String(args.default ?? "")} onChange={(e) => setArg("default", e.target.value)} />
          </label>
          <p className="cx-fine">Set variables in Settings (workspace) or the project page.</p>
        </>
      )}
      {fn === "randint" && (
        <div className="cx-row2">
          <label>
            min
            <NumField value={Number(args.min ?? 1)} onCommit={(v) => setArg("min", v)} />
          </label>
          <label>
            max
            <NumField value={Number(args.max ?? 100)} onCommit={(v) => setArg("max", v)} />
          </label>
        </div>
      )}
      {fn === "pick" && (
        <label>
          options (one per line)
          <textarea className="cx-input" rows={4} value={((posArgs[0] as string[]) ?? []).join("\n")} onChange={(e) => setPos([e.target.value.split("\n")])} />
        </label>
      )}
      {(fn === "uuid" || fn === "randint" || fn === "pick") && (
        <label>
          seed (optional — makes it stable between runs)
          <input className="cx-input" value={String(args.seed ?? "")} onChange={(e) => setArg("seed", e.target.value === "" ? undefined : isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value))} />
        </label>
      )}
      <div className="cx-ins-preview">
        renders as: <b data-testid="ins-preview">{preview.text || "∅"}</b> {preview.error && <span className="cx-danger">{preview.error}</span>}
      </div>
    </Dialog>
  );
}

// ---------- settings ----------

const FONTS = ["EB Garamond", "Cormorant Garamond", "Libre Baskerville", "Source Serif 4", "Georgia", "Iowan Old Style", "Charter", "Inter"];
const MONOS = ["JetBrains Mono", "SF Mono", "Menlo", "Consolas"];

function EndpointEditor({ e, onChange, onDelete }: { e: Endpoint; onChange(e: Endpoint): void; onDelete(): void }) {
  const [key, setK] = useState(getKey(e.id));
  return (
    <div className="cx-card-panel" data-testid={`endpoint-${e.id}`}>
      <div className="cx-row2">
        <label>
          name
          <Field value={e.name} onCommit={(name) => onChange({ ...e, name })} />
        </label>
        <label>
          API style
          <Seg
            value={e.style}
            options={[
              ["chat", "/chat/completions"],
              ["completions", "/completions"],
            ]}
            onChange={(style) => onChange({ ...e, style })}
          />
        </label>
      </div>
      <label>
        base URL
        <Field value={e.baseUrl} onCommit={(baseUrl) => onChange({ ...e, baseUrl })} placeholder="http://localhost:1234/v1" testid="endpoint-url" />
      </label>
      <div className="cx-row2">
        <label>
          default model
          <Field value={e.defaultModel ?? ""} onCommit={(m) => onChange({ ...e, defaultModel: m || undefined })} />
        </label>
        <label>
          API key (kept in this browser only)
          <input
            className="cx-input"
            type="password"
            value={key}
            onChange={(x) => {
              setK(x.target.value);
              setKey(e.id, x.target.value);
            }}
            placeholder="none"
            autoComplete="off"
          />
        </label>
      </div>
      <label>
        headers
        <KeyValues value={e.headers} onChange={(headers) => onChange({ ...e, headers })} keyPlaceholder="header-name" />
      </label>
      <label>
        extra JSON body (merged into every request)
        <JsonField value={e.extraBody} onCommit={(extraBody) => onChange({ ...e, extraBody: extraBody as Record<string, unknown> })} rows={3} />
      </label>
      <button className="cx-btn small ghost danger" onClick={onDelete}>
        Remove endpoint
      </button>
    </div>
  );
}

function Settings({ tab: initial }: { tab?: string }) {
  const s = useStore();
  const [tab, setTab] = useState(initial ?? "appearance");
  const st = s.ws.settings;
  const setEndpoints = (endpoints: Endpoint[]) => patchWorkspace({ endpoints });
  return (
    <Dialog
      title="Settings"
      wide
      testid="settings"
      footer={
        <>
          <button className="cx-btn ghost" onClick={startTour} data-testid="replay-tutorial">
            Replay tutorial
          </button>
          <span className="cx-spacer" />
          <button className="cx-btn primary" onClick={closeModal}>
            Done
          </button>
        </>
      }
    >
      <div className="cx-drawer-tabs">
        {[
          ["appearance", "Appearance"],
          ["endpoints", "Endpoints"],
          ["variables", "Variables"],
          ["taxonomy", "Types & flavors"],
          ["workspace", "Workspace"],
        ].map(([t, l]) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)} data-testid={`settings-${t}`}>
            {l}
          </button>
        ))}
      </div>
      {tab === "appearance" && (
        <div className="cx-form">
          <label>
            page font
            <select className="cx-select" value={s.prefs.font} onChange={(e) => setPrefs({ font: e.target.value })} data-testid="pref-font">
              {FONTS.map((f) => (
                <option key={f} style={{ fontFamily: f }}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label>
            data / code font
            <select className="cx-select" value={s.prefs.mono} onChange={(e) => setPrefs({ mono: e.target.value })}>
              {MONOS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
          <div className="cx-row2">
            <label>
              size <input type="range" min={15} max={28} value={s.prefs.fontSize} onChange={(e) => setPrefs({ fontSize: Number(e.target.value) })} /> {s.prefs.fontSize}px
            </label>
            <label>
              line height <input type="range" min={1.2} max={2.1} step={0.05} value={s.prefs.lineHeight} onChange={(e) => setPrefs({ lineHeight: Number(e.target.value) })} /> {s.prefs.lineHeight.toFixed(2)}
            </label>
          </div>
          <label>
            page width <input type="range" min={520} max={1100} step={10} value={s.prefs.pageWidth} onChange={(e) => setPrefs({ pageWidth: Number(e.target.value) })} /> {s.prefs.pageWidth}px
          </label>
          <label>
            theme
            <Seg
              value={s.prefs.theme}
              options={[
                ["dark", "night"],
                ["light", "day"],
                ["system", "follow system"],
              ]}
              onChange={(theme) => setPrefs({ theme })}
              testid="pref-theme"
            />
          </label>
          <label className="cx-check">
            <input type="checkbox" checked={s.prefs.prefixTint} onChange={(e) => setPrefs({ prefixTint: e.target.checked })} /> tint the stable (cacheable) prefix
          </label>
          <label className="cx-check">
            <input type="checkbox" checked={s.prefs.gutter} onChange={(e) => setPrefs({ gutter: e.target.checked })} /> token counts in the margin
          </label>
          <label className="cx-check">
            <input type="checkbox" checked={s.prefs.showWhitespace} onChange={(e) => setPrefs({ showWhitespace: e.target.checked })} /> show whitespace in the rendered view
          </label>
        </div>
      )}
      {tab === "endpoints" && (
        <div className="cx-form">
          <p className="cx-fine">Any OpenAI-compatible server: LM Studio, llama-server, Ollama, vLLM, OpenRouter, OpenAI… The server must allow CORS from this page.</p>
          {st.endpoints.map((e, i) => (
            <EndpointEditor
              key={e.id}
              e={e}
              onChange={(ne) => setEndpoints(st.endpoints.map((x, j) => (j === i ? ne : x)))}
              onDelete={() => setEndpoints(st.endpoints.filter((_, j) => j !== i))}
            />
          ))}
          <button
            className="cx-btn"
            onClick={() => setEndpoints([...st.endpoints, { id: `ep${Date.now().toString(36)}`, name: "New endpoint", baseUrl: "http://localhost:1234/v1", style: "chat", headers: {}, extraBody: {} }])}
            data-testid="add-endpoint"
          >
            + Add endpoint
          </button>
        </div>
      )}
      {tab === "variables" && (
        <div className="cx-form">
          <p className="cx-fine">
            Workspace variables, available everywhere as <code>{'{{ var("name") }}'}</code>. A browser can't read your hostname, so set it here if you need it. Projects can override these.
          </p>
          <KeyValues value={st.vars} onChange={(vars) => patchWorkspace({ vars })} testid="workspace-vars" />
        </div>
      )}
      {tab === "taxonomy" && (
        <div className="cx-form">
          <label>
            block types (comma separated)
            <Field value={st.types.join(", ")} onCommit={(v) => patchWorkspace({ types: v.split(",").map((x) => x.trim()).filter(Boolean) })} />
          </label>
          <label>
            flavors (comma separated; “general” is the fallback)
            <Field value={st.flavors.join(", ")} onCommit={(v) => patchWorkspace({ flavors: [...new Set(["general", ...v.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)])] })} />
          </label>
        </div>
      )}
      {tab === "workspace" && (
        <div className="cx-form">
          <p>
            Open: <b>{s.vfs?.name}</b> ({s.vfs?.kind === "browser" ? "browser storage" : "folder on disk"})
          </p>
          <button
            className="cx-btn"
            onClick={async () => {
              closeModal();
              await forgetWorkspace();
              closeWorkspace();
            }}
          >
            Close workspace
          </button>
        </div>
      )}
    </Dialog>
  );
}

function Confirm({ m }: { m: Extract<Modal, { t: "confirm" }> }) {
  return (
    <Dialog
      title={m.title}
      testid="confirm"
      footer={
        <>
          <Cancel />
          <button
            className="cx-btn primary"
            onClick={() => {
              closeModal();
              m.onOk();
            }}
            data-testid="confirm-ok"
          >
            {m.ok}
          </button>
        </>
      }
    >
      <p>{m.body}</p>
    </Dialog>
  );
}

export function Modals() {
  const m = useStore((s) => s.modal);
  if (!m) return null;
  switch (m.t) {
    case "save-block":
      return <SaveBlock m={m} />;
    case "new-version":
      return <NewVersion fork={m.fork} />;
    case "version-settings":
      return <VersionSettings id={m.id} />;
    case "new-project":
      return <NewProject />;
    case "new-block":
      return <NewBlock kind={m.kind} />;
    case "new-data":
      return <NewData />;
    case "data-pipe":
      return <DataPipe pos={m.pos} />;
    case "insertion":
      return <Insertion pos={m.pos} />;
    case "ref-edit":
      return <RefEdit pos={m.pos} />;
    case "settings":
      return <Settings tab={m.tab} />;
    case "confirm":
      return <Confirm m={m} />;
  }
}

/** Open "save to library/project" for the current selection in the active editor. */
export function saveSelectionToLibrary(scope: "library" | "project" = "library", sectionPos?: number) {
  const ed = activeEditor();
  if (!ed) return;
  const st = ed.view.state;
  let nodes: Node[];
  if (sectionPos !== undefined) {
    const n = st.doc.nodeAt(sectionPos);
    nodes = n ? [nodeFromPM(n)] : [];
  } else nodes = selectedCards(st).map(nodeFromPM);
  if (!nodes.length) return;
  const one = nodes.length === 1 ? nodes[0] : null;
  let kind: "directive" | "section";
  let text: string;
  if (one && (one.k === "line" || one.k === "directive")) {
    kind = "directive";
    const { from, to, empty } = st.selection;
    text = empty || sectionPos !== undefined ? inlinePlainFmt(one) : st.doc.textBetween(from, to, "\n");
    if (!text.trim()) text = inlinePlainFmt(one);
  } else if (one && one.k === "section") {
    kind = "section";
    text = fmtBody([{ role: "user", children: one.children }]).trimEnd();
  } else {
    kind = "section";
    text = fmtBody([{ role: "user", children: nodes }]).trimEnd();
  }
  const sectionTitle = one?.k === "section" ? one.title : "";
  const pos = sectionPos;
  useStore.setState({
    modal: {
      t: "save-block",
      kind,
      scope,
      title: sectionTitle || undefined,
      text,
      onSaved: (key) => {
        const e = activeEditor();
        if (!e) return;
        if (pos !== undefined) {
          const n = e.view.state.doc.nodeAt(pos);
          if (n) e.view.dispatch(e.view.state.tr.replaceWith(pos, pos + n.nodeSize, e.view.state.schema.nodes.use.create({ ref: key })));
        } else replaceWithRef(key)(e.view.state, e.view.dispatch);
      },
    },
  });
}

const inlinePlainFmt = (n: Node) => (n.k === "line" || n.k === "directive" ? fmtBody([{ role: "user", children: [{ k: "line", content: n.content }] }]).trimEnd() : "");
