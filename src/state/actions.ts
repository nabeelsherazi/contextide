// Higher-level workspace actions used by the UI and the palette.
import { useStore, writeFile, removeFile, renameFile, setVersion, setProject, currentProject, currentVersion, toast, getKey } from "./store";
import { type BlockKind, blockFile, newBlockKey, keyPath, type RunSettings, type ProjectSettings, type WorkspaceSettings, DEFAULT_SETTINGS, mergedRunSettings } from "../core/workspace";
import { joinFront, parseDoc, fmtDoc, slug, splitFront } from "../core/doc";
import { activeEditor } from "../editor/active";
import { executeRun, type RunPlan } from "../run/runner";
import type { RunMode } from "../core/runs";
import { docFromPM } from "../editor/convert";

const get = useStore.getState;

export function nextVersionId(existing: string[]): string {
  for (let i = 0; i < 26 * 27; i++) {
    const id = i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));
    if (!existing.includes(id)) return id;
  }
  return `V${existing.length + 1}`;
}

export async function createVersion(o: { id?: string; subtitle?: string; flavor?: string; fork?: string }) {
  const p = currentProject();
  if (!p) return;
  const id = (o.id?.trim() || nextVersionId(p.versions.map((v) => v.id))).replace(/[^\w.-]/g, "-");
  const src = o.fork ? p.versions.find((v) => v.id === o.fork) : undefined;
  activeEditor()?.flush();
  const base = src ? get().files.get(src.file) ?? "" : "";
  const doc = base ? parseDoc(base) : { front: {}, messages: [] };
  const front = { ...doc.front, title: id, subtitle: o.subtitle ?? (src ? `fork of ${src.id}` : ""), flavor: o.flavor ?? src?.flavor ?? "general" };
  const text = base ? fmtDoc({ front, messages: doc.messages }) : joinFront(front, "\n");
  await writeFile(`${p.dir}/versions/${id}.md`, text);
  setVersion(id);
}

export async function updateVersionMeta(id: string, patch: { id?: string; subtitle?: string; flavor?: string }) {
  const p = currentProject();
  const v = p?.versions.find((x) => x.id === id);
  if (!p || !v) return;
  const ed = activeEditor();
  const isOpen = ed?.key === v.file;
  const front: Record<string, unknown> = {};
  if (patch.subtitle !== undefined) front.subtitle = patch.subtitle;
  if (patch.flavor !== undefined) front.flavor = patch.flavor;
  if (patch.id && patch.id !== id) front.title = patch.id;
  if (isOpen) ed!.setFront(front);
  else {
    const text = get().files.get(v.file) ?? "";
    const d = parseDoc(text);
    await writeFile(v.file, fmtDoc({ front: { ...d.front, ...front }, messages: d.messages }));
  }
  if (patch.id && patch.id !== id) {
    const to = `${p.dir}/versions/${patch.id.replace(/[^\w.-]/g, "-")}.md`;
    await new Promise((r) => setTimeout(r, 50));
    await renameFile(v.file, to);
    setVersion(patch.id);
  }
}

export async function deleteVersion(id: string) {
  const p = currentProject();
  const v = p?.versions.find((x) => x.id === id);
  if (!p || !v || p.versions.length <= 1) return;
  await removeFile(v.file);
  const rest = p.versions.filter((x) => x.id !== id);
  setVersion(rest[0].id);
}

export async function createProject(name: string, description = "") {
  const n = slug(name);
  if (!n) return;
  await writeFile(`projects/${n}/project.json`, JSON.stringify({ description, run: { endpoint: get().ws.settings.endpoints[0]?.id, temperature: 0 } }, null, 2) + "\n");
  await writeFile(`projects/${n}/versions/A.md`, joinFront({ title: "A", subtitle: "", flavor: "general" }, "\n"));
  setProject(n);
}

