/** The outputs every gun has (M13): its sight (what it would hit first, whose, which robot) and its barrel's angle. */
export const GUN_OUTPUTS = ['sight', 'sightSide', 'sightId', 'aim'] as const;

/**
 * What a gun's sight sees first (`sightSide`), as numbers because outputs are numbers: nothing within range, its own
 * robot, a robot on its side, an enemy, a robot nobody controls (debris, a bomb, a wreck), or terrain (the ground).
 */
export const SIGHT = { nothing: 0, own: 1, friend: 2, enemy: 3, none: 4, terrain: 5 } as const;

/** A shell in flight (M13). Not a body: the world moves it each tick and casts a ray along the way. */
export interface Shell {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Where it was one tick ago, for drawing between ticks. */
  px: number;
  py: number;
  /** The robot whose gun fired it, and that gun (its own collider is never hit). */
  robot: number;
  gun: string;
  damage: number;
  /** N s given to what it hits, along its path. */
  push: number;
  /** Ticks it has left. */
  left: number;
}

/** A gun's sight after the last physics step (M13). */
export interface GunSight {
  distance: number;
  side: number;
  id: number;
  aim: number;
}
