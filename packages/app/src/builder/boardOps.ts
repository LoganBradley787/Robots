import {
  footprintOf,
  mirrorable,
  mirroredShift,
  mirrorProblem,
  mirrorRotation,
  mirrorX,
  movePartsBy,
  partCells,
  partDrivers,
  placePart,
  placePartStamp,
  removeParts,
  replacePartAt,
  replacePartType,
  stampPlacement,
  type Blueprint,
  type PartDrivers,
  type PartRegistry,
  type PartStamp,
  type PlacedPart,
  type ReplaceReport,
  type Rotation,
} from '@robots/sim-core';

/**
 * What the board does to a blueprint (M16), as pure functions over sim-core's edit operations: place, swap, erase,
 * move, each with mirror mode's rule that both halves land or neither does. The reducer (`editorState.ts`) calls
 * these; nothing here knows about the mouse.
 */

export interface Cell {
  x: number;
  y: number;
}

export interface MirrorSetting {
  on: boolean;
  /** The axis is the line x = axisHalfCells / 2. */
  axisHalfCells: number;
}

/** One part swapped for another type: what it kept and lost, and what drove it before (worked out before the swap). */
export interface SwapOutcome {
  report: ReplaceReport;
  drivers: PartDrivers;
}

/** What an edit did besides changing the blueprint, for the notice and the offer that follow it. */
export interface Fx {
  /** Blank parts just placed (ids). */
  placed?: string[];
  swaps?: SwapOutcome[];
  /** Parts whose id changed (a move, a swap): old id to new id. */
  renames?: Map<string, string>;
}

export function cellsOfPart(p: PlacedPart, registry: PartRegistry): Cell[] {
  return registry.has(p.part) ? partCells(p, registry).map((c) => c.cell) : [{ x: p.x, y: p.y }];
}

/** Every part with a cell among `cells`, in blueprint order. */
export function partsOn(bp: Blueprint, registry: PartRegistry, cells: readonly Cell[]): PlacedPart[] {
  return bp.parts.filter((p) => cellsOfPart(p, registry).some((c) => cells.some((d) => d.x === c.x && d.y === c.y)));
}

/** How the board names a part type in a sentence: "gun", "swivel thruster". */
export function typeName(registry: PartRegistry, type: string): string {
  return registry.has(type) ? registry.get(type).name.toLowerCase() : type;
}

/** "1 gun", "3 guns", "2 parts" for a mix. */
export function countParts(registry: PartRegistry, types: readonly string[]): string {
  const kinds = new Set(types);
  const word = kinds.size === 1 ? typeName(registry, types[0] ?? '') : 'part';
  return `${types.length} ${word}${types.length === 1 ? '' : 's'}`;
}

interface Spot {
  x: number;
  y: number;
  rot: Rotation;
}

/** Where a part's mirror image stands: the mirrored cell, turned the mirrored way. Undefined for a part with no mirror image. */
function mirroredSpot(registry: PartRegistry, part: string, size: [number, number] | undefined, at: Spot, axisHalfCells: number): Spot | undefined {
  if (!registry.has(part)) return undefined;
  const def = registry.get(part);
  if (!mirrorable(def)) return undefined;
  const rot = mirrorRotation(at.rot);
  // A multi-cell part symmetric about another column than its origin's moves its origin when mirrored (M12).
  const shift = mirroredShift(footprintOf(def, size), rot);
  return { x: mirrorX(at.x, axisHalfCells) + shift.x, y: at.y + shift.y, rot };
}

/**
 * The part that is `p`'s mirror image across the axis: the same type at the mirrored cell, turned the mirrored way.
 * Undefined when there is none, or when `p` is its own image (it sits on the axis).
 */
export function mirrorTwin(bp: Blueprint, registry: PartRegistry, p: PlacedPart, axisHalfCells: number): PlacedPart | undefined {
  const s = mirroredSpot(registry, p.part, p.size, p, axisHalfCells);
  if (!s) return undefined;
  const twin = bp.parts.find((q) => q.part === p.part && q.x === s.x && q.y === s.y && q.rot === s.rot);
  return twin === p ? undefined : twin;
}

export type PlaceOutcome = { ok: true; bp: Blueprint; fx: Fx } | { ok: false; error: string };

