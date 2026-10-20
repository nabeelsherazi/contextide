import { useMemo, useState } from "react";
import { useStore, openModal, currentVersion } from "../state/store";
import { type Block, type BlockKind, BLOCK_KINDS, usages, variantsOf } from "../core/workspace";
import { INSERTIONS } from "../core/insertions";
import { forBlock, forData, forInsertion, dragPayload, type Insertable } from "../editor/blocks";
import { DRAG_MIME } from "../editor/plugins";
import { KIND_ICON } from "./items";
import { dataItems } from "../core/workspace";
import { activeEditor } from "../editor/active";
import { applyItem } from "./Editor";

const KIND_LABEL: Record<BlockKind, string> = { directive: "Directives", section: "Sections", insertion: "Insertions", tool: "Tools", schema: "Schemas" };

function DragRow(props: { make: () => Insertable; icon: string; label: string; sub?: string; badges?: React.ReactNode; onOpen?: () => void; title?: string; testid?: string; active?: boolean }) {
  return (
    <div
      className={`cx-row${props.active ? " active" : ""}`}
      draggable
      title={props.title}
      data-testid={props.testid}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, dragPayload(props.make()));
        e.dataTransfer.setData("text/plain", props.label);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={props.onOpen}
    >
      <span className="cx-row-icon">{props.icon}</span>
      <span className="cx-row-label">
        {props.label}
        {props.sub && <span className="cx-row-sub">{props.sub}</span>}
      </span>
      {props.badges}
      <button
        className="cx-row-add"
        title="Insert at cursor"
        onClick={(e) => {
          e.stopPropagation();
          const ed = activeEditor();
          if (ed) applyItem(ed.view, { id: "", icon: "", label: "", group: "", make: props.make });
        }}
      >
        ↵
      </button>
    </div>
  );
}

