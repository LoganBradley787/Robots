import { partMass } from '../parts/footprint';
import type { FootprintCell, PartDef } from '../parts/types';

/**
 * Repair paid in parts: every number to play with, and the prices made from them. A robot's script scraps parts of its
 * own robot into a tank and builds or heals other parts with what it holds (`repair.ts`).
 */

/** What a scrap gives back, of the part's value. */
export const SCRAP_RETURN = 0.8;
/** The share of a part's worth that creating it costs. Healing it from nothing to full costs the rest. */
export const CREATE_SHARE = 0.5;
/** A job's seconds, as times the part's `build` seconds. */
export const TIME_SCALE = 3;
/** A scrap's seconds, as times the seconds to build the part. */
export const SCRAP_TIME = 0.5;
/** Jobs a robot may run at once. */
export const JOBS_AT_ONCE = 1;
/** A created part's health, of its full health: a whole part that dies to anything. */
export const START_HEALTH = 0.01;
/** Seconds per kg for a part with no `build`: what a stock fabricator bay takes (`fabbay.json`). */
export const SECONDS_PER_KG = 0.6;

/** A part's worth: its def's `juice`, else its mass in kg. */
export function worth(def: PartDef, cells?: readonly FootprintCell[]): number {
  return def.juice ?? partMass(def, cells ?? def.footprint);
}

/** What creating a part costs. */
export function createCost(juice: number): number {
  return CREATE_SHARE * juice;
}

/** What healing a part by `gained`, a share of its full health, costs. */
export function healCost(juice: number, gained: number): number {
  return (1 - CREATE_SHARE) * juice * gained;
}

/** What scrapping a part at health share `health` gives back. */
export function scrapGives(juice: number, health: number): number {
  return SCRAP_RETURN * juice * (CREATE_SHARE + (1 - CREATE_SHARE) * health);
}

/** Seconds to create a part, and to heal it from nothing to full. */
export function jobSeconds(def: PartDef, cells?: readonly FootprintCell[]): number {
  return (def.build ?? SECONDS_PER_KG * partMass(def, cells ?? def.footprint)) * TIME_SCALE;
}
