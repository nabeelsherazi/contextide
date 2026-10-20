// A tiny virtual filesystem over a FileSystemDirectoryHandle (a real folder, or OPFS),
// plus an in-memory implementation for tests.

export interface FileEntry {
  text: string;
  mtime: number;
}

export interface Vfs {
  name: string;
  kind: "folder" | "browser" | "memory";
  readAll(): Promise<Map<string, FileEntry>>;
  /** Return entries whose mtime differs from `known`, plus deletions. */
  scan(known: Map<string, number>): Promise<{ changed: Map<string, FileEntry>; deleted: string[] }>;
  write(path: string, text: string): Promise<number>;
  remove(path: string): Promise<void>;
}

const TEXT_EXT = /\.(md|json|jsonl|ndjson|txt|csv|tsv)$/i;
const SKIP_DIR = new Set([".git", "node_modules", ".obsidian", ".trash"]);
const MAX_BYTES = 25 * 1024 * 1024;

async function* walk(dir: FileSystemDirectoryHandle, prefix = ""): AsyncGenerator<[string, FileSystemFileHandle]> {
  for await (const [name, h] of dir.entries()) {
    if (name.startsWith(".") && h.kind === "directory") continue;
    if (h.kind === "directory") {
      if (SKIP_DIR.has(name)) continue;
      yield* walk(h as FileSystemDirectoryHandle, `${prefix}${name}/`);
    } else if (TEXT_EXT.test(name)) yield [`${prefix}${name}`, h as FileSystemFileHandle];
  }
}

async function dirFor(root: FileSystemDirectoryHandle, path: string, create: boolean): Promise<[FileSystemDirectoryHandle, string]> {
  const parts = path.split("/");
  const name = parts.pop()!;
  let d = root;
  for (const p of parts) d = await d.getDirectoryHandle(p, { create });
  return [d, name];
}

export function handleVfs(root: FileSystemDirectoryHandle, kind: "folder" | "browser"): Vfs {
  return {
    name: root.name || "browser workspace",
    kind,
    async readAll() {
      const out = new Map<string, FileEntry>();
      for await (const [path, h] of walk(root)) {
        const f = await h.getFile();
        if (f.size > MAX_BYTES) continue;
        out.set(path, { text: await f.text(), mtime: f.lastModified });
      }
      return out;
    },
    async scan(known) {
      const changed = new Map<string, FileEntry>();
      const seen = new Set<string>();
      for await (const [path, h] of walk(root)) {
        seen.add(path);
        const f = await h.getFile();
        if (known.get(path) !== f.lastModified && f.size <= MAX_BYTES) changed.set(path, { text: await f.text(), mtime: f.lastModified });
      }
      const deleted = [...known.keys()].filter((p) => !seen.has(p));
      return { changed, deleted };
    },
    async write(path, text) {
      const [d, name] = await dirFor(root, path, true);
      const fh = await d.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(text);
      await w.close();
      return (await fh.getFile()).lastModified;
    },
    async remove(path) {
      const [d, name] = await dirFor(root, path, false);
      await d.removeEntry(name);
    },
  };
}

export function memoryVfs(initial: Record<string, string> = {}): Vfs & { files: Map<string, FileEntry> } {
  let clock = 1;
  const files = new Map<string, FileEntry>(Object.entries(initial).map(([k, v]) => [k, { text: v, mtime: clock++ }]));
  return {
    name: "memory",
    kind: "memory",
    files,
    async readAll() {
      return new Map(files);
    },
    async scan(known) {
      const changed = new Map([...files].filter(([p, e]) => known.get(p) !== e.mtime));
      return { changed, deleted: [...known.keys()].filter((p) => !files.has(p)) };
    },
    async write(path, text) {
      const mtime = clock++;
      files.set(path, { text, mtime });
      return mtime;
    },
    async remove(path) {
      files.delete(path);
    },
  };
}

export const fsAccessSupported = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

export async function browserWorkspaceRoot(name = "default"): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(`ws-${name}`, { create: true });
}
