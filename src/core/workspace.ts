// The in-memory model of a workspace folder, built from a flat map of path -> text.
import { type PromptDoc, parseDoc, splitFront, slug } from "./doc";
import { type DataFormat, type DataOptions, type Item, DATA_EXTS, formatOf, parseData } from "./data";
import type { EvalConfig } from "./scoring";
import { type RunRecord, parseRun } from "./runs";

export type BlockKind = "directive" | "section" | "insertion" | "tool" | "schema";
export const BLOCK_KINDS: BlockKind[] = ["directive", "section", "insertion", "tool", "schema"];
export const KIND_DIR: Record<BlockKind, string> = { directive: "directives", section: "sections", insertion: "insertions", tool: "tools", schema: "schemas" };
const DIR_KIND: Record<string, BlockKind> = Object.fromEntries(Object.entries(KIND_DIR).map(([k, v]) => [v, k as BlockKind]));

export interface Endpoint {
  id: string;
  name: string;
  baseUrl: string;
  style: "chat" | "completions";
  headers: Record<string, string>;
  extraBody: Record<string, unknown>;
  defaultModel?: string;
}

export interface WorkspaceSettings {
  name: string;
  flavors: string[];
  types: string[];
  vars: Record<string, string>;
  endpoints: Endpoint[];
  /** Workflow (project) order in the picker; any not listed follow alphabetically. */
  projectOrder?: string[];
}

export interface RunSettings {
  endpoint?: string;
  model?: string;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  seed?: number;
  stop?: string[];
  stream?: boolean;
  extra?: Record<string, unknown>;
  /** tool loop: most rounds of tool calls answered before the model must reply (default 4) */
  toolRounds?: number;
  /** tool loop: end with one turn without tools, so a response_format schema can apply */
  finalNoTools?: boolean;
}

export interface ProjectSettings {
  description?: string;
  vars?: Record<string, string>;
  data?: Record<string, DataOptions>;
  run?: RunSettings;
  eval?: EvalConfig;
}

export interface Block {
  key: string; // "directive:safety/anti-prompt-injection"
  kind: BlockKind;
  path: string; // "safety/anti-prompt-injection"
  file: string;
  scope: "library" | "project";
  project?: string;
  flavor: string;
  type: string;
  fn: string; // human "function" label
  front: Record<string, unknown>;
  body: string;
}

export interface Version {
  id: string;
  file: string;
  title: string;
  subtitle: string;
  flavor: string;
  doc: PromptDoc;
}

export interface DataSource {
  name: string;
  file: string;
  format: DataFormat;
  text: string;
  opts: DataOptions;
}

export interface Project {
  name: string;
  dir: string;
  settings: ProjectSettings;
  versions: Version[];
  data: DataSource[];
  runs: RunRecord[];
}

export interface Workspace {
  settings: WorkspaceSettings;
  blocks: Block[];
  projects: Project[];
}

export const DEFAULT_SETTINGS: WorkspaceSettings = {
  name: "ContextIDE",
  flavors: ["general", "claude", "gemini", "gpt", "qwen", "gemma"],
  types: ["task", "safety", "tone", "format", "context", "examples"],
  vars: {},
  endpoints: [
    { id: "lmstudio", name: "LM Studio", baseUrl: "http://localhost:1234/v1", style: "chat", headers: {}, extraBody: {} },
    { id: "llama", name: "llama-server", baseUrl: "http://localhost:8080/v1", style: "chat", headers: {}, extraBody: {} },
  ],
};

const parseJson = <T>(text: string | undefined, fallback: T): T => {
  if (text === undefined) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(text) as T) };
  } catch {
    return fallback;
  }
};

const cache = new Map<string, { text: string; value: unknown }>();
function memo<T>(key: string, text: string, f: () => T): T {
  const hit = cache.get(key);
  if (hit && hit.text === text) return hit.value as T;
  const value = f();
  cache.set(key, { text, value });
  return value;
}

