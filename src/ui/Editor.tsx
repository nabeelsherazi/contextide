import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { schema } from "../editor/schema";
import { docToPM, docFromPM } from "../editor/convert";
import { basePlugins, setAnalysis, consumeSlash, type SlashState, analysisKey } from "../editor/plugins";
import { nodeViews, type EditorCtx } from "../editor/views";
import { setActiveEditor } from "../editor/active";
import { parseDoc, parseBody, fmtDoc, fmtBody, type Message } from "../core/doc";
import { useStore, openModal, toast } from "../state/store";
import { analyze } from "../state/analysis";
import { envFor } from "../core/env";
import { mergedVars } from "../core/workspace";
import { insertCard, insertInline } from "../editor/commands";
import { slashItems, type MenuItem } from "./items";
import { onTokenizerReady } from "../tokens/tokens";

export interface EditorProps {
  /** identity of the document (path); a change re-creates the editor */
  docKey: string;
  text: string;
  mode: "version" | "block";
  flavor: string;
  onSave(text: string): void;
  /** called with the live AST as you type */
  onLive?(messages: Message[]): void;
  placeholder?: string;
}

const SAVE_MS = 350;

export function Editor(p: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const frontRef = useRef<Record<string, unknown>>({});
  const lastText = useRef<string>(p.text);
  const saveTimer = useRef<number | undefined>(undefined);
  const liveTimer = useRef<number | undefined>(undefined);
  const dirty = useRef(false);
  const flavorRef = useRef(p.flavor);
  const propsRef = useRef(p);
  propsRef.current = p;
  flavorRef.current = p.flavor;
  const [slash, setSlash] = useState<{ state: SlashState; x: number; y: number } | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const slashRef = useRef<{ items: MenuItem[]; index: number }>({ items: [], index: 0 });
  const chooseRef = useRef<(i: MenuItem | undefined) => void>(() => {});

  const serialize = useCallback((messages: Message[]) => {
    if (propsRef.current.mode === "version") return fmtDoc({ front: frontRef.current, messages });
    return fmtBody(messages);
  }, []);

  const flush = useCallback(() => {
    const v = viewRef.current;
    if (!v) return;
    window.clearTimeout(saveTimer.current);
    if (!dirty.current) return;
    dirty.current = false;
    const text = serialize(docFromPM(v.state.doc));
    lastText.current = text;
    propsRef.current.onSave(text);
  }, [serialize]);

  const runAnalysis = useCallback(() => {
    const v = viewRef.current;
    if (!v) return;
    const s = useStore.getState();
    const messages = docFromPM(v.state.doc);
    const project = s.ws.projects.find((x) => x.name === s.project);
    const version = project?.versions.find((x) => x.id === s.version);
    const env = envFor(s.ws, project, propsRef.current.mode === "version" ? version : undefined, { flavor: flavorRef.current });
    const a = analyze(messages, env);
    const { prefs } = s;
    setAnalysis(v, a, { tint: prefs.prefixTint, gutter: prefs.gutter });
    useStore.setState({ analysis: a });
  }, []);

  // create the view
  useEffect(() => {
    if (!host.current) return;
    const parsed = p.mode === "version" ? parseDoc(p.text) : { front: {}, messages: parseBody(p.text) };
    frontRef.current = parsed.front;
    lastText.current = p.text;
    const listeners = new Set<() => void>();
    const ctx: EditorCtx = {
      ws: () => useStore.getState().ws,
      project: () => useStore.getState().project ?? undefined,
      flavor: () => flavorRef.current,
      vars: () => {
        const s = useStore.getState();
        return mergedVars(s.ws, s.ws.projects.find((x) => x.name === s.project));
      },
      subscribe: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      open: (kind, pos) => {
        if (kind === "ref") openModal({ t: "ref-edit", pos });
        else if (kind === "data") openModal({ t: "data-pipe", pos });
        else if (kind === "insertion") openModal({ t: "insertion", pos });
        else {
          const n = viewRef.current?.state.doc.nodeAt(pos);
          const s = useStore.getState();
          const b = s.ws.blocks.find((x) => x.key === `${kind}:${n?.attrs.name}`);
          if (b) useStore.setState({ view: { t: "block", key: b.key, flavor: b.flavor, file: b.file } });
        }
      },
      sectionMenu: (pos, anchor) => {
        const r = anchor.getBoundingClientRect();
        useStore.setState({ menu: { x: r.left, y: r.bottom + 4, kind: "section", pos } });
      },
    };
    const view = new EditorView(host.current, {
      state: EditorState.create({
        schema,
        doc: docToPM(parsed.messages),
        plugins: basePlugins({
          slash: {
            onKey: (key) => {
              const st = slashRef.current;
              if (!st.items.length) return false;
              if (key === "ArrowDown") setSlashIndex((i) => (i + 1) % st.items.length);
              else if (key === "ArrowUp") setSlashIndex((i) => (i - 1 + st.items.length) % st.items.length);
              else chooseSlash(st.items[st.index]);
              return true;
            },
            onChange: (state, v) => {
              if (!state.open) {
                setSlash((prev) => (prev ? null : prev));
                return;
              }
              const c = v.coordsAtPos(state.from);
              const below = window.innerHeight - c.bottom > 340;
              setSlash({ state, x: c.left, y: below ? c.bottom + 6 : Math.max(8, c.top - 6 - 330) });
            },
          },
          onContextMenu: (_v, e) => useStore.setState({ menu: { x: e.clientX, y: e.clientY, kind: "editor" } }),
          analysis: { tint: useStore.getState().prefs.prefixTint, gutter: useStore.getState().prefs.gutter },
          extraKeys: {
            "Mod-s": () => {
              flush();
              return true;
            },
          },
        }),
      }),
      nodeViews: nodeViews(ctx),
      dispatchTransaction(tr) {
        const next = view.state.apply(tr);
        view.updateState(next);
        if (tr.docChanged) {
          dirty.current = true;
          window.clearTimeout(saveTimer.current);
          saveTimer.current = window.setTimeout(flush, SAVE_MS);
          window.clearTimeout(liveTimer.current);
          liveTimer.current = window.setTimeout(() => {
            propsRef.current.onLive?.(docFromPM(view.state.doc));
            runAnalysis();
          }, 120);
        }
      },
    });
    viewRef.current = view;
    const chooseSlash = (item: MenuItem | undefined) => {
      if (!item) return;
      view.dispatch(consumeSlash(view));
      applyItem(view, item);
    };
    chooseRef.current = chooseSlash;
    const api = {
      key: p.docKey,
      view,
      flush,
      setFront: (patch: Record<string, unknown>) => {
        frontRef.current = { ...frontRef.current, ...patch };
        for (const [k, v] of Object.entries(patch)) if (v === undefined) delete frontRef.current[k];
        dirty.current = true;
        flush();
      },
    };
    setActiveEditor(api);
    const onFocus = () => setActiveEditor(api);
    view.dom.addEventListener("focus", onFocus);
    const unsubStore = useStore.subscribe((s, prev) => {
      if (s.rev !== prev.rev || s.prefs !== prev.prefs) {
        listeners.forEach((f) => f());
        runAnalysis();
      }
    });
    const unsubTok = onTokenizerReady(runAnalysis);
    propsRef.current.onLive?.(parsed.messages);
    runAnalysis();
    if (!p.text.trim()) view.focus();
    return () => {
      flush();
      unsubStore();
      unsubTok();
      view.dom.removeEventListener("focus", onFocus);
      setActiveEditor(null);
      view.destroy();
      viewRef.current = null;
      useStore.setState({ analysis: null });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.docKey, p.mode]);

  // re-analyze when flavor changes
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    v.dispatch(v.state.tr.setMeta(analysisKey, {}).setMeta("addToHistory", false));
    runAnalysis();
  }, [p.flavor, runAnalysis]);

  // external changes to the file
  useEffect(() => {
    const v = viewRef.current;
    if (!v || p.text === lastText.current) return;
    const current = serialize(docFromPM(v.state.doc));
    if (current === p.text) {
      lastText.current = p.text;
      return;
    }
    const load = () => {
      const parsed = p.mode === "version" ? parseDoc(p.text) : { front: {}, messages: parseBody(p.text) };
      frontRef.current = parsed.front;
      lastText.current = p.text;
      dirty.current = false;
      const tr = v.state.tr.replaceWith(0, v.state.doc.content.size, docToPM(parsed.messages).content).setMeta("addToHistory", false);
      v.dispatch(tr);
      dirty.current = false;
      window.clearTimeout(saveTimer.current);
    };
    if (!dirty.current) {
      load();
      toast("Reloaded — the file changed on disk");
    } else
      openModal({
        t: "confirm",
        title: "This file changed on disk",
        body: "It was edited outside ContextIDE while you have unsaved changes here. Load the version on disk (discarding yours), or cancel to keep yours and overwrite it.",
        ok: "Load from disk",
        onOk: load,
      });
  }, [p.text, p.mode, serialize]);

  // slash items
  const s = useStore();
  const items = useMemo(() => (slash ? slashItems(s.ws, s.project ?? undefined, p.flavor, slash.state.query) : []), [slash, s.ws, s.project, p.flavor]);
  slashRef.current = { items, index: Math.min(slashIndex, Math.max(0, items.length - 1)) };
  useEffect(() => setSlashIndex(0), [slash?.state.query]);

  return (
    <div className="cx-editor-host" data-testid="editor">
      <div ref={host} />
      {slash && (
        <div className="cx-popover cx-slash" style={{ left: slash.x, top: slash.y }} data-testid="slash-menu" onMouseDown={(e) => e.preventDefault()}>
          {items.length === 0 && <div className="cx-menu-empty">No matches</div>}
          {items.slice(0, 40).map((it, i) => (
            <button
              key={it.id}
              className={`cx-menu-item${i === slashRef.current.index ? " active" : ""}`}
              onMouseEnter={() => setSlashIndex(i)}
              onClick={() => chooseRef.current(it)}
            >
              <span className="cx-menu-icon">{it.icon}</span>
              <span className="cx-menu-label">{it.label}</span>
              {it.hint && <span className="cx-menu-hint">{it.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function applyItem(view: EditorView, item: MenuItem) {
  const ins = item.make();
  if (!ins) return;
  if (ins.mode === "card") insertCard(ins.node)(view.state, view.dispatch);
  else for (const n of ins.nodes) insertInline(n)(view.state, view.dispatch);
  view.focus();
}
