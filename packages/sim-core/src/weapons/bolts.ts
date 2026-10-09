/**
 * A charged gun's shot in flight (M15: the cannon's orb, the lance's bolt). Not a body: the world moves it each tick
 * and takes the parts on its path, nearest first, until its damage is spent.
 */
export interface Bolt {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Where it was one tick ago, for drawing between ticks. */
  px: number;
  py: number;
  /** The robot whose gun fired it, and that gun (its own colliders are never hit). */
  robot: number;
  gun: string;
  /** The damage it left the barrel with, and what it has left to give. */
  damage: number;
  left: number;
  /** N s shared out along its path among the parts it hits, by their share of its damage. */
  push: number;
  /** Meters across: it takes every part its width touches. 0 is a line. */
  width: number;
  /** Ticks of flight it has left. */
  ticks: number;
}
