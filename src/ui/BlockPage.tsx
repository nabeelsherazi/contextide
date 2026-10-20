import { useState, useEffect } from "react";
import { Trash2 } from "lucide-react";
import { useStore, setVersion, openModal, removeFile, currentProject } from "../state/store";
import { variantsOf, usages, extractJson } from "../core/workspace";
import { Editor } from "./Editor";
import { Field, Seg, Choice, FieldRow, Hint } from "./widgets";
import { updateBlockBody, updateBlockFront, addFlavorVariant } from "../state/actions";
import { splitFront } from "../core/doc";
import { digest, DEFAULT_DIGEST_HEADER } from "../core/digest";
import { KIND_ICON } from "./items";
import { PageHeader } from "./PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

function JsonBody(p: { file: string; body: string; kind: "tool" | "schema"; header: string }) {
  const src = (/```(?:json)?\s*\n([\s\S]*?)\n```/.exec(p.body)?.[1] ?? p.body).trim();
  const [t, setT] = useState(src);
  useEffect(() => setT(src), [p.file]); // eslint-disable-line react-hooks/exhaustive-deps
  const parsed = extractJson("```json\n" + t + "\n```");
  return (
    <div className="max-w-[var(--page-width)]">
      <Textarea
        className="cx-code min-h-[300px] p-5 font-mono text-[12.5px] leading-relaxed"
        rows={18}
        spellCheck={false}
        value={t}
        data-testid="json-body"
        onChange={(e) => setT(e.target.value)}
        onBlur={() => {
          if (!extractJson("```json\n" + t + "\n```").error) updateBlockBody(p.file, "```json\n" + t.trim() + "\n```");
        }}
      />
      {parsed.error ? <div className="mt-1 text-[11.5px] text-danger">{parsed.error}</div> : <Hint>valid JSON · saved on blur</Hint>}
      {p.kind === "schema" && !parsed.error && (
        <>
          <h4 className="mt-[18px] mb-1.5 font-serif text-[18px] font-normal">Digest — what local models read when the mode includes “digest”</h4>
          <pre className="cx-r-json">{digest(parsed.value, p.header)}</pre>
        </>
      )}
    </div>
  );
}

