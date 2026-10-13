import { readFileSync } from 'node:fs';
import { resolveScripts } from '../src/blueprint/scripts';
import { toFileJson } from '../src/blueprint/serialize';
import type { Blueprint } from '../src/blueprint/types';
import { loadBlueprint } from '../src/blueprint/validate';
import { defaultRegistry } from '../src/parts/registry';
import { attachBehavior, fillSlot, fitBehavior, parseBehaviorHeader, type BehaviorFit } from '../src/script/shelf';
import type { Robot } from '../src/world/Robot';
import type { World } from '../src/world/World';

/** Shared by the tests of the shelf behaviors (`behaviors/`): robots get a behavior the way the builder gives it. */
export const registry = defaultRegistry();

export const bpFile = (file: string): string => readFileSync(new URL(`../../../blueprints/${file}`, import.meta.url), 'utf8');
/** A shelf file's text: `shelf('hover')` is `behaviors/hover.js`. */
export const shelf = (id: string): string => readFileSync(new URL(`../../../behaviors/${id}.js`, import.meta.url), 'utf8');

/** A shipped blueprint, as a `Blueprint`, without the scripts named in `drop` (the ones a shelf behavior replaces). */
export function shipped(name: string, drop: readonly string[] = []): Blueprint {
  const raw = resolveScripts(JSON.parse(bpFile(`${name}.json`)), bpFile).raw;
  const bp = loadBlueprint(raw, registry).blueprint;
  return { ...bp, scripts: bp.scripts.filter((s) => !drop.includes(s.id)), bindings: bp.bindings.filter((b) => b.script === undefined || !drop.includes(b.script)) };
}

/** A blueprint written in the test, as a `Blueprint`. */
export function built(raw: unknown): Blueprint {
  return loadBlueprint(raw, registry).blueprint;
}

export interface Given {
  blueprint: Blueprint;
  fit: BehaviorFit;
  scriptId: string;
}

/**
 * Adds a shelf behavior to a blueprint as the builder does: `attachBehavior`, then every slot filled with its guess
 * (`fitBehavior`, `fillSlot`), or with the ids given for that group in `fill`. `params` are the script's params.
 */
export function give(bp: Blueprint, id: string, opts: { params?: Record<string, number>; fill?: Record<string, readonly string[]> } = {}): Given {
  const source = shelf(id);
  const header = parseBehaviorHeader(source).header;
  if (!header) throw new Error(`${id} has no behavior header`);
  const attached = attachBehavior(bp, id, source);
  if (!attached.ok) throw new Error(attached.error);
  let out = attached.blueprint;
  const fit = fitBehavior(out, registry, header);
  for (const s of fit.slots) out = fillSlot(out, registry, s.slot, opts.fill?.[s.slot.group] ?? s.guess);
  if (opts.params) out = { ...out, scripts: out.scripts.map((s) => (s.id === attached.scriptId ? { ...s, params: { ...opts.params } } : s)) };
  return { blueprint: out, fit, scriptId: attached.scriptId };
}

/** What `spawnBlueprint` takes: the blueprint as its file would be, with the scripts' code inline. */
export function raw(bp: Blueprint): unknown {
  return toFileJson(bp, registry, { inlineScripts: true });
}

/** The pose of the body a robot's core is on. */
export function coreState(w: World, r: Robot): { x: number; y: number; angle: number; vx: number; vy: number } {
  const core = r.parts.get(r.primaryCoreId ?? r.rootId);
  return w.physics.state(r.groups[core?.group ?? 0]?.bodyId as number);
}
