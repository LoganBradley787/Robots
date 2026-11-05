import { partMass } from '../parts/footprint';
import type { FootprintCell, PartDef } from '../parts/types';

/**
 * Repair paid in parts: every number to play with, and the prices made from them. A robot's script scraps parts of its
 * own robot into a tank and builds or heals other parts with what it holds (`repair.ts`).
 */

/**
 * What a scrap gives back, of the part's value. 1 since 2026-11-05 (0.8 before): juice is the one thing a robot never
 * gets more of, and it goes down only when a part takes damage (Logan). A part sold at full health builds the same part
 * at full health somewhere else; one sold at half health, only one at half health.
 */
export const SCRAP_RETURN = 1;
/** The share of a part's worth that creating it costs. Healing it from nothing to full costs the rest. */
export const CREATE_SHARE = 0.5;
/** A job's seconds, as times the part's `build` seconds. 3 until 2026-11-02: Logan wanted it near instant, to see how robots behave. */
export const TIME_SCALE = 0.03;
/** A scrap's seconds, as times the seconds to build the part. */
export const SCRAP_TIME = 0.5;
/** Jobs a robot may run at once: one, and one more for each this many parts it has left. A big robot has more to work with, and less as it goes. */
export const PARTS_PER_JOB = 100;
/** A robot with more than one job at a time lands what finishes on every this many ticks, so jobs share a rebuild. */
export const LAND_EVERY = 30;
/** A created part's health, of its full health: a whole part that dies to anything. */
export const START_HEALTH = 0.01;
/** Seconds per kg for a part with no `build`: what a stock fabricator bay takes (`fabbay.json`). */
export const SECONDS_PER_KG = 0.6;

/** A part's worth: its def's `juice`, else its mass in kg. */
export function worth(def: PartDef, cells?: readonly FootprintCell[]): number {
  return def.juice ?? partMass(def, cells ?? def.footprint);
}

/**
 * What creating a part costs: the price of a part at `START_HEALTH`, the health it comes out at (50.5 percent of its
 * worth). It was `CREATE_SHARE` alone until 2026-11-05, which handed out that 1 percent of health free: with scrapping at
 * full price, a part made and sold again would have made juice from nothing.
 */
export function createCost(juice: number): number {
  return juice * (CREATE_SHARE + (1 - CREATE_SHARE) * START_HEALTH);
}

/** What healing a part by `gained`, a share of its full health, costs. */
export function healCost(juice: number, gained: number): number {
  return (1 - CREATE_SHARE) * juice * gained;
}

/** What scrapping a part at health share `health` gives back. */
export function scrapGives(juice: number, health: number): number {
  return SCRAP_RETURN * juice * (CREATE_SHARE + (1 - CREATE_SHARE) * health);
}

/** How many jobs a robot with this many parts may run at once. */
export function jobsAtOnce(parts: number): number {
  return 1 + Math.floor(parts / PARTS_PER_JOB);
}

/** Seconds to create a part, and to heal it from nothing to full. */
export function jobSeconds(def: PartDef, cells?: readonly FootprintCell[]): number {
  return (def.build ?? SECONDS_PER_KG * partMass(def, cells ?? def.footprint)) * TIME_SCALE;
}