const overlap = (a: readonly Cell[], b: readonly Cell[]): boolean => a.some((c) => b.some((d) => d.x === c.x && d.y === c.y));

/**
 * Places the part in hand on a cell (M16). A taken cell refuses it, with the reason; with `swap` (Shift) the part there
 * gives way and the new one keeps its groups and the settings that still apply (`replacePartAt`), and keeps answering
 * to the old type's name when a key or a script drove it by that name. The same part already standing there is not a
 * refusal: nothing changes. In mirror mode the mirror image is placed too, and both land or neither does.
 */
export function placeHeld(bp: Blueprint, registry: PartRegistry, held: { part: string; rot: Rotation }, cell: Cell, mirror: MirrorSetting, swap: boolean): PlaceOutcome {
  if (!registry.has(held.part)) return { ok: false, error: `There is no part called "${held.part}".` };
  const first: Spot = { x: cell.x, y: cell.y, rot: held.rot };
  const spots: Spot[] = [first];
  if (mirror.on && mirrorX(cell.x, mirror.axisHalfCells) !== cell.x) {
    // A part with no mirror image (a lopsided multi-cell part, M12) is placed once.
    const twin = mirroredSpot(registry, held.part, undefined, first, mirror.axisHalfCells);
    if (twin) spots.push(twin);
  }
  const probe = (s: Spot): PlacedPart => ({ id: '', part: held.part, x: s.x, y: s.y, rot: s.rot, tags: [] });
  const cells = spots.map((s) => cellsOfPart(probe(s), registry));
  if (cells.length === 2 && overlap(cells[0] ?? [], cells[1] ?? [])) return { ok: false, error: 'The two halves would overlap across the mirror line.' };

  const name = typeName(registry, held.part);
  let out = bp;
  const fx: Required<Fx> = { placed: [], swaps: [], renames: new Map() };
  for (const [i, s] of spots.entries()) {
    const hit = partsOn(out, registry, cells[i] ?? []);
    const same = hit[0];
    if (hit.length === 1 && same && same.part === held.part && same.x === s.x && same.y === s.y && same.rot === s.rot) continue;
    const where = i === 0 ? 'That cell' : 'The mirrored cell';
    if (hit.length === 0) {
      out = placePart(out, registry, held.part, s.x, s.y, s.rot);
      const made = out.parts[out.parts.length - 1];
      if (made) fx.placed.push(made.id);
      continue;
    }
    const taken = hit.length === 1 && same ? `a ${typeName(registry, same.part)}` : `${hit.length} parts`;
    if (!swap) return { ok: false, error: `${where} is taken by ${taken}. Hold Shift to swap ${hit.length === 1 ? 'it' : 'one part'} for the ${name}.` };
    if (hit.length > 1 || !same) return { ok: false, error: `A ${name} there would cover ${taken}. It can take the place of one.` };
    const drivers = partDrivers(out, registry, same.id, held.part);
    const r = replacePartAt(out, registry, held.part, s.x, s.y, s.rot, { keepTypeTag: drivers.byType });
    if (!r.ok) return { ok: false, error: sentence(r.error) };
    out = r.blueprint;
    fx.swaps.push({ report: r.report, drivers });
    for (const [from, to] of r.ids) fx.renames.set(from, to);
  }
  return { ok: true, bp: out, fx };
}

/** A held copy of parts (M16: "another like it", Cmd+D): the parts with their groups and settings, and how it is turned. */
export interface HeldCopy {
  stamp: PartStamp;
  rot: Rotation;
  /** Flipped left to right (F), before turning. */
  flipped: boolean;
}

function copySpots(copy: HeldCopy, cell: Cell, mirror: MirrorSetting, registry: PartRegistry): Array<{ at: Cell; rot: Rotation; mirror: boolean }> {
  const spots = [{ at: cell, rot: copy.rot, mirror: copy.flipped }];
  const mx = mirrorX(cell.x, mirror.axisHalfCells);
  // The mirror image of "flip, then turn by r" is "flip the other way, then turn by -r". Parts that cannot be flipped are placed once.
  if (mirror.on && mx !== cell.x && mirrorProblem(copy.stamp, registry) === undefined) spots.push({ at: { x: mx, y: cell.y }, rot: ((360 - copy.rot) % 360) as Rotation, mirror: !copy.flipped });
  return spots;
}

