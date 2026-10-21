// Thin app-level wrappers over shadcn/ui primitives: commit-on-blur fields, a Select that
// tolerates "no value", a segmented control, and labelled rows in ContextIDE's serif voice.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** A labelled control: serif italic label above (or beside, for checks). */
export function FieldRow(p: { label: ReactNode; children: ReactNode; className?: string; hint?: ReactNode }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-2 font-serif text-[15px] text-ink-3 italic", p.className)}>
      <span className="pl-0.5 leading-none">{p.label}</span>
      <div className="not-italic">{p.children}</div>
      {p.hint && <span className="font-serif text-[13.5px] leading-snug text-ink-3 italic">{p.hint}</span>}
    </label>
  );
}

export function Hint(p: { children: ReactNode; className?: string }) {
  return <p className={cn("my-0.5 font-serif text-[15px] leading-normal text-ink-3 italic", p.className)}>{p.children}</p>;
}

export function CheckRow(p: { checked: boolean; onChange(v: boolean): void; children: ReactNode; disabled?: boolean; testid?: string }) {
  return (
    <div>
      <label className={cn("flex cursor-pointer items-center gap-3 font-serif text-[16px] text-ink-2 not-italic", p.disabled && "opacity-50")}>
        <Checkbox checked={p.checked} disabled={p.disabled} onCheckedChange={(v) => p.onChange(v === true)} data-testid={p.testid} />
        <span>{p.children}</span>
      </label>
    </div>
  );
}

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
    value: v,
    placeholder: p.placeholder,
    "data-testid": p.testid,
    onFocus: () => (focused.current = true),
    onBlur: () => {
      focused.current = false;
      commit();
    },
  };
  if (p.multiline) return <Textarea {...common} className={p.className} rows={p.rows ?? 3} onChange={(e) => setV(e.target.value)} />;
  return <Input {...common} className={p.className} list={p.list} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} />;
}

export function NumField(p: { value: number | undefined; onCommit(v: number | undefined): void; placeholder?: string; testid?: string; className?: string }) {
  return (
    <Field
      className={cn("font-mono text-[13px] tabular-nums placeholder:font-serif", p.className)}
      value={p.value === undefined ? "" : String(p.value)}
      placeholder={p.placeholder}
      testid={p.testid}
      onCommit={(s) => {
        const t = s.trim();
        if (!t) return p.onCommit(undefined);
        const n = Number(t);
        if (Number.isFinite(n)) p.onCommit(n);
      }}
    />
  );
}

const NONE = "__none__";

/** shadcn Select with plain string options; "" is allowed as a value (Radix forbids it). */
export function Choice(p: {
  value: string;
  onChange(v: string): void;
  options: (string | [string, ReactNode])[];
  placeholder?: string;
  className?: string;
  testid?: string;
  size?: "sm" | "default";
  title?: string;
  itemClassName?: string;
}) {
  const opts = p.options.map((o) => (typeof o === "string" ? ([o, o] as [string, ReactNode]) : o));
  const hasEmpty = opts.some(([v]) => v === "");
  return (
    <Select value={p.value === "" ? (hasEmpty ? NONE : "") : p.value} onValueChange={(v) => p.onChange(v === NONE ? "" : v)}>
      <SelectTrigger className={cn("min-w-0", p.className)} size={p.size ?? "sm"} data-testid={p.testid} title={p.title}>
        <SelectValue placeholder={p.placeholder} />
      </SelectTrigger>
      <SelectContent>
        {opts.map(([v, label]) => (
          <SelectItem key={v || NONE} value={v === "" ? NONE : v} data-value={v} className={p.itemClassName}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Segmented control (single choice, never empty). */
export function Seg<T extends string>(p: { value: T; options: [NoInfer<T>, ReactNode][]; onChange(v: NoInfer<T>): void; testid?: string; className?: string }) {
  return (
    <ToggleGroup type="single" value={p.value} onValueChange={(v) => v && p.onChange(v as T)} className={p.className} data-testid={p.testid}>
      {p.options.map(([v, l]) => (
        <ToggleGroupItem key={v} value={v} data-value={v} className="h-7 px-3">
          {l}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
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
    <div className="flex flex-col gap-1.5" data-testid={p.testid}>
      {entries.map(([k, v], i) => (
        <div key={i} className="grid grid-cols-[1fr_1.6fr_auto] items-center gap-1.5">
          <Field value={k} onCommit={(nk) => set(i, nk, v)} placeholder={p.keyPlaceholder ?? "name"} className={KEY} />
          <Field value={v} onCommit={(nv) => set(i, k, nv)} placeholder={p.valuePlaceholder ?? "value"} />
          <Button variant="ghost" size="icon-sm" onClick={() => p.onChange(Object.fromEntries(entries.filter((_, j) => j !== i)))} title="Remove">
            <X />
          </Button>
        </div>
      ))}
      <AddKV onAdd={(k, v) => p.onChange({ ...p.value, [k]: v })} keyPlaceholder={p.keyPlaceholder} valuePlaceholder={p.valuePlaceholder} />
    </div>
  );
}

/** Keys are identifiers, so they speak in the mono. */
const KEY = "font-mono text-[12.5px] placeholder:font-serif";

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
    <div className="cx-kv-new grid grid-cols-[1fr_1.6fr_auto] items-center gap-1.5">
      <Input value={k} placeholder={p.keyPlaceholder ?? "name"} onChange={(e) => setK(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} className={KEY} />
      <Input value={v} placeholder={p.valuePlaceholder ?? "value"} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
      <Button variant="ghost" size="icon-sm" className="text-good disabled:text-ink-4" onClick={add} title="Add this row" disabled={!k.trim()} data-testid="kv-add">
        <Check />
      </Button>
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
    <div>
      <Textarea
        className="font-mono text-[12px]"
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
      {err && <div className="mt-1 text-[11.5px] text-danger">{err}</div>}
    </div>
  );
}

/** Small capitals, tracked like an inscription: the heading voice of drawers and panels. */
export function Eyebrow(p: { children: ReactNode; className?: string }) {
  return <div className={cn("font-serif text-[11.5px] font-medium tracking-[0.22em] text-ink-3 uppercase", p.className)}>{p.children}</div>;
}
