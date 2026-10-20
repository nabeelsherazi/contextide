import { useStore, setVersion, openModal, removeFile, currentProject } from "../state/store";
import { variantsOf, usages, extractJson } from "../core/workspace";
import { Editor } from "./Editor";
import { Field, Seg } from "./widgets";
import { updateBlockBody, updateBlockFront, addFlavorVariant } from "../state/actions";
import { splitFront } from "../core/doc";
import { digest, DEFAULT_DIGEST_HEADER } from "../core/digest";
import { KIND_ICON } from "./items";
import { useState, useEffect } from "react";

function JsonBody(p: { file: string; body: string; kind: "tool" | "schema"; header: string }) {
  const src = (/```(?:json)?\s*\n([\s\S]*?)\n```/.exec(p.body)?.[1] ?? p.body).trim();
  const [t, setT] = useState(src);
  useEffect(() => setT(src), [p.file]); // eslint-disable-line react-hooks/exhaustive-deps
  const parsed = extractJson("```json\n" + t + "\n```");
  return (
    <div className="cx-json-body">
      <textarea
        className="cx-input cx-mono cx-code"
        rows={18}
        spellCheck={false}
        value={t}
        data-testid="json-body"
        onChange={(e) => setT(e.target.value)}
        onBlur={() => {
          if (!extractJson("```json\n" + t + "\n```").error) updateBlockBody(p.file, "```json\n" + t.trim() + "\n```");
        }}
      />
      {parsed.error ? <div className="cx-field-err">{parsed.error}</div> : <div className="cx-muted-text">valid JSON · saved on blur</div>}
      {p.kind === "schema" && !parsed.error && (
        <>
          <h4>Digest (what local models read when mode includes “digest”)</h4>
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
  if (!b) return <div className="cx-empty-page">That block no longer exists.</div>;
  const variants = variantsOf(s.ws, key, s.project ?? undefined);
  const used = usages(s.ws, key);
  const missing = s.ws.settings.flavors.filter((f) => !variants.some((v) => v.flavor === f));
  const text = s.files.get(b.file) ?? "";
  const { body } = splitFront(text);
  const back = () => useStore.setState({ view: { t: "version" } });
  const p = currentProject(s);
  return (
    <div className="cx-blockpage" data-testid="block-page">
      <header className="cx-page-head">
        <button className="cx-btn small ghost" onClick={back} data-testid="back">
          ← {s.version ?? "back"}
        </button>
        <span className="cx-page-title static">
          <span className="cx-page-kind">
            {KIND_ICON[b.kind]} {b.kind}
            {b.type ? ` · ${b.type}` : ""}
          </span>
          <span className="cx-page-id">{b.fn}</span>
        </span>
        <span className="cx-badge">{b.scope === "project" ? `project: ${b.project}` : "library"}</span>
      </header>
      <div className="cx-variant-tabs" data-testid="variant-tabs">
        {variants.map((v) => (
          <button key={v.file} className={`cx-tab${v.file === b.file ? " active" : ""}`} onClick={() => useStore.setState({ view: { t: "block", key, flavor: v.flavor, file: v.file } })}>
            {v.flavor}
          </button>
        ))}
        {missing.length > 0 && (
          <select
            className="cx-select"
            value=""
            data-testid="add-variant"
            onChange={async (e) => {
              const to = await addFlavorVariant(b.file, e.target.value);
              if (to) useStore.setState({ view: { t: "block", key, flavor: e.target.value, file: to } });
            }}
          >
            <option value="">+ flavor variant…</option>
            {missing.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        )}
      </div>
      <div className="cx-block-meta">
        <label>
          type
          <Field value={b.type} list="cx-types" onCommit={(v) => updateBlockFront(b.file, { type: v })} />
        </label>
        <label>
          function
          <Field value={b.fn} onCommit={(v) => updateBlockFront(b.file, { function: v })} testid="block-fn" />
        </label>
        {b.kind === "section" && (
          <>
            <label>
              title
              <Field value={String(b.front.title ?? b.fn)} onCommit={(v) => updateBlockFront(b.file, { title: v })} />
            </label>
            <label>
              frame
              <Seg value={String(b.front.frame ?? "auto") as "auto"} options={[["auto", "auto"], ["md", "## md"], ["xml", "<xml>"], ["none", "none"]] as never} onChange={(v) => updateBlockFront(b.file, { frame: v === "auto" ? undefined : v })} />
            </label>
            <label>
              list
              <Seg value={String(b.front.list ?? "plain") as "plain"} options={[["plain", "plain"], ["bullets", "- bullets"], ["numbered", "1. numbered"]] as never} onChange={(v) => updateBlockFront(b.file, { list: v === "plain" ? undefined : v })} />
            </label>
          </>
        )}
        {(b.kind === "tool" || b.kind === "schema") && (
          <>
            <label>
              name
              <Field value={String(b.front.name ?? b.path)} onCommit={(v) => updateBlockFront(b.file, { name: v })} />
            </label>
            {b.kind === "tool" && (
              <label className="wide">
                description
                <Field value={String(b.front.description ?? "")} onCommit={(v) => updateBlockFront(b.file, { description: v })} />
              </label>
            )}
            {b.kind === "schema" && (
              <>
                <label>
                  strict
                  <Seg value={b.front.strict === false ? "off" : "on"} options={[["on", "on"], ["off", "off"]]} onChange={(v) => updateBlockFront(b.file, { strict: v === "on" })} />
                </label>
                <label className="wide">
                  digest header
                  <Field value={String(b.front.digestHeader ?? "")} placeholder={DEFAULT_DIGEST_HEADER} onCommit={(v) => updateBlockFront(b.file, { digestHeader: v })} />
                </label>
              </>
            )}
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
        <div className="cx-paper cx-paper-block">
          <Editor key={b.file} docKey={b.file} text={body} mode="block" flavor={b.flavor} onSave={(t) => updateBlockBody(b.file, t)} />
        </div>
      )}
      <footer className="cx-block-foot">
        <div>
          {used.length ? (
            <>
              Used in{" "}
              {used.map((u, i) => (
                <button
                  key={i}
                  className="cx-link"
                  onClick={() => {
                    if (u.project === p?.name) setVersion(u.version);
                    else {
                      useStore.setState({ project: u.project });
                      setVersion(u.version);
                    }
                  }}
                >
                  {u.project}/{u.version}
                </button>
              ))}
            </>
          ) : (
            <span className="cx-muted-text">Not used in any version yet — drag it onto a page.</span>
          )}
        </div>
        <button
          className="cx-btn small ghost danger"
          onClick={() =>
            openModal({
              t: "confirm",
              title: `Delete the ${b.flavor} variant of “${b.fn}”?`,
              body: used.length ? `It's used in ${used.length} version(s); those references will fall back to another variant or break.` : "This deletes the file.",
              ok: "Delete",
              onOk: () => {
                removeFile(b.file);
                back();
              },
            })
          }
        >
          Delete variant
        </button>
      </footer>
    </div>
  );
}
