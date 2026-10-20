import { useMemo, useState, type ReactNode } from "react";
import { ChevronRight, CornerDownLeft, Plus, Search } from "lucide-react";
import { useStore, openModal, currentVersion } from "../state/store";
import { type Block, type BlockKind, BLOCK_KINDS, usages, variantsOf, dataItems } from "../core/workspace";
import { INSERTIONS } from "../core/insertions";
import { forBlock, forData, forInsertion, dragPayload, type Insertable } from "../editor/blocks";
import { DRAG_MIME } from "../editor/plugins";
import { KIND_ICON } from "./items";
import { activeEditor } from "../editor/active";
import { applyItem } from "./Editor";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Choice } from "./widgets";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<BlockKind, string> = { directive: "Directives", section: "Sections", insertion: "Insertions", tool: "Tools", schema: "Schemas" };

const insertAtCursor = (make: () => Insertable) => {
  const ed = activeEditor();
  if (ed) applyItem(ed.view, { id: "", icon: "", label: "", group: "", make });
};

/** A draggable library row: drag onto the page, click to open (or insert), ↵ to insert at the cursor. */
function DragRow(p: { make: () => Insertable; icon: string; label: string; sub?: string; badges?: ReactNode; onOpen?: () => void; title?: string; testid?: string; active?: boolean }) {
  return (
    <div
      className={cn(
        "group/row flex min-w-0 cursor-grab items-center gap-2 rounded-[9px] px-2 py-[5px] transition-colors select-none hover:bg-paper-2",
        p.active && "bg-paper-2 shadow-[inset_2px_0_0_var(--gold)]",
      )}
      draggable
      title={p.title}
      data-testid={p.testid}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, dragPayload(p.make()));
        e.dataTransfer.setData("text/plain", p.label);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={p.onOpen}
    >
      <span className="w-4 flex-none text-center text-[12px] text-ink-3">{p.icon}</span>
      <span className="min-w-0 flex-1 truncate font-serif text-[16px]">
        {p.label}
        {p.sub && <span className="ml-1.5 font-sans text-[11px] text-ink-3">{p.sub}</span>}
      </span>
      {p.badges}
      <Button
        variant="ghost"
        size="icon-xs"
        className="opacity-0 group-hover/row:opacity-100"
        title="Insert at cursor"
        onClick={(e) => {
          e.stopPropagation();
          insertAtCursor(p.make);
        }}
      >
        <CornerDownLeft />
      </Button>
    </div>
  );
}

function Group(p: { id: string; label: ReactNode; count: number; open: boolean; onToggle(): void; onAdd(): void; addTestid: string; children: ReactNode }) {
  return (
    <Collapsible open={p.open} onOpenChange={p.onToggle} className="border-b border-rule py-1 last:border-b-0" data-testid={`group-${p.id}`}>
      <div className="flex items-center justify-between">
        <CollapsibleTrigger
          className="group/t flex cursor-pointer items-center gap-1.5 py-2 font-sans text-[10.5px] font-medium tracking-[0.22em] text-ink-3 uppercase transition-colors hover:text-foreground"
          data-testid={`toggle-group-${p.id}`}
        >
          <ChevronRight className="size-3 transition-transform group-data-[state=open]/t:rotate-90" />
          {p.label}
          <span className="tracking-normal text-ink-4">{p.count}</span>
        </CollapsibleTrigger>
        <Button variant="ghost" size="icon-xs" onClick={p.onAdd} title={`New ${p.id}`} data-testid={p.addTestid}>
          <Plus />
        </Button>
      </div>
      <CollapsibleContent className="pb-1">{p.children}</CollapsibleContent>
    </Collapsible>
  );
}