export function BlockPage() {
  const s = useStore();
  if (s.view.t !== "block") return null;
  const { key, file } = s.view;
  const b = s.ws.blocks.find((x) => x.file === file) ?? variantsOf(s.ws, key, s.project ?? undefined)[0];
  if (!b) return <Hint>That block no longer exists.</Hint>;
  const variants = variantsOf(s.ws, key, s.project ?? undefined);
  const used = usages(s.ws, key);
  const missing = s.ws.settings.flavors.filter((f) => !variants.some((v) => v.flavor === f));
  const text = s.files.get(b.file) ?? "";
  const { body } = splitFront(text);
  const p = currentProject(s);
  const open = (f: string, flavor: string) => useStore.setState({ view: { t: "block", key, flavor, file: f } });
  return (
    <div data-testid="block-page">
      <PageHeader
        kind={`${KIND_ICON[b.kind]} ${b.kind}${b.type ? ` · ${b.type}` : ""}`}
        title={b.fn}
        right={<Badge variant="outline">{b.scope === "project" ? `project: ${b.project}` : "library"}</Badge>}
      />
      <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="variant-tabs">
        <Tabs value={b.file} onValueChange={(f) => open(f, variants.find((v) => v.file === f)?.flavor ?? "general")}>
          <TabsList className="h-8 bg-transparent p-0">
            {variants.map((v) => (
              <TabsTrigger key={v.file} value={v.file} className="h-7 flex-none text-[15px]">
                {v.flavor}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {missing.length > 0 && (
          <Choice
            value=""
            placeholder="+ flavor variant…"
            onChange={async (f) => {
              if (!f) return;
              const to = await addFlavorVariant(b.file, f);
              if (to) open(to, f);
            }}
            options={missing}
            testid="add-variant"
          />
        )}
      </div>
      <div className="mb-3.5 flex max-w-[var(--page-width)] flex-wrap items-end gap-x-4 gap-y-2.5">
        <FieldRow label="type" className="min-w-[150px]">
          <Field value={b.type} list="cx-types" onCommit={(v) => updateBlockFront(b.file, { type: v })} />
        </FieldRow>
        <FieldRow label="function" className="min-w-[200px]">
          <Field value={b.fn} onCommit={(v) => updateBlockFront(b.file, { function: v })} testid="block-fn" />
        </FieldRow>
        {b.kind === "section" && (
          <>
            <FieldRow label="title" className="min-w-[150px]">
              <Field value={String(b.front.title ?? b.fn)} onCommit={(v) => updateBlockFront(b.file, { title: v })} />
            </FieldRow>
            <FieldRow label="frame">
              <Seg
                value={String(b.front.frame ?? "auto")}
                options={[
                  ["auto", "auto"],
                  ["md", "## md"],
                  ["xml", "<xml>"],
                  ["none", "none"],
                ]}
                onChange={(v) => updateBlockFront(b.file, { frame: v === "auto" ? undefined : v })}
              />
            </FieldRow>
            <FieldRow label="list">
              <Seg
                value={String(b.front.list ?? "plain")}
                options={[
                  ["plain", "plain"],
                  ["bullets", "- bullets"],
                  ["numbered", "1. numbered"],
                ]}
                onChange={(v) => updateBlockFront(b.file, { list: v === "plain" ? undefined : v })}
              />
            </FieldRow>
          </>
        )}
        {(b.kind === "tool" || b.kind === "schema") && (
          <FieldRow label="name" className="min-w-[150px]">
            <Field value={String(b.front.name ?? b.path)} onCommit={(v) => updateBlockFront(b.file, { name: v })} />
          </FieldRow>
        )}
        {b.kind === "tool" && (
          <FieldRow label="description" className="min-w-[260px] flex-1">
            <Field value={String(b.front.description ?? "")} onCommit={(v) => updateBlockFront(b.file, { description: v })} />
          </FieldRow>
        )}
        {b.kind === "schema" && (
          <>
            <FieldRow label="strict">
              <Seg
                value={b.front.strict === false ? "off" : "on"}
                options={[
                  ["on", "on"],
                  ["off", "off"],
                ]}
                onChange={(v) => updateBlockFront(b.file, { strict: v === "on" })}
              />
            </FieldRow>
            <FieldRow label="digest header" className="min-w-[260px] flex-1">
              <Field value={String(b.front.digestHeader ?? "")} placeholder={DEFAULT_DIGEST_HEADER} onCommit={(v) => updateBlockFront(b.file, { digestHeader: v })} />
            </FieldRow>
          </>
        )}
        <datalist id="cx-types">
          {s.ws.settings.types.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </div>
      {b.kind === "tool" || b.kind === "schema" ? (
        <JsonBody file={b.file} body={body} kind={b.kind} header={String(b.front.digestHeader ?? DEFAULT_DIGEST_HEADER)} />
      ) : (
        <div className="cx-canvas cx-canvas-block">
          <Editor key={b.file} docKey={b.file} text={body} mode="block" flavor={b.flavor} onSave={(t) => updateBlockBody(b.file, t)} />
        </div>
      )}
      <footer className="mt-[18px] flex max-w-[var(--page-width)] items-center justify-between gap-2.5 text-[12px] text-ink-2">
        <div className="flex flex-wrap items-center gap-1">
          {used.length ? (
            <>
              Used in
              {used.map((u, i) => (
                <Button
                  key={i}
                  variant="link"
                  onClick={() => {
                    if (u.project !== p?.name) useStore.setState({ project: u.project });
                    setVersion(u.version);
                  }}
                >
                  {u.project}/{u.version}
                </Button>
              ))}
            </>
          ) : (
            <Hint className="my-0">Not used in any version yet — drag it onto a page.</Hint>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-danger"
          onClick={() =>
            openModal({
              t: "confirm",
              title: `Delete the ${b.flavor} variant of “${b.fn}”?`,
              body: used.length ? `It's used in ${used.length} version(s); those references will fall back to another variant or break.` : "This deletes the file.",
              ok: "Delete",
              onOk: () => {
                removeFile(b.file);
                useStore.setState({ view: { t: "version" } });
              },
            })
          }
        >
          <Trash2 className="size-3.5" /> Delete variant
        </Button>
      </footer>
    </div>
  );
}
