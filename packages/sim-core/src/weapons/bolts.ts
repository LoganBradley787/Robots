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
  /**
   * N s shared out along its path among the parts it hits, by their share of its damage. A broken part's share goes
   * to the nearest part of its robot still standing.
   */
  push: number;
  /**
   * The speed its pushes have given so far, m/s, by the robot that took them (the most any one body of it took): held to
   * `BOLT_MAX_DV` in all. Absent until a push of it lands.
   */
  kicks?: { robot: number; dv: number }[];
  /** Meters across: it takes every part its width touches. 0 is a line. */
  width: number;
  /** The lines across its width that have met terrain and hit nothing more, one bit each, lowest offset first. */
  dead: number;
  /** Ticks of flight it has left. */
  ticks: number;
}
