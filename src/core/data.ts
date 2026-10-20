// Data sources: raw files parsed into items (strings or records).

export type Rec = Record<string, unknown>;
export type Item = string | Rec;
export type Split = "lines" | "paragraphs" | "whole";
export type DataFormat = "text" | "jsonl" | "json" | "csv" | "tsv";

export interface DataOptions {
  split?: Split;
  /** Field used as the item id for scoring (records) — strings are their own id. */
  id?: string;
}

export function formatOf(path: string): DataFormat {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "jsonl" || ext === "ndjson") return "jsonl";
  if (ext === "json") return "json";
  if (ext === "csv") return "csv";
  if (ext === "tsv") return "tsv";
  return "text";
}

export const DATA_EXTS = ["txt", "md", "jsonl", "ndjson", "json", "csv", "tsv"];

export function parseData(text: string, format: DataFormat, opts: DataOptions = {}): { items: Item[]; error?: string; fields: string[] } {
  try {
    let items: Item[];
    switch (format) {
      case "jsonl":
        items = text
          .split(/\r?\n/)
          .filter((l) => l.trim())
          .map((l) => JSON.parse(l) as Item);
        break;
      case "json": {
        const v = JSON.parse(text);
        items = Array.isArray(v) ? v : typeof v === "object" && v ? Object.entries(v).map(([key, value]) => ({ key, value })) : [String(v)];
        break;
      }
      case "csv":
      case "tsv":
        items = parseDelimited(text, format === "csv" ? "," : "\t");
        break;
      default: {
        const split = opts.split ?? "lines";
        const t = text.replace(/\r\n/g, "\n");
        if (split === "whole") items = t.trim() ? [t.replace(/\n+$/, "")] : [];
        else if (split === "paragraphs")
          items = t
            .split(/\n\s*\n/)
            .map((p) => p.replace(/^\n+|\n+$/g, ""))
            .filter((p) => p.trim());
        else items = t.split("\n").filter((l) => l.trim());
      }
    }
    items = items.map((x) => (typeof x === "object" && x !== null ? (x as Rec) : String(x)));
    return { items, fields: fieldsOf(items) };
  } catch (e) {
    return { items: [], fields: [], error: (e as Error).message };
  }
}

export function fieldsOf(items: Item[]): string[] {
  const set = new Set<string>();
  for (const it of items.slice(0, 200)) if (typeof it === "object") for (const k of Object.keys(it)) set.add(k);
  return [...set];
}

export function parseDelimited(text: string, sep: string): Rec[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"' && cell === "") q = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (!nonEmpty.length) return [];
  const [header, ...body] = nonEmpty;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ""])));
}

export const itemId = (it: Item, idField?: string): string =>
  typeof it === "string" ? it : String(idField && it[idField] !== undefined ? it[idField] : (it.id ?? it.name ?? JSON.stringify(it)));

export const itemText = (it: Item): string =>
  typeof it === "string"
    ? it
    : Object.entries(it)
        .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join(", ");
