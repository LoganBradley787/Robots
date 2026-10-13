import { partCells, rootPartId } from '../assembly/assemble';
import { defaultSize } from '../parts/footprint';
import type { PartRegistry } from '../parts/registry';
import type { Rotation } from '../parts/types';
import { partId } from './expand';
import type { Binding, Blueprint, CoreControls, PlacedPart, Recipe, ScriptSpec } from './types';

/**
 * Pure edit operations for the builder. Each returns a new Blueprint, or the same object when nothing changed,
 * so callers can skip history entries by identity. Blueprint order is preserved; new parts are appended.
 */

export function blankBlueprint(name: string): Blueprint {
  return { format: 1, name, parts: [], bindings: [], scripts: [], continuations: [] };
}

function cellsOf(p: PlacedPart, registry: PartRegistry): { x: number; y: number }[] {
  return registry.has(p.part) ? partCells(p, registry).map((c) => c.cell) : [{ x: p.x, y: p.y }];
}

/** The part covering a cell, if any. */
export function partAt(bp: Blueprint, registry: PartRegistry, x: number, y: number): PlacedPart | undefined {
  return bp.parts.find((p) => cellsOf(p, registry).some((c) => c.x === x && c.y === y));
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}#${n}`)) return `${base}#${n}`;
}

/** Places a part, replacing whatever covers its cells. Placing an identical part is a no-op. */
export function placePart(bp: Blueprint, registry: PartRegistry, part: string, x: number, y: number, rot: Rotation): Blueprint {
  const probe: PlacedPart = { id: '', part, x, y, rot, tags: [] };
  const cells = cellsOf(probe, registry);
  const covered = (p: PlacedPart): boolean => cellsOf(p, registry).some((c) => cells.some((d) => d.x === c.x && d.y === c.y));
  const hit = bp.parts.filter(covered);
  const same = hit[0];
  if (hit.length === 1 && same && same.part === part && same.x === x && same.y === y && same.rot === rot) return bp;
  const cleared = removeParts(bp, hit.map((p) => p.id), registry);
  const id = uniqueId(partId(part, x, y), new Set(cleared.parts.map((p) => p.id)));
  return { ...cleared, parts: [...cleared.parts, { id, part, x, y, rot, tags: [id] }] };
}

export function erasePartAt(bp: Blueprint, registry: PartRegistry, x: number, y: number): Blueprint {
  const hit = partAt(bp, registry, x, y);
  return hit ? removeParts(bp, [hit.id], registry) : bp;
}

export function removeParts(bp: Blueprint, ids: readonly string[], registry: PartRegistry): Blueprint {
  if (!bp.parts.some((p) => ids.includes(p.id))) return bp;
  const out: Blueprint = { ...bp, parts: bp.parts.filter((p) => !ids.includes(p.id)) };
  // Everything that named a removed part by id goes with it (M7): a core's controls, and the pilot and takeover
  // order, which would otherwise point at nothing and never validate again.
  if (bp.cores?.some((c) => ids.includes(c.core))) {
    const cores = bp.cores.filter((c) => !ids.includes(c.core));
    if (cores.length > 0) out.cores = cores;
    else delete out.cores;
  }
  if (bp.primaryCore !== undefined && ids.includes(bp.primaryCore)) delete out.primaryCore;
  if (bp.corePriority?.some((id) => ids.includes(id))) {
    const order = bp.corePriority.filter((id) => !ids.includes(id));
    if (order.length > 0) out.corePriority = order;
    else delete out.corePriority;
  }
  // With the primary core gone the next core is the primary one, and the primary core's controls are the top-level
  // ones: an entry of its own in `cores` would never validate again (review E3).
  const root = rootPartId(bp, registry);
  if (root !== undefined && ids.includes(root)) {
    const next = rootPartId(out, registry);
    const entry = out.cores?.find((c) => c.core === next);
    if (entry) return promoteControls(out, entry);
  }
  return out;
}

