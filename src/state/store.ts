import { create } from "zustand";
import { type Workspace, buildWorkspace, type Project, type Version } from "../core/workspace";
import type { PromptDoc } from "../core/doc";
import type { Vfs } from "../fs/vfs";

export interface Prefs {
  font: string;
  mono: string;
  fontSize: number;
  lineHeight: number;
  pageWidth: number;
  theme: "system" | "light" | "dark";
  showWhitespace: boolean;
  gutter: boolean;
  prefixTint: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  font: "EB Garamond",
  mono: "JetBrains Mono",
  fontSize: 21,
  lineHeight: 1.6,
  pageWidth: 760,
  theme: "system",
  showWhitespace: false,
  gutter: true,
  prefixTint: true,
};

export type View = { t: "version" } | { t: "block"; key: string; flavor: string; file: string } | { t: "data"; name: string } | { t: "project" };

export type Modal =
  | null
  | { t: "settings"; tab?: string }
  | { t: "save-block"; kind: "directive" | "section"; text: string; title?: string; onSaved: (key: string, scope: "library" | "project") => void; scope?: "library" | "project" }
  | { t: "new-version"; fork?: string }
  | { t: "version-settings"; id: string }
  | { t: "new-project" }
  | { t: "new-block"; kind: import("../core/workspace").BlockKind }
  | { t: "new-data" }
  | { t: "data-pipe"; pos: number }
  | { t: "insertion"; pos: number }
  | { t: "ref-edit"; pos: number }
  | { t: "confirm"; title: string; body: string; ok: string; onOk: () => void };

export type RightTab = "run" | "outputs" | "diff";

const loadPrefs = (): Prefs => {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem("contextide:prefs") ?? "{}") };
  } catch {
    return DEFAULT_PREFS;
  }
};

const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
};

export interface RunProgress {
  running: boolean;
  done: number;
  total: number;
  label: string;
  live: string;
  error?: string;
  abort?: AbortController;
}

export interface State {
  vfs: Vfs | null;
  files: Map<string, string>;
  mtimes: Map<string, number>;
  ws: Workspace;
  /** bumps on every file change */
  rev: number;
  /** bumps when a file changes on disk from outside the app */
  external: { path: string; n: number } | null;
  project: string | null;
  version: string | null;
  view: View;
  /** live (unsaved) doc of the version being edited */
  liveDoc: PromptDoc | null;
  left: boolean;
  right: boolean;
  rightTab: RightTab;
  rendered: boolean;
  modal: Modal;
  palette: boolean;
  prefs: Prefs;
  saving: number;
  saveError: string | null;
  flavorFilter: string;
  search: string;
  progress: RunProgress;
  selectedRun: string | null;
  diff: { a: string | null; b: string | null; what: "output" | "prompt"; ai: number; bi: number };
  toast: { msg: string; n: number } | null;
  menu: { x: number; y: number; kind: "editor" | "section"; pos?: number } | null;
  analysis: import("./analysis").Analysis | null;
  runOverride: boolean;
  /** current tutorial step, or null */
  tour: number | null;
}

export const useStore = create<State>(() => ({
  vfs: null,
  files: new Map(),
  mtimes: new Map(),
  ws: buildWorkspace(new Map()),
  rev: 0,
  external: null,
  project: null,
  version: null,
  view: { t: "version" },
  liveDoc: null,
  left: lsGet("contextide:left") !== "0",
  right: lsGet("contextide:right") !== "0",
  rightTab: "run",
  rendered: false,
  modal: null,
  palette: false,
  prefs: loadPrefs(),
  saving: 0,
  saveError: null,
  flavorFilter: "auto",
  search: "",
  progress: { running: false, done: 0, total: 0, label: "", live: "" },
  selectedRun: null,
  diff: { a: null, b: null, what: "output", ai: 0, bi: 0 },
  toast: null,
  menu: null,
  analysis: null,
  runOverride: false,
  tour: null,
}));

const set = useStore.setState;
const get = useStore.getState;

// ---------- selectors ----------

export const currentProject = (s: State = get()): Project | undefined => s.ws.projects.find((p) => p.name === s.project);
export const currentVersion = (s: State = get()): Version | undefined => currentProject(s)?.versions.find((v) => v.id === s.version);

// ---------- actions ----------

function rebuild(files: Map<string, string>, extra: Partial<State> = {}) {
  const ws = buildWorkspace(files);
  set((s) => ({ files, ws, rev: s.rev + 1, ...extra }));
  fixSelection();
}