export function Library() {
  const s = useStore();
  const v = currentVersion(s);
  const flavor = s.flavorFilter === "auto" ? (v?.flavor ?? "general") : s.flavorFilter;
  // every group starts collapsed; a search shows everything that matches
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const q = s.search.trim().toLowerCase();
  const isOpen = (k: string) => !!q || !!open[k];
  const toggleGroup = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const p = s.ws.projects.find((x) => x.name === s.project);

  const groups = useMemo(() => {
    const keys = new Map<string, Block[]>();
    for (const b of s.ws.blocks) {
      if (b.scope === "project" && b.project !== s.project) continue;
      keys.set(b.key, [...(keys.get(b.key) ?? []), b]);
    }
    const out: Record<BlockKind, Map<string, { key: string; shown: Block; variants: Block[] }[]>> = { directive: new Map(), section: new Map(), insertion: new Map(), tool: new Map(), schema: new Map() };
    for (const [key, all] of keys) {
      const variants = variantsOf(s.ws, key, s.project ?? undefined);
      const shown = flavor === "all" ? (variants.find((x) => x.flavor === "general") ?? variants[0]) : (variants.find((x) => x.flavor === flavor) ?? variants.find((x) => x.flavor === "general"));
      if (!shown) continue;
      const hay = `${shown.fn} ${shown.type} ${shown.body} ${key}`.toLowerCase();
      if (q && !q.split(/\s+/).every((w) => hay.includes(w))) continue;
      const type = shown.type || "—";
      const g = out[shown.kind];
      g.set(type, [...(g.get(type) ?? []), { key, shown, variants: variants.length ? variants : all }]);
    }
    return out;
  }, [s.ws, s.project, flavor, q]);

  const openBlock = (b: Block) => useStore.setState({ view: { t: "block", key: b.key, flavor: b.flavor, file: b.file } });
  const viewKey = s.view.t === "block" ? s.view.key : null;

  return (
    <aside className="cx-drawer cx-left" data-testid="library">
      <div className="cx-drawer-head">
        <input className="cx-search" placeholder="Search blocks…" value={s.search} onChange={(e) => useStore.setState({ search: e.target.value })} data-testid="library-search" />
        <select className="cx-select" value={s.flavorFilter} onChange={(e) => useStore.setState({ flavorFilter: e.target.value })} title="Show blocks for a flavor (plus General)" data-testid="flavor-filter">
          <option value="auto">flavor: {v?.flavor ?? "general"} (version)</option>
          <option value="all">all flavors</option>
          {s.ws.settings.flavors.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>
      <div className="cx-drawer-body">
        {BLOCK_KINDS.map((kind) => {
          const types = [...groups[kind].entries()].sort(([a], [b]) => a.localeCompare(b));
          const expanded = isOpen(kind);
          return (
            <section key={kind} className="cx-group" data-testid={`group-${kind}`}>
              <div className="cx-group-head">
                <button className="cx-group-toggle" onClick={() => toggleGroup(kind)} aria-expanded={expanded} data-testid={`toggle-group-${kind}`}>
                  {expanded ? "▾" : "▸"} {KIND_LABEL[kind]} <span className="cx-group-count">{kind === "insertion" ? INSERTIONS.length + [...groups[kind].values()].flat().length : [...groups[kind].values()].flat().length}</span>
                </button>
                <button className="cx-mini" title={`New ${kind}`} onClick={() => openModal({ t: "new-block", kind })} data-testid={`new-${kind}`}>
                  +
                </button>
              </div>
              {expanded && kind === "insertion" && (
                <div className="cx-type">
                  {INSERTIONS.map((ins) => (
                    <DragRow
                      key={ins.fn}
                      make={() => forInsertion(ins.fn)}
                      icon={ins.icon}
                      label={ins.label}
                      sub={ins.fn}
                      title={`${ins.doc} — click to insert at the cursor, or drag`}
                      testid={`ins-${ins.fn}`}
                      onOpen={() => {
                        const ed = activeEditor();
                        if (ed) applyItem(ed.view, { id: "", icon: "", label: "", group: "", make: () => forInsertion(ins.fn) });
                      }}
                    />
                  ))}
                </div>
              )}
              {expanded &&
                types.map(([type, rows]) => (
                  <div key={type} className="cx-type">
                    {kind !== "insertion" && kind !== "tool" && kind !== "schema" && <div className="cx-type-label">{type}</div>}
                    {rows
                      .sort((a, b) => a.shown.fn.localeCompare(b.shown.fn))
                      .map(({ key, shown, variants }) => {
                        const n = usages(s.ws, key).length;
                        return (
                          <DragRow
                            key={key}
                            make={() => forBlock(shown)}
                            icon={KIND_ICON[kind]}
                            label={shown.fn}
                            testid={`block-${key}`}
                            active={viewKey === key}
                            title={shown.body.slice(0, 400)}
                            onOpen={() => openBlock(shown)}
                            badges={
                              <span className="cx-row-badges">
                                {variants
                                  .filter((x) => x.flavor !== "general")
                                  .map((x) => (
                                    <span key={x.flavor} className={`cx-flavor${x.flavor === flavor ? " on" : ""}`}>
                                      {x.flavor}
                                    </span>
                                  ))}
                                {shown.scope === "project" && <span className="cx-flavor">project</span>}
                                {n > 0 && (
                                  <span className="cx-uses" title={`Used in ${n} version(s)`}>
                                    {n}
                                  </span>
                                )}
                              </span>
                            }
                          />
                        );
                      })}
                  </div>
                ))}
            </section>
          );
        })}
        <section className="cx-group" data-testid="group-data">
          <div className="cx-group-head">
            <button className="cx-group-toggle" onClick={() => toggleGroup("data")} aria-expanded={isOpen("data")} data-testid="toggle-group-data">
              {isOpen("data") ? "▾" : "▸"} Data <span className="cx-group-count">{p?.data.length ?? 0}</span>
            </button>
            <button className="cx-mini" title="New data source" onClick={() => openModal({ t: "new-data" })} data-testid="new-data">
              +
            </button>
          </div>
          {isOpen("data") && (
            <div className="cx-type">
              {p?.data
                .filter((d) => !q || d.name.toLowerCase().includes(q))
                .map((d) => (
                  <DragRow
                    key={d.name}
                    make={() => forData(d.name)}
                    icon="▤"
                    label={d.name}
                    sub={`${d.format === "text" ? (d.opts.split ?? "lines") : d.format} · ${dataItems(d).items.length}`}
                    testid={`data-${d.name}`}
                    active={s.view.t === "data" && s.view.name === d.name}
                    onOpen={() => useStore.setState({ view: { t: "data", name: d.name } })}
                  />
                ))}
              {!p?.data.length && <div className="cx-empty-note">No data yet. Create a data source and paste your rows in.</div>}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}