/**
 * Moves a core's controls to the top level and drops its `cores` entry. Nothing the robot had is lost: its own
 * bindings and scripts stay and the core's come after them, a binding both had once, a script id both had under a new
 * name (`guide-2`) that the core's bindings follow. A scoped core's targets get its scope (`burn` to `missile1.burn`),
 * so its bindings still mean its own parts; the code of its scripts is not rewritten.
 */
function promoteControls(bp: Blueprint, entry: CoreControls): Blueprint {
  const scope = entry.scope;
  const scoped = new Set(scope === undefined ? [] : bp.parts.filter((p) => p.tags.includes(scope)).flatMap((p) => p.tags));
  const target = (t: string): string => (scope !== undefined && !bp.parts.some((p) => p.id === t) && scoped.has(`${scope}.${t}`) ? `${scope}.${t}` : t);
  const taken = new Set(bp.scripts.map((s) => s.id));
  const renamed = new Map<string, string>();
  const scripts: ScriptSpec[] = entry.scripts.map((s) => {
    const id = uniqueName(s.id, taken);
    taken.add(id);
    renamed.set(s.id, id);
    return id === s.id ? s : { ...s, id };
  });
  const same = (a: Binding, b: Binding): boolean => a.key === b.key && a.mode === b.mode && a.target === b.target && a.channel === b.channel && a.value === b.value && a.script === b.script;
  const bindings = [...bp.bindings];
  for (const b of entry.bindings) {
    const moved: Binding = { ...b, ...(b.target !== undefined ? { target: target(b.target) } : {}), ...(b.script !== undefined ? { script: renamed.get(b.script) ?? b.script } : {}) };
    // A script binding is never a repeat: the script it runs is the core's own, whatever it is called.
    if (moved.mode === 'script' || !bindings.some((x) => same(x, moved))) bindings.push(moved);
  }
  const out: Blueprint = { ...bp, bindings, scripts: [...bp.scripts, ...scripts] };
  if (entry.autoControls === false) out.autoControls = false;
  const cores = (bp.cores ?? []).filter((c) => c !== entry);
  if (cores.length > 0) out.cores = cores;
  else delete out.cores;
  return out;
}

function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** Explicit tags first, the implicit id tag last, like the grid expansion writes them. */
function withTags(p: PlacedPart, explicit: string[]): PlacedPart {
  const tags: string[] = [];
  for (const t of explicit) if (t !== p.id && !tags.includes(t)) tags.push(t);
  tags.push(p.id);
  return { ...p, tags };
}

export function addTagToParts(bp: Blueprint, ids: readonly string[], tag: string): Blueprint {
  const t = tag.trim();
  if (t === '') return bp;
  return { ...bp, parts: bp.parts.map((p) => (ids.includes(p.id) ? withTags(p, [...p.tags.filter((x) => x !== p.id), t]) : p)) };
}

/** The implicit id tag cannot be removed. */
export function removeTagFromParts(bp: Blueprint, ids: readonly string[], tag: string): Blueprint {
  return { ...bp, parts: bp.parts.map((p) => (ids.includes(p.id) ? withTags(p, p.tags.filter((x) => x !== tag && x !== p.id)) : p)) };
}

export type RotateResult = { ok: true; blueprint: Blueprint } | { ok: false; error: string };

/**
 * Turns the given parts in place, all at once, or refuses the whole thing when a turned part's cells would land on
 * another part (review E1: a multi-cell part turned onto a neighbour used to lose one of the two on save). Parts
 * turned together are checked where they end up, so two neighbours can swing clear of each other in one step.
 */