export async function patchProject(patch: Partial<ProjectSettings>) {
  const p = currentProject();
  if (!p) return;
  const next = { ...p.settings, ...patch };
  for (const k of Object.keys(next) as (keyof ProjectSettings)[]) if (next[k] === undefined) delete next[k];
  await writeFile(`${p.dir}/project.json`, JSON.stringify(next, null, 2) + "\n");
}

export async function patchWorkspace(patch: Partial<WorkspaceSettings>) {
  const s = get().ws.settings;
  await writeFile("contextide.json", JSON.stringify({ ...DEFAULT_SETTINGS, ...s, ...patch }, null, 2) + "\n");
}

/** Save run settings either for the project, or as an override on the current version. */
export async function patchRunSettings(patch: Partial<RunSettings>) {
  const p = currentProject();
  const v = currentVersion();
  if (!p) return;
  if (get().runOverride && v) {
    const run = { ...((v.doc.front.run as RunSettings) ?? {}), ...patch };
    activeEditor()?.key === v.file ? activeEditor()!.setFront({ run }) : await writeFile(v.file, fmtDoc({ front: { ...v.doc.front, run }, messages: v.doc.messages }));
  } else await patchProject({ run: { ...(p.settings.run ?? {}), ...patch } });
}

export async function clearVersionRunOverride() {
  const v = currentVersion();
  if (!v) return;
  const ed = activeEditor();
  if (ed?.key === v.file) ed.setFront({ run: undefined });
  else {
    const front = { ...v.doc.front };
    delete front.run;
    await writeFile(v.file, fmtDoc({ front, messages: v.doc.messages }));
  }
}

export interface SaveBlockInput {
  kind: BlockKind;
  type: string;
  fn: string;
  flavor: string;
  scope: "library" | "project";
  body: string;
  extraFront?: Record<string, unknown>;
}

export async function saveBlock(i: SaveBlockInput): Promise<{ key: string; file: string }> {
  const key = newBlockKey(i.kind, i.type, i.fn);
  const p = currentProject();
  const root = i.scope === "library" || !p ? "library" : `${p.dir}/blocks`;
  const file = blockFile(root, i.kind, keyPath(key), i.flavor);
  const front: Record<string, unknown> = { type: i.type || undefined, function: i.fn, flavor: i.flavor !== "general" ? i.flavor : undefined, ...(i.extraFront ?? {}) };
  if (i.kind === "tool" || i.kind === "schema") front.name = front.name ?? keyPath(key).split("/").pop();
  await writeFile(file, joinFront(front, i.body.replace(/\n*$/, "\n")));
  // remember new types/flavors
  const s = get().ws.settings;
  const types = i.type && !s.types.includes(i.type) ? [...s.types, i.type] : s.types;
  const flavors = !s.flavors.includes(i.flavor) ? [...s.flavors, i.flavor] : s.flavors;
  if (types !== s.types || flavors !== s.flavors) await patchWorkspace({ types, flavors });
  return { key, file };
}

/** Update a block file's body (keeping frontmatter). */
export async function updateBlockBody(file: string, body: string) {
  const text = get().files.get(file) ?? "";
  const { front } = splitFront(text);
  await writeFile(file, joinFront(front, body.replace(/\n*$/, "\n")));
}

export async function updateBlockFront(file: string, patch: Record<string, unknown>) {
  const text = get().files.get(file) ?? "";
  const { front, body } = splitFront(text);
  const next = { ...front, ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === "") delete next[k];
  await writeFile(file, joinFront(next, body));
}

export async function addFlavorVariant(file: string, flavor: string) {
  const s = get();
  const b = s.ws.blocks.find((x) => x.file === file);
  if (!b) return;
  const root = b.scope === "library" ? "library" : `projects/${b.project}/blocks`;
  const to = blockFile(root, b.kind, b.path, flavor);
  if (s.files.has(to)) return to;
  const { front, body } = splitFront(s.files.get(file) ?? "");
  await writeFile(to, joinFront({ ...front, flavor: flavor === "general" ? undefined : flavor }, body));
  if (!s.ws.settings.flavors.includes(flavor)) await patchWorkspace({ flavors: [...s.ws.settings.flavors, flavor] });
  return to;
}