const TypeLabel = (p: { children: ReactNode }) => <div className="mt-2.5 mb-0.5 ml-1.5 font-serif text-[13px] text-ink-3 italic">{p.children}</div>;

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
      const g = out[shown.kind];
      const type = shown.type || "—";
      g.set(type, [...(g.get(type) ?? []), { key, shown, variants: variants.length ? variants : all }]);
    }
    return out;
  }, [s.ws, s.project, flavor, q]);

  const openBlock = (b: Block) => useStore.setState({ view: { t: "block", key: b.key, flavor: b.flavor, file: b.file } });
  const viewKey = s.view.t === "block" ? s.view.key : null;
  const data = (p?.data ?? []).filter((d) => !q || d.name.toLowerCase().includes(q));

  return (
    <aside className="flex w-[286px] flex-none flex-col border-r border-rule bg-glass backdrop-blur-xl max-[1100px]:w-[250px]" data-testid="library">
      <div className="flex flex-col gap-2 px-3.5 pt-3.5 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-ink-3" />
          <Input
            className="rounded-full pl-8 font-serif text-[15px]"
            placeholder="Search blocks…"
            value={s.search}
            onChange={(e) => useStore.setState({ search: e.target.value })}
            data-testid="library-search"
          />
        </div>
        <Choice
          value={s.flavorFilter}
          onChange={(f) => useStore.setState({ flavorFilter: f })}
          options={[["auto", `flavor: ${v?.flavor ?? "general"} (version)`], ["all", "all flavors"], ...s.ws.settings.flavors]}
          className="w-full"
          title="Show blocks for a flavor (plus General)"
          testid="flavor-filter"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pt-1 pb-10">
        {BLOCK_KINDS.map((kind) => {
          const types = [...groups[kind].entries()].sort(([a], [b]) => a.localeCompare(b));
          const count = (kind === "insertion" ? INSERTIONS.length : 0) + [...groups[kind].values()].flat().length;
          return (
            <Group key={kind} id={kind} label={KIND_LABEL[kind]} count={count} open={isOpen(kind)} onToggle={() => toggleGroup(kind)} onAdd={() => openModal({ t: "new-block", kind })} addTestid={`new-${kind}`}>
              {kind === "insertion" &&
                INSERTIONS.map((ins) => (
                  <DragRow
                    key={ins.fn}
                    make={() => forInsertion(ins.fn)}
                    icon={ins.icon}
                    label={ins.label}
                    sub={ins.fn}
                    title={`${ins.doc} — click to insert at the cursor, or drag`}
                    testid={`ins-${ins.fn}`}
                    onOpen={() => insertAtCursor(() => forInsertion(ins.fn))}
                  />
                ))}
              {types.map(([type, rows]) => (
                <div key={type}>
                  {kind !== "insertion" && kind !== "tool" && kind !== "schema" && <TypeLabel>{type}</TypeLabel>}
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
                            <span className="flex items-center gap-1">
                              {variants
                                .filter((x) => x.flavor !== "general")
                                .map((x) => (
                                  <Badge key={x.flavor} variant="secondary" className={x.flavor === flavor ? "bg-gold-soft text-gold" : "text-ink-3"}>
                                    {x.flavor}
                                  </Badge>
                                ))}
                              {shown.scope === "project" && (
                                <Badge variant="secondary" className="text-ink-3">
                                  project
                                </Badge>
                              )}
                              {n > 0 && (
                                <span className="min-w-[15px] rounded-full bg-paper-2 text-center text-[10px] text-ink-3" title={`Used in ${n} version(s)`}>
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
            </Group>
          );
        })}
        <Group id="data" label="Data" count={p?.data.length ?? 0} open={isOpen("data")} onToggle={() => toggleGroup("data")} onAdd={() => openModal({ t: "new-data" })} addTestid="new-data">
          {data.map((d) => (
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
          {!p?.data.length && <p className="px-1.5 py-2.5 font-serif text-[14px] text-ink-3 italic">No data yet. Create a data source and paste your rows in.</p>}
        </Group>
      </div>
    </aside>
  );
}