export function setPartRotations(bp: Blueprint, registry: PartRegistry, rots: ReadonlyMap<string, Rotation>): RotateResult {
  const turned = new Set<string>();
  const parts = bp.parts.map((p) => {
    const rot = rots.get(p.id);
    if (rot === undefined || rot === p.rot) return p;
    turned.add(p.id);
    return { ...p, rot };
  });
  if (turned.size === 0) return { ok: true, blueprint: bp };
  const occupied = new Map<string, string>();
  for (const p of parts) if (!turned.has(p.id)) for (const c of cellsOf(p, registry)) occupied.set(`${c.x},${c.y}`, p.id);
  for (const p of parts) {
    if (!turned.has(p.id)) continue;
    for (const c of cellsOf(p, registry)) {
      const key = `${c.x},${c.y}`;
      const hit = occupied.get(key);
      if (hit !== undefined) return { ok: false, error: `${p.id} turned would overlap ${hit} at (${c.x}, ${c.y})` };
      occupied.set(key, p.id);
    }
  }
  return { ok: true, blueprint: { ...bp, parts } };
}

/** Turns one part in place. A turn onto another part is refused: the same blueprint comes back (`setPartRotations` says why). */
export function setPartRotation(bp: Blueprint, registry: PartRegistry, id: string, rot: Rotation): Blueprint {
  const r = setPartRotations(bp, registry, new Map([[id, rot]]));
  return r.ok ? r.blueprint : bp;
}

export function setBindings(bp: Blueprint, bindings: Binding[]): Blueprint {
  return { ...bp, bindings: bindings.map((b) => ({ ...b })) };
}

/** Turns auto controls on or off for the given parts (`11`). On is stored as the field being absent. */
export function setPartsAuto(bp: Blueprint, ids: readonly string[], on: boolean): Blueprint {
  return {
    ...bp,
    parts: bp.parts.map((p) => {
      if (!ids.includes(p.id) || (p.auto !== false) === on) return p;
      if (on) {
        const { auto: _auto, ...rest } = p;
        return rest;
      }
      return { ...p, auto: false };
    }),
  };
}

/** M10: starts the given parts armed or unarmed. Unarmed is stored as the field being absent. */
export function setPartsArmed(bp: Blueprint, ids: readonly string[], on: boolean): Blueprint {
  return {
    ...bp,
    parts: bp.parts.map((p) => {
      if (!ids.includes(p.id) || (p.armed === true) === on) return p;
      if (!on) {
        const { armed: _armed, ...rest } = p;
        return rest;
      }
      return { ...p, armed: true };
    }),
  };
}

/** Turns auto controls on or off for the whole blueprint. */
export function setAutoControls(bp: Blueprint, on: boolean): Blueprint {
  if ((bp.autoControls !== false) === on) return bp;
  if (on) {
    const { autoControls: _a, ...rest } = bp;
    return rest;
  }
  return { ...bp, autoControls: false };
}

/**
 * M12: what the given fabricators make. With a recipe, it is added (or replaces the one of its name) and the parts make
 * it; without, the parts make nothing. Recipes no part makes any more are dropped.
 */
