import type { LegendEntry } from './types';

/**
 * Shipped tokens. Arrow tokens point the way the part acts: thrust direction, lift direction, release direction,
 * or the side the wheel sits on relative to what it mounts to.
 */
export const DEFAULT_LEGEND: Readonly<Record<string, LegendEntry>> = {
  C: { part: 'core' },
  F: { part: 'frame' },
  B: { part: 'battery' },
  X: { part: 'warhead' },
  W: { part: 'wheel', rot: 0 },
  'W^': { part: 'wheel', rot: 180 },
  'W<': { part: 'wheel', rot: 270 },
  'W>': { part: 'wheel', rot: 90 },
  'T^': { part: 'thruster', rot: 0 },
  Tv: { part: 'thruster', rot: 180 },
  'T<': { part: 'thruster', rot: 90 },
  'T>': { part: 'thruster', rot: 270 },
  P: { part: 'propeller', rot: 0 },
  Pv: { part: 'propeller', rot: 180 },
  D: { part: 'decoupler', rot: 0 },
  Dv: { part: 'decoupler', rot: 180 },
  'D<': { part: 'decoupler', rot: 90 },
  'D>': { part: 'decoupler', rot: 270 },
};
