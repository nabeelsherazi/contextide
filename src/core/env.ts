// Glue: build a RenderEnv for a version of a project in a workspace.
import { type Workspace, type Project, type Version, resolveBlock, dataItems, mergedVars, variantsOf } from "./workspace";
import type { RenderEnv } from "./render";
import type { Item } from "./data";

export interface EnvOptions {
  now?: Date;
  seed?: number;
  flavor?: string;
  dataOverride?: Record<string, Item[]>;
  mute?: Set<string>;
  countTokens?: (s: string) => number;
  vars?: Record<string, string>;
}

export function envFor(ws: Workspace, p: Project | undefined, v: Version | undefined, o: EnvOptions = {}): RenderEnv {
  const flavor = o.flavor ?? v?.flavor ?? "general";
  const pname = p?.name;
  const firstOf = (key: string) => {
    const vs = variantsOf(ws, key, pname);
    return vs.find((b) => b.flavor === flavor) ?? vs.find((b) => b.flavor === "general") ?? vs[0];
  };
  return {
    flavor,
    resolve: (ref, pin) => resolveBlock(ws, ref, flavor, pin, pname),
    data: (name) => {
      const d = p?.data.find((x) => x.name === name);
      return d ? dataItems(d).items : undefined;
    },
    tool: (name) => firstOf(`tool:${name}`),
    schema: (name) => firstOf(`schema:${name}`),
    vars: { ...mergedVars(ws, p), ...(o.vars ?? {}) },
    now: o.now ?? new Date(),
    seed: o.seed ?? Number(v?.doc.front.seed ?? 1),
    dataOverride: o.dataOverride,
    mute: o.mute,
    countTokens: o.countTokens,
  };
}