export function setPartsMakes(bp: Blueprint, ids: readonly string[], recipe: Recipe | undefined): Blueprint {
  // A bay names what it builds after its tag: one without a tag gets a free one (`bay`, then `bayB`, `bayC`, ...).
  const used = new Set(bp.parts.flatMap((p) => p.tags));
  const freeTag = (): string => {
    for (const t of ['bay', ...'BCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => `bay${c}`)]) if (!used.has(t)) return t;
    return `bay${used.size}`;
  };
  const parts: PlacedPart[] = bp.parts.map((p) => {
    if (!ids.includes(p.id)) return p;
    if (recipe) {
      if (p.tags.some((t) => t !== p.id)) return { ...p, makes: recipe.name };
      const tag = freeTag();
      used.add(tag);
      return { ...p, tags: [tag, ...p.tags], makes: recipe.name };
    }
    const { makes: _makes, ...rest } = p;
    return rest;
  });
  const recipes = [...(bp.recipes ?? []).filter((r) => r.name !== recipe?.name), ...(recipe ? [recipe] : [])].filter((r) => parts.some((p) => p.makes === r.name));
  const { recipes: _old, ...rest } = bp;
  return recipes.length > 0 ? { ...rest, parts, recipes } : { ...rest, parts };
}

/**
 * M12: the size of the given stretchy parts (a bay's hollow), each from its own: `resize` gets a part's size and gives
 * its new one. The def's default size is stored as no size at all, so the file keeps the plain token.
 */
export function setPartsSize(bp: Blueprint, ids: readonly string[], resize: (size: [number, number]) => [number, number], registry: PartRegistry): Blueprint {
  return {
    ...bp,
    parts: bp.parts.map((p) => {
      if (!ids.includes(p.id) || !registry.has(p.part)) return p;
      const def = registry.get(p.part);
      const d = defaultSize(def);
      if (!d) return p;
      const next = resize(p.size ?? d);
      const { size: _size, ...rest } = p;
      return next[0] === d[0] && next[1] === d[1] ? rest : { ...rest, size: [next[0], next[1]] };
    }),
  };
}

/** Whether a part's id is the one its cell gives it (`type@x,y`). Any other id was written by hand and is kept as it is. */
function idFromPlace(p: PlacedPart): boolean {
  return p.id === partId(p.part, p.x, p.y);
}

/**
 * `bp` with `parts` as its parts and every name of a part id followed from old to new (`ids`), all at once, so two
 * parts may trade ids: binding targets (the robot's and each core's), each core's entry, `primaryCore`, and
 * `corePriority`. A part's own id tag is its own business (`withId`). Script code is not rewritten: a script that
 * names a part by id is found by `scriptIdMentions` (`script/reading.ts`).
 */
function renameIds(bp: Blueprint, parts: PlacedPart[], ids: ReadonlyMap<string, string>): Blueprint {
  const rename = (id: string): string => ids.get(id) ?? id;
  const changed = [...ids].some(([from, to]) => from !== to);
  if (!changed) return { ...bp, parts };
  const renameBindings = (bs: readonly Binding[]): Binding[] => bs.map((b) => (b.target !== undefined && ids.has(b.target) ? { ...b, target: rename(b.target) } : b));
  const out: Blueprint = { ...bp, parts, bindings: renameBindings(bp.bindings) };
  if (bp.primaryCore !== undefined) out.primaryCore = rename(bp.primaryCore);
  if (bp.corePriority !== undefined) out.corePriority = bp.corePriority.map(rename);
  if (bp.cores !== undefined) out.cores = bp.cores.map((c) => ({ ...c, core: rename(c.core), bindings: renameBindings(c.bindings) }));
  return out;
}

/** The part under another id: its own id tag follows, where it stood among its tags (last, when it had none). */
function withId(p: PlacedPart, id: string): PlacedPart {
  if (id === p.id) return p;
  const tags = p.tags.includes(p.id) ? p.tags.map((t) => (t === p.id ? id : t)) : [...p.tags, id];
  return { ...p, id, tags: tags.filter((t, i) => tags.indexOf(t) === i) };
}

/** Cells a part may be in: every whole cell from (`minX`, `minY`) to (`maxX`, `maxY`), both included. */
export interface CellArea {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface MoveOptions {
  /** The cells parts may land on. Absent: anywhere (a blueprint has no edge of its own). */
  area?: CellArea;
}

/** `ids` maps every moved part's old id to its new one (the same id for a part that keeps a hand-written id). */
export type MoveResult = { ok: true; blueprint: Blueprint; ids: Map<string, string> } | { ok: false; error: string };

/**
 * Moves parts by whole cells, each by its own step, all at once or not at all (M16). A moved part stays the part it
 * was: its tags, its settings (`auto`, `armed`, `makes`, `size`, and anything else on it), its rotation, and its place
 * in part order. Refused, with the blueprint untouched, when a moved part would land on a part that is not itself
 * moving, on another moved part, or outside `opts.area`. Parts that move together are checked where they end up, so
 * two may trade places and a row may shift along itself.
 *
 * Ids follow position: a part whose id is its cell's (`thruster@3,2`) gets its new cell's, and everything in the
 * blueprint that named the old id follows in the same step (`renameIds`): its own id tag, bindings, a core's entry in
 * `cores`, `primaryCore`, `corePriority`. A hand-written id (`left-gun`) is kept. Tags, scopes, and recipes name no
 * ids, so they need nothing. Ids not in the blueprint and steps of nothing are skipped; with nothing left to move the
 * same blueprint comes back.
 *
 * One step per part is what mirror mode needs: the left half moves by (dx, dy) and the right half by (-dx, dy) in one
 * call, and both halves land or neither does.
 */
export function movePartsBy(bp: Blueprint, registry: PartRegistry, steps: ReadonlyMap<string, { dx: number; dy: number }>, opts: MoveOptions = {}): MoveResult {
  for (const [id, s] of steps) if (!Number.isInteger(s.dx) || !Number.isInteger(s.dy)) return { ok: false, error: `${id} can only move by whole cells, not by (${s.dx}, ${s.dy})` };
  const stepOf = (p: PlacedPart): { dx: number; dy: number } | undefined => {
    const s = steps.get(p.id);
    return s !== undefined && (s.dx !== 0 || s.dy !== 0) ? s : undefined;
  };
  if (!bp.parts.some((p) => stepOf(p) !== undefined)) return { ok: true, blueprint: bp, ids: new Map() };

  const occupied = new Map<string, string>();
  for (const p of bp.parts) if (stepOf(p) === undefined) for (const c of cellsOf(p, registry)) occupied.set(`${c.x},${c.y}`, p.id);
  const taken = new Set(bp.parts.filter((p) => stepOf(p) === undefined || !idFromPlace(p)).map((p) => p.id));
  const ids = new Map<string, string>();
  const area = opts.area;
  const parts: PlacedPart[] = [];
  for (const p of bp.parts) {
    const s = stepOf(p);
    if (s === undefined) {
      parts.push(p);
      continue;
    }
    const at: PlacedPart = { ...p, x: p.x + s.dx, y: p.y + s.dy };
    for (const c of cellsOf(at, registry)) {
      if (area && (c.x < area.minX || c.x > area.maxX || c.y < area.minY || c.y > area.maxY)) return { ok: false, error: `${p.id} would leave the build area at (${c.x}, ${c.y})` };
      const key = `${c.x},${c.y}`;
      const hit = occupied.get(key);
      if (hit !== undefined) return { ok: false, error: `${p.id} would land on ${hit} at (${c.x}, ${c.y})` };
      occupied.set(key, p.id);
    }
    const id = idFromPlace(p) ? uniqueId(partId(p.part, at.x, at.y), taken) : p.id;
    taken.add(id);
    ids.set(p.id, id);
    parts.push({ ...withId(p, id), x: at.x, y: at.y });
  }
  const out = renameIds(bp, parts, ids);
  // A grid's `=` cells under a moved part go with it, so the blueprint still reads as the file would.
  if (bp.continuations.length > 0) {
    const stepAt = new Map<string, { dx: number; dy: number }>();
    for (const p of bp.parts) {
      const s = stepOf(p);
      if (s !== undefined) for (const c of cellsOf(p, registry)) stepAt.set(`${c.x},${c.y}`, s);
    }
    out.continuations = bp.continuations.map((c) => {
      const s = stepAt.get(`${c.x},${c.y}`);
      return s === undefined ? c : { x: c.x + s.dx, y: c.y + s.dy };
    });
  }
  return { ok: true, blueprint: out, ids };
}

/** Moves the given parts by (`dx`, `dy`) cells: `movePartsBy` with one step for all of them. */
export function moveParts(bp: Blueprint, registry: PartRegistry, ids: readonly string[], dx: number, dy: number, opts: MoveOptions = {}): MoveResult {
  return movePartsBy(bp, registry, new Map(ids.map((id) => [id, { dx, dy }])), opts);
}