function fixSelection() {
  const s = get();
  let { project, version } = s;
  if (!s.ws.projects.some((p) => p.name === project)) project = lsGet("contextide:project") ?? null;
  if (!s.ws.projects.some((p) => p.name === project)) project = s.ws.projects[0]?.name ?? null;
  const p = s.ws.projects.find((x) => x.name === project);
  if (!p?.versions.some((v) => v.id === version)) {
    const remembered = lsGet(`contextide:version:${project}`);
    version = p?.versions.find((v) => v.id === remembered)?.id ?? p?.versions[0]?.id ?? null;
  }
  if (project !== s.project || version !== s.version) set({ project, version, liveDoc: null });
}

export async function openVfs(vfs: Vfs) {
  const all = await vfs.readAll();
  const files = new Map([...all].map(([k, v]) => [k, v.text]));
  const mtimes = new Map([...all].map(([k, v]) => [k, v.mtime]));
  set({ vfs, mtimes, view: { t: "version" }, project: null, version: null, liveDoc: null, selectedRun: null });
  rebuild(files);
}

export function closeWorkspace() {
  set({ vfs: null, files: new Map(), mtimes: new Map(), ws: buildWorkspace(new Map()), project: null, version: null, liveDoc: null });
}

const pending = new Map<string, Promise<void>>();

export async function writeFile(path: string, text: string): Promise<void> {
  const s = get();
  if (!s.vfs) return;
  if (s.files.get(path) === text) return;
  const files = new Map(s.files);
  files.set(path, text);
  rebuild(files, { saving: s.saving + 1 });
  const prev = pending.get(path) ?? Promise.resolve();
  const p = prev.then(async () => {
    try {
      const mtime = await s.vfs!.write(path, text);
      set((st) => ({ mtimes: new Map(st.mtimes).set(path, mtime), saveError: null }));
    } catch (e) {
      set({ saveError: `Could not save ${path}: ${(e as Error).message}` });
    } finally {
      set((st) => ({ saving: st.saving - 1 }));
    }
  });
  pending.set(path, p);
  return p;
}

export async function removeFile(path: string) {
  const s = get();
  if (!s.vfs) return;
  const files = new Map(s.files);
  files.delete(path);
  const mtimes = new Map(s.mtimes);
  mtimes.delete(path);
  rebuild(files, { mtimes });
  try {
    await s.vfs.remove(path);
  } catch (e) {
    set({ saveError: `Could not delete ${path}: ${(e as Error).message}` });
  }
}

export async function renameFile(from: string, to: string) {
  const text = get().files.get(from);
  if (text === undefined || from === to) return;
  await writeFile(to, text);
  await removeFile(from);
}

/** Poll the disk for changes made outside the app. */
export async function pollDisk() {
  const s = get();
  if (!s.vfs || s.saving > 0) return;
  const { changed, deleted } = await s.vfs.scan(s.mtimes);
  if (!changed.size && !deleted.length) return;
  const st = get();
  if (st.saving > 0) return;
  const files = new Map(st.files);
  const mtimes = new Map(st.mtimes);
  let external: State["external"] = st.external;
  let any = false;
  for (const [p, e] of changed) {
    mtimes.set(p, e.mtime);
    if (files.get(p) !== e.text) {
      files.set(p, e.text);
      any = true;
      external = { path: p, n: (external?.n ?? 0) + 1 };
    }
  }
  for (const p of deleted) {
    mtimes.delete(p);
    if (files.delete(p)) any = true;
  }
  if (any) rebuild(files, { mtimes, external });
  else set({ mtimes });
}

export function setProject(name: string) {
  lsSet("contextide:project", name);
  set({ project: name, version: null, view: { t: "version" }, liveDoc: null, selectedRun: null });
  fixSelection();
}

export function setVersion(id: string) {
  const s = get();
  lsSet(`contextide:version:${s.project}`, id);
  set({ version: id, view: { t: "version" }, liveDoc: null });
}

export function setPrefs(p: Partial<Prefs>) {
  const prefs = { ...get().prefs, ...p };
  lsSet("contextide:prefs", JSON.stringify(prefs));
  set({ prefs });
}

export function toggle(k: "left" | "right" | "rendered") {
  const v = !get()[k];
  if (k !== "rendered") lsSet(`contextide:${k}`, v ? "1" : "0");
  set({ [k]: v } as Partial<State>);
}

export function toast(msg: string) {
  set((s) => ({ toast: { msg, n: (s.toast?.n ?? 0) + 1 } }));
}

export const openModal = (m: Modal) => set({ modal: m });
export const closeModal = () => set({ modal: null });

// ---------- API keys (kept in the browser, never in the workspace) ----------

export const getKey = (endpointId: string) => lsGet(`contextide:key:${endpointId}`) ?? "";
export const setKey = (endpointId: string, key: string) => lsSet(`contextide:key:${endpointId}`, key);
