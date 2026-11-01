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
  /**
   * The ids of the parts of copies its bays hold (`sealedParts`). They are off: no part of a copy in here is in a pool
   * or in the lists below that feed one, and each asks for power in vain.
   */
  sealed: ReadonlySet<string>;
  /** Parts `armParts` looks at: smoke pods, decoys, jammers, and parts that need arming. */
  arming: PartInstance[];
  solar: PartInstance[];
  reactors: PartInstance[];
  /** What a reactor's heat burns out first (`World.fry`). */
  fuses: PartInstance[];
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
  const sealed = sealedParts(robot);
  const lists: PartLists = { version: robot.version, parts: robot.parts, size: robot.parts.size, all: [], sealed, arming: [], solar: [], reactors: [], fuses: [], charges: [], guns: [], lasers: [], cannons: [], grapples: [], groups: [], shrugsOff: Infinity };
  const seen = new Set<number>();
  for (const part of robot.parts.values()) {
    const def = part.def;
    part.holder = robot;
    lists.all.push(part);
    if (def.smoke !== undefined || def.decoy !== undefined || def.jammer !== undefined || def.arming === true) lists.arming.push(part);
    if (def.solar !== undefined && !sealed.has(part.id)) lists.solar.push(part);
    if (def.reactor !== undefined && !sealed.has(part.id)) lists.reactors.push(part);
    if (def.fuse === true && !sealed.has(part.id)) lists.fuses.push(part);
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

const NO_PARTS: ReadonlySet<string> = new Set();

/**
 * The parts of the copies this robot's bays hold (doc 05, Sealed bays), read off the bays, so a copy is free the moment
 * its bay lets go or is gone. A copy whose core runs this robot is the robot now (it woke in a piece that broke off
 * with its bay): there is nothing left to seal it from.
 */
function sealedParts(robot: Robot): ReadonlySet<string> {
  let scopes: Set<string> | undefined;
  for (const part of robot.parts.values()) if (part.holding === true && part.holds !== undefined) (scopes ??= new Set()).add(part.holds);
  if (!scopes) return NO_PARTS;
  const running = robot.primaryCoreId === undefined ? undefined : robot.parts.get(robot.primaryCoreId)?.tags[0];
  if (running !== undefined) scopes.delete(running);
  const out = new Set<string>();
  for (const part of robot.parts.values()) if (scopes.has(part.tags[0] ?? '')) out.add(part.id);
  return out;
}