/** Split a block filename like "anti-prompt-injection.claude.md" into path + flavor. */
export function blockFileParts(rel: string): { path: string; flavor: string } | null {
  const m = /^(.+?)(?:\.([a-z0-9_-]+))?\.md$/i.exec(rel);
  if (!m) return null;
  return { path: m[1], flavor: (m[2] ?? "general").toLowerCase() };
}

export function blockFile(scopeRoot: string, kind: BlockKind, path: string, flavor: string): string {
  return `${scopeRoot}/${KIND_DIR[kind]}/${path}${flavor && flavor !== "general" ? "." + flavor : ""}.md`;
}

function parseBlock(file: string, text: string, scope: "library" | "project", project?: string): Block | null {
  const root = scope === "library" ? "library/" : `projects/${project}/blocks/`;
  const rest = file.slice(root.length);
  const [dir, ...tail] = rest.split("/");
  const kind = DIR_KIND[dir];
  if (!kind || !tail.length) return null;
  const parts = blockFileParts(tail.join("/"));
  if (!parts) return null;
  return memo(`block:${file}`, text, () => {
    const { front, body } = splitFront(text);
    const segs = parts.path.split("/");
    const type = String(front.type ?? (segs.length > 1 ? segs[0] : ""));
    const fn = String(front.function ?? front.name ?? segs[segs.length - 1].replace(/-/g, " "));
    return {
      key: `${kind}:${parts.path}`,
      kind,
      path: parts.path,
      file,
      scope,
      project,
      flavor: String(front.flavor ?? parts.flavor).toLowerCase(),
      type,
      fn,
      front,
      body: body.replace(/\n$/, ""),
    };
  });
}

export function buildWorkspace(files: Map<string, string>): Workspace {
  const settings = parseJson<WorkspaceSettings>(files.get("contextide.json"), DEFAULT_SETTINGS);
  const blocks: Block[] = [];
  const projects = new Map<string, Project>();
  const proj = (name: string) => {
    let p = projects.get(name);
    if (!p) {
      p = { name, dir: `projects/${name}`, settings: {}, versions: [], data: [], runs: [] };
      projects.set(name, p);
    }
    return p;
  };

  for (const [file, text] of files) {
    if (file.startsWith("library/")) {
      const b = parseBlock(file, text, "library");
      if (b) blocks.push(b);
      continue;
    }
    const m = /^projects\/([^/]+)\/(.*)$/.exec(file);
    if (!m) continue;
    const [, name, rest] = m;
    const p = proj(name);
    if (rest === "project.json") {
      p.settings = parseJson<ProjectSettings>(text, {});
    } else if (rest.startsWith("versions/") && rest.endsWith(".md")) {
      const id = rest.slice("versions/".length, -3);
      const doc = memo(`doc:${file}`, text, () => parseDoc(text));
      p.versions.push({
        id,
        file,
        title: String(doc.front.title ?? id),
        subtitle: String(doc.front.subtitle ?? ""),
        flavor: String(doc.front.flavor ?? "general").toLowerCase(),
        doc,
      });
    } else if (rest.startsWith("blocks/")) {
      const b = parseBlock(file, text, "project", name);
      if (b) blocks.push(b);
    } else if (rest.startsWith("data/")) {
      const fname = rest.slice("data/".length);
      const ext = fname.split(".").pop()?.toLowerCase() ?? "";
      if (fname.includes("/") || !DATA_EXTS.includes(ext)) continue;
      p.data.push({ name: fname.replace(/\.[^.]+$/, ""), file, format: formatOf(fname), text, opts: {} });
    } else if (rest.startsWith("runs/") && rest.endsWith(".md")) {
      const r = memo(`run:${file}`, text, () => parseRun(file, text));
      if (r) p.runs.push(r);
    }
  }
  for (const p of projects.values()) {
    for (const d of p.data) d.opts = p.settings.data?.[d.name] ?? {};
    p.versions.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    p.data.sort((a, b) => a.name.localeCompare(b.name));
    p.runs.sort((a, b) => b.time.localeCompare(a.time));
  }
  blocks.sort((a, b) => a.key.localeCompare(b.key) || a.flavor.localeCompare(b.flavor));
  const rank = (n: string) => {
    const i = settings.projectOrder?.indexOf(n) ?? -1;
    return i < 0 ? Infinity : i;
  };
  return { settings, blocks, projects: [...projects.values()].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name)) };
}

