// Variables as a cluster of bubbles packed on a hex grid, smaller toward the edge — like a watch's app grid.
import { useMemo } from "react";

export interface VarBubble {
  name: string;
  value: string;
  scope: "workspace" | "project";
}

const D = 92; // bubble diameter
const GAP = 8;

/** Axial hex coordinates in a spiral from the center: ring 0, ring 1 (6), ring 2 (12)... */
export function hexSpiral(n: number): { q: number; r: number; ring: number }[] {
  const out = [{ q: 0, r: 0, ring: 0 }];
  const dirs = [
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, 0],
    [-1, 1],
    [0, 1],
  ];
  for (let k = 1; out.length < n; k++) {
    let q = dirs[4][0] * k;
    let r = dirs[4][1] * k;
    for (let i = 0; i < 6 && out.length < n; i++)
      for (let j = 0; j < k && out.length < n; j++) {
        out.push({ q, r, ring: k });
        q += dirs[i][0];
        r += dirs[i][1];
      }
  }
  return out.slice(0, n);
}

export function VarCluster(p: { vars: VarBubble[]; value?: string; onPick(name: string): void; onAdd(): void }) {
  const cells = useMemo(() => {
    const n = p.vars.length + 1; // + the "new" bubble
    const spots = hexSpiral(n);
    const s = D + GAP;
    const pts = spots.map((h) => ({ x: s * (h.q + h.r / 2), y: s * (Math.sqrt(3) / 2) * h.r, ring: h.ring }));
    const xs = pts.map((t) => t.x);
    const ys = pts.map((t) => t.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return {
      pts: pts.map((t) => ({ ...t, x: t.x - minX, y: t.y - minY })),
      w: Math.max(...xs) - minX + D,
      h: Math.max(...ys) - minY + D,
    };
  }, [p.vars.length]);
  const scaleFor = (ring: number) => Math.max(0.62, 1 - ring * 0.1);
  return (
    <div className="cx-cluster-wrap">
      <div className="cx-cluster" style={{ width: cells.w, height: cells.h }} data-testid="var-cluster">
        {p.vars.map((v, i) => {
          const c = cells.pts[i];
          const long = v.name.length > 9;
          return (
            <button
              key={v.name}
              className={`cx-bubble${v.name === p.value ? " on" : ""}${v.scope === "project" ? " project" : ""}`}
              style={{ left: c.x, top: c.y, width: D, height: D, ["--s" as string]: scaleFor(c.ring), animationDelay: `${i * 28}ms` }}
              onClick={() => p.onPick(v.name)}
              title={`${v.name} = ${v.value}${v.scope === "project" ? " (project)" : ""}`}
              data-testid={`var-${v.name}`}
            >
              <span className={`cx-bubble-name${long ? " long" : ""}`}>{v.name}</span>
              <span className="cx-bubble-value">{v.value || "—"}</span>
            </button>
          );
        })}
        {(() => {
          const c = cells.pts[p.vars.length];
          return (
            <button
              className="cx-bubble add"
              style={{ left: c.x, top: c.y, width: D, height: D, ["--s" as string]: scaleFor(c.ring), animationDelay: `${p.vars.length * 28}ms` }}
              onClick={p.onAdd}
              title="Add a new variable in Settings"
              data-testid="var-add"
            >
              <span className="cx-bubble-plus">+</span>
              <span className="cx-bubble-value">new</span>
            </button>
          );
        })()}
      </div>
    </div>
  );
}