/** Where a held copy's parts would stand with its anchor on `cell` (and its mirror image, in mirror mode): for the ghost. */
export function copyGhost(copy: HeldCopy, cell: Cell, mirror: MirrorSetting, registry: PartRegistry): PlacedPart[] {
  return copySpots(copy, cell, mirror, registry).flatMap((s) => stampPlacement(copy.stamp, s.at, registry, { rot: s.rot, mirror: s.mirror }));
}

/**
 * Places a held copy with its anchor on `cell`: every part keeps the original's groups and settings (`placePartStamp`).
 * All of it lands, with its mirror image in mirror mode, or none of it. A copy of one part landing on that very part
 * (same type, same turn) changes nothing, so a drag can pass over what it has painted.
 */
export function placeCopy(bp: Blueprint, registry: PartRegistry, copy: HeldCopy, cell: Cell, mirror: MirrorSetting): PlaceOutcome {
  let out = bp;
  const one = copy.stamp.parts.length === 1;
  for (const [i, s] of copySpots(copy, cell, mirror, registry).entries()) {
    const want = stampPlacement(copy.stamp, s.at, registry, { rot: s.rot, mirror: s.mirror });
    const only = want[0];
    if (one && only && out.parts.some((p) => p.part === only.part && p.x === only.x && p.y === only.y && p.rot === only.rot)) continue;
    const r = placePartStamp(out, registry, copy.stamp, s.at, { rot: s.rot, mirror: s.mirror });
    if (!r.ok) return { ok: false, error: i === 0 ? takenText(out, registry, want) ?? sentence(r.error) : `The mirrored copy does not fit: ${r.error}.` };
    out = r.blueprint;
  }
  // A copy is not blank (it has the original's groups), so it is not listed as `placed`: nothing is offered for it.
  return { ok: true, bp: out, fx: {} };
}

/** "That cell is taken by a frame." for parts that would land on others, else undefined. */
function takenText(bp: Blueprint, registry: PartRegistry, want: readonly PlacedPart[]): string | undefined {
  const hit = partsOn(bp, registry, want.flatMap((p) => cellsOfPart(p, registry)));
  const first = hit[0];
  if (!first) return undefined;
  if (want.length === 1) return `That cell is taken by a ${typeName(registry, first.part)}. A copy lands only on empty cells.`;
  return `The copy would land on ${hit.length === 1 ? `a ${typeName(registry, first.part)}` : `${hit.length} parts`}. It needs empty cells.`;
}

/** An engine reason as a sentence: a capital first, a full stop last. */
export function sentence(text: string): string {
  const t = text.trim();
  if (t === '') return t;
  return `${t[0]?.toUpperCase() ?? ''}${t.slice(1)}${/[.!?]$/.test(t) ? '' : '.'}`;
}

/** The parts the eraser would remove at a cell: the one under it, and in mirror mode the one under the mirrored cell. */
export function eraseTargets(bp: Blueprint, registry: PartRegistry, cell: Cell, mirror: MirrorSetting): PlacedPart[] {
  const cells = [cell];
  const mx = mirrorX(cell.x, mirror.axisHalfCells);
  if (mirror.on && mx !== cell.x) cells.push({ x: mx, y: cell.y });
  return partsOn(bp, registry, cells);
}

/** Erases at a cell (and its mirror image) as one change. */
export function eraseAt(bp: Blueprint, registry: PartRegistry, cell: Cell, mirror: MirrorSetting): Blueprint {
  const hit = eraseTargets(bp, registry, cell, mirror);
  return hit.length === 0 ? bp : removeParts(bp, hit.map((p) => p.id), registry);
}

/**
 * The step each part takes when the selection moves by (`dx`, `dy`): the selected parts that step, and in mirror mode
 * the mirror image of each (a part not itself selected) the mirrored step. One map for `movePartsBy`, so everything
 * lands or nothing does.
 */
export function moveSteps(bp: Blueprint, registry: PartRegistry, ids: readonly string[], dx: number, dy: number, mirror: MirrorSetting): Map<string, { dx: number; dy: number }> {
  const steps = new Map<string, { dx: number; dy: number }>();
  for (const p of bp.parts) if (ids.includes(p.id)) steps.set(p.id, { dx, dy });
  if (mirror.on) {
    for (const p of bp.parts) {
      if (!ids.includes(p.id)) continue;
      const twin = mirrorTwin(bp, registry, p, mirror.axisHalfCells);
      if (twin && !steps.has(twin.id)) steps.set(twin.id, { dx: -dx, dy });
    }
  }
  return steps;
}

