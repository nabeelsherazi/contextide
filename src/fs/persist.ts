import { get, set, del } from "idb-keyval";

const KEY = "contextide:workspace";

export type Saved = { kind: "folder"; handle: FileSystemDirectoryHandle } | { kind: "browser"; name: string };

export const saveWorkspace = (s: Saved) => set(KEY, s);
export const loadSaved = () => get<Saved>(KEY);
export const forgetWorkspace = () => del(KEY);

export async function hasPermission(h: FileSystemDirectoryHandle, request: boolean): Promise<boolean> {
  const opts = { mode: "readwrite" as const };
  if ((await h.queryPermission(opts)) === "granted") return true;
  if (!request) return false;
  return (await h.requestPermission(opts)) === "granted";
}
