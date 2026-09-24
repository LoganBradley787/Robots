import { mirrorX, placeBlueprint, type Blueprint, type PartRegistry, type PlacedPart, type Rotation } from '@robots/sim-core';

/** A saved blueprint held in the builder to place as a copy (M7, `10`): its name, the blueprint with scripts, and how it is turned. */
export interface Stamp {
  name: string;
  bp: Blueprint;
  rot: Rotation;
  /** Flipped left to right (F), before turning. */
  flipped: boolean;
}

interface Spot {
  at: { x: number; y: number };
  rot: Rotation;
  mirror: boolean;
}

/** Where a click at `cell` puts the stamp: there, and in mirror mode its mirror image across the axis too. */
export function stampSpots(stamp: Stamp, cell: { x: number; y: number }, mirror: { on: boolean; axisHalfCells: number }): Spot[] {
  const spots: Spot[] = [{ at: cell, rot: stamp.rot, mirror: stamp.flipped }];
  const mx = mirrorX(cell.x, mirror.axisHalfCells);
  // The mirror image of "flip, then turn by r" is "flip the other way, then turn by -r".
  if (mirror.on && mx !== cell.x) spots.push({ at: { x: mx, y: cell.y }, rot: ((360 - stamp.rot) % 360) as Rotation, mirror: !stamp.flipped });
  return spots;
}

/** Places the stamp (and its mirror twin) as one change, or refuses the whole thing with the first reason. */
export function placeStamp(bp: Blueprint, stamp: Stamp, cell: { x: number; y: number }, mirror: { on: boolean; axisHalfCells: number }, registry: PartRegistry): { ok: true; bp: Blueprint } | { ok: false; error: string } {
  let out = bp;
  for (const s of stampSpots(stamp, cell, mirror)) {
    const r = placeBlueprint(out, stamp.bp, s.at, registry, { rot: s.rot, mirror: s.mirror });
    if (!r.ok) return r;
    out = r.blueprint;
  }
  return { ok: true, bp: out };
}

/** What the ghost draws: every part the stamp would add, and whether a click there would place it. */
export function stampGhost(bp: Blueprint, stamp: Stamp, cell: { x: number; y: number }, mirror: { on: boolean; axisHalfCells: number }, registry: PartRegistry): { parts: PlacedPart[]; ok: boolean } {
  const parts: PlacedPart[] = [];
  for (const s of stampSpots(stamp, cell, mirror)) {
    // On an empty robot nothing overlaps, so this always gives the cells, even where the real place is refused.
    const r = placeBlueprint({ ...bp, parts: [], cores: [] }, stamp.bp, s.at, registry, { rot: s.rot, mirror: s.mirror });
    if (r.ok) parts.push(...r.blueprint.parts);
  }
  return { parts, ok: placeStamp(bp, stamp, cell, mirror, registry).ok };
}