export async function createDataSource(name: string, ext: string, text = "") {
  const p = currentProject();
  if (!p) return;
  const n = slug(name);
  await writeFile(`${p.dir}/data/${n}.${ext}`, text);
  useStore.setState({ view: { t: "data", name: n } });
}

// ---------- running ----------

export async function startRun(o: { mode: RunMode; fanout?: { source: string; size: number }; repeat?: number; scoring: boolean; version?: string }) {
  const s = get();
  const p = currentProject(s);
  const v = o.version ? p?.versions.find((x) => x.id === o.version) : currentVersion(s);
  if (!p || !v) return null;
  if (s.progress.running) return null;
  const ed = activeEditor();
  ed?.flush();
  const messages = ed && ed.key === v.file ? docFromPM(ed.view.state.doc) : v.doc.messages;
  const settings = mergedRunSettings(p, v);
  const endpoint = s.ws.settings.endpoints.find((e) => e.id === settings.endpoint) ?? s.ws.settings.endpoints[0];
  if (!endpoint) {
    toast("Add an endpoint in Settings first");
    return null;
  }
  const abort = new AbortController();
  useStore.setState({ progress: { running: true, done: 0, total: 1, label: "starting", live: "", abort } });
  const plan: RunPlan = {
    ws: s.ws,
    project: p,
    version: v,
    messages,
    mode: o.mode,
    settings,
    endpoint,
    apiKey: getKey(endpoint.id),
    fanout: o.fanout,
    repeat: o.repeat,
    scoring: o.scoring,
    signal: abort.signal,
    onProgress: (pr) => useStore.setState((st) => ({ progress: { ...st.progress, ...pr } })),
  };
  try {
    const { fileName, text, record } = await executeRun(plan);
    const path = `${p.dir}/runs/${fileName}`;
    await writeFile(path, text);
    useStore.setState({ progress: { running: false, done: 0, total: 0, label: "", live: "" }, selectedRun: fileName.replace(/\.md$/, "") });
    const err = record.outputs.find((x) => x.error)?.error;
    if (err) useStore.setState((st) => ({ progress: { ...st.progress, error: err } }));
    return fileName.replace(/\.md$/, "");
  } catch (e) {
    useStore.setState({ progress: { running: false, done: 0, total: 0, label: "", live: "", error: (e as Error).message } });
    return null;
  }
}

export function stopRun() {
  get().progress.abort?.abort();
}

/** Run two versions with the same settings and open them side by side in Diff. */
export async function compareVersions(a: string, b: string, scoring: boolean) {
  const ra = await startRun({ mode: "whole", scoring, version: a });
  if (!ra) return;
  await new Promise((r) => setTimeout(r, 1100)); // distinct run file timestamps
  const rb = await startRun({ mode: "whole", scoring, version: b });
  if (!rb) return;
  useStore.setState({ rightTab: "diff", diff: { a: ra, b: rb, what: "output", ai: 0, bi: 0 } });
}

export async function updateRunMeta(id: string, patch: { rating?: "up" | "down" | null; starred?: boolean; note?: string }) {
  const p = currentProject();
  const r = p?.runs.find((x) => x.id === id);
  if (!r) return;
  const text = get().files.get(r.file) ?? "";
  const { front, body } = splitFront(text);
  const next: Record<string, unknown> = { ...front };
  if (patch.rating !== undefined) next.rating = patch.rating ?? undefined;
  if (patch.starred !== undefined) next.starred = patch.starred || undefined;
  if (patch.note !== undefined) next.note = patch.note || undefined;
  await writeFile(r.file, joinFront(next, body));
}

export async function deleteRun(id: string) {
  const p = currentProject();
  const r = p?.runs.find((x) => x.id === id);
  if (r) await removeFile(r.file);
}