// ---------- resolution ----------

export function variantsOf(ws: Workspace, key: string, project?: string): Block[] {
  const all = ws.blocks.filter((b) => b.key === key && (b.scope === "library" || b.project === project));
  // project-scoped variants shadow library ones of the same flavor
  const byFlavor = new Map<string, Block>();
  for (const b of all) if (b.scope === "library") byFlavor.set(b.flavor, b);
  for (const b of all) if (b.scope === "project") byFlavor.set(b.flavor, b);
  return [...byFlavor.values()];
}

export function resolveBlock(ws: Workspace, key: string, flavor: string, pin?: string, project?: string): { block?: Block; fellBack: boolean } {
  const vs = variantsOf(ws, key, project);
  if (!vs.length) return { fellBack: false };
  const want = pin ?? flavor;
  const exact = vs.find((b) => b.flavor === want);
  if (exact) return { block: exact, fellBack: false };
  const gen = vs.find((b) => b.flavor === "general");
  return { block: gen ?? vs[0], fellBack: true };
}

export function dataItems(src: DataSource): { items: Item[]; error?: string; fields: string[] } {
  return memo(`data:${src.file}:${JSON.stringify(src.opts)}`, src.text, () => parseData(src.text, src.format, src.opts));
}

/** Keys of all functions grouped, for the drawer. */
export function functionKeys(ws: Workspace, project?: string): string[] {
  return [...new Set(ws.blocks.filter((b) => b.scope === "library" || b.project === project).map((b) => b.key))];
}

export function newBlockKey(kind: BlockKind, type: string, fn: string): string {
  if (kind === "tool" || kind === "schema" || kind === "insertion") return `${kind}:${type ? slug(type) + "/" : ""}${slug(fn)}`.replace(/:\//, ":");
  return `${kind}:${slug(type || "misc")}/${slug(fn)}`;
}

export const keyKind = (key: string) => key.split(":")[0] as BlockKind;
export const keyPath = (key: string) => key.slice(key.indexOf(":") + 1);

export function usages(ws: Workspace, key: string): { project: string; version: string }[] {
  const out: { project: string; version: string }[] = [];
  const kind = keyKind(key);
  const path = keyPath(key);
  for (const p of ws.projects)
    for (const v of p.versions) {
      let hit = false;
      const visit = (nodes: PromptDoc["messages"][number]["children"]) => {
        for (const n of nodes) {
          if (n.k === "use" && n.ref === key) hit = true;
          if ((n.k === "tool" || n.k === "schema") && n.k === kind && n.name === path) hit = true;
          if (n.k === "section") visit(n.children);
        }
      };
      v.doc.messages.forEach((m) => visit(m.children));
      if (hit) out.push({ project: p.name, version: v.id });
    }
  return out;
}

export function mergedRunSettings(p: Project, v?: Version): RunSettings {
  const vr = (v?.doc.front.run ?? {}) as RunSettings;
  return { temperature: 0.2, max_tokens: 1024, ...(p.settings.run ?? {}), ...vr };
}

export function mergedVars(ws: Workspace, p?: Project): Record<string, string> {
  return { ...ws.settings.vars, ...(p?.settings.vars ?? {}) };
}

export function extractJson(body: string): { value?: unknown; error?: string } {
  const m = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(body);
  const src = (m ? m[1] : body).trim();
  if (!src) return { value: {} };
  try {
    return { value: JSON.parse(src) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Move `name` so it sits before `before` (or at the end when `before` is null). */
export function moveBefore(names: string[], name: string, before: string | null): string[] {
  const rest = names.filter((n) => n !== name);
  const i = before === null ? rest.length : rest.indexOf(before);
  rest.splice(i < 0 ? rest.length : i, 0, name);
  return rest;
}
