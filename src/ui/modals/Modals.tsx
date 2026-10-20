import { useMemo, useState, type ReactNode } from "react";
import { useStore, closeModal, openModal, currentProject, currentVersion, setPrefs, setKey, getKey, closeWorkspace, type Modal } from "../../state/store";
import { createVersion, updateVersionMeta, deleteVersion, createProject, saveBlock, createDataSource, patchWorkspace, updateBlockBody, nextVersionId } from "../../state/actions";
import { activeEditor } from "../../editor/active";
import { replaceWithRef, detachRef, setCardAttrs, selectedCards } from "../../editor/commands";
import { nodeFromPM, pipeFromString } from "../../editor/convert";
import { fmtBody, slug, type Node } from "../../core/doc";
import { resolveBlock, variantsOf, dataItems, usages, type Endpoint, type BlockKind, mergedVars } from "../../core/workspace";
import { applyPipeline, TRANSFORMS } from "../../core/pipeline";
import { evalInsertion, insertionInfo } from "../../core/insertions";
import { Field, KeyValues, JsonField, Seg, NumField, Choice, CheckRow, FieldRow } from "../widgets";
import { Dialog as UIDialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { forgetWorkspace } from "../../fs/persist";
import { startTour } from "../Tour";
import { VarCluster } from "../VarCluster";

function Dialog(p: { title: string; children: ReactNode; footer?: ReactNode; wide?: boolean; testid?: string }) {
  return (
    <UIDialog open onOpenChange={(o) => !o && closeModal()}>
      <DialogContent showCloseButton={false} className={cn("max-h-[86vh] overflow-y-auto", p.wide ? "sm:max-w-[720px]" : "sm:max-w-[460px]")} data-testid={p.testid ?? "dialog"} aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{p.title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {p.children}
        </div>
        {p.footer && <DialogFooter className="mt-1 items-center sm:justify-end">{p.footer}</DialogFooter>}
      </DialogContent>
    </UIDialog>
  );
}

const Cancel = () => (
  <Button variant="ghost" onClick={closeModal}>
    Cancel
  </Button>
);

/** Quick-pick chips plus free text. */
function QuickPick(p: { value: string; options: string[]; onChange(v: string): void; placeholder?: string; testid?: string }) {
  return (
    <div className="flex flex-col gap-1.5 not-italic">
      <Input value={p.value} placeholder={p.placeholder} onChange={(e) => p.onChange(e.target.value)} data-testid={p.testid} />
      <div className="flex flex-wrap gap-1">
        {p.options.map((o) => (
          <Button key={o} type="button" variant="outline" size="xs" className={cn("font-sans text-[11.5px]", o === p.value && "border-gold/60 bg-gold-soft text-gold")} onClick={() => p.onChange(o)}>
            {o}
          </Button>
        ))}
      </div>
    </div>
  );
}

// ---------- save to library ----------

function SaveBlock({ m }: { m: Extract<Modal, { t: "save-block" }> }) {
  const s = useStore();
  const v = currentVersion(s);
  // a single line saves as a directive; several cards (or a section) save as a section
  const kind = m.kind;
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
      title={`Save ${kind} to ${scope}`}
      testid="save-block"
      footer={
        <>
          <Cancel />
          <Button disabled={!can} onClick={save} data-testid="save-block-ok">
            Save
          </Button>
        </>
      }
    >
      <p className="font-serif text-[14px] text-ink-3 italic" data-testid="save-kind">
        {kind === "directive" ? "Saving this line as a directive." : "Saving these cards together as a section."}
      </p>
      <FieldRow label="type">
        <QuickPick value={type} options={types} onChange={setType} placeholder="e.g. safety, tone, task instruction" testid="save-type" />
      </FieldRow>
      <FieldRow label="function">
        <QuickPick value={fn} options={fns} onChange={setFn} placeholder="e.g. Anti Prompt Injection" testid="save-fn" />
        {fns.includes(fn) && <span className="font-serif text-[14px] text-ink-3 italic">Adds a {flavor} variant to the existing “{fn}”.</span>}
      </FieldRow>
      <FieldRow label="flavor">
        <QuickPick value={flavor} options={s.ws.settings.flavors} onChange={(f) => setFlavor(slug(f) === "untitled" ? "general" : f.toLowerCase())} testid="save-flavor" />
      </FieldRow>
      <FieldRow label="scope">
        <Seg
          value={scope}
          options={[
            ["library", "Library (all projects)"],
            ["project", "This project"],
          ]}
          onChange={setScope}
        />
      </FieldRow>
      <CheckRow checked={link} onChange={setLink}>
        replace the selection with a live reference
      </CheckRow>
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
          <Button
            disabled={!id.trim() || taken}
            onClick={async () => {
              closeModal();
              await createVersion({ id, subtitle, flavor, fork: from || undefined });
            }}
            data-testid="new-version-ok"
          >
            Create
          </Button>
        </>
      }
    >
      <FieldRow label="name">
        <Input value={id} onChange={(e) => setId(e.target.value)} data-testid="version-id" />
        {taken && <span className="text-[11.5px] text-danger not-italic">already exists</span>}
      </FieldRow>
      <FieldRow label="subtitle — the philosophy of this approach">
        <Input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="e.g. few-shot heavy, XML everything, terse" data-testid="version-subtitle" autoFocus />
      </FieldRow>
      <FieldRow label="start from">
        <Choice value={from} onChange={setFrom} options={[["", "a blank page"], ...(p?.versions ?? []).map((v) => [v.id, `a copy of ${v.title}${v.subtitle ? ` · ${v.subtitle}` : ""}`] as [string, string])]} testid="version-from" />
      </FieldRow>
      <FieldRow label="flavor">
        <Choice value={flavor} onChange={setFlavor} options={s.ws.settings.flavors} />
      </FieldRow>
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
              <Button
                variant="destructive"
                onClick={() => {
                  closeModal();
                  deleteVersion(v.id);
                }}
              >
                Really delete {v.id}
              </Button>
            ) : (
              <Button variant="ghost" className="text-danger" onClick={() => setConfirmDel(true)}>
                Delete…
              </Button>
            ))}
          <span className="flex-1" />
          <Cancel />
          <Button
            disabled={!name.trim() || taken}
            onClick={() => {
              closeModal();
              updateVersionMeta(v.id, { id: name !== v.id ? name : undefined, subtitle, flavor });
            }}
            data-testid="version-settings-ok"
          >
            Save
          </Button>
        </>
      }
    >
      <FieldRow label="name">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
        {taken && <span className="text-[11.5px] text-danger not-italic">already exists</span>}
      </FieldRow>
      <FieldRow label="subtitle">
        <Input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} autoFocus />
      </FieldRow>
      <FieldRow label="flavor">
        <Choice value={flavor} onChange={setFlavor} options={[...new Set([...s.ws.settings.flavors, v.flavor])]} />
      </FieldRow>
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
          <Button
            disabled={!name.trim() || exists}
            onClick={() => {
              closeModal();
              createProject(name, desc);
            }}
            data-testid="new-project-ok"
          >
            Create
          </Button>
        </>
      }
    >
      <FieldRow label="name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. sentiment-triage" autoFocus data-testid="project-name" />
        {name && <span className="font-serif text-[14px] text-ink-3 italic">folder: projects/{slug(name)}</span>}
        {exists && <span className="text-[11.5px] text-danger not-italic">already exists</span>}
      </FieldRow>
      <FieldRow label="what is it for?">
        <Textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />
      </FieldRow>
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
          <Button
            disabled={!fn.trim()}
            data-testid="new-block-ok"
            onClick={async () => {
              const r = await saveBlock({ kind, type: named ? "" : type.trim(), fn: fn.trim(), flavor, scope, body: BLOCK_DEFAULT_BODY[kind], extraFront: kind === "tool" || kind === "schema" ? { name: slug(fn).replace(/-/g, "_") } : kind === "section" ? { title: fn.trim() } : undefined });
              closeModal();
              useStore.setState({ view: { t: "block", key: r.key, flavor, file: r.file } });
            }}
          >
            Create
          </Button>
        </>
      }
    >
      {!named && (
        <FieldRow label="type">
          <QuickPick value={type} options={s.ws.settings.types} onChange={setType} placeholder="e.g. safety" testid="new-block-type" />
        </FieldRow>
      )}
      <FieldRow label={named ? "name" : "function"}>
        <Input value={fn} onChange={(e) => setFn(e.target.value)} autoFocus data-testid="new-block-fn" />
      </FieldRow>
      {!named && (
        <FieldRow label="flavor">
          <QuickPick value={flavor} options={s.ws.settings.flavors} onChange={(f) => setFlavor(f.toLowerCase())} />
        </FieldRow>
      )}
      <FieldRow label="scope">
        <Seg
          value={scope}
          options={[
            ["library", "Library"],
            ["project", "This project"],
          ]}
          onChange={setScope}
        />
      </FieldRow>
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
          <Button
            disabled={!slug(name) || slug(name) === "untitled"}
            data-testid="new-data-ok"
            onClick={async () => {
              closeModal();
              await createDataSource(name, fmt, text);
            }}
          >
            Create
          </Button>
        </>
      }
    >
      <FieldRow label="name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. merchants, paragraphs-under-test" autoFocus data-testid="data-name" />
      </FieldRow>
      <FieldRow label="format">
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
      </FieldRow>
      <Textarea className="min-h-[200px] font-mono text-[12.5px]" placeholder="Paste data here (you can also do it later)" value={text} onChange={(e) => setText(e.target.value)} data-testid="new-data-text" />
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
            <Button variant="ghost" onClick={() => (closeModal(), useStore.setState({ view: { t: "block", key: block.key, flavor: block.flavor, file: block.file } }))}>
              Open in library
            </Button>
          )}
          <span className="flex-1" />
          <Cancel />
          {block && (
            <Button
              variant="outline"
              data-testid="ref-detach"
              onClick={() => {
                detachRef(pos, { kind: block.kind, body, fn: block.fn, front: block.front })(ed.view.state, ed.view.dispatch);
                closeModal();
              }}
              title="Replace the live reference with an editable copy that remembers where it came from"
            >
              Detach copy
            </Button>
          )}
          {block && (
            <Button
              disabled={!changed}
              data-testid="ref-update"
              onClick={async () => {
                await updateBlockBody(block.file, body);
                closeModal();
              }}
            >
              Update library{used.length > 1 ? ` (${used.length} versions)` : ""}
            </Button>
          )}
        </>
      }
    >
      {block ? (
        <>
          <div className="flex items-center gap-2 not-italic">
            <span className="text-ink-3">variant</span>
            <Choice
              value={pin ?? ""}
              onChange={(f) => setCardAttrs(pos, { flavor: f || null })(ed.view.state, ed.view.dispatch)}
              options={[["", `follow version flavor (${block.flavor})`], ...variants.map((x) => [x.flavor, `pin: ${x.flavor}`] as [string, string])]}
              testid="ref-pin"
            />
            <span className="flex-1" />
            <span className="text-ink-3">used in {used.map((u) => `${u.project}/${u.version}`).join(", ") || "nothing"}</span>
          </div>
          <Textarea className="cx-ref-body font-serif text-[17px] leading-normal" rows={block.kind === "section" ? 10 : 4} value={body} onChange={(e) => setBody(e.target.value)} data-testid="ref-body" />
          <p className="font-serif text-[14px] text-ink-3 italic">Editing here changes the shared library block for every version that uses it — or detach a local copy for just this version.</p>
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
          <Button
            disabled={!!parseErr}
            data-testid="data-pipe-ok"
            onClick={() => {
              setCardAttrs(pos, { source, pipe: pipe.trim(), static: isStatic })(ed.view.state, ed.view.dispatch);
              closeModal();
            }}
          >
            Apply
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        <FieldRow label="source">
          <Choice value={source} onChange={setSource} options={(p?.data ?? []).map((d) => d.name)} className="w-full" />
        </FieldRow>
        <CheckRow checked={isStatic} onChange={setStatic}>
          static — same every run, counts toward the cacheable prefix
        </CheckRow>
      </div>
      <FieldRow label="transforms">
        <Input className="font-mono text-[12px]" value={pipe} onChange={(e) => setPipe(e.target.value)} placeholder='shuffle(seed=1) | head(50) | template("{name}") | numbered' data-testid="pipe-input" />
        {parseErr && <span className="text-[11.5px] text-danger not-italic">{parseErr}</span>}
      </FieldRow>
      <div className="flex flex-col gap-0.5">
        {(["select", "fields", "format", "cleanup"] as const).map((g) => (
          <div key={g}>
            <span className="inline-block w-[60px] font-serif text-[13px] text-ink-3 italic">{g}</span>
            {TRANSFORMS.filter((t) => t.group === g).map((t) => (
              <Button key={t.name} type="button" variant="outline" size="xs" className="m-0.5 font-sans text-[11.5px]" title={t.doc} onClick={() => setPipe((x) => (x.trim() ? `${x.trim()} | ${t.sig}` : t.sig))}>
                {t.name}
              </Button>
            ))}
          </div>
        ))}
      </div>
      {src && <div className="font-serif text-[14px] text-ink-3 italic">fields: {dataItems(src).fields.join(", ") || "(text items)"} · use them as {"{field}"} in template()</div>}
      {preview && (
        <>
          <div className="text-ink-3">
            {preview.count} of {dataItems(src!).items.length} items {preview.errors.length > 0 && <span className="text-danger">· {preview.errors.join("; ")}</span>}
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
      title={fn === "var" ? "Insert a variable" : `${info?.icon ?? ""} ${info?.label ?? fn}`}
      wide={fn === "var" && Object.keys(mergedVars(s.ws, currentProject(s))).length > 6}
      testid="insertion-dialog"
      footer={
        <>
          <Button
            variant="ghost"
            className="text-danger"
            onClick={() => {
              ed.view.dispatch(ed.view.state.tr.delete(pos, pos + 1));
              closeModal();
            }}
          >
            Remove
          </Button>
          <span className="flex-1" />
          <Cancel />
          {fn !== "var" && (<Button
            data-testid="insertion-ok"
            onClick={() => {
              setCardAttrs(pos, { pos: JSON.stringify(posArgs), args: JSON.stringify(args) })(ed.view.state, ed.view.dispatch);
              closeModal();
            }}
          >
            Apply
          </Button>)}
        </>
      }
    >
      {fn === "now" && (
        <>
          <FieldRow label="format">
            <QuickPick value={String(args.format ?? "")} options={DATE_FORMATS} onChange={(v) => setArg("format", v)} testid="ins-format" />
            <span className="font-serif text-[14px] text-ink-3 italic">tokens: YYYY MMMM MMM MM DD D dddd ddd HH hh h mm ss A z, [literal]</span>
          </FieldRow>
          <FieldRow label="timezone">
            <QuickPick value={String(args.tz ?? "")} options={TZS} onChange={(v) => setArg("tz", v)} placeholder="local" />
          </FieldRow>
          <FieldRow label="offset">
            <Input value={String(args.offset ?? "")} onChange={(e) => setArg("offset", e.target.value)} placeholder="e.g. -1d (yesterday), +2h" />
          </FieldRow>
          <CheckRow checked={args.frozen !== undefined} onChange={(c) => setArg("frozen", c ? new Date().toISOString() : undefined)} testid="ins-frozen">
            freeze to a fixed time (reproducible, cache-friendly)
          </CheckRow>
          {args.frozen !== undefined && <Input value={String(args.frozen)} onChange={(e) => setArg("frozen", e.target.value)} />}
        </>
      )}
      {fn === "var" && (
        <VarCluster
          vars={Object.entries(vars).map(([name, value]) => ({ name, value, scope: p?.settings.vars?.[name] !== undefined ? "project" : "workspace" }))}
          value={String(posArgs[0] ?? "")}
          onPick={(name) => {
            setCardAttrs(pos, { pos: JSON.stringify([name]), args: "{}" })(ed.view.state, ed.view.dispatch);
            closeModal();
          }}
          onAdd={() => openModal({ t: "settings", tab: "variables" })}
        />
      )}
      {fn === "randint" && (
        <div className="grid grid-cols-2 gap-2">
          <FieldRow label="min">
            <NumField value={Number(args.min ?? 1)} onCommit={(v) => setArg("min", v)} />
          </FieldRow>
          <FieldRow label="max">
            <NumField value={Number(args.max ?? 100)} onCommit={(v) => setArg("max", v)} />
          </FieldRow>
        </div>
      )}
      {fn === "pick" && (
        <FieldRow label="options (one per line)">
          <Textarea rows={4} value={((posArgs[0] as string[]) ?? []).join("\n")} onChange={(e) => setPos([e.target.value.split("\n")])} />
        </FieldRow>
      )}
      {(fn === "uuid" || fn === "randint" || fn === "pick") && (
        <FieldRow label="seed (optional — makes it stable between runs)">
          <Input value={String(args.seed ?? "")} onChange={(e) => setArg("seed", e.target.value === "" ? undefined : isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value))} />
        </FieldRow>
      )}
      {fn !== "var" && <div className="rounded-lg bg-paper-2 px-2.5 py-2 text-[12.5px]">
        renders as: <b data-testid="ins-preview">{preview.text || "∅"}</b> {preview.error && <span className="text-danger">{preview.error}</span>}
      </div>}
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
      <div className="grid grid-cols-2 gap-2">
        <FieldRow label="name">
          <Field value={e.name} onCommit={(name) => onChange({ ...e, name })} />
        </FieldRow>
        <FieldRow label="API style">
          <Seg
            value={e.style}
            options={[
              ["chat", "/chat/completions"],
              ["completions", "/completions"],
            ]}
            onChange={(style) => onChange({ ...e, style })}
          />
        </FieldRow>
      </div>
      <FieldRow label="base URL">
        <Field value={e.baseUrl} onCommit={(baseUrl) => onChange({ ...e, baseUrl })} placeholder="http://localhost:1234/v1" testid="endpoint-url" />
      </FieldRow>
      <div className="grid grid-cols-2 gap-2">
        <FieldRow label="default model">
          <Field value={e.defaultModel ?? ""} onCommit={(m) => onChange({ ...e, defaultModel: m || undefined })} />
        </FieldRow>
        <FieldRow label="API key (kept in this browser only)">
          <Input
            type="password"
            value={key}
            onChange={(x) => {
              setK(x.target.value);
              setKey(e.id, x.target.value);
            }}
            placeholder="none"
            autoComplete="off"
          />
        </FieldRow>
      </div>
      <FieldRow label="headers">
        <KeyValues value={e.headers} onChange={(headers) => onChange({ ...e, headers })} keyPlaceholder="header-name" />
      </FieldRow>
      <FieldRow label="extra JSON body (merged into every request)">
        <JsonField value={e.extraBody} onCommit={(extraBody) => onChange({ ...e, extraBody: extraBody as Record<string, unknown> })} rows={3} />
      </FieldRow>
      <Button variant="ghost" size="sm" className="text-danger" onClick={onDelete}>
        Remove endpoint
      </Button>
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
          <Button variant="ghost" onClick={startTour} data-testid="replay-tutorial">
            Replay tutorial
          </Button>
          <span className="flex-1" />
          <Button onClick={closeModal}>
            Done
          </Button>
        </>
      }
    >
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto flex-wrap gap-1 bg-transparent p-0">
        {[
          ["appearance", "Appearance"],
          ["endpoints", "Endpoints"],
          ["variables", "Variables"],
          ["taxonomy", "Types & flavors"],
          ["workspace", "Workspace"],
        ].map(([t, l]) => (
          <TabsTrigger key={t} value={t} className="h-8 flex-none" data-testid={`settings-${t}`}>
            {l}
          </TabsTrigger>
        ))}
        </TabsList>
      </Tabs>
      {tab === "appearance" && (
        <div className="flex flex-col gap-3">
          <FieldRow label="page font">
            <Choice value={s.prefs.font} onChange={(f) => setPrefs({ font: f })} options={FONTS.map((f) => [f, <span style={{ fontFamily: f }}>{f}</span>] as [string, ReactNode])} testid="pref-font" />
          </FieldRow>
          <FieldRow label="data / code font">
            <Choice value={s.prefs.mono} onChange={(f) => setPrefs({ mono: f })} options={MONOS} />
          </FieldRow>
          <div className="grid grid-cols-2 gap-2">
            <FieldRow label={`size · ${s.prefs.fontSize}px`}>
              <Slider className="my-2" min={15} max={28} step={1} value={[s.prefs.fontSize]} onValueChange={([v]) => setPrefs({ fontSize: v })} />
            </FieldRow>
            <FieldRow label={`line height · ${s.prefs.lineHeight.toFixed(2)}`}>
              <Slider className="my-2" min={1.2} max={2.1} step={0.05} value={[s.prefs.lineHeight]} onValueChange={([v]) => setPrefs({ lineHeight: v })} />
            </FieldRow>
          </div>
          <FieldRow label="page width · {s.prefs.pageWidth}px">
            <Slider className="my-2" min={520} max={1100} step={10} value={[s.prefs.pageWidth]} onValueChange={([v]) => setPrefs({ pageWidth: v })} />
          </FieldRow>
          <FieldRow label="theme">
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
          </FieldRow>
          <CheckRow checked={s.prefs.prefixTint} onChange={(c) => setPrefs({ prefixTint: c })}>
            tint the stable (cacheable) prefix
          </CheckRow>
          <CheckRow checked={s.prefs.gutter} onChange={(c) => setPrefs({ gutter: c })}>
            token counts in the margin
          </CheckRow>
          <CheckRow checked={s.prefs.showWhitespace} onChange={(c) => setPrefs({ showWhitespace: c })}>
            show whitespace in the rendered view
          </CheckRow>
        </div>
      )}
      {tab === "endpoints" && (
        <div className="flex flex-col gap-3">
          <p className="font-serif text-[14px] text-ink-3 italic">Any OpenAI-compatible server: LM Studio, llama-server, Ollama, vLLM, OpenRouter, OpenAI… The server must allow CORS from this page.</p>
          {st.endpoints.map((e, i) => (
            <EndpointEditor
              key={e.id}
              e={e}
              onChange={(ne) => setEndpoints(st.endpoints.map((x, j) => (j === i ? ne : x)))}
              onDelete={() => setEndpoints(st.endpoints.filter((_, j) => j !== i))}
            />
          ))}
          <Button
            variant="outline"
            onClick={() => setEndpoints([...st.endpoints, { id: `ep${Date.now().toString(36)}`, name: "New endpoint", baseUrl: "http://localhost:1234/v1", style: "chat", headers: {}, extraBody: {} }])}
            data-testid="add-endpoint"
          >
            + Add endpoint
          </Button>
        </div>
      )}
      {tab === "variables" && (
        <div className="flex flex-col gap-3">
          <p className="font-serif text-[14px] text-ink-3 italic">
            Workspace variables, available everywhere as <code>{'{{ var("name") }}'}</code>. A browser can't read your hostname, so set it here if you need it. Projects can override these.
          </p>
          <KeyValues value={st.vars} onChange={(vars) => patchWorkspace({ vars })} testid="workspace-vars" />
        </div>
      )}
      {tab === "taxonomy" && (
        <div className="flex flex-col gap-3">
          <FieldRow label="block types (comma separated)">
            <Field value={st.types.join(", ")} onCommit={(v) => patchWorkspace({ types: v.split(",").map((x) => x.trim()).filter(Boolean) })} />
          </FieldRow>
          <FieldRow label="flavors (comma separated; “general” is the fallback)">
            <Field value={st.flavors.join(", ")} onCommit={(v) => patchWorkspace({ flavors: [...new Set(["general", ...v.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)])] })} />
          </FieldRow>
        </div>
      )}
      {tab === "workspace" && (
        <div className="flex flex-col gap-3">
          <p>
            Open: <b>{s.vfs?.name}</b> ({s.vfs?.kind === "browser" ? "browser storage" : "folder on disk"})
          </p>
          <Button
            variant="outline"
            onClick={async () => {
              closeModal();
              await forgetWorkspace();
              closeWorkspace();
            }}
          >
            Close workspace
          </Button>
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
          <Button
            onClick={() => {
              closeModal();
              m.onOk();
            }}
            data-testid="confirm-ok"
          >
            {m.ok}
          </Button>
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
