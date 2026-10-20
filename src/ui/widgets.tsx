import { useEffect, useRef, useState } from "react";

/** A text input that commits on blur/Enter, keeping local edits while typing. */
export function Field(p: { value: string; onCommit(v: string): void; placeholder?: string; className?: string; list?: string; testid?: string; multiline?: boolean; rows?: number }) {
  const [v, setV] = useState(p.value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setV(p.value);
  }, [p.value]);
  const commit = () => {
    if (v !== p.value) p.onCommit(v);
  };
  const common = {
    className: p.className ?? "cx-input",
    value: v,
    placeholder: p.placeholder,
    "data-testid": p.testid,
    onFocus: () => (focused.current = true),
    onBlur: () => {
      focused.current = false;
      commit();
    },
  };
  if (p.multiline) return <textarea {...common} rows={p.rows ?? 3} onChange={(e) => setV(e.target.value)} />;
  return <input {...common} list={p.list} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} />;
}

export function NumField(p: { value: number | undefined; onCommit(v: number | undefined): void; step?: number; min?: number; max?: number; placeholder?: string; testid?: string }) {
  return (
    <Field
      value={p.value === undefined ? "" : String(p.value)}
      placeholder={p.placeholder}
      testid={p.testid}
      className="cx-input cx-num"
      onCommit={(s) => {
        const t = s.trim();
        if (!t) return p.onCommit(undefined);
        const n = Number(t);
        if (Number.isFinite(n)) p.onCommit(n);
      }}
    />
  );
}

export function KeyValues(p: { value: Record<string, string>; onChange(v: Record<string, string>): void; keyPlaceholder?: string; valuePlaceholder?: string; testid?: string }) {
  const entries = Object.entries(p.value);
  const set = (i: number, k: string, v: string) => {
    const next = entries.slice();
    next[i] = [k, v];
    p.onChange(Object.fromEntries(next.filter(([key]) => key.trim())));
  };
  return (
    <div className="cx-kv" data-testid={p.testid}>
      {entries.map(([k, v], i) => (
        <div key={i} className="cx-kv-row">
          <Field value={k} onCommit={(nk) => set(i, nk, v)} placeholder={p.keyPlaceholder ?? "name"} />
          <Field value={v} onCommit={(nv) => set(i, k, nv)} placeholder={p.valuePlaceholder ?? "value"} />
          <button className="cx-mini" onClick={() => p.onChange(Object.fromEntries(entries.filter((_, j) => j !== i)))} title="Remove">
            ×
          </button>
        </div>
      ))}
      <AddKV onAdd={(k, v) => p.onChange({ ...p.value, [k]: v })} keyPlaceholder={p.keyPlaceholder} valuePlaceholder={p.valuePlaceholder} />
    </div>
  );
}

function AddKV(p: { onAdd(k: string, v: string): void; keyPlaceholder?: string; valuePlaceholder?: string }) {
  const [k, setK] = useState("");
  const [v, setV] = useState("");
  const add = () => {
    if (!k.trim()) return;
    p.onAdd(k.trim(), v);
    setK("");
    setV("");
  };
  return (
    <div className="cx-kv-row cx-kv-new">
      <input className="cx-input" value={k} placeholder={p.keyPlaceholder ?? "name"} onChange={(e) => setK(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
      <input className="cx-input" value={v} placeholder={p.valuePlaceholder ?? "value"} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
      <button className="cx-mini" onClick={add} title="Add">
        +
      </button>
    </div>
  );
}

/** A JSON textarea that only commits valid JSON. */
export function JsonField(p: { value: unknown; onCommit(v: unknown): void; rows?: number; testid?: string }) {
  const [t, setT] = useState(() => JSON.stringify(p.value ?? {}, null, 2));
  const [err, setErr] = useState<string | null>(null);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setT(JSON.stringify(p.value ?? {}, null, 2));
  }, [p.value]);
  return (
    <div className="cx-json">
      <textarea
        className="cx-input cx-mono"
        rows={p.rows ?? 4}
        value={t}
        data-testid={p.testid}
        spellCheck={false}
        onFocus={() => (focused.current = true)}
        onChange={(e) => {
          setT(e.target.value);
          try {
            JSON.parse(e.target.value || "{}");
            setErr(null);
          } catch (x) {
            setErr((x as Error).message);
          }
        }}
        onBlur={() => {
          focused.current = false;
          try {
            p.onCommit(JSON.parse(t || "{}"));
          } catch {
            /* keep error */
          }
        }}
      />
      {err && <div className="cx-field-err">{err}</div>}
    </div>
  );
}

export function Seg<T extends string>(p: { value: T; options: [NoInfer<T>, string][]; onChange(v: NoInfer<T>): void; testid?: string }) {
  return (
    <div className="cx-seg-ctl" data-testid={p.testid}>
      {p.options.map(([v, l]) => (
        <button key={v} className={v === p.value ? "on" : ""} onClick={() => p.onChange(v)} data-value={v}>
          {l}
        </button>
      ))}
    </div>
  );
}
