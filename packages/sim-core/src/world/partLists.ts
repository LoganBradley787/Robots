import type { PartInstance, Robot } from './Robot';

/**
 * A robot's parts by what the tick does with them, each list in the robot's part order, so a pass over one kind of
 * part looks at those parts only instead of every part of every robot (two titans: 6000 parts, ten passes a tick).
 * Derived, never hashed. Good while the robot is as it was: its `version`, its map of parts and that map's size, as
 * for a behavior list.
 */
export interface PartLists {
  version: number;
  parts: Robot['parts'];
  size: number;
  /** Every part. */
  all: PartInstance[];
  /** Parts `armParts` looks at: smoke pods, decoys, jammers, and parts that need arming. */
  arming: PartInstance[];
  solar: PartInstance[];
  charges: PartInstance[];
  guns: PartInstance[];
  lasers: PartInstance[];
  cannons: PartInstance[];
  grapples: PartInstance[];
  /** Its body groups, in the order its parts first name them. */
  groups: number[];
  /** A velocity change in one step at or under this sets off none of its fuzes (`checkImpacts`). Crash damage has its own gate (`contactCrash`). */
  shrugsOff: number;
}

const kept = new WeakMap<Robot, PartLists>();

export function partLists(robot: Robot): PartLists {
  const had = kept.get(robot);
  if (had && had.version === robot.version && had.parts === robot.parts && had.size === robot.parts.size) return had;
  const lists: PartLists = { version: robot.version, parts: robot.parts, size: robot.parts.size, all: [], arming: [], solar: [], charges: [], guns: [], lasers: [], cannons: [], grapples: [], groups: [], shrugsOff: Infinity };
  const seen = new Set<number>();
  for (const part of robot.parts.values()) {
    const def = part.def;
    part.holder = robot;
    lists.all.push(part);
    if (def.smoke !== undefined || def.decoy !== undefined || def.jammer !== undefined || def.arming === true) lists.arming.push(part);
    if (def.solar !== undefined) lists.solar.push(part);
    if (def.charge !== undefined) lists.charges.push(part);
    if (def.gun !== undefined) lists.guns.push(part);
    if (def.laser !== undefined) lists.lasers.push(part);
    if (def.cannon !== undefined) lists.cannons.push(part);
    if (def.grapple !== undefined) lists.grapples.push(part);
    if (!seen.has(part.group)) {
      seen.add(part.group);
      lists.groups.push(part.group);
    }
    lists.shrugsOff = Math.min(lists.shrugsOff, def.impact?.speed ?? Infinity, def.charge?.crash ?? Infinity);
  }
  kept.set(robot, lists);
  return lists;
}