export type MoveOutcome = { ok: true; bp: Blueprint; selection: string[]; renames: Map<string, string> } | { ok: false; error: string };

/** Moves the selection by whole cells with its groups and settings (`movePartsBy`); blocked, nothing moves and it says why. */
export function moveSelection(bp: Blueprint, registry: PartRegistry, ids: readonly string[], dx: number, dy: number, mirror: MirrorSetting): MoveOutcome {
  const r = movePartsBy(bp, registry, moveSteps(bp, registry, ids, dx, dy, mirror));
  if (!r.ok) return { ok: false, error: `Blocked: ${r.error}. Nothing moved.` };
  return { ok: true, bp: r.blueprint, selection: ids.map((id) => r.ids.get(id) ?? id), renames: r.ids };
}

export type SwapResult = { ok: true; bp: Blueprint; swaps: SwapOutcome[]; ids: Map<string, string> } | { ok: false; error: string };

/**
 * Swaps the given parts for another type where they stand (M16, Swap to): every one, or none when one does not fit.
 * A part that a key or a script drove by its type name keeps answering to that name (`keepTypeTag`), so they still
 * reach it. Each outcome carries what drove the part before the swap, with what will not work on the new type.
 */
export function swapParts(bp: Blueprint, registry: PartRegistry, ids: readonly string[], newType: string): SwapResult {
  let out = bp;
  const swaps: SwapOutcome[] = [];
  const renames = new Map<string, string>();
  for (const id of ids) {
    const old = out.parts.find((p) => p.id === id);
    if (!old || old.part === newType) continue;
    const drivers = partDrivers(out, registry, id, newType);
    const r = replacePartType(out, registry, id, newType, { keepTypeTag: drivers.byType });
    if (!r.ok) return { ok: false, error: sentence(r.error) };
    out = r.blueprint;
    swaps.push({ report: r.report, drivers });
    for (const [from, to] of r.ids) renames.set(from, to);
  }
  return { ok: true, bp: out, swaps, ids: renames };
}

/** A group a blank part just placed could join, with the parts that would join it. */
export interface GroupOffer {
  tag: string;
  ids: string[];
}

/**
 * What to offer a blank part just placed (M16): when it touches parts of its own type that all share a group, "add to
 * group X". Parts placed together that touch each other (a drag) are one cluster, judged by the older parts of their
 * type they touch; the offer is for the whole cluster. Nothing is offered when the neighbours share no group, or when
 * there are none.
 */
export function groupOffers(bp: Blueprint, registry: PartRegistry, placed: readonly string[]): GroupOffer[] {
  const fresh = bp.parts.filter((p) => placed.includes(p.id));
  if (fresh.length === 0) return [];
  const cells = new Map(bp.parts.map((p) => [p.id, cellsOfPart(p, registry)]));
  const touches = (a: PlacedPart, b: PlacedPart): boolean => (cells.get(a.id) ?? []).some((c) => (cells.get(b.id) ?? []).some((d) => Math.abs(c.x - d.x) + Math.abs(c.y - d.y) === 1));
  const offers = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const start of fresh) {
    if (seen.has(start.id)) continue;
    // The cluster: fresh parts of one type, each touching another of them.
    const cluster = [start];
    seen.add(start.id);
    for (let i = 0; i < cluster.length; i++) {
      for (const q of fresh) {
        if (seen.has(q.id) || q.part !== start.part || !touches(cluster[i] as PlacedPart, q)) continue;
        seen.add(q.id);
        cluster.push(q);
      }
    }
    const old = bp.parts.filter((q) => q.part === start.part && !placed.includes(q.id) && cluster.some((c) => touches(c, q)));
    const first = old[0];
    if (!first) continue;
    const shared = first.tags.filter((t) => t !== first.id && old.every((q) => q.tags.includes(t)));
    for (const tag of shared) offers.set(tag, [...(offers.get(tag) ?? []), ...cluster.map((c) => c.id)]);
  }
  return [...offers].map(([tag, ids]) => ({ tag, ids }));
}
