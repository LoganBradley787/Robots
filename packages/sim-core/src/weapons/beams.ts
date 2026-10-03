/**
 * A laser's beam on the last tick (M14), from the barrel's end to where it stopped, for drawing and reports. Not
 * simulation state: the world rebuilds the list every tick.
 */
export interface Beam {
  /** The robot whose laser burned it, and that laser. */
  robot: number;
  laser: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** The share of its energy the laser was granted (0 to 1): a brownout burns weaker. */
  power: number;
  /** Smoke clouds the beam crossed; each halves what it burns. */
  smoke: number;
  /** What it met, as a gun's sight reads it (`SIGHT`): nothing within range, terrain, or whose part. */
  side: number;
  /** The robot and part it burned, when it met a part. */
  hitRobot?: number;
  hitPart?: string;
}
